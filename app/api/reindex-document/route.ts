import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Re-chunk + Embed existing document content ───────────────────────────────
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

// ─── POST /api/reindex-document ───────────────────────────────────────────────
// Body: { document_id: string }
//
// Steps:
// 1. Load document content from DB
// 2. Check it is not the generic error string
// 3. Delete old document_chunks for this document
// 4. Re-chunk the content
// 5. Generate fresh Gemini embeddings
// 6. Store new chunks
export async function POST(req: NextRequest) {
  try {
    const { document_id } = await req.json();
    if (!document_id) {
      return NextResponse.json({ error: 'Missing document_id' }, { status: 400 });
    }

    // 1. Load the document
    const { data: doc, error: docFetchErr } = await supabase
      .from('documents')
      .select('id, title, content, document_type')
      .eq('id', document_id)
      .single();

    if (docFetchErr || !doc) {
      return NextResponse.json(
        { error: docFetchErr?.message || 'Document not found', document_id },
        { status: 404 }
      );
    }

    const content: string = doc.content || '';

    // 2. Detect if content is a legacy error string (from the old swallowed-exception pattern)
    const isErrorContent = content.startsWith('[PDF:') || content.startsWith('[DOCX:') ||
      content.startsWith('[Image:') || content.startsWith('[OCR') ||
      content.startsWith('[Excel:') || content.startsWith('[PowerPoint:') ||
      content.startsWith('[ZIP:') || content.includes('Could not extract text');

    if (isErrorContent) {
      return NextResponse.json(
        {
          error: 'Document content contains an extraction error string — re-upload the file to extract proper text.',
          stored_content_preview: content.slice(0, 200),
          document_id,
          title: doc.title,
          hint: 'Delete this document and re-upload the PDF. The extraction pipeline is now fixed and will extract real text.',
        },
        { status: 422 }
      );
    }

    if (content.trim().length < 50) {
      return NextResponse.json(
        {
          error: `Document content is too short to re-index (${content.length} chars)`,
          document_id,
          title: doc.title,
        },
        { status: 422 }
      );
    }

    console.log(`[reindex-document] Re-indexing "${doc.title}" (${content.length} chars)`);

    // 3. Delete old chunks
    const { error: deleteErr } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', document_id);

    if (deleteErr) {
      console.error('[reindex-document] Failed to delete old chunks:', deleteErr.message);
      return NextResponse.json(
        { error: `Failed to delete old chunks: ${deleteErr.message}` },
        { status: 500 }
      );
    }
    console.log(`[reindex-document] Old chunks deleted for document "${doc.title}"`);

    // 4. Re-chunk
    const chunks = chunkText(content);
    console.log(`[reindex-document] Created ${chunks.length} chunks`);

    // 5. Get Gemini key and embed
    const geminiKey = await getGeminiKey();
    let embeddedChunks = 0;
    let storedChunks = 0;
    let firstInsertError = '';

    for (let i = 0; i < chunks.length; i++) {
      let embedding: number[] | null = null;
      if (geminiKey) {
        embedding = await generateEmbedding(chunks[i], geminiKey);
        if (embedding) embeddedChunks++;
        if (i > 0 && i % 5 === 0) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      const { error: chunkError } = await supabase.from('document_chunks').insert({
        document_id,
        chunk_text: chunks[i],
        chunk_index: i,
        embedding,
        metadata: { source_type: doc.document_type || 'document', reindexed: true },
      });

      if (chunkError) {
        console.error(`[reindex-document] chunk ${i} insert failed:`, chunkError.message);
        if (!firstInsertError) firstInsertError = chunkError.message;
      } else {
        storedChunks++;
      }
    }

    console.log(`[reindex-document] Complete: ${storedChunks}/${chunks.length} chunks stored, ${embeddedChunks} embeddings`);

    if (storedChunks === 0) {
      return NextResponse.json(
        {
          error: `Re-chunking produced ${chunks.length} chunks but all DB inserts failed.`,
          db_error: firstInsertError,
          document_id,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      document_id,
      title: doc.title,
      chars_in_content: content.length,
      chunks_stored: storedChunks,
      attempted_chunks: chunks.length,
      embeddings_generated: embeddedChunks,
      embeddings_enabled: !!geminiKey,
      message: `Re-indexed "${doc.title}": ${storedChunks} chunks, ${embeddedChunks} embeddings.`,
    });

  } catch (err: any) {
    console.error('[reindex-document] Unexpected error:', err);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
