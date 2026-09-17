import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Text Chunking ────────────────────────────────────────────────────────────
function chunkText(text: string, maxChunkSize = 1000, overlap = 150): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
    } else {
      currentChunk += sentence + ' ';
    }
  }
  if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
  return chunks.filter((c) => c.length > 20);
}

// ─── Gemini Embedding ─────────────────────────────────────────────────────────
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

// ─── Get Gemini key (env first, then DB) ─────────────────────────────────────
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

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { title, content, document_type } = await req.json();

    if (!title || !content) {
      return NextResponse.json({ error: 'Missing title or content' }, { status: 400 });
    }

    const geminiKey = await getGeminiKey();

    // Insert document record
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .insert({ title, content, document_type: document_type || 'document' })
      .select()
      .single();

    if (docError) {
      return NextResponse.json({ error: `Document insert failed: ${docError.message}` }, { status: 500 });
    }

    // Chunk and embed
    const chunks = chunkText(content);
    let embeddedChunks = 0;
    let failedChunks = 0;

    for (let i = 0; i < chunks.length; i++) {
      let embedding: number[] | null = null;

      if (geminiKey) {
        embedding = await generateEmbedding(chunks[i], geminiKey);
        if (embedding) embeddedChunks++;
        // Rate-limit protection every 5 chunks
        if (i > 0 && i % 5 === 0) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      const { error: chunkError } = await supabase.from('document_chunks').insert({
        document_id: docData.id,
        chunk_text: chunks[i],
        chunk_index: i,
        embedding,
      });

      if (chunkError) {
        console.error(`Chunk ${i} insert failed:`, chunkError.message);
        failedChunks++;
      }
    }

    return NextResponse.json({
      success: true,
      document: docData,
      chunks: chunks.length,
      embedded_chunks: embeddedChunks,
      failed_chunks: failedChunks,
      embeddings_enabled: !!geminiKey,
      message: geminiKey
        ? `Indexed ${chunks.length} chunks with ${embeddedChunks} Gemini embeddings.`
        : `Indexed ${chunks.length} chunks (text search only).`,
    });
  } catch (err: any) {
    console.error('process-document API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
