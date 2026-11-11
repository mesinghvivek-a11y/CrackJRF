-- CrackJRF Admin workspace: dashboard support, settings and transactional bulk tools.

-- Preserve the distinction between the examination session and the actual exam date.
-- January is accepted because a December-cycle examination can be held in January.
alter table public.exam_events drop constraint if exists exam_events_session_check;
alter table public.exam_events
  add constraint exam_events_session_check
  check (session in ('June','December','January','Other'));

create table if not exists public.platform_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
drop policy if exists "admin read platform settings" on public.platform_settings;
create policy "admin read platform settings" on public.platform_settings
  for select to authenticated using (public.is_admin());
drop policy if exists "super admin manage platform settings" on public.platform_settings;
create policy "super admin manage platform settings" on public.platform_settings
  for all to authenticated
  using (public.has_admin_role(array['super_admin']))
  with check (public.has_admin_role(array['super_admin']));

create or replace function public.admin_bulk_delete_questions(p_question_ids uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  if not public.has_admin_role(array['super_admin']) then
    raise exception 'Only the Super Admin can bulk delete questions';
  end if;
  if p_question_ids is null or cardinality(p_question_ids) = 0 then
    raise exception 'Select at least one question';
  end if;
  delete from public.questions where id = any(p_question_ids);
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.admin_bulk_delete_questions(uuid[]) from public;
grant execute on function public.admin_bulk_delete_questions(uuid[]) to authenticated;

create or replace function public.admin_bulk_reclassify_questions(p_question_ids uuid[], p_syllabus_node_ids text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare affected integer; requested integer; valid_nodes integer; target_versions integer; target_version uuid; target_subject uuid;
begin
  if not public.has_admin_role(array['super_admin','content_editor']) then
    raise exception 'Content Editor or Super Admin access is required to reclassify questions';
  end if;
  if p_question_ids is null or cardinality(p_question_ids) = 0 then
    raise exception 'Select at least one question';
  end if;
  if p_syllabus_node_ids is null or cardinality(p_syllabus_node_ids) = 0 then
    raise exception 'Select at least one syllabus node';
  end if;
  select count(distinct node_id) into requested
  from unnest(p_syllabus_node_ids) as ids(node_id);
  select count(distinct n.id) into valid_nodes
  from public.syllabus_nodes n
  where n.id = any(p_syllabus_node_ids) and n.is_active = true;
  if requested <> valid_nodes then
    raise exception 'One or more selected syllabus nodes are missing or inactive';
  end if;
  select count(distinct syllabus_version_id)
    into target_versions
    from public.syllabus_nodes where id = any(p_syllabus_node_ids) and is_active = true;
  select syllabus_version_id into target_version
    from public.syllabus_nodes where id = any(p_syllabus_node_ids) and is_active = true limit 1;
  if target_versions <> 1 then
    raise exception 'Bulk reclassification must use nodes from one subject syllabus version';
  end if;
  select subject_id into target_subject from public.syllabus_versions where id = target_version;
  if exists(select 1 from public.questions where id = any(p_question_ids) and subject_id <> target_subject) then
    raise exception 'Selected questions and syllabus nodes must belong to the same subject. Change subject separately after checking its exam-paper mapping.';
  end if;
  delete from public.question_classifications where question_id = any(p_question_ids);
  insert into public.question_classifications(question_id, syllabus_node_id, is_primary, assigned_by)
  select q.id, nodes.node_id, nodes.ordinality = 1, auth.uid()
  from public.questions q
  cross join (
    select distinct node_id, min(ordinality) as ordinality
    from unnest(p_syllabus_node_ids) with ordinality as requested_nodes(node_id, ordinality)
    group by node_id
  ) as nodes
  where q.id = any(p_question_ids);
  get diagnostics affected = row_count;
  return (select count(distinct id)::integer from public.questions where id = any(p_question_ids));
end;
$$;
revoke all on function public.admin_bulk_reclassify_questions(uuid[],text[]) from public;
grant execute on function public.admin_bulk_reclassify_questions(uuid[],text[]) to authenticated;


-- Return exact per-node classification counts without PostgREST row caps.
create or replace function public.admin_syllabus_question_counts()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  select coalesce(jsonb_object_agg(counts.syllabus_node_id, counts.question_count), '{}'::jsonb)
    into result
  from (
    select syllabus_node_id, count(distinct question_id)::integer as question_count
    from public.question_classifications
    group by syllabus_node_id
  ) as counts;
  return result;
end;
$$;
revoke all on function public.admin_syllabus_question_counts() from public;
grant execute on function public.admin_syllabus_question_counts() to authenticated;


-- Align trusted batch publication with optional Hindi fields and January event sessions.
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
  if v_session not in ('June','December','January','Other') then raise exception 'Exam session must be June, December, January or Other'; end if;
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
    -- Hindi fields are independently optional; absent or partial Hindi never blocks English publication.

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
