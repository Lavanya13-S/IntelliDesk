'use client';

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  FileUp, Loader2, X, FileText, Upload, CheckCircle2, AlertCircle,
  FileSpreadsheet, Image, Presentation, Archive, FileType, RefreshCw,
  Info,
} from 'lucide-react';

interface UploadedDocument {
  id: string;
  title: string;
  document_type: string | null;
  created_at: string;
  chunk_count?: number;
  content_preview?: string;
}

const ACCEPTED_TYPES = [
  '.pdf', '.docx', '.doc', '.xlsx', '.xls',
  '.pptx', '.ppt', '.png', '.jpg', '.jpeg',
  '.webp', '.gif', '.bmp', '.tiff', '.txt', '.zip',
];

const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff',
  'text/plain',
  'application/zip',
];

function getFileTypeLabel(filename: string): { label: string; icon: typeof FileText; color: string } {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return { label: 'PDF', icon: FileText, color: 'text-red-500' };
  if (['docx', 'doc'].includes(ext)) return { label: 'Word', icon: FileText, color: 'text-blue-600' };
  if (['xlsx', 'xls'].includes(ext)) return { label: 'Excel', icon: FileSpreadsheet, color: 'text-green-600' };
  if (['pptx', 'ppt'].includes(ext)) return { label: 'PowerPoint', icon: Presentation, color: 'text-orange-500' };
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'].includes(ext)) return { label: 'Image (OCR)', icon: Image, color: 'text-purple-500' };
  if (ext === 'zip') return { label: 'ZIP', icon: Archive, color: 'text-yellow-600' };
  if (ext === 'txt') return { label: 'Text', icon: FileType, color: 'text-gray-500' };
  return { label: ext.toUpperCase(), icon: FileText, color: 'text-muted-foreground' };
}

function isAcceptedFile(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  return ACCEPTED_TYPES.includes(ext) || ACCEPTED_MIME.includes(file.type) || file.type.startsWith('image/');
}

/** Returns true if the stored document content is the old generic error fallback */
function isErrorContent(preview: string): boolean {
  if (!preview) return false;
  return (
    preview.startsWith('[PDF:') ||
    preview.startsWith('[DOCX:') ||
    preview.startsWith('[Image:') ||
    preview.startsWith('[OCR') ||
    preview.startsWith('[Excel:') ||
    preview.startsWith('[PowerPoint:') ||
    preview.startsWith('[ZIP:') ||
    preview.includes('Could not extract text')
  );
}

export default function DocumentUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('policy');
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'extracting' | 'processing' | 'complete' | 'error'>('idle');
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchDocuments();
  }, []);

  async function fetchDocuments() {
    try {
      const { data } = await supabase
        .from('documents')
        .select('id, title, document_type, created_at, content')
        .order('created_at', { ascending: false });

      if (data) {
        const docsWithChunks = await Promise.all(
          data.map(async (doc) => {
            const { count } = await supabase
              .from('document_chunks')
              .select('*', { count: 'exact', head: true })
              .eq('document_id', doc.id);
            return {
              ...doc,
              chunk_count: count || 0,
              content_preview: (doc.content || '').slice(0, 100),
            };
          })
        );
        setDocuments(docsWithChunks);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
    } finally {
      setLoadingDocs(false);
    }
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      if (isAcceptedFile(droppedFile)) {
        setFile(droppedFile);
        if (!title) setTitle(droppedFile.name.replace(/\.[^.]+$/, ''));
      } else {
        toast({
          title: 'Unsupported file type',
          description: `Supported: PDF, Word, Excel, PowerPoint, Images, TXT, ZIP`,
          variant: 'destructive',
        });
      }
    }
  }, [title, toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      if (!title) setTitle(selectedFile.name.replace(/\.[^.]+$/, ''));
    }
  };

  async function handleUpload() {
    if (!file || !title) {
      toast({ title: 'Missing information', description: 'Please provide a title and select a file.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    setUploadStatus('extracting');
    setUploadProgress(15);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title);
      formData.append('document_type', documentType);

      setUploadStatus('processing');
      setUploadProgress(40);

      const res = await fetch('/api/extract-attachment', {
        method: 'POST',
        body: formData,
      });

      setUploadProgress(80);

      if (!res.ok) {
        const err = await res.json();
        // Surface the REAL error, not a generic message
        const errorMsg = err.extraction_error || err.error || 'Processing failed';
        const details = [
          err.extraction_method ? `Method: ${err.extraction_method}` : null,
          err.pages_detected ? `Pages: ${err.pages_detected}` : null,
          err.chars_extracted !== undefined ? `Chars: ${err.chars_extracted}` : null,
          err.hint || null,
        ].filter(Boolean).join(' | ');

        throw new Error(details ? `${errorMsg}\n${details}` : errorMsg);
      }

      const result = await res.json();
      setUploadProgress(100);
      setUploadStatus('complete');

      const typeLabel = getFileTypeLabel(file.name).label;
      const extractionInfo = [
        result.pages_detected ? `${result.pages_detected} pages` : null,
        result.chars_extracted ? `${result.chars_extracted.toLocaleString()} chars` : null,
        `${result.chunks} chunks`,
        result.embeddings_enabled ? `${result.embedded_chunks} embeddings` : 'no embeddings (add Gemini key)',
      ].filter(Boolean).join(' · ');

      toast({
        title: `✅ ${typeLabel} indexed successfully`,
        description: `"${title}": ${extractionInfo}. Vector search active.`,
      });

      setFile(null);
      setTitle('');
      await fetchDocuments();

      setTimeout(() => {
        setUploadStatus('idle');
        setUploadProgress(0);
      }, 3000);
    } catch (err: any) {
      console.error('Upload error:', err);
      setUploadStatus('error');
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  }

  async function handleReindex(doc: UploadedDocument) {
    setReindexingId(doc.id);
    try {
      const res = await fetch('/api/reindex-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: doc.id }),
      });

      const result = await res.json();

      if (!res.ok) {
        // If content is the old error string, tell user to re-upload
        if (res.status === 422) {
          toast({
            title: 'Re-upload required',
            description: result.hint || 'The stored content is an extraction error. Delete this document and re-upload the file.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Re-index failed',
            description: result.error || 'Unknown error',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: '✅ Re-indexed successfully',
          description: `"${doc.title}": ${result.chunks_stored} chunks, ${result.embeddings_generated} embeddings regenerated.`,
        });
        await fetchDocuments();
      }
    } catch (err: any) {
      toast({ title: 'Re-index error', description: err.message, variant: 'destructive' });
    } finally {
      setReindexingId(null);
    }
  }

  async function deleteDocument(docId: string) {
    try {
      await supabase.from('document_chunks').delete().eq('document_id', docId);
      await supabase.from('documents').delete().eq('id', docId);
      toast({ title: 'Deleted', description: 'Document removed from knowledge base.' });
      await fetchDocuments();
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    }
  }

  const fileTypeInfo = file ? getFileTypeLabel(file.name) : null;

  const statusMessages: Record<string, string> = {
    extracting: `Extracting text from ${fileTypeInfo?.label ?? 'file'} using pdfjs-dist...`,
    processing: 'Chunking text and generating Gemini embeddings — this may take a moment...',
    complete: 'Indexed! Gemini vector embeddings ready for semantic search.',
    error: 'Upload failed. See error details above.',
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileUp className="h-4 w-4 text-primary" />
            Upload Document to Knowledge Base
          </CardTitle>
          <CardDescription>
            Supports: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), Images (OCR), TXT, ZIP
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc-title">Document Title</Label>
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Employee Handbook 2024" />
          </div>

          <div className="space-y-2">
            <Label>Document Type</Label>
            <div className="flex flex-wrap gap-2">
              {['policy', 'handbook', 'procedure', 'guide', 'faq-doc', 'form', 'report'].map((type) => (
                <Badge key={type} variant={documentType === type ? 'default' : 'outline'} className="cursor-pointer capitalize" onClick={() => setDocumentType(type)}>
                  {type}
                </Badge>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
              ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/20'}
              ${file ? 'bg-muted/30' : ''}
            `}
          >
            <input
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              onChange={handleFileChange}
              className="hidden"
              id="doc-upload"
            />
            <label htmlFor="doc-upload" className="cursor-pointer block">
              {file && fileTypeInfo ? (
                <div className="flex items-center justify-center gap-2">
                  <fileTypeInfo.icon className={`h-5 w-5 ${fileTypeInfo.color}`} />
                  <span className="text-sm font-medium">{file.name}</span>
                  <Badge variant="secondary" className="text-xs">{fileTypeInfo.label}</Badge>
                  <button onClick={(e) => { e.preventDefault(); setFile(null); }} className="ml-2 p-1 rounded hover:bg-muted">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Drag & drop any document here, or click to browse</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">PDF · Word · Excel · PowerPoint · Images · TXT · ZIP</p>
                </>
              )}
            </label>
          </div>

          {/* Progress */}
          {uploadStatus !== 'idle' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {uploadStatus === 'complete' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : uploadStatus === 'error' ? (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                )}
                <span className="text-sm">{statusMessages[uploadStatus]}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all duration-500" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <Button onClick={handleUpload} disabled={!file || !title || uploading} className="w-full gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {uploading ? 'Processing & Indexing...' : 'Upload & Index for AI Search'}
          </Button>
        </CardContent>
      </Card>

      {/* Indexed documents list */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Indexed Documents
                <Badge variant="secondary" className="text-xs font-normal">RAG Vector Store</Badge>
              </CardTitle>
              {/* BUG 3 FIX: Explain the difference between this store and the KB tabs */}
              <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                These documents feed Semantic Search. The Policies / FAQs / Templates tabs
                show separately authored structured entries (kb_policies, kb_faqs tables).
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingDocs ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length > 0 ? (
            <div className="space-y-2">
              {documents.map((doc) => {
                const typeInfo = getFileTypeLabel(doc.title);
                const TypeIcon = typeInfo.icon;
                const hasErrorContent = isErrorContent(doc.content_preview || '');
                const isReindexing = reindexingId === doc.id;
                return (
                  <div
                    key={doc.id}
                    className={`flex items-center justify-between p-3 rounded-lg border text-sm ${hasErrorContent ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20' : ''}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <TypeIcon className={`h-4 w-4 shrink-0 ${typeInfo.color}`} />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{doc.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.document_type} · {doc.chunk_count} chunks
                          {hasErrorContent && (
                            <span className="ml-2 text-red-600 dark:text-red-400 font-medium">
                              ⚠ Extraction error — re-upload required
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {!hasErrorContent && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                          onClick={() => handleReindex(doc)}
                          disabled={isReindexing}
                          title="Re-index: regenerate chunks and embeddings"
                        >
                          {isReindexing
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />
                          }
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => deleteDocument(doc.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No documents indexed yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
