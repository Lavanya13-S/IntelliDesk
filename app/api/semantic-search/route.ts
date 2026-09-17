import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
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
    return data.embedding?.values || null;
  } catch {
    return null;
  }
}

function textSimilarity(query: string, text: string): number {
  const qWords = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const tWords = new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  if (qWords.size === 0 || tWords.size === 0) return 0;
  let intersection = 0;
  for (const w of Array.from(qWords)) if (tWords.has(w)) intersection++;
  const union = qWords.size + tWords.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export async function POST(req: NextRequest) {
  try {
    const { query, threshold = 0.25, limit = 5 } = await req.json();
    if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 });

    const geminiKey = await getGeminiKey();
    let results: any[] = [];
    let usedVector = false;
    let usedAI = false;

    // Primary: pgvector search
    if (geminiKey) {
      const queryEmbedding = await generateEmbedding(query, geminiKey);
      if (queryEmbedding) {
        const { data: vectorResults, error: vectorError } = await supabase.rpc(
          'match_document_chunks',
          { query_embedding: queryEmbedding, match_threshold: threshold, match_count: limit * 2 }
        );

        if (!vectorError && vectorResults && vectorResults.length > 0) {
          const docIds = [...Array.from(new Set(vectorResults.map((r: any) => String(r.document_id))))];
          const { data: docs } = await supabase
            .from('documents')
            .select('id, title, document_type')
            .in('id', docIds);
          const docMap = new Map((docs || []).map((d: any) => [String(d.id), d]));

          results = vectorResults.slice(0, limit).map((r: any) => {
            const doc = (docMap.get(String(r.document_id)) || {}) as any;
            return {
              id: r.id,
              document_id: r.document_id,
              chunk_text: r.chunk_text,
              chunk_index: r.chunk_index,
              title: doc.title || 'Unknown Document',
              document_type: doc.document_type || 'document',
              similarity: r.similarity,
            };
          });
          usedVector = true;
        }
      }
    }

    // Fallback: ilike substring search first, then Jaccard word-overlap
    if (!usedVector) {
      // Step 1: Try direct substring match (handles partial names like "kaar")
      const { data: ilikeChunks } = await supabase
        .from('document_chunks')
        .select('id, document_id, chunk_text, chunk_index, documents(title, document_type)')
        .ilike('chunk_text', `%${query}%`)
        .limit(limit);

      if (ilikeChunks && ilikeChunks.length > 0) {
        results = ilikeChunks.map((chunk: any) => {
          const doc = chunk.documents as any;
          return {
            id: chunk.id,
            document_id: chunk.document_id,
            chunk_text: chunk.chunk_text,
            chunk_index: chunk.chunk_index,
            title: doc?.title || 'Unknown Document',
            document_type: doc?.document_type || 'document',
            similarity: 0.5, // fixed relevance score for substring match
          };
        });
      } else {
        // Step 2: Jaccard word-overlap across all chunks
        const { data: chunks } = await supabase
          .from('document_chunks')
          .select('id, document_id, chunk_text, chunk_index, documents(title, document_type)')
          .limit(3000);

        if (chunks && chunks.length > 0) {
          const scored = chunks
            .map((chunk: any) => {
              const doc = chunk.documents as any;
              return {
                id: chunk.id,
                document_id: chunk.document_id,
                chunk_text: chunk.chunk_text,
                chunk_index: chunk.chunk_index,
                title: doc?.title || 'Unknown Document',
                document_type: doc?.document_type || 'document',
                similarity: textSimilarity(query, chunk.chunk_text || ''),
              };
            })
            .filter((c: any) => c.similarity >= 0.01)
            .sort((a: any, b: any) => b.similarity - a.similarity)
            .slice(0, limit);
          results = scored;
        }
      }
    }

    // AI answer from top chunks
    let answer = '';
    if (results.length > 0 && geminiKey) {
      const context = results
        .slice(0, 4)
        .map((c: any, idx: number) => `[${idx + 1}] ${c.title}:\n${c.chunk_text}`)
        .join('\n\n');

      try {
        const aiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `Answer the employee's question using ONLY the knowledge base excerpts below. Be concise and accurate. Do not mention you are using a knowledge base.\n\nQuestion: ${query}\n\nKnowledge Base:\n${context}\n\nAnswer:` }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
            }),
          }
        );
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const text = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) { answer = String(text).trim(); usedAI = true; }
        }
      } catch { /* fallback */ }
    }

    return NextResponse.json({ results, answer, used_ai: usedAI, used_vector: usedVector, result_count: results.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
