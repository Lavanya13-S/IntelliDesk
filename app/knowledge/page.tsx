'use client';

import { Sidebar } from '@/components/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BookOpen,
  FileText,
  BrainCircuit,
  Database,
  Search,
  Upload,
} from 'lucide-react';
import DocumentUpload from '@/components/document-upload';
import SemanticSearch from '@/components/semantic-search';

export default function KnowledgePage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 pb-4 max-w-7xl mx-auto w-full">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <BookOpen className="h-7 w-7 text-primary" />
              Knowledge Base
            </h1>
            <p className="text-muted-foreground mt-1">
              Upload enterprise documents and make them searchable for IntelliDesk AI.
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6 max-w-7xl mx-auto w-full space-y-6">

          {/* Upload + How It Works */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DocumentUpload />

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  How It Works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Upload Document</p>
                    <p>Upload a supported company document — policy, handbook, procedure, guide, report, or form.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">2</div>
                  <div>
                    <p className="font-medium text-foreground">Text Extraction</p>
                    <p>IntelliDesk extracts readable content from the uploaded document.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">3</div>
                  <div>
                    <p className="font-medium text-foreground">Embedding Generation</p>
                    <p>Gemini converts the extracted content into 768-dimensional vector embeddings for semantic retrieval.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                    <Database className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Vector Storage</p>
                    <p>Embeddings are stored in pgvector with cosine similarity index for fast retrieval.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                    <Search className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Semantic Search</p>
                    <p>IntelliDesk searches indexed knowledge and retrieves relevant content for AI-assisted support.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Semantic Search */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BrainCircuit className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Semantic Search</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Search the indexed knowledge base using natural-language questions. Searches across all indexed enterprise documents.
            </p>
            <SemanticSearch />
          </div>
        </div>
      </div>
    </div>
  );
}
