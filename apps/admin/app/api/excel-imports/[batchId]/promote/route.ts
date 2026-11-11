import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/server-supabase';

export const runtime = 'nodejs';
const optionKeys = ['A','B','C','D'];
function asText(value: unknown): string { return value === null || value === undefined ? '' : String(value).trim(); }
function htmlEscape(value: string): string { return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function richText(value: string) { return value ? [{ type: 'html', html: `<p>${htmlEscape(value).replace(/\n/g,'<br>')}</p>` }] : []; }
async function adminContext() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, role: null };
  const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
  if (!member?.active || !['super_admin','content_editor','reviewer'].includes(member.role)) return { supabase, user, role: null };
  return { supabase, user, role: member.role as string };
}

export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  let createdQuestionId = '';
  try {
    const { batchId } = await context.params;
    const { supabase, user, role } = await adminContext();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!role) return NextResponse.json({ error: 'Content Editor, Reviewer or Super Admin access required' }, { status: 403 });
    const body = await request.json() as { rowId?: string };
    if (!body.rowId) return NextResponse.json({ error: 'rowId is required.' }, { status: 400 });
    const { data: row, error: rowError } = await supabase.from('excel_import_rows').select('*').eq('id', body.rowId).eq('batch_id', batchId).single();
    if (rowError || !row) return NextResponse.json({ error: 'Staged question row not found.' }, { status: 404 });
    if (row.canonical_question_id) return NextResponse.json({ error: 'This staged row has already been added to the canonical Question Bank.' }, { status: 409 });
    if (row.review_status !== 'reviewed') return NextResponse.json({ error: 'Save and mark this staged row as reviewed before adding it to the Question Bank.' }, { status: 409 });
    const errors = Array.isArray(row.validation_errors) ? row.validation_errors : [];
    if (errors.length) return NextResponse.json({ error: 'Resolve all row validation errors before adding it to the Question Bank.', validationErrors: errors }, { status: 422 });
    const data = row.row_data as Record<string, unknown>;
    const subjectCode = String(row.subject_code);
    const { data: subject, error: subjectError } = await supabase.from('subjects').select('id,code,name').eq('code', subjectCode).single();
    if (subjectError || !subject) throw new Error(`Subject ${subjectCode} is not configured.`);
    const meta = (await supabase.from('excel_import_batches').select('exam_metadata').eq('id', batchId).single()).data?.exam_metadata ?? {};
    const year = Number(meta.exam_year);
    const session = ['June','December','Other'].includes(String(meta.exam_session)) ? String(meta.exam_session) : 'Other';
    const eventType = ['regular','re_exam','special','unknown'].includes(String(meta.event_type)) ? String(meta.event_type) : 'unknown';
    const label = asText(meta.event_label);
    const { data: event, error: eventError } = await supabase.from('exam_events').upsert({ year, session, event_type: eventType, label }, { onConflict: 'year,session,event_type,label' }).select('id').single();
    if (eventError || !event) throw eventError ?? new Error('Unable to create exam event.');
    const paperNumber = Number(row.paper_number);
    const shift = asText(meta.shift) || 'Unknown';
    const { count: questionCount } = await supabase.from('excel_import_rows').select('id', { count: 'exact', head: true }).eq('batch_id', batchId).eq('paper_number', paperNumber).eq('subject_code', subjectCode);
    const { data: paper, error: paperError } = await supabase.from('exam_papers').upsert({
      exam_event_id: event.id, subject_id: subject.id, paper_number: paperNumber, shift,
      exam_date: asText(meta.exam_date) || null,
      original_question_count: questionCount ?? null,
      source_status: 'unverified',
      historical_pattern_notes: 'Imported from CrackJRF Excel workbook. Source and answer verification is pending.',
    }, { onConflict: 'exam_event_id,subject_id,paper_number,shift' }).select('id').single();
    if (paperError || !paper) throw paperError ?? new Error('Unable to create exam paper record.');

    const { data: existingAppearance, error: appearanceLookupError } = await supabase
      .from('question_appearances')
      .select('id,question_id')
      .eq('exam_paper_id', paper.id)
      .eq('original_question_number', asText(row.original_question_number))
      .maybeSingle();
    if (appearanceLookupError) throw appearanceLookupError;
    if (existingAppearance) throw new Error(`Question number ${row.original_question_number} already exists for this exam paper in the Question Bank. Check the existing record before importing it again.`);

    const { data: code, error: codeError } = await supabase.rpc('next_question_code', { p_subject_code: subjectCode });
    if (codeError || !code) throw codeError ?? new Error('Unable to generate a permanent CrackJRF question code.');
    const questionType = ['mcq','comprehension','table','image','map','matrix','numeric','other'].includes(row.question_type) ? row.question_type : 'other';
    const { data: question, error: questionError } = await supabase.from('questions').insert({
      question_code: code, subject_id: subject.id, question_type: questionType, status: 'draft', answer_status: 'pending',
      primary_language: 'en', created_by: user.id, updated_by: user.id,
    }).select('id,question_code').single();
    if (questionError || !question) throw questionError ?? new Error('Unable to create canonical question draft.');
    createdQuestionId = question.id;

    const englishStem = asText(data.question_english);
    const hindiStem = asText(data.question_hindi_final) || asText(data.question_hindi_official);
    const hinglishStem = asText(data.question_hinglish_roman);
    const translationRows = [{ question_id: question.id, language: 'en', script_variant: 'native', origin: 'official_source', language_question_code: `${code}E`, stem_blocks: [{ type: 'paragraph', text: englishStem }], reviewed: false }];
    if (hindiStem) translationRows.push({ question_id: question.id, language: 'hi', script_variant: 'native', origin: asText(data.question_hindi_origin) || (asText(data.question_hindi_official) ? 'official_source' : 'manual'), language_question_code: `${code}H`, stem_blocks: [{ type: 'paragraph', text: hindiStem }], reviewed: false } as never);
    if (hinglishStem) translationRows.push({ question_id: question.id, language: 'hi', script_variant: 'roman', origin: asText(data.question_hinglish_origin) || 'ai_draft', stem_blocks: [{ type: 'paragraph', text: hinglishStem }], reviewed: false } as never);
    const { error: translationError } = await supabase.from('question_translations').insert(translationRows);
    if (translationError) throw translationError;

    for (let index = 0; index < optionKeys.length; index += 1) {
      const key = optionKeys[index];
      const englishOption = asText(data[`option_${key.toLowerCase()}_english`]);
      const hindiOption = asText(data[`option_${key.toLowerCase()}_hindi_final`]) || asText(data[`option_${key.toLowerCase()}_hindi_official`]);
      const hinglishOption = asText(data[`option_${key.toLowerCase()}_hinglish_roman`]);
      if (!englishOption && !hindiOption && !hinglishOption) continue;
      const { data: option, error: optionError } = await supabase.from('question_options').insert({ question_id: question.id, option_key: key, sort_order: index + 1, provider_option_id: `${asText(data.vendor_row_id) || row.original_question_number}-${key}` }).select('id').single();
      if (optionError || !option) throw optionError ?? new Error(`Unable to create option ${key}.`);
      const optionTranslations = [];
      if (englishOption) optionTranslations.push({ option_id: option.id, language: 'en', script_variant: 'native', origin: 'official_source', content_blocks: [{ type: 'paragraph', text: englishOption }] });
      if (hindiOption) optionTranslations.push({ option_id: option.id, language: 'hi', script_variant: 'native', origin: asText(data[`option_${key.toLowerCase()}_hindi_origin`]) || (asText(data[`option_${key.toLowerCase()}_hindi_official`]) ? 'official_source' : 'manual'), content_blocks: [{ type: 'paragraph', text: hindiOption }] });
      if (hinglishOption) optionTranslations.push({ option_id: option.id, language: 'hi', script_variant: 'roman', origin: asText(data[`option_${key.toLowerCase()}_hinglish_origin`]) || 'ai_draft', content_blocks: [{ type: 'paragraph', text: hinglishOption }] });
      if (optionTranslations.length) {
        const { error: optionTranslationError } = await supabase.from('question_option_translations').insert(optionTranslations);
        if (optionTranslationError) throw optionTranslationError;
      }
    }

    const englishExplanation = asText(data.provider_explanation_english);
    const hindiExplanation = asText(data.provider_explanation_hindi_final) || asText(data.provider_explanation_hindi);
    const hinglishExplanation = asText(data.provider_explanation_hinglish_roman);
    const explanationRows = [];
    if (englishExplanation) explanationRows.push({ question_id: question.id, language: 'en', script_variant: 'native', origin: 'institution_solution', explanation_overview: englishExplanation, explanation_richtext: richText(englishExplanation), review_status: 'draft', updated_by: user.id });
    if (hindiExplanation) explanationRows.push({ question_id: question.id, language: 'hi', script_variant: 'native', origin: asText(data.provider_explanation_hindi_origin) || (asText(data.provider_explanation_hindi) ? 'institution_solution' : 'manual'), explanation_overview: hindiExplanation, explanation_richtext: richText(hindiExplanation), review_status: 'draft', updated_by: user.id });
    if (hinglishExplanation) explanationRows.push({ question_id: question.id, language: 'hi', script_variant: 'roman', origin: asText(data.provider_explanation_hinglish_origin) || 'ai_draft', explanation_overview: hinglishExplanation, explanation_richtext: richText(hinglishExplanation), review_status: 'draft', updated_by: user.id });
    if (explanationRows.length) {
      const { error: explanationError } = await supabase.from('question_explanation_translations').insert(explanationRows);
      if (explanationError) throw explanationError;
      const { error: draftError } = await supabase.from('question_explanation_drafts').upsert({ question_id: question.id, explanation_overview: englishExplanation || null, explanation_richtext: richText(englishExplanation), updated_by: user.id });
      if (draftError) throw draftError;
    }

    const unitId = asText(data.unit_id), sectionId = asText(data.section_id), topicId = asText(data.topic_id), subtopicId = asText(data.subtopic_id);
    const tagIds = [unitId, sectionId, topicId, subtopicId].filter(Boolean);
    if (tagIds.length) {
      if (!unitId || !sectionId || !topicId) throw new Error('Choose a complete Unit → Section → Topic path before promoting a classified question.');
      const { data: nodes, error: nodeError } = await supabase.from('syllabus_nodes').select('id,parent_id,node_type').in('id', tagIds);
      if (nodeError) throw nodeError;
      const byId = new Map((nodes ?? []).map((node) => [node.id, node]));
      if (byId.get(unitId)?.node_type !== 'unit') throw new Error('Selected unit is not a unit in the active CrackJRF taxonomy.');
      if (byId.get(sectionId)?.node_type !== 'section' || byId.get(sectionId)?.parent_id !== unitId) throw new Error('Selected section does not belong to the selected unit.');
      if (byId.get(topicId)?.node_type !== 'topic' || byId.get(topicId)?.parent_id !== sectionId) throw new Error('Selected topic does not belong to the selected section.');
      if (subtopicId && (byId.get(subtopicId)?.node_type !== 'subtopic' || byId.get(subtopicId)?.parent_id !== topicId)) throw new Error('Selected sub-topic does not belong to the selected topic.');
      const validIds = new Set((nodes ?? []).map((node) => node.id));
      if (validIds.size !== tagIds.length) throw new Error('One or more selected syllabus classifications are not found in the active CrackJRF taxonomy. Re-select the tags.');
      const classifications = tagIds.filter((id) => validIds.has(id)).map((nodeId) => ({ question_id: question.id, syllabus_node_id: nodeId, is_primary: nodeId === asText(data.topic_id), assigned_by: user.id }));
      if (classifications.length) {
        const { error: classificationError } = await supabase.from('question_classifications').insert(classifications);
        if (classificationError) throw classificationError;
      }
    }
    const keywordMap = new Map<string, string>();
    for (const value of asText(data.keywords).split(/[;,]/)) {
      const keyword = value.trim().slice(0, 80);
      const normalized = keyword.toLocaleLowerCase('en-IN');
      if (keyword && !keywordMap.has(normalized)) keywordMap.set(normalized, keyword);
    }
    const keywords = [...keywordMap.entries()].slice(0, 30);
    if (keywords.length) {
      const { error: keywordError } = await supabase.from('question_keywords').insert(keywords.map(([normalized_keyword, keyword]) => ({ question_id: question.id, keyword, normalized_keyword })));
      if (keywordError) throw keywordError;
    }

    const appearanceNotes = [
      `Official source: ${asText(meta.official_source_filename) || 'not named'}; page ${asText(data.official_paper_page) || 'not supplied'}.`,
      `Institution source: ${asText(meta.institution_solved_filename) || 'not named'}; page ${asText(data.institution_paper_page) || 'not supplied'}.`,
      `Provider match: ${asText(data.question_match_status) || 'not assessed'} (${asText(data.match_confidence) || 'confidence not supplied'}).`,
      asText(data.source_alignment_note),
    ].filter(Boolean).join(' ');
    const { error: appearanceError } = await supabase.from('question_appearances').insert({
      question_id: question.id, exam_paper_id: paper.id, original_question_number: asText(row.original_question_number), appearance_notes: appearanceNotes,
    });
    if (appearanceError) throw appearanceError;

    const proposedKeys = asText(data.correct_option).toUpperCase().replace(/[;|]/g, ',').split(',').map((value) => value.trim()).filter((value) => optionKeys.includes(value));
    if (proposedKeys.length) {
      const sourceNote = [
        `Provider answer source: ${asText(data.answer_source_type) || 'not stated'}.`,
        `Source title: ${asText(data.answer_source_title) || asText(meta.institution_solved_filename) || 'not stated'}.`,
        `Source page: ${asText(data.answer_source_page) || asText(data.institution_paper_page) || 'not supplied'}.`,
        `Official key status: ${asText(data.official_key_status) || 'not supplied'}.`,
        'Imported answer is a claim only; it has not been verified by CrackJRF.',
      ].join(' ');
      const { error: evidenceError } = await supabase.from('answer_evidence').insert({ question_id: question.id, claimed_option_keys: proposedKeys, explanation_richtext: richText(englishExplanation), provenance_note: sourceNote, verification_status: 'unverified' });
      if (evidenceError) throw evidenceError;
    }

    const mediaAssets = Array.isArray(data.media_assets) ? data.media_assets as Array<Record<string, unknown>> : [];
    for (const [assetIndex, asset] of mediaAssets.entries()) {
      if (!asText(asset.storage_path)) continue;
      const requestedAssetType = asText(data.media_asset_type || asset.asset_type);
      const assetType = ['image','map','diagram','table_image','page_crop','other'].includes(requestedAssetType) ? requestedAssetType : 'image';
      const placement = asText(data.media_placement || asset.placement) === 'explanation' ? 'explanation' : 'question';
      const { error: assetError } = await supabase.from('question_assets').insert({ question_id: question.id, asset_type: assetType, storage_path: asText(asset.storage_path), alt_text: asText(asset.alt_text) || asText(data.media_alt_text) || null, caption: asText(asset.caption) || asText(data.media_description) || null, placement, sort_order: assetIndex + 1 });
      if (assetError) throw assetError;
    }

    const { error: revisionError } = await supabase.from('question_revisions').insert({ question_id: question.id, revision_number: 1, snapshot: { excel_batch_id: batchId, excel_row_id: row.id, row_data: data }, changed_by: user.id, change_summary: 'Draft created from Excel import staging' });
    if (revisionError) throw revisionError;
    const { error: updateError } = await supabase.from('excel_import_rows').update({ canonical_question_id: question.id, row_data: { ...data, canonical_question_code: question.question_code }, review_status: 'promoted', promoted_at: new Date().toISOString(), promoted_by: user.id }).eq('id', row.id);
    if (updateError) throw updateError;
    const { count: promotedCount } = await supabase.from('excel_import_rows').select('id', { count: 'exact', head: true }).eq('batch_id', batchId).eq('review_status', 'promoted');
    const { data: batchSummary, error: batchSummaryError } = await supabase.from('excel_import_batches').select('total_rows').eq('id', batchId).single();
    if (batchSummaryError) throw batchSummaryError;
    const batchStatus = (promotedCount ?? 0) >= (batchSummary?.total_rows ?? 0) ? 'completed' : 'in_review';
    const { error: batchUpdateError } = await supabase.from('excel_import_batches').update({ rows_promoted: promotedCount ?? 0, status: batchStatus }).eq('id', batchId);
    if (batchUpdateError) throw batchUpdateError;
    await supabase.from('audit_logs').insert({ actor_id: user.id, entity_type: 'question', entity_id: question.id, action: 'created_from_excel_staging', after_data: { question_code: code, batch_id: batchId, row_id: row.id, answer_status: 'pending' } });
    return NextResponse.json({ questionId: question.id, questionCode: question.question_code, status: 'draft' }, { status: 201 });
  } catch (error) {
    if (createdQuestionId) {
      try {
        const supabase = await createServerSupabaseClient();
        await supabase.from('questions').delete().eq('id', createdQuestionId);
      } catch { /* Preserve the original failure. */ }
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create canonical question draft.' }, { status: 400 });
  }
}
