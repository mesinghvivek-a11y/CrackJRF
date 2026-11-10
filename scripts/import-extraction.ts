import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

interface ExtractionPage {
  page_number: number;
  extraction_method: 'embedded_text' | 'ocr';
  extracted_text: string;
  warnings?: string[];
}
interface ExtractionItem {
  source_page_start?: number;
  source_page_end?: number;
  source_question_number?: string | null;
  source_native_question_id?: string | null;
  paper_number?: number | null;
  language?: 'en' | 'hi' | 'bilingual' | 'unknown';
  raw_text?: string;
  segmentation_status?: 'needs_review' | 'segmented' | 'verified' | 'rejected';
  warnings?: string[];
  extraction_method?: 'embedded_text' | 'ocr';
  ocr_language?: string;
  source_type?: string;
}
interface ExtractionFile {
  source_document: { file_name: string; sha256: string; page_count: number; [key: string]: unknown };
  pages: ExtractionPage[];
  items: ExtractionItem[];
}

async function main() {
  const [jobId, extractionPath] = process.argv.slice(2);
  if (!jobId || !extractionPath) {
    throw new Error('Usage: npm run import:extraction -- <IMPORT_JOB_UUID> <extraction.json>');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in root .env.local.');
  const filePath = path.resolve(extractionPath);
  const data = JSON.parse(await fs.readFile(filePath, 'utf8')) as ExtractionFile;
  if (!data.source_document || !Array.isArray(data.pages) || !Array.isArray(data.items)) {
    throw new Error('Invalid extraction JSON: expected source_document, pages and items.');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: job, error: jobError } = await db.from('import_jobs').select('id,source_document_id,status').eq('id', jobId).single();
  if (jobError) throw jobError;
  await db.from('import_jobs').update({ status: 'processing', extractor_name: 'PyMuPDF + Tesseract', extractor_version: '1.0', total_pages: data.source_document.page_count, started_at: new Date().toISOString() }).eq('id', jobId);

  for (let offset = 0; offset < data.pages.length; offset += 100) {
    const rows = data.pages.slice(offset, offset + 100).map((p) => ({
      import_job_id: jobId,
      page_number: p.page_number,
      extraction_method: p.extraction_method,
      extracted_text: p.extracted_text ?? '',
      warnings: p.warnings ?? []
    }));
    const { error } = await db.from('import_job_pages').upsert(rows, { onConflict: 'import_job_id,page_number' });
    if (error) throw error;
  }

  let inserted = 0;
  for (let offset = 0; offset < data.items.length; offset += 100) {
    const rows = data.items.slice(offset, offset + 100).map((item) => ({
      source_document_id: job.source_document_id,
      import_job_id: jobId,
      source_page_start: item.source_page_start ?? null,
      source_page_end: item.source_page_end ?? item.source_page_start ?? null,
      source_question_number: item.source_question_number ?? null,
      source_native_question_id: item.source_native_question_id ?? null,
      paper_number: item.paper_number === 1 || item.paper_number === 2 ? item.paper_number : null,
      language: item.language ?? 'unknown',
      raw_content: {
        raw_text: item.raw_text ?? '',
        extraction_method: item.extraction_method ?? 'embedded_text',
        ocr_language: item.ocr_language ?? null,
        source_type: item.source_type ?? data.source_document.source_type ?? null,
        warnings: item.warnings ?? []
      },
      extracted_text: item.raw_text ?? '',
      segmentation_status: 'needs_review'
    }));
    const { error } = await db.from('source_question_items').insert(rows);
    if (error) throw error;
    inserted += rows.length;
  }
  const { error: updateError } = await db.from('import_jobs').update({ status: 'reviewing', processed_pages: data.pages.length, extracted_items: inserted, completed_at: new Date().toISOString() }).eq('id', jobId);
  if (updateError) throw updateError;
  await db.from('source_documents').update({ processing_status: 'needs_review', file_sha256: data.source_document.sha256, page_count: data.source_document.page_count }).eq('id', job.source_document_id);
  console.log(`Imported ${inserted} staging candidates from ${data.pages.length} pages into job ${jobId}. All candidates remain needs_review.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
