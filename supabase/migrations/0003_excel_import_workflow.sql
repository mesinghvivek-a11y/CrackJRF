-- CrackJRF Excel-first import workflow and Devanagari/Roman Hindi support.
-- Apply after 0002_json_import_packages.sql. Existing JSON tables remain intact during migration.

create table if not exists public.excel_import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  file_name text not null,
  storage_path text not null,
  file_sha256 text not null,
  exam_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'staged' check (status in ('staged','in_review','completed','rejected')),
  total_rows integer not null default 0 check (total_rows >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  rows_with_errors integer not null default 0 check (rows_with_errors >= 0),
  rows_promoted integer not null default 0 check (rows_promoted >= 0),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists excel_import_batches_created_idx
  on public.excel_import_batches(created_at desc);
drop index if exists public.excel_import_batches_sha_idx;
create unique index if not exists excel_import_batches_sha_uidx
  on public.excel_import_batches(file_sha256);
drop trigger if exists excel_import_batches_updated_at on public.excel_import_batches;
create trigger excel_import_batches_updated_at
  before update on public.excel_import_batches
  for each row execute function public.set_updated_at();

create table if not exists public.excel_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.excel_import_batches(id) on delete cascade,
  vendor_row_id text,
  paper_number smallint check (paper_number in (1,2)),
  subject_code text,
  subject_name text,
  original_question_number text,
  paper_order integer check (paper_order > 0),
  question_type text not null default 'mcq',
  row_data jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  validation_warnings jsonb not null default '[]'::jsonb,
  review_status text not null default 'needs_review' check (review_status in ('needs_review','in_review','reviewed','promoted','rejected')),
  canonical_question_id uuid references public.questions(id) on delete set null,
  promoted_at timestamptz,
  promoted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists excel_import_rows_batch_idx
  on public.excel_import_rows(batch_id, paper_number, paper_order);
create index if not exists excel_import_rows_status_idx
  on public.excel_import_rows(batch_id, review_status);
drop trigger if exists excel_import_rows_updated_at on public.excel_import_rows;
create trigger excel_import_rows_updated_at
  before update on public.excel_import_rows
  for each row execute function public.set_updated_at();

alter table public.excel_import_batches enable row level security;
alter table public.excel_import_rows enable row level security;
drop policy if exists "admin can read excel import batches" on public.excel_import_batches;
create policy "admin can read excel import batches" on public.excel_import_batches
  for select to authenticated
  using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
drop policy if exists "importers create excel import batches" on public.excel_import_batches;
create policy "importers create excel import batches" on public.excel_import_batches
  for insert to authenticated
  with check (public.has_admin_role(array['super_admin','importer']));
drop policy if exists "admin can update excel import batches" on public.excel_import_batches;
create policy "admin can update excel import batches" on public.excel_import_batches
  for update to authenticated
  using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
drop policy if exists "importers can delete excel import batches" on public.excel_import_batches;
create policy "importers can delete excel import batches" on public.excel_import_batches
  for delete to authenticated
  using (public.has_admin_role(array['super_admin','importer']));
drop policy if exists "admin can read excel import rows" on public.excel_import_rows;
create policy "admin can read excel import rows" on public.excel_import_rows
  for select to authenticated
  using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
drop policy if exists "importers create excel import rows" on public.excel_import_rows;
create policy "importers create excel import rows" on public.excel_import_rows
  for insert to authenticated
  with check (public.has_admin_role(array['super_admin','importer']));
drop policy if exists "content team update excel import rows" on public.excel_import_rows;
create policy "content team update excel import rows" on public.excel_import_rows
  for update to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "importers delete excel import rows" on public.excel_import_rows;
create policy "importers delete excel import rows" on public.excel_import_rows
  for delete to authenticated
  using (public.has_admin_role(array['super_admin','importer']));

-- Extend the existing editorial policies so Reviewers can perform the work assigned to them.
-- Super Admin remains the only role allowed to publish through the approval API.
drop policy if exists "exam events admin write" on public.exam_events;
create policy "exam events admin write" on public.exam_events for all to authenticated
  using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
drop policy if exists "exam papers admin write" on public.exam_papers;
create policy "exam papers admin write" on public.exam_papers for all to authenticated
  using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
drop policy if exists "admin question code counters" on public.question_code_counters;
create policy "admin question code counters" on public.question_code_counters for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin question write" on public.questions;
create policy "admin question write" on public.questions for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin translations write" on public.question_translations;
create policy "admin translations write" on public.question_translations for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin options write" on public.question_options;
create policy "admin options write" on public.question_options for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin option translations write" on public.question_option_translations;
create policy "admin option translations write" on public.question_option_translations for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin groups write" on public.question_groups;
create policy "admin groups write" on public.question_groups for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin group translations write" on public.question_group_translations;
create policy "admin group translations write" on public.question_group_translations for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin group members write" on public.question_group_members;
create policy "admin group members write" on public.question_group_members for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin classifications write" on public.question_classifications;
create policy "admin classifications write" on public.question_classifications for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin appearances write" on public.question_appearances;
create policy "admin appearances write" on public.question_appearances for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','importer','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','importer','reviewer']));
drop policy if exists "admin assets write" on public.question_assets;
create policy "admin assets write" on public.question_assets for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "admin revisions" on public.question_revisions;
create policy "admin revisions" on public.question_revisions for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));

-- Hindi in Devanagari and Hinglish in Roman script are separate editable variants.
-- English remains one native variant. Existing rows are preserved as native.
alter table public.question_translations
  add column if not exists script_variant text not null default 'native',
  add column if not exists origin text not null default 'manual';
alter table public.question_translations drop constraint if exists question_translations_origin_check;
alter table public.question_translations
  add constraint question_translations_origin_check
  check (origin in ('official_source','institution_solution','ai_draft','manual'));
alter table public.question_translations
  drop constraint if exists question_translations_question_id_language_key;
alter table public.question_translations drop constraint if exists question_translations_script_variant_check;
alter table public.question_translations
  add constraint question_translations_script_variant_check
  check ((language = 'en' and script_variant = 'native') or (language = 'hi' and script_variant in ('native','roman')));
create unique index if not exists question_translations_language_script_uidx
  on public.question_translations(question_id, language, script_variant);

alter table public.question_option_translations
  add column if not exists script_variant text not null default 'native',
  add column if not exists origin text not null default 'manual';
alter table public.question_option_translations drop constraint if exists question_option_translations_origin_check;
alter table public.question_option_translations
  add constraint question_option_translations_origin_check
  check (origin in ('official_source','institution_solution','ai_draft','manual'));
alter table public.question_option_translations
  drop constraint if exists question_option_translations_option_id_language_key;
alter table public.question_option_translations drop constraint if exists question_option_translations_script_variant_check;
alter table public.question_option_translations
  add constraint question_option_translations_script_variant_check
  check ((language = 'en' and script_variant = 'native') or (language = 'hi' and script_variant in ('native','roman')));
create unique index if not exists question_option_translations_language_script_uidx
  on public.question_option_translations(option_id, language, script_variant);

-- A language variant is not student-visible until its editorial review flag is true.
alter table public.question_option_translations
  add column if not exists reviewed boolean not null default false;
-- Preserve already-published legacy content during the changeover.
update public.question_translations t set reviewed = true
from public.questions q where q.id = t.question_id and q.status = 'published';
update public.question_option_translations ot set reviewed = true
from public.question_options o join public.questions q on q.id = o.question_id
where o.id = ot.option_id and q.status = 'published';

alter table public.question_explanation_translations
  add column if not exists script_variant text not null default 'native',
  add column if not exists origin text not null default 'manual';
alter table public.question_explanation_translations drop constraint if exists question_explanation_translations_origin_check;
alter table public.question_explanation_translations
  add constraint question_explanation_translations_origin_check
  check (origin in ('official_source','institution_solution','ai_draft','manual'));
alter table public.question_explanation_translations
  drop constraint if exists question_explanation_translations_question_id_language_key;
alter table public.question_explanation_translations drop constraint if exists question_explanation_translations_script_variant_check;
alter table public.question_explanation_translations
  add constraint question_explanation_translations_script_variant_check
  check ((language = 'en' and script_variant = 'native') or (language = 'hi' and script_variant in ('native','roman')));
create unique index if not exists question_explanation_translations_language_script_uidx
  on public.question_explanation_translations(question_id, language, script_variant);

-- Permit a single .xlsx handoff in the existing private source document bucket.
update storage.buckets
set file_size_limit = 104857600,
    allowed_mime_types = array[
      'application/pdf',
      'application/zip',
      'application/x-zip-compressed',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ]
where id = 'source-pdfs';


-- The PYQ answer RPC returns language-specific explanations only after they are verified.
create or replace function public.get_practice_answer(p_question_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare answer_json jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists (
    select 1 from public.test_attempts a
    join public.test_attempt_questions tq on tq.attempt_id = a.id
    where a.user_id = auth.uid() and a.status = 'in_progress' and tq.question_id = p_question_id
  ) then raise exception 'Answer is unavailable during an active test'; end if;
  select jsonb_build_object(
    'correct_option_keys', va.correct_option_keys,
    'answer_status', va.answer_status,
    'grading_rule', va.grading_rule,
    'explanation_overview', va.explanation_overview,
    'explanation_richtext', va.explanation_richtext,
    'option_explanations', va.option_explanations,
    'references_data', va.references_data,
    'explanation_translations', coalesce((select jsonb_agg(jsonb_build_object('language', et.language, 'script_variant', et.script_variant, 'overview', et.explanation_overview, 'richtext', et.explanation_richtext) order by et.language, et.script_variant) from public.question_explanation_translations et where et.question_id = va.question_id and et.review_status = 'verified'), '[]'::jsonb)
  ) into answer_json
  from public.verified_answers va
  join public.questions q on q.id = va.question_id
  where va.question_id = p_question_id and q.status = 'published';
  if answer_json is null then raise exception 'Verified answer not available'; end if;
  return answer_json;
end; $$;
revoke all on function public.get_practice_answer(uuid) from public;
grant execute on function public.get_practice_answer(uuid) to authenticated;




-- Searchable editorial keywords are separate from syllabus classification.
create table if not exists public.question_keywords (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  keyword text not null check (length(trim(keyword)) between 1 and 80),
  normalized_keyword text not null,
  created_at timestamptz not null default now(),
  unique(question_id, normalized_keyword)
);
create index if not exists question_keywords_search_idx on public.question_keywords(normalized_keyword);
alter table public.question_keywords enable row level security;
drop policy if exists "published question keywords read" on public.question_keywords;
create policy "published question keywords read" on public.question_keywords for select using (exists(select 1 from public.questions q where q.id = question_id and q.status = 'published') or public.is_admin());
drop policy if exists "content team manages question keywords" on public.question_keywords;
create policy "content team manages question keywords" on public.question_keywords for all to authenticated using (public.has_admin_role(array['super_admin','content_editor','reviewer'])) with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));

-- Reviewers need to attach/correct media while editing; students may read media only after publication.
drop policy if exists "content team manages question assets" on storage.objects;
create policy "content team manages question assets" on storage.objects for all to authenticated using (bucket_id = 'question-assets' and public.has_admin_role(array['super_admin','content_editor','reviewer'])) with check (bucket_id = 'question-assets' and public.has_admin_role(array['super_admin','content_editor','reviewer']));
drop policy if exists "students read published question asset objects" on storage.objects;
create policy "students read published question asset objects" on storage.objects for select to authenticated
using (bucket_id = 'question-assets' and exists (
  select 1 from public.question_assets qa
  join public.questions q on q.id = qa.question_id
  where qa.storage_path = storage.objects.name and q.status = 'published'
));

-- Placement tells Student Portal whether an image belongs beside the question or explanation.
alter table public.question_assets add column if not exists placement text not null default 'question';
alter table public.question_assets drop constraint if exists question_assets_placement_check;
alter table public.question_assets add constraint question_assets_placement_check check (placement in ('question','explanation'));

-- Test snapshots include native Hindi and Roman-script Hinglish variants plus published assets.
create or replace function public.start_test_attempt(
  p_blueprint_code text,
  p_question_ids uuid[],
  p_paper_numbers smallint[],
  p_duration_minutes integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_blueprint public.test_blueprints%rowtype;
  v_attempt uuid;
  v_count integer;
  v_distinct integer;
  v_duration integer;
  i integer;
  v_question public.questions%rowtype;
  v_attempt_question uuid;
  v_snapshot jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if coalesce(array_length(p_question_ids,1),0)=0 then raise exception 'Select at least one question'; end if;
  if array_length(p_question_ids,1) <> array_length(p_paper_numbers,1) then raise exception 'Question and paper arrays must have the same length'; end if;
  if cardinality(p_question_ids) > 150 then raise exception 'A test cannot contain more than 150 questions'; end if;
  select * into v_blueprint from public.test_blueprints where code=p_blueprint_code and active=true;
  if not found then raise exception 'Active test blueprint not found'; end if;
  v_duration := coalesce(p_duration_minutes,v_blueprint.duration_minutes);
  if v_duration < 1 or v_duration > 600 then raise exception 'Test duration must be between 1 and 600 minutes'; end if;
  select count(*),count(distinct x) into v_count,v_distinct from unnest(p_question_ids) as x;
  if v_count <> v_distinct then raise exception 'Duplicate questions are not allowed in a test'; end if;
  if exists(select 1 from unnest(p_paper_numbers) p where p not in (1,2)) then raise exception 'Paper number must be 1 or 2'; end if;
  if v_blueprint.mode='full_ugc_net' and ((select count(*) from unnest(p_paper_numbers) p where p=1) <> v_blueprint.paper_i_question_count or (select count(*) from unnest(p_paper_numbers) p where p=2) <> v_blueprint.paper_ii_question_count) then raise exception 'Complete UGC NET mock must match the Paper I and Paper II blueprint counts'; end if;
  if v_blueprint.mode='geography_only' and (select count(*) from unnest(p_paper_numbers) p where p=2) <> v_blueprint.paper_ii_question_count then raise exception 'Geography practice test must match its configured Paper II question count'; end if;
  if exists(
    select 1 from unnest(p_question_ids) qid
    left join public.questions q on q.id=qid
    left join public.verified_answers va on va.question_id=q.id
    where q.id is null or q.status <> 'published' or (va.question_id is null and q.answer_status <> 'dropped')
  ) then raise exception 'Every selected question must be published and have a verified grading record'; end if;
  insert into public.test_attempts(user_id,blueprint_id,status,deadline_at,configuration_snapshot)
  values(v_user,v_blueprint.id,'in_progress',now()+make_interval(mins=>v_duration),
    jsonb_build_object('mode',v_blueprint.mode,'duration_minutes',v_duration,
      'marks_per_correct',v_blueprint.marks_per_correct,'marks_per_wrong',v_blueprint.marks_per_wrong,
      'marks_per_unattempted',v_blueprint.marks_per_unattempted,'total_questions',v_count))
  returning id into v_attempt;
  for i in 1..v_count loop
    select * into v_question from public.questions where id=p_question_ids[i];
    select jsonb_build_object(
      'question_code',v_question.question_code,
      'question_type',v_question.question_type,
      'translations',coalesce((select jsonb_agg(jsonb_build_object('language',t.language,'script_variant',t.script_variant,'stem_blocks',t.stem_blocks,'instruction_blocks',t.instruction_blocks) order by t.language) from public.question_translations t where t.question_id=v_question.id and t.reviewed=true),'[]'::jsonb),
      'options',coalesce((select jsonb_agg(jsonb_build_object('key',o.option_key,'translations',coalesce((select jsonb_agg(jsonb_build_object('language',ot.language,'script_variant',ot.script_variant,'content_blocks',ot.content_blocks) order by ot.language) from public.question_option_translations ot where ot.option_id=o.id and ot.reviewed=true),'[]'::jsonb)) order by o.sort_order) from public.question_options o where o.question_id=v_question.id),'[]'::jsonb),
      'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'asset_type',a.asset_type,'placement',a.placement,'alt_text',a.alt_text,'caption',a.caption,'sort_order',a.sort_order) order by a.sort_order) from public.question_assets a where a.question_id=v_question.id),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(jsonb_build_object('group_type',g.group_type,'translations',coalesce((select jsonb_agg(jsonb_build_object('language',gt.language,'stimulus_blocks',gt.stimulus_blocks)) from public.question_group_translations gt where gt.group_id=g.id),'[]'::jsonb))) from public.question_group_members gm join public.question_groups g on g.id=gm.group_id where gm.question_id=v_question.id),'[]'::jsonb)
    ) into v_snapshot;
    insert into public.test_attempt_questions(attempt_id,question_id,sequence_number,paper_number,question_snapshot)
      values(v_attempt,v_question.id,i,p_paper_numbers[i],v_snapshot) returning id into v_attempt_question;
    insert into public.test_attempt_answer_keys(attempt_question_id,correct_option_keys,answer_status,grading_rule,explanation_snapshot)
      select v_attempt_question,va.correct_option_keys,va.answer_status,va.grading_rule,
        jsonb_build_object('overview',va.explanation_overview,'richtext',va.explanation_richtext,'option_explanations',va.option_explanations,'references',va.references_data,'translations',coalesce((select jsonb_agg(jsonb_build_object('language',et.language,'script_variant',et.script_variant,'overview',et.explanation_overview,'richtext',et.explanation_richtext) order by et.language,et.script_variant) from public.question_explanation_translations et where et.question_id=va.question_id and et.review_status='verified'),'[]'::jsonb))
      from public.verified_answers va where va.question_id=v_question.id;
    if not found and v_question.answer_status='dropped' then
      insert into public.test_attempt_answer_keys(attempt_question_id,correct_option_keys,answer_status,grading_rule)
      values(v_attempt_question,'{}','dropped','dropped_credit');
    end if;
    insert into public.test_responses(attempt_id,question_id,response_state) values(v_attempt,v_question.id,'not_visited');
  end loop;
  return v_attempt;
end; $$;



-- Enforce translation review permissions at the database layer too, not only in the Admin UI/API.
create or replace function public.enforce_question_variant_review_role()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.reviewed = true and not public.has_admin_role(array['super_admin','reviewer']) then
    if tg_op = 'INSERT' then
      raise exception 'Only a Reviewer or Super Admin can mark a question translation as reviewed';
    end if;
    if old.reviewed = false
       or new.stem_blocks is distinct from old.stem_blocks
       or new.instruction_blocks is distinct from old.instruction_blocks then
      raise exception 'Only a Reviewer or Super Admin can verify changed question translation content';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists question_translations_review_role_guard on public.question_translations;
create trigger question_translations_review_role_guard
  before insert or update on public.question_translations
  for each row execute function public.enforce_question_variant_review_role();

create or replace function public.enforce_option_variant_review_role()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.reviewed = true and not public.has_admin_role(array['super_admin','reviewer']) then
    if tg_op = 'INSERT' then
      raise exception 'Only a Reviewer or Super Admin can mark an option translation as reviewed';
    end if;
    if old.reviewed = false or new.content_blocks is distinct from old.content_blocks then
      raise exception 'Only a Reviewer or Super Admin can verify changed option translation content';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists question_option_translations_review_role_guard on public.question_option_translations;
create trigger question_option_translations_review_role_guard
  before insert or update on public.question_option_translations
  for each row execute function public.enforce_option_variant_review_role();
