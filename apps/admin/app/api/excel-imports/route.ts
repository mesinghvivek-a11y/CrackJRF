import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
import { normalizeQuestionRow, parseQuestionWorkbook } from '../../../lib/excel-workbook';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

async function adminContext(roles: string[] = ['super_admin','importer','content_editor','reviewer']) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, role: null };
  const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
  if (!member?.active || !roles.includes(member.role)) return { supabase, user, role: null };
  return { supabase, user, role: member.role as string };
}

export async function GET() {
  try {
    const { supabase, user, role } = await adminContext();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!role) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const { data, error } = await supabase
      .from('excel_import_batches')
      .select('id,batch_code,file_name,exam_metadata,status,total_rows,valid_rows,rows_with_errors,rows_promoted,created_at')
      .order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return NextResponse.json({ batches: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Excel import history.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let batchId = '';
  try {
    const { supabase, user, role } = await adminContext(['super_admin','importer']);
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!role) return NextResponse.json({ error: 'Super Admin or Importer role required' }, { status: 403 });
    const body = await request.json() as { storagePath?: unknown; fileName?: unknown };
    const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
    const fileName = typeof body.fileName === 'string' ? body.fileName : '';
    if (!storagePath || !storagePath.startsWith(`excel-imports/${user.id}/`) || storagePath.split('/').length !== 3 || storagePath.includes('..') || !/\.xlsx$/i.test(storagePath)) {
      return NextResponse.json({ error: 'Upload one .xlsx file into your own excel-imports storage folder.' }, { status: 400 });
    }
    const { data: blob, error: downloadError } = await supabase.storage.from('source-pdfs').download(storagePath);
    if (downloadError || !blob) throw new Error(`Unable to read workbook from private storage: ${downloadError?.message ?? 'file not found'}`);
    if (blob.size > MAX_FILE_BYTES) throw new Error('Excel workbook exceeds the 25 MB limit. Remove unused taxonomy rows or split the event if necessary.');
    const bytes = Buffer.from(await blob.arrayBuffer());
    const fileSha256 = createHash('sha256').update(bytes).digest('hex');
    const { data: duplicateBatch, error: duplicateError } = await supabase.from('excel_import_batches').select('id,batch_code').eq('file_sha256', fileSha256).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicateBatch) throw new Error(`This exact workbook was already imported as ${duplicateBatch.batch_code}. Open that batch instead of creating a duplicate.`);
    const parsed = parseQuestionWorkbook(bytes);
    const metadata = parsed.metadata;
    const year = Number(metadata.exam_year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Exam Metadata: enter a valid exam_year between 2000 and 2100.');
    const session = metadata.exam_session || 'Other';
    if (metadata.exam_date) {
      const rawDate = String(metadata.exam_date).trim();
      const serial = Number(rawDate);
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(Date.parse(`${rawDate}T00:00:00Z`))) {
        metadata.exam_date = rawDate;
      } else if (Number.isFinite(serial) && serial >= 36526 && serial <= 73415) {
        const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
        metadata.exam_date = date.toISOString().slice(0, 10);
      } else {
        throw new Error('Exam Metadata: enter exam_date as YYYY-MM-DD or use an Excel date cell.');
      }
    }
    if (!['June','December','Other'].includes(session)) throw new Error('Exam Metadata: exam_session must be June, December or Other.');
    const eventType = metadata.event_type || 'regular';
    if (!['regular','re_exam','special','unknown'].includes(eventType)) throw new Error('Exam Metadata: event_type must be regular, re_exam, special or unknown.');
    const orderCounters = new Map<string, number>();
    const normalized = parsed.questions.map((record, index) => {
      const paper = String(record.paper ?? '').toUpperCase().replace(/PAPER\s*/g, '').trim();
      const defaultPaperIiCode = String(metadata.paper_ii_subject_code ?? '').trim();
      const subject = String(record.subject_code || (paper === 'I' || paper === '1' ? '00' : defaultPaperIiCode)).trim();
      if (!record.subject_name && paper !== 'I' && paper !== '1' && metadata.paper_ii_subject_name) record.subject_name = metadata.paper_ii_subject_name;
      const key = `${paper}:${subject}`;
      const nextOrder = (orderCounters.get(key) ?? 0) + 1;
      orderCounters.set(key, nextOrder);
      const inferred = !String(record.paper_order ?? '').trim();
      const normalizedRow = normalizeQuestionRow(inferred ? { ...record, paper_order: String(nextOrder) } : record, index);
      if (inferred) normalizedRow.warnings.push(`Paper order was inferred as ${nextOrder} from the worksheet order within Paper ${paper || '?'}. Confirm the official sequence.`);
      return normalizedRow;
    });
    const duplicateOrder = new Set<string>();
    const duplicateQuestionNumbers = new Set<string>();
    for (const row of normalized) {
      if (row.paperNumber && row.paperOrder) {
        const key = `${row.paperNumber}:${row.subjectCode}:${row.paperOrder}`;
        if (duplicateOrder.has(key)) row.errors.push(`Duplicate paper_order ${row.paperOrder} in Paper ${row.paperNumber}.`);
        duplicateOrder.add(key);
        const originalKey = `${row.paperNumber}:${row.subjectCode}:${String(row.originalQuestionNumber).toLowerCase()}`;
        if (row.originalQuestionNumber && duplicateQuestionNumbers.has(originalKey)) row.warnings.push(`Original question number ${row.originalQuestionNumber} appears more than once in this paper. Confirm source numbering.`);
        if (row.originalQuestionNumber) duplicateQuestionNumbers.add(originalKey);
      }
    }
    const validSubjects = new Set<string>();
    for (const code of [...new Set(normalized.map((row) => row.subjectCode).filter(Boolean))]) {
      const { data: subject } = await supabase.from('subjects').select('code').eq('code', code).maybeSingle();
      if (subject) validSubjects.add(code);
    }
    for (const row of normalized) {
      if (row.subjectCode && !validSubjects.has(row.subjectCode)) row.errors.push(`Subject code ${row.subjectCode} is not configured in CrackJRF.`);
      if (row.paperNumber === 2 && metadata.paper_ii_subject_code && row.subjectCode !== metadata.paper_ii_subject_code) row.warnings.push(`Row subject code differs from Exam Metadata paper_ii_subject_code (${metadata.paper_ii_subject_code}).`);
    }

    const batchCode = `XLSX-${year}-${session.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const validCount = normalized.filter((row) => row.errors.length === 0).length;
    const errorCount = normalized.length - validCount;
    const { data: batch, error: batchError } = await supabase.from('excel_import_batches').insert({
      batch_code: batchCode,
      file_name: fileName || storagePath.split('/').pop(),
      storage_path: storagePath,
      file_sha256: fileSha256,
      exam_metadata: metadata,
      status: 'staged',
      total_rows: normalized.length,
      valid_rows: validCount,
      rows_with_errors: errorCount,
      uploaded_by: user.id,
    }).select('id').single();
    if (batchError || !batch) throw batchError ?? new Error('Unable to create Excel import batch.');
    batchId = batch.id;

    for (let offset = 0; offset < normalized.length; offset += 100) {
      const records = normalized.slice(offset, offset + 100).map((row, localIndex) => ({
        batch_id: batch.id,
        vendor_row_id: row.row.vendor_row_id || null,
        paper_number: row.paperNumber || null,
        subject_code: row.subjectCode || null,
        subject_name: row.row.subject_name || null,
        original_question_number: row.originalQuestionNumber || null,
        paper_order: row.paperOrder || null,
        question_type: row.questionType,
        row_data: row.row,
        validation_errors: row.errors,
        validation_warnings: row.warnings,
        review_status: 'needs_review',
      }));
      const { error: rowsError } = await supabase.from('excel_import_rows').insert(records);
      if (rowsError) throw rowsError;
    }
    await supabase.from('audit_logs').insert({ actor_id: user.id, entity_type: 'excel_import_batch', entity_id: batch.id, action: 'excel_workbook_staged', after_data: { batch_code: batchCode, total_rows: normalized.length, valid_rows: validCount, rows_with_errors: errorCount, file_name: fileName } });
    return NextResponse.json({ batchId: batch.id, batchCode, totalRows: normalized.length, validRows: validCount, rowsWithErrors: errorCount, sheets: parsed.sheetNames }, { status: 201 });
  } catch (error) {
    if (batchId) {
      try {
        const { supabase } = await adminContext(['super_admin','importer']);
        await supabase.from('excel_import_batches').delete().eq('id', batchId);
      } catch { /* Preserve the original validation error. */ }
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected Excel import error.' }, { status: 400 });
  }
}
