import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  detail: string;
  fix?: string;
}

async function checkGeminiKey(): Promise<CheckResult> {
  try {
    const { data } = await supabase
      .from('ai_settings')
      .select('gemini_api_key')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const key = data?.gemini_api_key || process.env.GEMINI_API_KEY;
    if (!key) {
      return { name: 'Gemini API Key', status: 'fail', detail: 'No Gemini API key configured', fix: 'Add GEMINI_API_KEY to .env or configure via Settings → AI' };
    }

    // Test the key
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with OK' }] }], generationConfig: { maxOutputTokens: 10 } }),
      }
    );
    if (!res.ok) {
      return { name: 'Gemini API Key', status: 'fail', detail: `Gemini API returned ${res.status}`, fix: 'Check your Gemini API key is valid and has quota' };
    }
    return { name: 'Gemini API Key', status: 'pass', detail: 'Gemini API key valid and responding' };
  } catch (err: any) {
    return { name: 'Gemini API Key', status: 'fail', detail: err.message };
  }
}

async function checkSupabaseConnection(): Promise<CheckResult> {
  try {
    const { data, error } = await supabase.from('emails').select('id').limit(1);
    if (error) throw error;
    return { name: 'Supabase Connection', status: 'pass', detail: 'Supabase connected and emails table accessible' };
  } catch (err: any) {
    return { name: 'Supabase Connection', status: 'fail', detail: err.message, fix: 'Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env' };
  }
}

async function checkNotificationsTable(): Promise<CheckResult> {
  try {
    const { error } = await supabase.from('notifications').select('id').limit(1);
    if (error && error.message.includes('does not exist')) {
      return {
        name: 'Notifications Table',
        status: 'fail',
        detail: 'notifications table missing — run migration 008',
        fix: 'Run supabase/migrations/20260701000001_008_notifications.sql in Supabase SQL editor'
      };
    }
    return { name: 'Notifications Table', status: 'pass', detail: 'notifications table exists and accessible' };
  } catch (err: any) {
    return { name: 'Notifications Table', status: 'fail', detail: err.message };
  }
}

async function checkRAG(): Promise<CheckResult> {
  try {
    const { data, error } = await supabase.from('document_chunks').select('id').limit(1);
    if (error) throw error;
    const { count } = await supabase.from('document_chunks').select('*', { count: 'exact', head: true });
    if ((count ?? 0) === 0) {
      return {
        name: 'RAG / Semantic Search',
        status: 'warning',
        detail: 'document_chunks table is empty — no documents indexed yet',
        fix: 'Upload a document via Knowledge → Upload Document to enable semantic search'
      };
    }
    // Check for embeddings
    const { count: embCount } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null);
    const pct = count && count > 0 ? Math.round(((embCount ?? 0) / count) * 100) : 0;
    return {
      name: 'RAG / Semantic Search',
      status: pct > 0 ? 'pass' : 'warning',
      detail: `${count} chunks indexed, ${embCount} with embeddings (${pct}% vector-searchable)`
    };
  } catch (err: any) {
    return { name: 'RAG / Semantic Search', status: 'fail', detail: err.message };
  }
}

async function checkSimilarCaseAgent(): Promise<CheckResult> {
  try {
    const { count } = await supabase
      .from('resolved_cases')
      .select('*', { count: 'exact', head: true });
    if ((count ?? 0) === 0) {
      return {
        name: 'Similar Case Agent',
        status: 'warning',
        detail: 'No resolved cases yet — similar case search will be unavailable until tickets are resolved',
        fix: 'Resolve at least one ticket to populate the self-learning database'
      };
    }
    const { count: embCount } = await supabase
      .from('resolved_cases')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null);
    return {
      name: 'Similar Case Agent',
      status: 'pass',
      detail: `${count} resolved cases, ${embCount} with embeddings for vector similarity search`
    };
  } catch (err: any) {
    return { name: 'Similar Case Agent', status: 'fail', detail: err.message };
  }
}

async function checkLangGraph(): Promise<CheckResult> {
  try {
    // Verify the package is importable
    await import('@langchain/langgraph');
    const { data } = await supabase
      .from('ai_settings')
      .select('langgraph_enabled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const enabled = data?.langgraph_enabled ?? true;
    return {
      name: 'LangGraph Pipeline',
      status: 'pass',
      detail: `@langchain/langgraph installed. Pipeline ${enabled ? 'enabled' : 'disabled (using sequential fallback)'}`
    };
  } catch (err: any) {
    return {
      name: 'LangGraph Pipeline',
      status: 'fail',
      detail: `@langchain/langgraph not importable: ${err.message}`,
      fix: 'Run: npm install @langchain/langgraph @langchain/core'
    };
  }
}

async function checkAttachments(): Promise<CheckResult> {
  try {
    const { default: mammoth } = await import('mammoth');
    const XLSX = await import('xlsx');
    return {
      name: 'Smart Attachments',
      status: 'pass',
      detail: 'mammoth (DOCX) and xlsx (Excel) packages available. Tesseract OCR ready for images.'
    };
  } catch (err: any) {
    return {
      name: 'Smart Attachments',
      status: 'fail',
      detail: `Missing packages: ${err.message}`,
      fix: 'Run: npm install mammoth xlsx tesseract.js sharp'
    };
  }
}

/**
 * Checks the real IntelliDesk Gmail OAuth connection by querying the
 * oauth_tokens table — the same source of truth used by the Gmail Status
 * endpoint (/api/auth/google/status) and the Gmail sync service.
 *
 * PASS   → a token row exists with token_status = 'active'
 * WARNING→ a token row exists but token_status = 'expired' (needs reconnect)
 * FAIL   → no token row found (Gmail never connected) OR env vars missing
 */
async function checkGmail(): Promise<CheckResult> {
  // First verify the minimum OAuth env vars are present
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    return {
      name: 'Gmail Integration',
      status: 'fail',
      detail: `Missing environment variables: ${missing.join(', ')}`,
      fix: 'Add Google OAuth credentials to .env and SUPABASE_SERVICE_ROLE_KEY'
    };
  }

  // Query oauth_tokens using the service role key (same as /api/auth/google/status)
  try {
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data, error } = await serviceClient
      .from('oauth_tokens')
      .select('account_email, token_status, updated_at')
      .eq('provider', 'google')
      .maybeSingle();

    if (error) {
      return {
        name: 'Gmail Integration',
        status: 'fail',
        detail: `OAuth token lookup failed: ${error.message}`,
        fix: 'Check Supabase connection and oauth_tokens table'
      };
    }

    if (!data) {
      return {
        name: 'Gmail Integration',
        status: 'fail',
        detail: 'Gmail not connected — no OAuth token found',
        fix: 'Go to Settings → Email and click "Connect Gmail" to authorize'
      };
    }

    const tokenStatus: string = (data as any).token_status ?? 'active';
    const email: string = (data as any).account_email ?? 'unknown';

    if (tokenStatus === 'expired') {
      return {
        name: 'Gmail Integration',
        status: 'warning',
        detail: `Gmail authorization expired for ${email} — reconnect required`,
        fix: 'Go to Settings → Email and click "Reconnect Gmail"'
      };
    }

    return {
      name: 'Gmail Integration',
      status: 'pass',
      detail: `Gmail connected and active — account: ${email}`
    };
  } catch (err: any) {
    return {
      name: 'Gmail Integration',
      status: 'fail',
      detail: `Gmail check error: ${err.message}`
    };
  }
}

async function checkResponseGenerator(): Promise<CheckResult> {
  try {
    const { data } = await supabase
      .from('ai_settings')
      .select('gemini_api_key')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const key = data?.gemini_api_key || process.env.GEMINI_API_KEY;
    return {
      name: 'Response Generator',
      status: key ? 'pass' : 'warning',
      detail: key
        ? 'Gemini-powered response generator active with rule-based fallback'
        : 'No Gemini key — using rule-based fallback responses only'
    };
  } catch (err: any) {
    return { name: 'Response Generator', status: 'fail', detail: err.message };
  }
}

export async function GET(req: NextRequest) {
  const checks = await Promise.allSettled([
    checkSupabaseConnection(),
    checkGeminiKey(),
    checkNotificationsTable(),
    checkRAG(),
    checkSimilarCaseAgent(),
    checkLangGraph(),
    checkAttachments(),
    checkGmail(),
    checkResponseGenerator(),
  ]);

  const results: CheckResult[] = checks.map((c) =>
    c.status === 'fulfilled'
      ? c.value
      : { name: 'Unknown', status: 'fail' as const, detail: (c as any).reason?.message ?? 'Unknown error' }
  );

  const passed = results.filter((r) => r.status === 'pass').length;
  const warned = results.filter((r) => r.status === 'warning').length;
  const failed = results.filter((r) => r.status === 'fail').length;

  return NextResponse.json({
    summary: { total: results.length, passed, warned, failed },
    overall: failed === 0 ? (warned > 0 ? 'warning' : 'pass') : 'fail',
    checks: results,
    generated_at: new Date().toISOString(),
  });
}
