'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import {
  Search, Loader2, FileText, MessageSquare, BookOpen, Cpu, AlignLeft, BrainCircuit,
} from 'lucide-react';

interface SearchResult {
  id: string;
  document_id: string;
  chunk_text: string;
  chunk_index: number;
  title: string;
  document_type: string;
  similarity: number;
}

export default function SemanticSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [usedVector, setUsedVector] = useState(false);
  const [usedAI, setUsedAI] = useState(false);
  const { toast } = useToast();

  async function handleSearch() {
    if (!query.trim()) return;

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      toast({
        title: 'Configuration missing',
        description: 'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    setSearched(true);
    setResults([]);
    setAnswer('');
    setUsedVector(false);
    setUsedAI(false);

    try {
      const res = await fetch('/api/semantic-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          threshold: 0.25,
          limit: 8,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Search failed');
      }

      const data = await res.json();
      const chunks: SearchResult[] = data.results || [];
      const generatedAnswer = (data.answer || '').trim();

      setResults(chunks);
      setAnswer(generatedAnswer);
      setUsedVector(data.used_vector ?? false);
      setUsedAI(data.used_ai ?? false);
    } catch (err: any) {
      toast({
        title: 'Search failed',
        description: err.message,
        variant: 'destructive',
      });
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function getSourceIcon(type: string) {
    if (type === 'policy') return <BookOpen className="h-3.5 w-3.5 text-blue-500" />;
    if (type === 'faq-doc') return <MessageSquare className="h-3.5 w-3.5 text-green-500" />;
    return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  }

  function formatSimilarity(score: number): string {
    return `${(score * 100).toFixed(1)}%`;
  }

  function buildAnswerFallback(): string {
    if (results.length === 0) return '';
    const topChunks = results.slice(0, 3);
    const combined = topChunks.map((r) => r.chunk_text).join(' ');
    const sentences = combined.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
    const unique = sentences.filter((s, i) => sentences.indexOf(s) === i);
    return unique.slice(0, 5).join(' ');
  }

  const displayAnswer = answer || buildAnswerFallback();

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          Semantic Search
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search knowledge base... e.g. 'remote work VPN setup'"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {/* Search Mode indicator (shown after a search) */}
        {searched && !loading && (
          <div className="flex items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className={`gap-1 ${usedVector
                ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                : 'border-amber-500 text-amber-600 dark:text-amber-400'
              }`}
            >
              {usedVector ? (
                <><Cpu className="h-3 w-3" /> Gemini Vector Search</>
              ) : (
                <><AlignLeft className="h-3 w-3" /> Text Search (upload docs + add Gemini key for vectors)</>
              )}
            </Badge>
            {usedAI && (
              <Badge variant="outline" className="gap-1 border-emerald-500 text-emerald-600 dark:text-emerald-400">
                <BrainCircuit className="h-3 w-3" /> AI Answer
              </Badge>
            )}
          </div>
        )}

        {searched && (
          <div className="flex-1 overflow-hidden">
            {results.length > 0 ? (
              <ScrollArea className="h-full">
                <div className="space-y-4 pr-4">
                  {/* Answer */}
                  {displayAnswer && (
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/10">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium text-primary">
                          {usedAI ? 'AI Answer' : 'Best Match Summary'}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayAnswer}</p>
                    </div>
                  )}

                  {/* Matching Chunks */}
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Relevant passages ({results.length} found)
                    </p>
                    {results.map((result) => (
                      <div key={result.id} className="p-3 rounded-lg border bg-card text-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getSourceIcon(result.document_type)}
                            <span className="font-medium">{result.title}</span>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {formatSimilarity(result.similarity)} match
                          </Badge>
                        </div>
                        <p className="text-muted-foreground leading-relaxed line-clamp-4">
                          {result.chunk_text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Search className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">No results found</p>
                <p className="text-xs mt-1 text-center max-w-xs">
                  {usedVector
                    ? 'Try a different query — the documents in your knowledge base may not cover this topic yet.'
                    : 'No matching text found. Try a different search term, or add a Gemini API key in Settings for AI-powered vector search.'}
                </p>
              </div>
            )}
          </div>
        )}

        {!searched && (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <Search className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Enter a query to search the knowledge base</p>
            <p className="text-xs mt-1">Searches across all uploaded policies, handbooks, and guides</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
