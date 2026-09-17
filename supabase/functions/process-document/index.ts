import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - Deno URL import, not resolvable by Node TS tooling
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Deno global declaration for Node-based TypeScript tooling
declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Text Chunking ────────────────────────────────────────────────────────────

/**
 * Splits text into overlapping chunks of ~1000 chars.
 * Sentence-aware: prefers to break on sentence boundaries.
 */
function chunkText(text: string, maxChunkSize = 1000, overlap = 150): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Keep last ~overlap chars as context for the next chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += sentence + " ";
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((c) => c.length > 20);
}

// ─── Gemini Embedding ─────────────────────────────────────────────────────────

/**
 * Generates a 768-dim vector using Gemini gemini-embedding-001.
 * Returns null on any error — chunk is stored without embedding in that case.
 */
async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: text.slice(0, 2048) }] },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini embedding API error:", res.status, errText);
      return null;
    }

    const data = await res.json();
    return data.embedding?.values || null;
  } catch (err) {
    console.error("generateEmbedding failed:", err);
    return null;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const {
      title,
      content,
      document_type,
      file_name,
      mime_type,
      file_data_base64,
    } = await req.json();

    if (!title || !content) {
      return new Response(
        JSON.stringify({ error: "Missing title or content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const hasGemini = !!geminiKey;

    // ── Step 1: Upload original file to Supabase Storage ──────────────────────
    let fileUrl: string | null = null;
    const storageBucket = "knowledge-documents";

    if (file_data_base64 && file_name) {
      try {
        const binary = atob(file_data_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        const safeName = String(file_name).replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${crypto.randomUUID()}/${Date.now()}_${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from(storageBucket)
          .upload(path, bytes, {
            contentType: mime_type || "application/pdf",
            upsert: false,
          });

        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage
            .from(storageBucket)
            .getPublicUrl(path);
          fileUrl = publicUrlData.publicUrl;
        } else {
          console.warn("Storage upload failed (non-fatal):", uploadError.message);
        }
      } catch (storageErr) {
        console.warn("File upload skipped:", storageErr);
      }
    }

    // ── Step 2: Generate document-level embedding ─────────────────────────────
    let docEmbedding: number[] | null = null;
    if (hasGemini) {
      const summaryText = `${title}. ${content.slice(0, 600)}`;
      docEmbedding = await generateEmbedding(summaryText, geminiKey);
    }

    // ── Step 3: Insert document record ────────────────────────────────────────
    const { data: docData, error: docError } = await supabase
      .from("documents")
      .insert({
        title,
        content,
        file_url: fileUrl,
        document_type: document_type || "document",
        embedding: docEmbedding,
      })
      .select()
      .single();

    if (docError) {
      return new Response(
        JSON.stringify({ error: `Document insert failed: ${docError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Step 4: Chunk text ────────────────────────────────────────────────────
    const chunks = chunkText(content);
    let embeddedChunks = 0;
    let failedChunks = 0;

    // ── Step 5: Insert each chunk with its embedding ──────────────────────────
    for (let i = 0; i < chunks.length; i++) {
      let embedding: number[] | null = null;

      if (hasGemini) {
        embedding = await generateEmbedding(chunks[i], geminiKey);
        if (embedding) {
          embeddedChunks++;
        }

        // Rate-limit protection: pause every 5 chunks to stay under Gemini quota
        if (i > 0 && i % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      const { error: chunkError } = await supabase.from("document_chunks").insert({
        document_id: docData.id,
        chunk_text: chunks[i],
        chunk_index: i,
        embedding, // null if Gemini unavailable — Jaccard fallback will still work
      });

      if (chunkError) {
        console.error(`Chunk ${i} insert failed:`, chunkError.message);
        failedChunks++;
        // Continue to next chunk — partial indexing is better than total failure
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        document: docData,
        chunks: chunks.length,
        embedded_chunks: embeddedChunks,
        failed_chunks: failedChunks,
        embeddings_enabled: hasGemini,
        message: hasGemini
          ? `Indexed ${chunks.length} chunks with ${embeddedChunks} Gemini embeddings. Vector search is now active.`
          : `Indexed ${chunks.length} chunks (no Gemini key set — text search only).`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-document error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
