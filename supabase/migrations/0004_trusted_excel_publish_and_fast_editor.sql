-- CrackJRF trusted Excel import + fast bilingual editor.
-- A workbook supplied by the Super Admin is treated as pre-checked content.
-- Structural/relationship checks still run; a valid batch publishes atomically.

-- This product supports English and Devanagari Hindi only. Remove any legacy Roman-script rows
-- and restrict all three translation tables to native script variants.
delete from public.question_translations where language = 'hi' and script_variant = 'roman';
delete from public.question_option_translations where language = 'hi' and script_variant = 'roman';
delete from public.question_explanation_translations where language = 'hi' and script_variant = 'roman';

alter table public.question_translations drop constraint if exists question_translations_script_variant_check;
alter table public.question_translations add constraint question_translations_script_variant_check
  check ((language = 'en' and script_variant = 'native') or (language = 'hi' and script_variant = 'native'));
alter table public.question_option_translations drop constraint if exists question_option_translations_script_variant_check;
alter table public.question_option_translations add constraint question_option_translations_script_variant_check
  check ((language = 'en' and script_variant = 'native') or (language = 'hi' and script_variant = 'native'));
alter table public.question_explanation_translations drop constraint if exists question_explanation_translations_script_variant_check;
alter table public.question_explanation_translations add constraint question_explanation_translations_script_variant_check
  check ((language = 'en' and script_variant = 'native') or (language = 'hi' and script_variant = 'native'));

alter table public.question_appearances add column if not exists paper_order integer check (paper_order is null or paper_order > 0);
alter table public.question_appearances add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create table if not exists public.question_editor_drafts (
  question_id uuid primary key references public.questions(id) on delete cascade,
  draft_payload jsonb not null,
  base_revision integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.question_editor_drafts enable row level security;
grant select, insert, update, delete on public.question_editor_drafts to authenticated;
drop policy if exists "admins manage question editor drafts" on public.question_editor_drafts;
create policy "admins manage question editor drafts" on public.question_editor_drafts
  for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));

-- Internal writer shared by the trusted Excel importer and the compact editor.
create or replace function public.apply_question_editor_payload(
  p_question_id uuid,
  p_subject_id uuid,
  p_payload jsonb,
  p_actor uuid,
  p_status text,
  p_revision_number integer,
  p_revision_summary text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit text := nullif(p_payload #>> '{classification,unitId}','');
  v_section text := nullif(p_payload #>> '{classification,sectionId}','');
  v_topic text := nullif(p_payload #>> '{classification,topicId}','');
  v_subtopic text := nullif(p_payload #>> '{classification,subtopicId}','');
  v_node_type text;
  v_parent text;
  v_syllabus_version_id uuid;
  v_content_origin text := case when p_payload->>'contentOrigin' in ('official_source','institution_solution','manual') then p_payload->>'contentOrigin' else 'manual' end;
  v_explanation_origin text := case when p_payload->>'explanationOrigin' in ('official_source','institution_solution','manual') then p_payload->>'explanationOrigin' else 'manual' end;
  v_source_note text := nullif(p_payload->>'sourceNote','');
  v_source_metadata jsonb := coalesce(p_payload->'sourceMetadata','{}'::jsonb);
  v_option jsonb;
  v_option_id uuid;
  v_key text;
  v_en text;
  v_hi text;
  v_answer_keys text[];
  v_answer_status text;
  v_explanation_en text := coalesce(p_payload->>'explanationEn','');
  v_explanation_hi text := coalesce(p_payload->>'explanationHi','');
  v_keywords text[];
  v_keyword text;
  v_appearance jsonb := coalesce(p_payload->'appearance','{}'::jsonb);
  v_exam_paper_id uuid;
  v_original_number text;
  v_paper_order integer;
  v_asset jsonb;
  v_asset_index integer := 0;
begin
  if p_status not in ('draft','published') then raise exception 'Invalid question status.'; end if;
  if nullif(p_payload->>'stemEn','') is null then raise exception 'English question text is required.'; end if;
  if coalesce(jsonb_typeof(p_payload->'options'),'') <> 'array' then
    raise exception 'Options must be supplied as an array.';
  end if;
  if jsonb_array_length(p_payload->'options') <> 4 then
    raise exception 'Exactly four options are required.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'options') as opt(item)
    where coalesce(upper(opt.item->>'key'),'') not in ('A','B','C','D')
       or nullif(opt.item->>'en','') is null
  ) or (
    select count(distinct upper(opt.item->>'key')) from jsonb_array_elements(p_payload->'options') as opt(item)
  ) <> 4 then
    raise exception 'Exactly one English option for each key A, B, C and D is required.';
  end if;

  v_answer_status := coalesce(p_payload->>'answerStatus','single_correct');
  select array_agg(x order by x) into v_answer_keys
  from (select distinct upper(trim(value)) as x from jsonb_array_elements_text(coalesce(p_payload->'correctOptionKeys','[]'::jsonb))) s;
  if v_answer_status = 'all_options_correct' then v_answer_keys := array['A','B','C','D']; end if;
  if v_answer_status not in ('single_correct','multiple_correct','all_options_correct','dropped') then
    raise exception 'Select a valid answer type.';
  end if;
  if v_answer_status <> 'dropped' and coalesce(array_length(v_answer_keys,1),0) = 0 then
    raise exception 'Select at least one correct option.';
  end if;
  if exists(select 1 from unnest(coalesce(v_answer_keys,'{}'::text[])) x where x not in ('A','B','C','D')) then
    raise exception 'Correct answers must be A, B, C or D.';
  end if;
  if v_answer_status = 'single_correct' and coalesce(array_length(v_answer_keys,1),0) <> 1 then
    raise exception 'A single-correct question must have exactly one correct option.';
  end if;
  if v_answer_status = 'multiple_correct' and coalesce(array_length(v_answer_keys,1),0) < 2 then
    raise exception 'A multiple-correct question must have at least two correct options.';
  end if;

  -- Validate the complete topic path against the current syllabus version for this subject.
  if v_unit is null or v_section is null or v_topic is null then
    raise exception 'Choose a Unit, Section and Topic before publishing.';
  end if;
  select id into v_syllabus_version_id from public.syllabus_versions
    where subject_id=p_subject_id and is_current=true order by created_at desc limit 1;
  if v_syllabus_version_id is null then raise exception 'No current syllabus version is configured for the selected subject.'; end if;
  select node_type,parent_id into v_node_type,v_parent from public.syllabus_nodes
    where id=v_unit and syllabus_version_id=v_syllabus_version_id and is_active=true;
  if not found or v_node_type <> 'unit' or v_parent is not null then raise exception 'Selected Unit is not valid for this subject.'; end if;
  select node_type,parent_id into v_node_type,v_parent from public.syllabus_nodes
    where id=v_section and syllabus_version_id=v_syllabus_version_id and is_active=true;
  if not found or v_node_type <> 'section' or v_parent <> v_unit then raise exception 'Selected Section does not belong to this Unit.'; end if;
  select node_type,parent_id into v_node_type,v_parent from public.syllabus_nodes
    where id=v_topic and syllabus_version_id=v_syllabus_version_id and is_active=true;
  if not found or v_node_type <> 'topic' or v_parent <> v_section then raise exception 'Selected Topic does not belong to this Section.'; end if;
  if v_subtopic is not null then
    select node_type,parent_id into v_node_type,v_parent from public.syllabus_nodes
      where id=v_subtopic and syllabus_version_id=v_syllabus_version_id and is_active=true;
    if not found or v_node_type <> 'subtopic' or v_parent <> v_topic then raise exception 'Selected sub-topic does not belong to this Topic.'; end if;
  end if;

  update public.questions set
    subject_id=p_subject_id,
    question_type=coalesce(nullif(p_payload->>'questionType',''),'mcq'),
    status=p_status,
    answer_status=v_answer_status,
    primary_language='en',
    updated_by=p_actor,
    current_revision=p_revision_number,
    published_at=case when p_status='published' then now() else null end
  where id=p_question_id;

  -- English is the canonical language. Hindi is optional and independent.
  insert into public.question_translations(
    question_id,language,script_variant,origin,language_question_code,stem_blocks,reviewed
  ) values (
    p_question_id,'en','native',v_content_origin,
    (select question_code||'E' from public.questions where id=p_question_id),
    jsonb_build_array(jsonb_build_object('type','paragraph','text',p_payload->>'stemEn')),
    p_status='published'
  ) on conflict(question_id,language,script_variant) do update set
    stem_blocks=excluded.stem_blocks,reviewed=excluded.reviewed,origin=excluded.origin;

  v_hi := nullif(p_payload->>'stemHi','');
  if v_hi is not null then
    insert into public.question_translations(
      question_id,language,script_variant,origin,language_question_code,stem_blocks,reviewed
    ) values (
      p_question_id,'hi','native',v_content_origin,
      (select question_code||'H' from public.questions where id=p_question_id),
      jsonb_build_array(jsonb_build_object('type','paragraph','text',v_hi)),
      p_status='published'
    ) on conflict(question_id,language,script_variant) do update set
      stem_blocks=excluded.stem_blocks,reviewed=excluded.reviewed,origin=excluded.origin;
  else
    delete from public.question_translations where question_id=p_question_id and language='hi';
  end if;

  -- Preserve canonical option UUIDs across edits.
  for v_option in select value from jsonb_array_elements(p_payload->'options') loop
    v_key := upper(v_option->>'key');
    v_en := nullif(v_option->>'en','');
    v_hi := nullif(v_option->>'hi','');
    insert into public.question_options(question_id,option_key,sort_order)
      values(p_question_id,v_key,case v_key when 'A' then 1 when 'B' then 2 when 'C' then 3 else 4 end)
      on conflict(question_id,option_key) do update set sort_order=excluded.sort_order
      returning id into v_option_id;
    insert into public.question_option_translations(option_id,language,script_variant,origin,content_blocks,reviewed)
      values(v_option_id,'en','native',v_content_origin,jsonb_build_array(jsonb_build_object('type','paragraph','text',v_en)),p_status='published')
      on conflict(option_id,language,script_variant) do update set content_blocks=excluded.content_blocks,reviewed=excluded.reviewed,origin=excluded.origin;
    if v_hi is not null then
      insert into public.question_option_translations(option_id,language,script_variant,origin,content_blocks,reviewed)
        values(v_option_id,'hi','native',v_content_origin,jsonb_build_array(jsonb_build_object('type','paragraph','text',v_hi)),p_status='published')
        on conflict(option_id,language,script_variant) do update set content_blocks=excluded.content_blocks,reviewed=excluded.reviewed,origin=excluded.origin;
    else
      delete from public.question_option_translations where option_id=v_option_id and language='hi';
    end if;
  end loop;
  delete from public.question_options where question_id=p_question_id and option_key not in ('A','B','C','D');

  -- Explanations are editable independently by language; no translation service is required.
  if nullif(v_explanation_en,'') is not null then
    insert into public.question_explanation_translations(
      question_id,language,script_variant,origin,explanation_overview,explanation_richtext,review_status,updated_by,verified_by,verified_at
    ) values (
      p_question_id,'en','native',v_explanation_origin,v_explanation_en,
      jsonb_build_array(jsonb_build_object('type','paragraph','text',v_explanation_en)),
      case when p_status='published' then 'verified' else 'draft' end,p_actor,
      case when p_status='published' then p_actor else null end,
      case when p_status='published' then now() else null end
    ) on conflict(question_id,language,script_variant) do update set
      explanation_overview=excluded.explanation_overview,explanation_richtext=excluded.explanation_richtext,
      review_status=excluded.review_status,updated_by=excluded.updated_by,verified_by=excluded.verified_by,verified_at=excluded.verified_at;
  else
    delete from public.question_explanation_translations where question_id=p_question_id and language='en';
  end if;
  if nullif(p_payload->>'explanationHi','') is not null then
    insert into public.question_explanation_translations(
      question_id,language,script_variant,origin,explanation_overview,explanation_richtext,review_status,updated_by,verified_by,verified_at
    ) values (
      p_question_id,'hi','native',v_explanation_origin,p_payload->>'explanationHi',
      jsonb_build_array(jsonb_build_object('type','paragraph','text',p_payload->>'explanationHi')),
      case when p_status='published' then 'verified' else 'draft' end,p_actor,
      case when p_status='published' then p_actor else null end,
      case when p_status='published' then now() else null end
    ) on conflict(question_id,language,script_variant) do update set
      explanation_overview=excluded.explanation_overview,explanation_richtext=excluded.explanation_richtext,
      review_status=excluded.review_status,updated_by=excluded.updated_by,verified_by=excluded.verified_by,verified_at=excluded.verified_at;
  else
    delete from public.question_explanation_translations where question_id=p_question_id and language='hi';
  end if;

  insert into public.question_explanation_drafts(question_id,explanation_overview,explanation_richtext,option_explanations,references_data,updated_by)
    values(p_question_id,v_explanation_en,jsonb_build_array(jsonb_build_object('type','paragraph','text',v_explanation_en)),
      coalesce(p_payload->'optionExplanations','{}'::jsonb),coalesce(p_payload->'references','[]'::jsonb),p_actor)
    on conflict(question_id) do update set explanation_overview=excluded.explanation_overview,
      explanation_richtext=excluded.explanation_richtext,option_explanations=excluded.option_explanations,
      references_data=excluded.references_data,updated_by=excluded.updated_by,updated_at=now();

  insert into public.verified_answers(question_id,correct_option_keys,answer_status,grading_rule,explanation_overview,explanation_richtext,option_explanations,references_data,verified_by,verified_at,version)
    values(p_question_id,coalesce(v_answer_keys,'{}'::text[]),v_answer_status,
      case when v_answer_status='dropped' then 'dropped_credit' else 'normal' end,
      nullif(v_explanation_en,''),jsonb_build_array(jsonb_build_object('type','paragraph','text',v_explanation_en)),
      coalesce(p_payload->'optionExplanations','{}'::jsonb),coalesce(p_payload->'references','[]'::jsonb),p_actor,now(),1)
    on conflict(question_id) do update set correct_option_keys=excluded.correct_option_keys,
      answer_status=excluded.answer_status,grading_rule=excluded.grading_rule,
      explanation_overview=excluded.explanation_overview,explanation_richtext=excluded.explanation_richtext,
      option_explanations=excluded.option_explanations,references_data=excluded.references_data,
      verified_by=excluded.verified_by,verified_at=excluded.verified_at,version=public.verified_answers.version+1;

  -- Preserve prior evidence; add one accepted record for this published answer revision.
  insert into public.answer_evidence(question_id,claimed_option_keys,explanation_richtext,provenance_note,verification_status,reviewed_by,reviewed_at)
    values(p_question_id,coalesce(v_answer_keys,'{}'::text[]),
      jsonb_build_array(jsonb_build_object('type','paragraph','text',v_explanation_en)),
      coalesce(v_source_note,'Trusted pre-checked workbook or authorised Admin edit.'),
      'accepted',p_actor,now());

  delete from public.question_classifications where question_id=p_question_id;
  insert into public.question_classifications(question_id,syllabus_node_id,is_primary,assigned_by)
    values(p_question_id,v_unit,false,p_actor),(p_question_id,v_section,false,p_actor),
          (p_question_id,v_topic,true,p_actor);
  if v_subtopic is not null then
    insert into public.question_classifications(question_id,syllabus_node_id,is_primary,assigned_by)
      values(p_question_id,v_subtopic,false,p_actor);
  end if;

  delete from public.question_keywords where question_id=p_question_id;
  for v_keyword in select distinct trim(keyword_item.value) from jsonb_array_elements_text(coalesce(p_payload->'keywords','[]'::jsonb)) as keyword_item(value) where trim(keyword_item.value)<>'' loop
    insert into public.question_keywords(question_id,keyword,normalized_keyword)
      values(p_question_id,left(v_keyword,80),lower(left(v_keyword,80))) on conflict(question_id,normalized_keyword) do nothing;
  end loop;

  -- Keep the original exam appearance editable without changing the permanent platform ID.
  v_exam_paper_id := nullif(v_appearance->>'examPaperId','')::uuid;
  v_original_number := nullif(v_appearance->>'originalQuestionNumber','');
  v_paper_order := nullif(v_appearance->>'paperOrder','')::integer;
  if v_exam_paper_id is not null and v_original_number is not null then
    update public.question_appearances set original_question_number=v_original_number,
      paper_order=coalesce(v_paper_order,paper_order),
      appearance_notes=coalesce(v_appearance->>'notes',appearance_notes),
      source_metadata=case
        when v_source_metadata='{}'::jsonb then source_metadata
        when v_source_metadata ? 'questionRow' then v_source_metadata
        else jsonb_set(coalesce(source_metadata,'{}'::jsonb), '{questionRow}', v_source_metadata, true)
      end
      where question_id=p_question_id and exam_paper_id=v_exam_paper_id;
  end if;

  delete from public.question_assets where question_id=p_question_id;
  for v_asset in select asset_item.value from jsonb_array_elements(coalesce(p_payload->'assets','[]'::jsonb)) as asset_item(value) loop
    v_asset_index := v_asset_index + 1;
    if nullif(v_asset->>'storage_path','') is not null then
      insert into public.question_assets(question_id,asset_type,storage_path,placement,alt_text,caption,sort_order)
      values(p_question_id,
        case when v_asset->>'asset_type' in ('image','map','diagram','table_image','page_crop','other') then v_asset->>'asset_type' else 'image' end,
        v_asset->>'storage_path',case when v_asset->>'placement'='explanation' then 'explanation' else 'question' end,
        nullif(v_asset->>'alt_text',''),nullif(v_asset->>'caption',''),v_asset_index);
    end if;
  end loop;

  insert into public.question_revisions(question_id,revision_number,snapshot,changed_by,change_summary)
    values(p_question_id,p_revision_number,p_payload,p_actor,p_revision_summary);
  if p_status='published' then
    insert into public.question_approvals(question_id,approved_by,decision,notes)
      values(p_question_id,p_actor,'published','Published from trusted CrackJRF workbook/editor. The workbook is treated as pre-checked source content.');
  end if;
end;
$$;
revoke all on function public.apply_question_editor_payload(uuid,uuid,jsonb,uuid,text,integer,text) from public, authenticated;

-- The Admin editor's Save Draft action stores a working copy without disturbing a live published question.
-- Publish applies the submitted working copy in one database transaction.
create or replace function public.save_question_editor(
  p_question_code text,
  p_payload jsonb,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_question public.questions%rowtype;
  v_subject_id uuid;
  v_revision integer;
  v_base_revision integer;
  v_status text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_role(array['super_admin','content_editor','reviewer']) then raise exception 'Admin access required'; end if;
  if p_action not in ('draft','publish') then raise exception 'Action must be draft or publish'; end if;
  if p_action='publish' and not public.has_admin_role(array['super_admin']) then raise exception 'Only the Super Admin can publish questions'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Question payload is invalid'; end if;
  select * into v_question from public.questions where question_code=p_question_code for update;
  if not found then raise exception 'Question not found'; end if;
  if p_action='draft' then
    v_base_revision := coalesce(nullif(p_payload->>'baseRevision','')::integer,v_question.current_revision);
    insert into public.question_editor_drafts(question_id,draft_payload,base_revision,updated_by,updated_at)
      values(v_question.id,p_payload,v_base_revision,v_user,now())
      on conflict(question_id) do update set draft_payload=excluded.draft_payload,
        base_revision=excluded.base_revision,updated_by=excluded.updated_by,updated_at=now();
    return jsonb_build_object('questionCode',p_question_code,'status','draft_saved','publishedStatus',v_question.status);
  end if;
  if nullif(p_payload->>'baseRevision','') is not null
     and (p_payload->>'baseRevision')::integer <> v_question.current_revision then
    raise exception 'This question was updated by another Admin after you opened it. Reload the question before publishing to avoid overwriting newer changes.';
  end if;
  select id into v_subject_id from public.subjects where code=p_payload->>'subjectCode' and active=true;
  if v_subject_id is null then raise exception 'Selected subject is not configured'; end if;
  v_revision := v_question.current_revision + 1;
  perform public.apply_question_editor_payload(v_question.id,v_subject_id,p_payload,v_user,'published',v_revision,'Published from compact bilingual editor');
  delete from public.question_editor_drafts where question_id=v_question.id;
  insert into public.audit_logs(actor_id,entity_type,entity_id,action,before_data,after_data)
    values(v_user,'question',v_question.id::text,'question_published_from_editor',jsonb_build_object('status',v_question.status,'revision',v_question.current_revision),jsonb_build_object('status','published','revision',v_revision));
  return jsonb_build_object('questionCode',p_question_code,'status','published','revision',v_revision);
end;
$$;
revoke all on function public.save_question_editor(text,jsonb,text) from public;
grant execute on function public.save_question_editor(text,jsonb,text) to authenticated;

-- Publish every row in one transaction after validating the trusted workbook batch.
create or replace function public.publish_excel_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_batch public.excel_import_batches%rowtype;
  v_meta jsonb;
  v_row record;
  v_data jsonb;
  v_subject_id uuid;
  v_event_id uuid;
  v_paper_id uuid;
  v_question_id uuid;
  v_code text;
  v_keys text[];
  v_answer_status text;
  v_options jsonb;
  v_payload jsonb;
  v_shift text;
  v_year integer;
  v_session text;
  v_event_type text;
  v_label text;
  v_count integer := 0;
  v_codes jsonb := '[]'::jsonb;
  v_original text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.has_admin_role(array['super_admin']) then raise exception 'Only the Super Admin can publish a trusted Excel batch'; end if;
  select * into v_batch from public.excel_import_batches where id=p_batch_id for update;
  if not found then raise exception 'Excel import batch not found'; end if;
  if v_batch.status='completed' then
    return jsonb_build_object('batchCode',v_batch.batch_code,'publishedCount',v_batch.rows_promoted,'alreadyPublished',true);
  end if;
  v_meta := v_batch.exam_metadata;
  v_year := nullif(v_meta->>'exam_year','')::integer;
  v_session := coalesce(nullif(v_meta->>'exam_session',''),'Other');
  v_event_type := coalesce(nullif(v_meta->>'event_type',''),'regular');
  v_label := coalesce(v_meta->>'event_label','');
  v_shift := coalesce(nullif(v_meta->>'shift',''),'Unknown');
  if v_year is null or v_year < 2000 or v_year > 2100 then raise exception 'Exam year is invalid'; end if;
  if v_session not in ('June','December','Other') then raise exception 'Exam session must be June, December or Other'; end if;
  if v_event_type not in ('regular','re_exam','special','unknown') then raise exception 'Exam event type is invalid'; end if;

  if not exists(select 1 from public.excel_import_rows where batch_id=p_batch_id) then raise exception 'The workbook contains no question rows'; end if;
  if exists(select 1 from public.excel_import_rows where batch_id=p_batch_id and jsonb_array_length(validation_errors)>0) then
    raise exception 'One or more workbook rows have structural errors. Correct the Excel file and import again.';
  end if;

  insert into public.exam_events(year,session,event_type,label)
    values(v_year,v_session,v_event_type,v_label)
    on conflict(year,session,event_type,label) do update set label=excluded.label
    returning id into v_event_id;

  for v_row in
    select * from public.excel_import_rows where batch_id=p_batch_id order by paper_number,paper_order for update
  loop
    v_data := v_row.row_data;
    v_original := coalesce(v_row.original_question_number,'');
    if v_row.paper_number not in (1,2) or v_row.subject_code is null then raise exception 'Paper or subject code is missing for original question %',v_original; end if;
    select id into v_subject_id from public.subjects where code=v_row.subject_code and active=true;
    if v_subject_id is null then raise exception 'Subject code % is not configured',v_row.subject_code; end if;
    if nullif(v_data->>'question_english','') is null then raise exception 'English question text is missing for question %',v_original; end if;
    if nullif(v_data->>'option_a_english','') is null or nullif(v_data->>'option_b_english','') is null or nullif(v_data->>'option_c_english','') is null or nullif(v_data->>'option_d_english','') is null then
      raise exception 'All four English options are required for question %',v_original;
    end if;
    select array_agg(x order by x) into v_keys
      from (select distinct upper(trim(token)) as x
        from regexp_split_to_table(coalesce(v_data->>'correct_option',''),'[,;|]') as split_token(token)
        where trim(token) <> '') answer_tokens;
    if coalesce(array_length(v_keys,1),0)=0 then raise exception 'Correct option is missing for question %',v_original; end if;
    if exists(select 1 from unnest(v_keys) k where k not in ('A','B','C','D')) then raise exception 'Invalid correct option for question %',v_original; end if;
    if array_length(v_keys,1)>1 then v_answer_status:='multiple_correct'; else v_answer_status:='single_correct'; end if;
    if nullif(v_data->>'question_hindi_official','') is not null and (
      nullif(v_data->>'option_a_hindi_official','') is null or nullif(v_data->>'option_b_hindi_official','') is null or
      nullif(v_data->>'option_c_hindi_official','') is null or nullif(v_data->>'option_d_hindi_official','') is null
    ) then raise exception 'Hindi stem is present but one or more Hindi options are missing for question %',v_original; end if;

    insert into public.exam_papers(exam_event_id,subject_id,paper_number,shift,exam_date,original_question_count,source_status,historical_pattern_notes)
      values(v_event_id,v_subject_id,v_row.paper_number,v_shift,nullif(v_meta->>'exam_date','')::date,
        (select count(*) from public.excel_import_rows x where x.batch_id=p_batch_id and x.paper_number=v_row.paper_number and x.subject_code=v_row.subject_code),
        'verified','Imported from a trusted, pre-checked CrackJRF Excel workbook.')
      on conflict(exam_event_id,subject_id,paper_number,shift) do update set
        original_question_count=excluded.original_question_count,source_status='verified',historical_pattern_notes=excluded.historical_pattern_notes
      returning id into v_paper_id;

    if exists(select 1 from public.question_appearances where exam_paper_id=v_paper_id and original_question_number=v_original) then
      raise exception 'Question number % already exists for this exam event/paper/shift',v_original;
    end if;

    v_code := public.next_question_code(v_row.subject_code);
    insert into public.questions(question_code,subject_id,question_type,status,answer_status,primary_language,created_by,updated_by,published_at)
      values(v_code,v_subject_id,v_row.question_type,'published',v_answer_status,'en',v_user,v_user,now())
      returning id into v_question_id;

    v_options := jsonb_build_array(
      jsonb_build_object('key','A','en',v_data->>'option_a_english','hi',coalesce(v_data->>'option_a_hindi_official','')),
      jsonb_build_object('key','B','en',v_data->>'option_b_english','hi',coalesce(v_data->>'option_b_hindi_official','')),
      jsonb_build_object('key','C','en',v_data->>'option_c_english','hi',coalesce(v_data->>'option_c_hindi_official','')),
      jsonb_build_object('key','D','en',v_data->>'option_d_english','hi',coalesce(v_data->>'option_d_hindi_official',''))
    );
    v_payload := jsonb_build_object(
      'subjectCode',v_row.subject_code,
      'questionType',v_row.question_type,
      'contentOrigin','official_source',
      'explanationOrigin','institution_solution',
      'sourceNote',concat('Trusted Excel workbook: ',coalesce(v_batch.file_name,'(unknown workbook)'),'; official PDF: ',coalesce(v_meta->>'official_source_filename','not specified'),'; institution solved PDF: ',coalesce(v_meta->>'institution_solved_filename','not specified'),'; answer source: ',coalesce(v_data->>'answer_source_type','not specified'),'; answer source title/page: ',coalesce(v_data->>'answer_source_title','not specified'),' / ',coalesce(v_data->>'answer_source_page','not specified'),'; official key status: ',coalesce(v_data->>'official_key_status','not specified'),'; question match: ',coalesce(v_data->>'question_match_status','not specified'),' (',coalesce(v_data->>'match_confidence','not specified'),'); official/institution source pages: ',coalesce(v_data->>'official_paper_page','not specified'),' / ',coalesce(v_data->>'institution_paper_page','not specified'),'; option style: ',coalesce(v_data->>'option_style_preference','not specified'),'; media requirement: ',coalesce(v_data->>'media_required','no'),' — ',coalesce(v_data->>'media_description',''),' ; source alignment notes: ',coalesce(v_data->>'source_alignment_note',''),'; row notes: ',coalesce(v_data->>'row_notes','')),
      'stemEn',v_data->>'question_english',
      'stemHi',coalesce(v_data->>'question_hindi_official',''),
      'options',v_options,
      'answerStatus',v_answer_status,
      'correctOptionKeys',to_jsonb(v_keys),
      'explanationEn',coalesce(v_data->>'provider_explanation_english',''),
      'explanationHi',coalesce(v_data->>'provider_explanation_hindi',''),
      'optionExplanations','{}'::jsonb,
      'references','[]'::jsonb,
      'classification',jsonb_build_object('unitId',v_data->>'unit_id','sectionId',v_data->>'section_id','topicId',v_data->>'topic_id','subtopicId',v_data->>'subtopic_id'),
      'keywords',to_jsonb(regexp_split_to_array(coalesce(v_data->>'keywords',''), '[,;]')),
      'appearance',jsonb_build_object('examPaperId',v_paper_id,'originalQuestionNumber',v_original,'paperOrder',v_row.paper_order,
        'notes',concat('Source: ',coalesce(v_meta->>'official_source_filename','not specified'),'; official page ',coalesce(v_data->>'official_paper_page','not specified'),'; institution page ',coalesce(v_data->>'institution_paper_page','not specified'),'; answer source ',coalesce(v_data->>'answer_source_type','not specified'),'.')),
      'assets','[]'::jsonb,
      'sourceMetadata',jsonb_build_object('examMetadata',v_meta,'questionRow',v_data)
    );
    perform public.apply_question_editor_payload(v_question_id,v_subject_id,v_payload,v_user,'published',1,'Published from trusted Excel workbook import');
    insert into public.question_appearances(question_id,exam_paper_id,original_question_number,paper_order,appearance_notes,source_metadata)
      values(v_question_id,v_paper_id,v_original,v_row.paper_order,concat('Trusted Excel import · ',coalesce(v_data->>'answer_source_type','answer source not specified')),jsonb_build_object('examMetadata',v_meta,'questionRow',v_data));
    update public.excel_import_rows set canonical_question_id=v_question_id,review_status='promoted',promoted_at=now(),promoted_by=v_user,
      row_data=row_data || jsonb_build_object('canonical_question_code',v_code)
      where id=v_row.id;
    v_count := v_count+1;
    v_codes := v_codes || jsonb_build_array(jsonb_build_object('questionCode',v_code,'paperNumber',v_row.paper_number,'originalQuestionNumber',v_original));
  end loop;

  update public.excel_import_batches set status='completed',rows_promoted=v_count,valid_rows=v_count,rows_with_errors=0 where id=p_batch_id;
  insert into public.audit_logs(actor_id,entity_type,entity_id,action,after_data)
    values(v_user,'excel_import_batch',p_batch_id::text,'trusted_excel_batch_published',jsonb_build_object('batch_code',v_batch.batch_code,'published_count',v_count,'question_codes',v_codes));
  return jsonb_build_object('batchCode',v_batch.batch_code,'publishedCount',v_count,'questionCodes',v_codes,'status','completed');
end;
$$;
revoke all on function public.publish_excel_import_batch(uuid) from public;
grant execute on function public.publish_excel_import_batch(uuid) to authenticated;
