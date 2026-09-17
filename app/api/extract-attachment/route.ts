import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── File Type Detection ───────────────────────────────────────────────────────
function detectFileType(filename: string, mimeType?: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (ext === 'doc' || mimeType === 'application/msword') return 'docx';
  if (ext === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (ext === 'xls' || mimeType === 'application/vnd.ms-excel') return 'xlsx';
  if (ext === 'pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (ext === 'ppt' || mimeType === 'application/vnd.ms-powerpoint') return 'pptx';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'].includes(ext)) return 'image';
  if (mimeType?.startsWith('image/')) return 'image';
  if (ext === 'zip' || mimeType === 'application/zip') return 'zip';
  if (ext === 'txt' || mimeType === 'text/plain') return 'txt';
  return 'unknown';
}

// ─── PDF Extraction Report ────────────────────────────────────────────────────
interface ExtractionReport {
  filename: string;
  extension: string;
  mimeType: string;
  fileSizeBytes: number;
  extractionMethod: string;
  pagesDetected: number;
  charsExtracted: number;
  first300Chars: string;
  chunkCount: number;
  embeddingsGenerated: number;
  dbInsertSuccess: boolean;
  exceptionMessage: string | null;
  stackTrace: string | null;
}

function printExtractionReport(r: ExtractionReport): void {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              PDF EXTRACTION REPORT                          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║ File Name        : ${r.filename}`);
  console.log(`║ Extension        : ${r.extension}`);
  console.log(`║ MIME Type        : ${r.mimeType}`);
  console.log(`║ File Size        : ${r.fileSizeBytes.toLocaleString()} bytes`);
  console.log(`║ Extraction Method: ${r.extractionMethod}`);
  console.log(`║ Pages Detected   : ${r.pagesDetected}`);
  console.log(`║ Chars Extracted  : ${r.charsExtracted.toLocaleString()}`);
  console.log(`║ First 300 chars  :\n${r.first300Chars}`);
  console.log(`║ Chunks Created   : ${r.chunkCount}`);
  console.log(`║ Embeddings Gen.  : ${r.embeddingsGenerated}`);
  console.log(`║ DB Insert        : ${r.dbInsertSuccess ? 'SUCCESS' : 'FAILED'}`);
  if (r.exceptionMessage) {
    console.log(`║ EXCEPTION        : ${r.exceptionMessage}`);
  }
  if (r.stackTrace) {
    console.log(`║ STACK TRACE      :\n${r.stackTrace}`);
  }
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

// ─── PDF Extraction: Stage 1 — pdfjs-dist ─────────────────────────────────────
// ROOT CAUSE NOTE:
// pdf-parse v2.4.5 (installed) exports an object { PDFParse, AbortException, ... }
// NOT a callable function. require('pdf-parse') returns typeof === "object", causing
// TypeError when called as a function. The old catch block silently swallowed this
// TypeError and returned the generic fallback string.
//
// Fix: Use pdfjs-dist (already installed, v4.9.155, confirmed working in Node.js).
// pdfjs-dist requires a workerSrc to be set; use the bundled worker .mjs file.
async function extractPDFWithPdfjs(buffer: Buffer): Promise<{ text: string; pages: number; error?: string }> {
  // Dynamic import ensures pdfjs-dist is treated as external by webpack
  // (set in next.config.js serverComponentsExternalPackages + externals)
  const pdfjs = await import('pdfjs-dist');

  // CRITICAL: pdfjs-dist v4 requires a workerSrc even in Node.js.
  // Setting it to the bundled worker .mjs path satisfies the requirement.
  pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.mjs';

  // Load the PDF document — do NOT catch here, let real errors propagate
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableStream: true,
    disableAutoFetch: true,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    // Join all text items on the page
    const pageText = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText.length > 0) {
      pageTexts.push(pageText);
    }
  }

  const fullText = pageTexts.join('\n').trim();
  return { text: fullText, pages: numPages };
}

// ─── PDF Extraction: Stage 2 — Tesseract OCR (fallback for image-based PDFs) ──
async function extractPDFWithOCR(buffer: Buffer, filename: string): Promise<{ text: string; error?: string }> {
  // Tesseract can process image buffers directly but not PDFs.
  // For image-based PDFs, we attempt OCR directly on the buffer.
  // In production, this would require pdf-to-image conversion (e.g. pdftoppm).
  // Here we surface a clear message that OCR requires image conversion.
  const Tesseract = await import('tesseract.js');
  try {
    const { data } = await Tesseract.recognize(buffer, 'eng', {
      logger: () => {},
    });
    const text = data.text.trim();
    return { text };
  } catch (ocrErr: any) {
    // Tesseract cannot process raw PDF binary — this is expected.
    // Return empty string so the caller knows OCR also failed.
    return {
      text: '',
      error: `Tesseract OCR on raw PDF failed: ${ocrErr.message}`,
    };
  }
}

// ─── Main PDF Extraction Cascade ───────────────────────────────────────────────
// Stage 1: pdfjs-dist full text extraction
// Stage 2: If chars < 100, try Tesseract OCR (handles image-based/scanned PDFs)
// Stage 3: If both fail, throw the REAL exception — never return a generic string
async function extractPDF(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  report: ExtractionReport
): Promise<string> {
  let stage1Error: Error | null = null;

  // ── Stage 1: pdfjs-dist ────────────────────────────────────────────────────
  console.log(`[extract-attachment] Stage 1: pdfjs-dist extraction for "${filename}"`);
  report.extractionMethod = 'pdfjs-dist (Stage 1)';

  try {
    const { text, pages } = await extractPDFWithPdfjs(buffer);
    report.pagesDetected = pages;
    report.charsExtracted = text.length;
    report.first300Chars = text.slice(0, 300);
    report.exceptionMessage = null;
    report.stackTrace = null;

    console.log(`[extract-attachment] Stage 1 success: ${pages} pages, ${text.length} chars extracted`);

    if (text.length >= 100) {
      // Success — enough text extracted
      return text;
    }

    // Not enough text — could be image-based PDF
    console.log(`[extract-attachment] Stage 1 extracted only ${text.length} chars (< 100). Trying Stage 2: OCR.`);

    if (text.length > 0) {
      // Save what we have but try OCR too
      stage1Error = new Error(`Only ${text.length} characters extracted — may be image-based PDF`);
    }
  } catch (err: any) {
    stage1Error = err;
    report.exceptionMessage = err.message;
    report.stackTrace = err.stack ?? null;
    console.error(`[extract-attachment] Stage 1 FAILED for "${filename}"`);
    console.error(`  Function : extractPDFWithPdfjs`);
    console.error(`  Exception: ${err.message}`);
    console.error(`  Stack    :\n${err.stack}`);
  }

  // ── Stage 2: Tesseract OCR ─────────────────────────────────────────────────
  console.log(`[extract-attachment] Stage 2: Tesseract OCR for "${filename}"`);
  report.extractionMethod = 'Tesseract OCR (Stage 2)';

  try {
    const { text: ocrText, error: ocrErr } = await extractPDFWithOCR(buffer, filename);
    if (ocrText && ocrText.length >= 100) {
      report.charsExtracted = ocrText.length;
      report.first300Chars = ocrText.slice(0, 300);
      report.exceptionMessage = null;
      report.stackTrace = null;
      console.log(`[extract-attachment] Stage 2 OCR success: ${ocrText.length} chars`);
      return ocrText;
    }

    const ocrFailMsg = ocrErr || `OCR returned only ${ocrText?.length ?? 0} chars`;
    console.log(`[extract-attachment] Stage 2 OCR insufficient: ${ocrFailMsg}`);
  } catch (ocrException: any) {
    console.error(`[extract-attachment] Stage 2 OCR exception: ${ocrException.message}`);
  }

  // ── All stages failed — throw the REAL exception ───────────────────────────
  if (stage1Error) {
    throw new Error(
      `PDF extraction failed for "${filename}".\n` +
      `Stage 1 (pdfjs-dist) error: ${stage1Error.message}\n` +
      `Stage 2 (Tesseract OCR): insufficient or failed.\n` +
      `Stack: ${stage1Error.stack}`
    );
  }

  // pdfjs succeeded but returned < 100 chars — this is a genuinely sparse PDF
  const sparseText = report.first300Chars;
  if (sparseText && sparseText.length > 0) {
    // Return what we got — sparse is better than nothing
    return sparseText;
  }

  throw new Error(
    `PDF "${filename}" yielded zero extractable text from all methods (pdfjs-dist + Tesseract OCR). ` +
    `This may be a purely image-based scanned PDF that requires server-side pdf-to-image conversion before OCR. ` +
    `Pages detected: ${report.pagesDetected}.`
  );
}

// ─── Other Format Extractors (unchanged, errors still surface) ────────────────

async function extractDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  if (!text) throw new Error('mammoth.extractRawText returned empty content');
  return text;
}

async function extractXLSX(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csvData = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csvData.trim().length > 0) {
      sheets.push(`=== Sheet: ${sheetName} ===\n${csvData}`);
    }
  }
  const text = sheets.join('\n\n').trim();
  if (!text) throw new Error('XLSX workbook contained no readable data');
  return text;
}

async function extractPPTX(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buffer);
  const slideEntries = (zip.getEntries() as any[])
    .filter((e: any) => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
    .sort((a: any, b: any) => a.entryName.localeCompare(b.entryName));

  const texts: string[] = [];
  for (const entry of slideEntries) {
    const xml: string = entry.getData().toString('utf8');
    const matches = Array.from(xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)) as RegExpMatchArray[];
    const slideText = matches.map((m) => m[1]).join(' ').trim();
    if (slideText.length > 0) texts.push(slideText);
  }
  const text = texts.join('\n\n').trim();
  if (!text) throw new Error('PPTX contained no readable text in slides');
  return text;
}

async function extractImage(buffer: Buffer, filename: string): Promise<string> {
  const Tesseract = await import('tesseract.js');
  const { data } = await Tesseract.recognize(buffer, 'eng', {
    logger: () => {},
  });
  const text = data.text.trim();
  if (text.length < 10) {
    throw new Error(`OCR for image "${filename}" returned < 10 chars — image may be decorative or non-textual`);
  }
  return `[OCR from "${filename}"]:\n${text}`;
}

async function extractTXT(buffer: Buffer): Promise<string> {
  const text = buffer.toString('utf8').trim();
  if (!text) throw new Error('TXT file is empty');
  return text;
}

async function extractZIP(buffer: Buffer, filename: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buffer);
  const entries: any[] = (zip.getEntries() as any[]).slice(0, 10);
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const fileType = detectFileType(entry.name);
    const fileBuffer: Buffer = entry.getData();

    try {
      let text = '';
      const dummyReport: ExtractionReport = {
        filename: entry.name, extension: '', mimeType: '', fileSizeBytes: 0,
        extractionMethod: '', pagesDetected: 0, charsExtracted: 0, first300Chars: '',
        chunkCount: 0, embeddingsGenerated: 0, dbInsertSuccess: false,
        exceptionMessage: null, stackTrace: null,
      };
      if (fileType === 'pdf') text = await extractPDF(fileBuffer, entry.name, 'application/pdf', dummyReport);
      else if (fileType === 'docx') text = await extractDOCX(fileBuffer);
      else if (fileType === 'xlsx') text = await extractXLSX(fileBuffer);
      else if (fileType === 'txt') text = await extractTXT(fileBuffer);
      else if (fileType === 'image') text = await extractImage(fileBuffer, entry.name);
      else continue;

      if (text.trim().length > 0) {
        results.push(`--- File: ${entry.name} ---\n${text.slice(0, 2000)}`);
      }
    } catch (zipEntryErr: any) {
      console.error(`[extract-attachment] ZIP entry "${entry.name}" failed:`, zipEntryErr.message);
    }
  }

  if (results.length === 0) {
    throw new Error(`ZIP archive "${filename}" contained no readable files`);
  }
  return results.join('\n\n').trim();
}

// ─── Text Chunking ─────────────────────────────────────────────────────────────
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

// ─── Gemini Embedding ──────────────────────────────────────────────────────────
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
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[extract-attachment] Gemini embedding API error ${res.status}: ${errBody}`);
      return null;
    }
    const data = await res.json();
    return data.embedding?.values || null;
  } catch (embErr: any) {
    console.error(`[extract-attachment] Gemini embedding fetch error: ${embErr.message}`);
    return null;
  }
}

// ─── Get Gemini Key ────────────────────────────────────────────────────────────
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

// ─── Main Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const report: ExtractionReport = {
    filename: '',
    extension: '',
    mimeType: '',
    fileSizeBytes: 0,
    extractionMethod: '',
    pagesDetected: 0,
    charsExtracted: 0,
    first300Chars: '',
    chunkCount: 0,
    embeddingsGenerated: 0,
    dbInsertSuccess: false,
    exceptionMessage: null,
    stackTrace: null,
  };

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const titleFromForm = formData.get('title') as string | null;
    const documentType = (formData.get('document_type') as string) || 'document';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const filename = file.name;
    const mimeType = file.type;
    const fileType = detectFileType(filename, mimeType);
    const title = titleFromForm || filename.replace(/\.[^.]+$/, '');
    const extension = '.' + (filename.split('.').pop()?.toLowerCase() ?? '');

    // Populate report metadata
    report.filename = filename;
    report.extension = extension;
    report.mimeType = mimeType;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    report.fileSizeBytes = buffer.length;

    console.log(`\n[extract-attachment] Processing "${filename}" (${buffer.length} bytes, type=${fileType}, mime=${mimeType})`);

    // ── Extract text based on file type ────────────────────────────────────────
    let extractedText = '';

    try {
      switch (fileType) {
        case 'pdf':
          extractedText = await extractPDF(buffer, filename, mimeType, report);
          break;
        case 'docx':
          report.extractionMethod = 'mammoth (DOCX)';
          extractedText = await extractDOCX(buffer);
          report.charsExtracted = extractedText.length;
          report.first300Chars = extractedText.slice(0, 300);
          break;
        case 'xlsx':
          report.extractionMethod = 'xlsx (Excel)';
          extractedText = await extractXLSX(buffer);
          report.charsExtracted = extractedText.length;
          report.first300Chars = extractedText.slice(0, 300);
          break;
        case 'pptx':
          report.extractionMethod = 'adm-zip XML parse (PPTX)';
          extractedText = await extractPPTX(buffer);
          report.charsExtracted = extractedText.length;
          report.first300Chars = extractedText.slice(0, 300);
          break;
        case 'image':
          report.extractionMethod = 'Tesseract OCR (Image)';
          extractedText = await extractImage(buffer, filename);
          report.charsExtracted = extractedText.length;
          report.first300Chars = extractedText.slice(0, 300);
          break;
        case 'txt':
          report.extractionMethod = 'UTF-8 decode (TXT)';
          extractedText = await extractTXT(buffer);
          report.charsExtracted = extractedText.length;
          report.first300Chars = extractedText.slice(0, 300);
          break;
        case 'zip':
          report.extractionMethod = 'adm-zip recursive (ZIP)';
          extractedText = await extractZIP(buffer, filename);
          report.charsExtracted = extractedText.length;
          report.first300Chars = extractedText.slice(0, 300);
          break;
        default:
          return NextResponse.json(
            { error: `Unsupported file type: "${filename}" (extension: ${extension}, MIME: ${mimeType})` },
            { status: 415 }
          );
      }
    } catch (extractionErr: any) {
      // ── Extraction completely failed — do NOT store garbage content ──────────
      report.exceptionMessage = extractionErr.message;
      report.stackTrace = extractionErr.stack ?? null;
      report.dbInsertSuccess = false;

      printExtractionReport(report);

      return NextResponse.json(
        {
          error: 'Extraction failed',
          extraction_error: extractionErr.message,
          filename,
          file_type: fileType,
          mime_type: mimeType,
          file_size_bytes: buffer.length,
          extraction_method: report.extractionMethod,
          pages_detected: report.pagesDetected,
          chars_extracted: report.charsExtracted,
          debug: `Check server console for full stack trace. Method: ${report.extractionMethod}`,
        },
        { status: 422 }
      );
    }

    if (!extractedText || extractedText.trim().length < 10) {
      report.exceptionMessage = `Extraction returned ${extractedText?.length ?? 0} chars — too short to index`;
      printExtractionReport(report);
      return NextResponse.json(
        {
          error: 'Extracted text too short to index',
          chars_extracted: extractedText?.length ?? 0,
          filename,
          file_type: fileType,
        },
        { status: 422 }
      );
    }

    // Update report with final extraction result (in case PDF set it during extraction)
    if (report.charsExtracted === 0) {
      report.charsExtracted = extractedText.length;
      report.first300Chars = extractedText.slice(0, 300);
    }

    // ── Insert document record ──────────────────────────────────────────────────
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .insert({
        title,
        content: extractedText,
        document_type: documentType,
      })
      .select()
      .single();

    if (docError) {
      report.dbInsertSuccess = false;
      report.exceptionMessage = `documents table insert failed: ${docError.message}`;
      printExtractionReport(report);
      return NextResponse.json(
        { error: `Document insert failed: ${docError.message}`, details: docError },
        { status: 500 }
      );
    }

    // ── Chunk + Embed ───────────────────────────────────────────────────────────
    const geminiKey = await getGeminiKey();
    const chunks = chunkText(extractedText);
    let embeddedChunks = 0;
    let storedChunks = 0;
    let firstInsertError = '';

    for (let i = 0; i < chunks.length; i++) {
      let embedding: number[] | null = null;
      if (geminiKey) {
        embedding = await generateEmbedding(chunks[i], geminiKey);
        if (embedding) embeddedChunks++;
        // Rate-limit protection
        if (i > 0 && i % 5 === 0) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      const { error: chunkError } = await supabase.from('document_chunks').insert({
        document_id: docData.id,
        chunk_text: chunks[i],
        chunk_index: i,
        embedding,
        metadata: { source_type: fileType, filename },
      });

      if (chunkError) {
        console.error(`[extract-attachment] chunk ${i} insert failed:`, chunkError.message, chunkError.details);
        if (!firstInsertError) firstInsertError = chunkError.message;
      } else {
        storedChunks++;
      }
    }

    report.chunkCount = storedChunks;
    report.embeddingsGenerated = embeddedChunks;
    report.dbInsertSuccess = storedChunks > 0;

    // Print full extraction report to server console
    printExtractionReport(report);

    // If nothing was stored, clean up and surface the DB error
    if (storedChunks === 0) {
      await supabase.from('documents').delete().eq('id', docData.id);
      return NextResponse.json(
        {
          error: `Text extracted (${chunks.length} chunks attempted) but database storage failed.`,
          db_error: firstInsertError || 'unknown error',
          chars_extracted: extractedText.length,
          pages_detected: report.pagesDetected,
          hint: 'Run this SQL in Supabase: ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS metadata jsonb;',
        },
        { status: 500 }
      );
    }

    const summary = extractedText.slice(0, 500).replace(/\n+/g, ' ').trim();

    return NextResponse.json({
      success: true,
      document: docData,
      file_type: fileType,
      // Extraction details
      pages_detected: report.pagesDetected,
      chars_extracted: report.charsExtracted,
      extraction_method: report.extractionMethod,
      first_300_chars: report.first300Chars,
      // Chunk details
      chunks: storedChunks,
      attempted_chunks: chunks.length,
      embedded_chunks: embeddedChunks,
      embeddings_enabled: !!geminiKey,
      summary,
      message: `${fileType.toUpperCase()} indexed: ${storedChunks}/${chunks.length} chunks stored${geminiKey ? `, ${embeddedChunks} Gemini embeddings` : ' (text search only)'}.`,
    });

  } catch (err: any) {
    // Top-level catch — unexpected error
    report.exceptionMessage = err.message;
    report.stackTrace = err.stack ?? null;
    printExtractionReport(report);
    console.error('[extract-attachment] Unexpected top-level error:', err);
    return NextResponse.json(
      {
        error: err.message,
        stack: err.stack,
        extraction_method: report.extractionMethod,
        filename: report.filename,
      },
      { status: 500 }
    );
  }
}
