import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
import { inspectQuestionPackage } from '../../../lib/import-package';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

async function requireAdmin(allowedRoles: string[] = ['super_admin', 'importer', 'content_editor', 'reviewer']) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, role: null };
  const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
  if (!member?.active || !allowedRoles.includes(member.role)) return { supabase, user, role: null };
  return { supabase, user, role: member.role as string };
}

export async function GET() {
  try {
    const { supabase, user, role } = await requireAdmin();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!role) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const { data, error } = await supabase
      .from('import_packages')
      .select('id,package_id,schema_version,exam_year,exam_session,paper_number,shift,total_questions,imported_questions,validation_status,status,languages,created_at,subjects(code,name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ packages: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load JSON import packages.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let storagePath = '';
  let packageRowId = '';
  try {
    const { supabase, user, role } = await requireAdmin(['super_admin', 'importer']);
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!role) return NextResponse.json({ error: 'Super Admin or Importer role required' }, { status: 403 });

    const body = await request.json() as { storagePath?: unknown };
    storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
    if (!storagePath || !storagePath.startsWith(`packages/${user.id}/`) || storagePath.split('/').length !== 3 || storagePath.includes('..') || storagePath.includes('\\') || !/^[A-Za-z0-9._-]+\.zip$/i.test(storagePath.split('/')[2] ?? '')) {
      return NextResponse.json({ error: 'A ZIP archive uploaded to your own packages folder is required.' }, { status: 400 });
    }

    const { data: archiveBlob, error: downloadError } = await supabase.storage.from('source-pdfs').download(storagePath);
    if (downloadError || !archiveBlob) throw new Error(`Unable to read uploaded package from private storage: ${downloadError?.message ?? 'file not found'}`);
    if (archiveBlob.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP package exceeds the 100 MB file limit.');
    const archive = Buffer.from(await archiveBlob.arrayBuffer());
    const validated = inspectQuestionPackage(archive);
    const manifest = validated.manifest;
    const exam = manifest.exam as Record<string, unknown>;
    const packageId = String(manifest.package_id);

    const { data: duplicate } = await supabase.from('import_packages').select('id').eq('package_id', packageId).maybeSingle();
    if (duplicate) return NextResponse.json({ error: `Package ID ${packageId} has already been imported. For a corrected delivery, the provider must issue a new package_id and reference the superseded delivery in delivery_notes.` }, { status: 409 });

    const subjectCode = String(exam.subject_code);
    const { data: subject, error: subjectError } = await supabase.from('subjects').select('id').eq('code', subjectCode).single();
    if (subjectError || !subject) throw new Error(`Subject code ${subjectCode} is not configured in CrackJRF. Add the subject before importing this package.`);

    const eventType = exam.is_re_exam === true ? 're_exam' : 'regular';
    const eventLabel = String(exam.session_label ?? (exam.is_re_exam === true ? exam.re_exam_reference ?? '' : ''));
    const { data: event, error: eventError } = await supabase.from('exam_events')
      .upsert({ year: Number(exam.year), session: String(exam.session), event_type: eventType, label: eventLabel }, { onConflict: 'year,session,event_type,label' })
      .select('id').single();
    if (eventError || !event) throw eventError ?? new Error('Unable to create examination event.');

    const paperNumber = exam.paper === 'I' ? 1 : 2;
    const shift = String(exam.shift ?? 'Unknown');
    const { data: paper, error: paperError } = await supabase.from('exam_papers')
      .upsert({
        exam_event_id: event.id,
        subject_id: subject.id,
        paper_number: paperNumber,
        shift,
        exam_date: exam.exam_date ?? null,
        original_question_count: Number((validated.qaReport.official_question_count as number | undefined) ?? validated.questions.length),
        source_status: 'unverified',
        historical_pattern_notes: 'Imported from vendor JSON package; NTA order preserved; source verification pending.',
      }, { onConflict: 'exam_event_id,subject_id,paper_number,shift' })
      .select('id').single();
    if (paperError || !paper) throw paperError ?? new Error('Unable to create examination paper record.');

    const languages = (manifest.languages as Record<string, unknown>).available as string[];
    const { data: packageRow, error: packageError } = await supabase.from('import_packages').insert({
      package_id: packageId,
      schema_version: String(manifest.schema_version),
      subject_id: subject.id,
      exam_event_id: event.id,
      exam_paper_id: paper.id,
      paper_number: paperNumber,
      exam_year: Number(exam.year),
      exam_session: String(exam.session),
      shift,
      archive_path: storagePath,
      archive_sha256: validated.archiveSha256,
      manifest,
      qa_report: validated.qaReport,
      languages,
      total_questions: validated.questions.length,
      imported_questions: 0,
      validation_status: validated.warnings.length ? 'valid_with_warnings' : 'valid',
      status: 'staged',
      uploaded_by: user.id,
    }).select('id').single();
    if (packageError || !packageRow) throw packageError ?? new Error('Unable to register validated package.');
    packageRowId = packageRow.id;

    for (let offset = 0; offset < validated.questions.length; offset += 100) {
      const batch = validated.questions.slice(offset, offset + 100).map((question) => ({
        import_package_id: packageRow.id,
        base_question_id: question.base_question_id,
        language_question_codes: question.language_question_codes,
        order_index: question.order_index,
        original_question_number: question.original_question_number,
        question_type: question.question_type,
        common_data: question.common_data,
        english_data: question.english_data,
        hindi_data: question.hindi_data,
      }));
      const { error: questionError } = await supabase.from('import_package_questions').insert(batch);
      if (questionError) throw questionError;
    }

    const { error: countError } = await supabase.from('import_packages').update({ imported_questions: validated.questions.length }).eq('id', packageRow.id);
    if (countError) throw countError;
    await supabase.from('audit_logs').insert({
      actor_id: user.id,
      entity_type: 'import_package',
      entity_id: packageRow.id,
      action: 'validated_and_staged',
      after_data: { package_id: packageId, total_questions: validated.questions.length, warnings: validated.warnings },
    });

    return NextResponse.json({
      importPackageId: packageRow.id,
      packageId,
      status: 'staged',
      questionCount: validated.questions.length,
      languages,
      exam: { subject: String(exam.subject_name), subjectCode, paper: exam.paper, year: exam.year, session: exam.session, shift },
      validationStatus: validated.warnings.length ? 'valid_with_warnings' : 'valid',
      warnings: validated.warnings,
    }, { status: 201 });
  } catch (error) {
    if (packageRowId) {
      try {
        const { supabase } = await requireAdmin(['super_admin', 'importer']);
        await supabase.from('import_packages').delete().eq('id', packageRowId);
      } catch { /* Preserve the original import error. */ }
    }
    const message = error instanceof Error ? error.message : 'Unexpected JSON import error.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
