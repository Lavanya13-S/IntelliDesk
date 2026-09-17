import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sanitizeForKnowledgeBase } from '@/lib/sanitize';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── Gemini key helper (same pattern as other routes) ──────────────────────────

async function getGeminiKey(): Promise<string | null> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const { data } = await supabase
      .from('ai_settings')
      .select('gemini_api_key')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.gemini_api_key || null;
  } catch {
    return null;
  }
}

// ── Generate embedding via Gemini ─────────────────────────────────────────────

async function generateEmbedding(text: string, geminiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: text.slice(0, 2048) }] },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding?.values ?? null;
  } catch {
    return null;
  }
}

// ── Generate KB article via Gemini Flash ──────────────────────────────────────

async function generateArticle(
  geminiKey: string,
  intent: string,
  department: string,
  emailSubject: string,
  resolutionEmailBody: string
): Promise<{
  title: string;
  category: string;
  problem_summary: string;
  resolution_steps: string[];
  keywords: string[];
} | null> {
  const prompt = `You are an IT Knowledge Base writer for an enterprise ITSM system.

A ticket has been resolved. Generate a structured Knowledge Base article based on the following details.

INTENT: ${intent}
DEPARTMENT: ${department}
EMAIL SUBJECT: ${emailSubject}
RESOLUTION EMAIL (sanitized): ${resolutionEmailBody.slice(0, 1500)}

STRICT RULES:
1. NEVER include passwords, credentials, temporary passwords, license keys, VPN secrets, API keys, tokens, or any sensitive information.
2. Use generic, reusable language so the article helps future engineers.
3. Resolution steps should be actionable and specific to the intent.
4. Keywords should include the intent, department, and common search terms.

Respond with ONLY valid JSON matching this exact schema:
{
  "title": "Short descriptive article title (max 80 chars)",
  "category": "One of: Access Management | SAP | HR | Payroll | IT Infrastructure | Security | General IT",
  "problem_summary": "2-3 sentence summary of the problem type (no sensitive data)",
  "resolution_steps": [
    "Step 1: ...",
    "Step 2: ...",
    "Step 3: ..."
  ],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 800,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!res.ok) {
      // Surface the full error so server logs show exactly what Gemini rejected
      let errBody = '';
      try { errBody = await res.text(); } catch { /* ignore */ }
      console.error(`[create-article] Gemini error: ${res.status} ${res.statusText} — ${errBody.slice(0, 400)}`);
      return null;
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return JSON.parse(raw.trim());
  } catch (e) {
    console.error('[create-article] Article generation failed:', e);
    return null;
  }
}

// ── POST /api/knowledge/create-article ───────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      ticket_id,
      intent,
      department,
      email_subject,
      resolution_email_body,
    } = body as {
      ticket_id:             string | null;
      intent:                string | null;
      department:            string | null;
      email_subject:         string | null;
      resolution_email_body: string | null;
    };

    // ── Input validation ────────────────────────────────────────────────────
    if (!resolution_email_body?.trim()) {
      return NextResponse.json({ error: 'Missing resolution_email_body' }, { status: 400 });
    }

    const resolvedIntent     = intent     || 'General IT Request';
    const resolvedDepartment = department || 'IT';
    const resolvedSubject    = email_subject || `${resolvedIntent} — ${resolvedDepartment}`;

    // ── Sanitize FIRST before ANY processing ──────────────────────────────────
    const sanitizedBody = sanitizeForKnowledgeBase(resolution_email_body);

    // ── Get Gemini key ────────────────────────────────────────────────────────
    const geminiKey = await getGeminiKey();
    if (!geminiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    // ── Generate article content ───────────────────────────────────────────
    const article = await generateArticle(
      geminiKey,
      resolvedIntent,
      resolvedDepartment,
      resolvedSubject,
      sanitizedBody
    );

    if (!article) {
      return NextResponse.json({ error: 'Article generation failed' }, { status: 500 });
    }

    // ── Double-sanitize all AI-generated content (belt + suspenders) ──────────
    const safeTitle          = sanitizeForKnowledgeBase(article.title);
    const safeProblemSummary = sanitizeForKnowledgeBase(article.problem_summary);
    const safeSteps          = article.resolution_steps.map(sanitizeForKnowledgeBase);

    // ── Generate embedding for semantic search ────────────────────────────────
    const embeddingText = [
      safeTitle,
      resolvedIntent,
      resolvedDepartment,
      safeProblemSummary,
      ...safeSteps,
      ...article.keywords,
    ].join(' ');

    const embedding = await generateEmbedding(embeddingText, geminiKey);

    // ── Insert into resolution_articles ──────────────────────────────────────
    const { data: inserted, error: insertError } = await supabase
      .from('resolution_articles')
      .insert({
        ticket_id:        ticket_id   || null,
        title:            safeTitle,
        category:         article.category,
        department:       resolvedDepartment,
        intent:           resolvedIntent,
        problem_summary:  safeProblemSummary,
        resolution_steps: safeSteps,
        keywords:         article.keywords,
        resolution_email: sanitizedBody,  // sanitized — no credentials
        created_by:       'system',
        embedding:        embedding,
      })
      .select('id, title, category')
      .single();

    if (insertError) {
      console.error('[create-article] Insert error:', insertError.message);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.log('[create-article] KB article created:', inserted?.id, '—', inserted?.title);

    return NextResponse.json({
      success:    true,
      article_id: inserted?.id,
      title:      inserted?.title,
      category:   inserted?.category,
    });

  } catch (err: any) {
    console.error('[create-article] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
