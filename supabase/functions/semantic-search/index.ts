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

// ─── Gemini Embedding ─────────────────────────────────────────────────────────

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
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding?.values || null;
  } catch {
    return null;
  }
}

// ─── Text Similarity Fallback (Jaccard) ──────────────────────────────────────

function textSimilarity(query: string, text: string): number {
  const qWords = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const tWords = new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 2));

  if (qWords.size === 0 || tWords.size === 0) return 0;

  let intersection = 0;
  for (const w of qWords) {
    if (tWords.has(w)) intersection++;
  }

  const union = qWords.size + tWords.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { query, threshold = 0.3, limit = 5 } = await req.json();

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Missing query" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let results: any[] = [];
    let usedVector = false;

    // ── Primary: pgvector cosine similarity search ────────────────────────────
    if (geminiKey) {
      const queryEmbedding = await generateEmbedding(query, geminiKey);

      if (queryEmbedding) {
        // Call the match_document_chunks SQL function (defined in migration 004)
        const { data: vectorResults, error: vectorError } = await supabase.rpc(
          "match_document_chunks",
          {
            query_embedding: queryEmbedding,
            match_threshold: threshold,
            match_count: limit * 2, // Fetch extra, then slice after title join
          }
        );

        if (!vectorError && vectorResults && vectorResults.length > 0) {
          // Fetch document metadata (title, type) for the matched chunks
          const docIds: string[] = [
            ...new Set(vectorResults.map((r: any) => String(r.document_id))) as Set<string>,
          ];

          const { data: docs } = await supabase
            .from("documents")
            .select("id, title, document_type")
            .in("id", docIds);

          const docMap = new Map((docs || []).map((d: any) => [String(d.id), d]));

          results = vectorResults.slice(0, limit).map((r: any) => {
            const doc = (docMap.get(String(r.document_id)) || {}) as any;
            return {
              id: r.id,
              document_id: r.document_id,
              chunk_text: r.chunk_text,
              chunk_index: r.chunk_index,
              title: doc.title || "Unknown Document",
              document_type: doc.document_type || "document",
              similarity: r.similarity,
            };
          });

          usedVector = true;
        }
      }
    }

    // ── Fallback: Jaccard text similarity ─────────────────────────────────────
    // Used when: Gemini key not set, embedding unavailable, or no vector results.
    if (!usedVector) {
      const { data: chunks, error: chunksError } = await supabase
        .from("document_chunks")
        .select("id, document_id, chunk_text, chunk_index, documents(title, document_type)")
        .limit(5000);

      if (!chunksError && chunks && chunks.length > 0) {
        const jacThreshold = 0.05; // Lower threshold for text fallback

        const scored = chunks
          .map((chunk: any) => {
            const doc = chunk.documents as any;
            const score = textSimilarity(query, chunk.chunk_text || "");
            return {
              id: chunk.id,
              document_id: chunk.document_id,
              chunk_text: chunk.chunk_text,
              chunk_index: chunk.chunk_index,
              title: doc?.title || "Unknown Document",
              document_type: doc?.document_type || "document",
              similarity: score,
            };
          })
          .filter((c: any) => c.similarity >= jacThreshold)
          .sort((a: any, b: any) => b.similarity - a.similarity)
          .slice(0, limit);

        results = scored;
      }
    }

    // ── Generate AI Answer from Top Chunks ───────────────────────────────────
    let answer = "";
    let usedAI = false;

    if (results.length > 0 && geminiKey) {
      const context = results
        .slice(0, 4)
        .map((c: any, idx: number) => `[${idx + 1}] ${c.title}:\n${c.chunk_text}`)
        .join("\n\n");

      try {
        const aiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `You are an enterprise knowledge assistant helping employees find accurate information.

Answer the employee's question using ONLY the provided knowledge base excerpts below.
- Be concise and accurate.
- If the context doesn't contain a clear answer, say "Based on the available documentation, I was unable to find a direct answer. Please contact your HR/IT team for assistance."
- Do NOT make up information not present in the context.
- Do NOT mention that you are using a knowledge base or context.

Employee Question: ${query}

Knowledge Base Excerpts:
${context}

Answer:`,
                }],
              }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 512,
              },
            }),
          }
        );

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const aiText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (aiText) {
            answer = String(aiText).trim();
            usedAI = true;
          }
        }
      } catch (aiErr) {
        console.warn("AI answer generation failed, using text fallback:", aiErr);
      }
    }

    // ── Text-based answer fallback ────────────────────────────────────────────
    if (!answer && results.length > 0) {
      const combined = results
        .slice(0, 3)
        .map((c: any) => c.chunk_text)
        .join(" ");
      const sentences = combined
        .split(/(?<=[.!?])\s+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 20);
      const unique = sentences.filter(
        (s: string, i: number) => sentences.indexOf(s) === i
      );
      answer = unique.slice(0, 5).join(" ");
    }

    return new Response(
      JSON.stringify({
        results,
        answer,
        used_ai: usedAI,
        used_vector: usedVector,
        result_count: results.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("semantic-search error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
