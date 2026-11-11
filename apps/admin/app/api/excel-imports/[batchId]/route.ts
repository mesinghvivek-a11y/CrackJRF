import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';
import { normalizeQuestionRow } from '../../../../lib/excel-workbook';

export const runtime = 'nodejs';
async function getContext(roles: string[] = ['super_admin','importer','content_editor','reviewer']) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, role: null };
  const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
  if (!member?.active || !roles.includes(member.role)) return { supabase, user, role: null };
  return { supabase, user, role: member.role as string };
}

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    const { batchId } = await context.params;
    const { supabase, user, role } = await getContext();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!role) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const { data: batch, error: batchError } = await supabase.from('excel_import_batches').select('*').eq('id', batchId).single();
    if (batchError || !batch) return NextResponse.json({ error: 'Excel import batch not found.' }, { status: 404 });
    const { data: rows, error: rowsError } = await supabase.from('excel_import_rows').select('*').eq('batch_id', batchId).order('paper_number').order('paper_order').limit(3000);
    if (rowsError) throw rowsError;
    return NextResponse.json({ batch, rows: rows ?? [], permissions: { canMarkReviewed: ['super_admin','reviewer'].includes(role) } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Excel import batch.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    const { batchId } = await context.params;
    const { supabase, user, role } = await getContext(['super_admin','content_editor','reviewer']);
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!role) return NextResponse.json({ error: 'Content Editor, Reviewer or Super Admin access required' }, { status: 403 });
    const body = await request.json() as { rowId?: string; rowData?: Record<string, unknown>; reviewStatus?: string };
    if (!body.rowId || !body.rowData || typeof body.rowData !== 'object') return NextResponse.json({ error: 'rowId and rowData are required.' }, { status: 400 });
    const { data: existing, error: existingError } = await supabase.from('excel_import_rows').select('id,batch_id,canonical_question_id').eq('id', body.rowId).eq('batch_id', batchId).single();
    if (existingError || !existing) return NextResponse.json({ error: 'Staged question row not found.' }, { status: 404 });
    if (existing.canonical_question_id) return NextResponse.json({ error: 'This row has already been promoted. Edit the canonical question from Question Bank instead.' }, { status: 409 });
    const normalized = normalizeQuestionRow(body.rowData, 0);
    const allowedStatuses = ['needs_review','in_review','reviewed','rejected'];
    const requestedStatus = body.reviewStatus && allowedStatuses.includes(body.reviewStatus) ? body.reviewStatus : 'in_review';
    if (requestedStatus === 'reviewed' && !['super_admin','reviewer'].includes(role)) {
      return NextResponse.json({ error: 'Only a Reviewer or Super Admin can mark an imported question as reviewed.' }, { status: 403 });
    }
    if (requestedStatus === 'reviewed' && normalized.errors.length > 0) {
      return NextResponse.json({ error: 'Resolve all validation errors before marking this row reviewed.', validationErrors: normalized.errors }, { status: 422 });
    }
    const { data, error } = await supabase.from('excel_import_rows').update({
      vendor_row_id: String(body.rowData.vendor_row_id ?? '') || null,
      paper_number: normalized.paperNumber || null,
      subject_code: normalized.subjectCode || null,
      subject_name: String(body.rowData.subject_name ?? '') || null,
      original_question_number: normalized.originalQuestionNumber || null,
      paper_order: normalized.paperOrder || null,
      question_type: normalized.questionType,
      row_data: normalized.row,
      validation_errors: normalized.errors,
      validation_warnings: normalized.warnings,
      review_status: requestedStatus,
    }).eq('id', existing.id).select('id,validation_errors,validation_warnings,review_status,row_data').single();
    if (error) throw error;
    const { data: batchRows, error: countError } = await supabase.from('excel_import_rows').select('validation_errors,review_status').eq('batch_id', batchId);
    if (countError) throw countError;
    const validCount = (batchRows ?? []).filter((item) => Array.isArray(item.validation_errors) && item.validation_errors.length === 0).length;
    const errorCount = (batchRows ?? []).length - validCount;
    const promotedCount = (batchRows ?? []).filter((item) => item.review_status === 'promoted').length;
    await supabase.from('excel_import_batches').update({ status: 'in_review', valid_rows: validCount, rows_with_errors: errorCount, rows_promoted: promotedCount }).eq('id', batchId);
    await supabase.from('audit_logs').insert({ actor_id: user.id, entity_type: 'excel_import_row', entity_id: existing.id, action: 'staged_question_edited', after_data: { review_status: requestedStatus, validation_errors: normalized.errors, validation_warnings: normalized.warnings } });
    return NextResponse.json({ row: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save staged question.' }, { status: 400 });
  }
}
