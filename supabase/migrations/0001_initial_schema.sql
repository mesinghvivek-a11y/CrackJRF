-- UGC NET Platform initial schema
-- Apply in Supabase SQL Editor or with `supabase db push`.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_language text not null default 'en' check (preferred_language in ('en','hi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin','content_editor','reviewer','importer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.admin_members m where m.user_id = auth.uid() and m.active = true)
$$;
create or replace function public.has_admin_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.admin_members m where m.user_id = auth.uid() and m.active = true and m.role = any(allowed_roles))
$$;
revoke all on function public.is_admin() from public;
revoke all on function public.has_admin_role(text[]) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_admin_role(text[]) to authenticated;

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  paper_type text not null check (paper_type in ('common','subject_specific')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.syllabus_versions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id),
  version text not null,
  source_document text,
  effective_from date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique(subject_id, version)
);

create table if not exists public.syllabus_nodes (
  id text primary key,
  syllabus_version_id uuid not null references public.syllabus_versions(id) on delete cascade,
  parent_id text references public.syllabus_nodes(id) on delete cascade,
  node_type text not null check (node_type in ('unit','section','topic','subtopic')),
  title text not null,
  source_text text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(syllabus_version_id, parent_id, title)
);
create index if not exists syllabus_nodes_parent_idx on public.syllabus_nodes(parent_id, sort_order);

create table if not exists public.exam_events (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2100),
  session text not null check (session in ('June','December','Other')),
  event_type text not null default 'regular' check (event_type in ('regular','re_exam','special','unknown')),
  label text not null default '',
  created_at timestamptz not null default now(),
  unique(year, session, event_type, label)
);

create table if not exists public.exam_papers (
  id uuid primary key default gen_random_uuid(),
  exam_event_id uuid not null references public.exam_events(id),
  subject_id uuid not null references public.subjects(id),
  paper_number smallint not null check (paper_number in (1,2)),
  exam_date date,
  shift text,
  original_duration_minutes integer,
  original_question_count integer,
  original_marks numeric(8,2),
  historical_pattern_notes text,
  source_status text not null default 'unverified' check (source_status in ('unverified','verified','incomplete','disputed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(exam_event_id, subject_id, paper_number, shift)
);

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('nta_official','private_solution','official_answer_key','editorial','other')),
  file_name text not null,
  storage_path text,
  file_sha256 text,
  mime_type text default 'application/pdf',
  exam_paper_id uuid references public.exam_papers(id),
  exam_event_id uuid references public.exam_events(id),
  paper_scope text not null default 'single' check (paper_scope in ('paper1','paper2','combined','unknown')),
  shift text,
  language text check (language in ('en','hi','bilingual','unknown')),
  page_count integer,
  processing_status text not null default 'uploaded' check (processing_status in ('uploaded','queued','processing','extracted','needs_review','failed','archived')),
  uploaded_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists source_documents_sha_idx on public.source_documents(file_sha256);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','extracted','reviewing','completed','failed')),
  extractor_name text,
  extractor_version text,
  total_pages integer,
  processed_pages integer not null default 0,
  extracted_items integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.import_job_pages (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  page_number integer not null,
  extraction_method text not null check (extraction_method in ('embedded_text','ocr','manual')),
  extracted_text text,
  extraction_confidence numeric(5,4),
  page_asset_path text,
  warnings jsonb not null default '[]'::jsonb,
  unique(import_job_id, page_number)
);

create table if not exists public.source_question_items (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  import_job_id uuid references public.import_jobs(id) on delete set null,
  source_page_start integer,
  source_page_end integer,
  source_question_number text,
  source_native_question_id text,
  paper_number smallint check (paper_number in (1,2)),
  language text not null default 'unknown' check (language in ('en','hi','bilingual','unknown')),
  raw_content jsonb not null default '{}'::jsonb,
  extracted_text text,
  extraction_confidence numeric(5,4),
  segmentation_status text not null default 'needs_review' check (segmentation_status in ('needs_review','segmented','verified','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists source_question_items_doc_idx on public.source_question_items(source_document_id, source_page_start);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  question_code text not null unique,
  subject_id uuid not null references public.subjects(id),
  question_type text not null default 'mcq' check (question_type in ('mcq','comprehension','table','image','map','matrix','numeric','other')),
  status text not null default 'draft' check (status in ('draft','needs_correction','content_verified','answer_pending','ready_for_approval','published','rejected','archived')),
  answer_status text not null default 'pending' check (answer_status in ('pending','single_correct','multiple_correct','all_options_correct','dropped','disputed')),
  primary_language text not null default 'en' check (primary_language in ('en','hi')),
  difficulty_editorial text check (difficulty_editorial in ('easy','moderate','difficult')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  current_revision integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists questions_subject_status_idx on public.questions(subject_id,status);
create trigger questions_updated_at before update on public.questions for each row execute function public.set_updated_at();

create table if not exists public.question_code_counters (
  subject_code text primary key,
  last_value bigint not null default 0
);
create or replace function public.next_question_code(p_subject_code text)
returns text language plpgsql security definer set search_path = public as $$
declare next_value bigint; prefix text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  insert into public.question_code_counters(subject_code,last_value) values (p_subject_code,1)
  on conflict(subject_code) do update set last_value = public.question_code_counters.last_value + 1
  returning last_value into next_value;
  prefix := case when p_subject_code = '80' then 'GEO-Q-' when p_subject_code = '00' then 'P1-Q-' else 'NET-'||p_subject_code||'-Q-' end;
  return prefix || lpad(next_value::text,6,'0');
end; $$;
revoke all on function public.next_question_code(text) from public;
grant execute on function public.next_question_code(text) to authenticated;

create table if not exists public.question_source_links (
  question_id uuid not null references public.questions(id) on delete cascade,
  source_question_item_id uuid not null references public.source_question_items(id) on delete cascade,
  purpose text not null default 'question_content' check (purpose in ('question_content','translation','answer_source','supporting_evidence')),
  language text check (language in ('en','hi','bilingual','unknown')),
  created_at timestamptz not null default now(),
  primary key(question_id, source_question_item_id)
);

create table if not exists public.question_translations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  language text not null check (language in ('en','hi')),
  stem_blocks jsonb not null default '[]'::jsonb,
  instruction_blocks jsonb not null default '[]'::jsonb,
  content_hash text,
  reviewed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(question_id, language)
);
create trigger question_translations_updated_at before update on public.question_translations for each row execute function public.set_updated_at();

create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  option_key text not null check (option_key in ('A','B','C','D','E','F')),
  sort_order integer not null default 0,
  unique(question_id, option_key)
);
create table if not exists public.question_option_translations (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.question_options(id) on delete cascade,
  language text not null check (language in ('en','hi')),
  content_blocks jsonb not null default '[]'::jsonb,
  unique(option_id, language)
);

create table if not exists public.question_groups (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id),
  group_code text unique,
  group_type text not null check (group_type in ('comprehension','data_interpretation','shared_stimulus','other')),
  created_at timestamptz not null default now()
);
create table if not exists public.question_group_translations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.question_groups(id) on delete cascade,
  language text not null check (language in ('en','hi')),
  stimulus_blocks jsonb not null default '[]'::jsonb,
  unique(group_id, language)
);
create table if not exists public.question_group_members (
  group_id uuid not null references public.question_groups(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  member_order integer not null default 0,
  primary key(group_id, question_id)
);

create table if not exists public.question_classifications (
  question_id uuid not null references public.questions(id) on delete cascade,
  syllabus_node_id text not null references public.syllabus_nodes(id),
  is_primary boolean not null default false,
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(question_id, syllabus_node_id)
);
create index if not exists question_classifications_node_idx on public.question_classifications(syllabus_node_id);

create table if not exists public.question_appearances (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  exam_paper_id uuid not null references public.exam_papers(id),
  original_question_number text not null,
  nta_question_id text,
  source_question_item_id uuid references public.source_question_items(id),
  appearance_notes text,
  unique(question_id, exam_paper_id, original_question_number)
);
create index if not exists question_appearances_paper_idx on public.question_appearances(exam_paper_id, original_question_number);
create index if not exists question_appearances_nta_idx on public.question_appearances(nta_question_id);

create table if not exists public.question_source_matches (
  id uuid primary key default gen_random_uuid(),
  official_item_id uuid not null references public.source_question_items(id) on delete cascade,
  supporting_item_id uuid not null references public.source_question_items(id) on delete cascade,
  similarity_score numeric(5,4),
  match_method text,
  match_status text not null default 'candidate' check (match_status in ('candidate','confirmed','rejected','ambiguous')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  notes text,
  unique(official_item_id, supporting_item_id)
);

create table if not exists public.answer_evidence (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  source_document_id uuid references public.source_documents(id),
  source_question_item_id uuid references public.source_question_items(id),
  claimed_option_keys text[] not null default '{}',
  explanation_richtext jsonb not null default '[]'::jsonb,
  option_explanations jsonb not null default '{}'::jsonb,
  provenance_note text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','accepted','rejected','disputed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.question_explanation_drafts (
  question_id uuid primary key references public.questions(id) on delete cascade,
  explanation_overview text,
  explanation_richtext jsonb not null default '[]'::jsonb,
  option_explanations jsonb not null default '{}'::jsonb,
  references_data jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.verified_answers (
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_option_keys text[] not null default '{}',
  answer_status text not null check (answer_status in ('single_correct','multiple_correct','all_options_correct','dropped')),
  grading_rule text not null default 'normal' check (grading_rule in ('normal','all_candidates_credit','dropped_credit','no_score')),
  explanation_overview text,
  explanation_richtext jsonb not null default '[]'::jsonb,
  option_explanations jsonb not null default '{}'::jsonb,
  references_data jsonb not null default '[]'::jsonb,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  version integer not null default 1
);

create table if not exists public.question_assets (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references public.questions(id) on delete cascade,
  group_id uuid references public.question_groups(id) on delete cascade,
  asset_type text not null check (asset_type in ('image','map','diagram','table_image','page_crop','other')),
  storage_path text not null,
  alt_text text,
  caption text,
  sort_order integer not null default 0,
  check (question_id is not null or group_id is not null)
);

create table if not exists public.question_reviews (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  review_type text not null check (review_type in ('content','classification','answer','explanation','translation','final_approval')),
  status text not null check (status in ('pending','approved','changes_requested','rejected')),
  reviewer_id uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.question_approvals (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  approved_by uuid not null references auth.users(id),
  decision text not null check (decision in ('published','changes_requested','rejected')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.question_revisions (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  revision_number integer not null,
  snapshot jsonb not null,
  changed_by uuid references auth.users(id),
  change_summary text,
  created_at timestamptz not null default now(),
  unique(question_id, revision_number)
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.test_blueprints (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  mode text not null check (mode in ('geography_only','full_ugc_net','custom','historical_paper')),
  paper_i_question_count integer not null default 0,
  paper_ii_question_count integer not null default 0,
  duration_minutes integer not null,
  marks_per_correct numeric(5,2) not null default 2,
  marks_per_wrong numeric(5,2) not null default 0,
  marks_per_unattempted numeric(5,2) not null default 0,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true
);

create table if not exists public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  blueprint_id uuid references public.test_blueprints(id),
  title text,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','auto_submitted','abandoned','invalidated')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  duration_seconds integer,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists test_attempts_user_idx on public.test_attempts(user_id, started_at desc);
create table if not exists public.test_attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  sequence_number integer not null,
  paper_number smallint not null check (paper_number in (1,2)),
  question_snapshot jsonb not null,
  unique(attempt_id, question_id),
  unique(attempt_id, sequence_number)
);
-- Answer keys are stored separately so test-takers cannot read them while the attempt is active.
create table if not exists public.test_attempt_answer_keys (
  attempt_question_id uuid primary key references public.test_attempt_questions(id) on delete cascade,
  correct_option_keys text[] not null default '{}',
  answer_status text not null,
  grading_rule text not null default 'normal',
  explanation_snapshot jsonb not null default '{}'::jsonb
);
create table if not exists public.test_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  selected_option_keys text[] not null default '{}' check (selected_option_keys <@ array['A','B','C','D']::text[]),
  response_state text not null default 'not_answered' check (response_state in ('not_visited','not_answered','answered','marked_review','answered_marked_review')),
  time_spent_seconds integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(attempt_id, question_id)
);
create table if not exists public.test_results (
  attempt_id uuid primary key references public.test_attempts(id) on delete cascade,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  unanswered_count integer not null default 0,
  marks_obtained numeric(8,2) not null default 0,
  maximum_marks numeric(8,2) not null default 0,
  accuracy numeric(6,3),
  completion_rate numeric(6,3),
  time_taken_seconds integer,
  breakdown jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now()
);

create table if not exists public.user_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  primary key(user_id, question_id)
);

-- Create a profile for every newly registered user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Read-only answer RPC for PYQ learning. Active test answers are not returned.
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
    'references_data', va.references_data
  ) into answer_json
  from public.verified_answers va
  join public.questions q on q.id = va.question_id
  where va.question_id = p_question_id and q.status = 'published';
  if answer_json is null then raise exception 'Verified answer not available'; end if;
  return answer_json;
end; $$;
revoke all on function public.get_practice_answer(uuid) from public;
grant execute on function public.get_practice_answer(uuid) to authenticated;


-- Server-authoritative test creation. The client supplies only approved question IDs and paper numbers;
-- public question snapshots and protected answer keys are assembled separately on the database side.
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
      'translations',coalesce((select jsonb_agg(jsonb_build_object('language',t.language,'stem_blocks',t.stem_blocks,'instruction_blocks',t.instruction_blocks) order by t.language) from public.question_translations t where t.question_id=v_question.id),'[]'::jsonb),
      'options',coalesce((select jsonb_agg(jsonb_build_object('key',o.option_key,'translations',coalesce((select jsonb_agg(jsonb_build_object('language',ot.language,'content_blocks',ot.content_blocks) order by ot.language) from public.question_option_translations ot where ot.option_id=o.id),'[]'::jsonb)) order by o.sort_order) from public.question_options o where o.question_id=v_question.id),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(jsonb_build_object('group_type',g.group_type,'translations',coalesce((select jsonb_agg(jsonb_build_object('language',gt.language,'stimulus_blocks',gt.stimulus_blocks)) from public.question_group_translations gt where gt.group_id=g.id),'[]'::jsonb))) from public.question_group_members gm join public.question_groups g on g.id=gm.group_id where gm.question_id=v_question.id),'[]'::jsonb)
    ) into v_snapshot;
    insert into public.test_attempt_questions(attempt_id,question_id,sequence_number,paper_number,question_snapshot)
      values(v_attempt,v_question.id,i,p_paper_numbers[i],v_snapshot) returning id into v_attempt_question;
    insert into public.test_attempt_answer_keys(attempt_question_id,correct_option_keys,answer_status,grading_rule,explanation_snapshot)
      select v_attempt_question,va.correct_option_keys,va.answer_status,va.grading_rule,
        jsonb_build_object('overview',va.explanation_overview,'richtext',va.explanation_richtext,'option_explanations',va.option_explanations,'references',va.references_data)
      from public.verified_answers va where va.question_id=v_question.id;
    if not found and v_question.answer_status='dropped' then
      insert into public.test_attempt_answer_keys(attempt_question_id,correct_option_keys,answer_status,grading_rule)
      values(v_attempt_question,'{}','dropped','dropped_credit');
    end if;
    insert into public.test_responses(attempt_id,question_id,response_state) values(v_attempt,v_question.id,'not_visited');
  end loop;
  return v_attempt;
end; $$;

create or replace function public.submit_test_attempt(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_correct integer;
  v_incorrect integer;
  v_unanswered integer;
  v_total integer;
  v_attempted integer;
  v_score numeric(8,2);
  v_max numeric(8,2);
  v_time integer;
  v_auto boolean;
  v_accuracy numeric(6,3);
  v_completion numeric(6,3);
  v_breakdown jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_attempt from public.test_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Test attempt not found'; end if;
  if v_attempt.status <> 'in_progress' then
    select jsonb_build_object('status',v_attempt.status,'result',to_jsonb(r)) into v_breakdown from public.test_results r where r.attempt_id=p_attempt_id;
    return coalesce(v_breakdown,jsonb_build_object('status',v_attempt.status));
  end if;
  v_auto := v_attempt.deadline_at is not null and now() >= v_attempt.deadline_at;
  with per_question as (
    select tq.question_id, coalesce(tr.selected_option_keys,'{}'::text[]) selected_keys,
      ak.correct_option_keys,ak.grading_rule,
      case when coalesce(cardinality(tr.selected_option_keys),0)>0 then true else false end is_attempted
    from public.test_attempt_questions tq
    join public.test_attempt_answer_keys ak on ak.attempt_question_id=tq.id
    left join public.test_responses tr on tr.attempt_id=tq.attempt_id and tr.question_id=tq.question_id
    where tq.attempt_id=p_attempt_id
  ), graded as (
    select *,
      case when grading_rule in ('all_candidates_credit','dropped_credit') then true
           when grading_rule='no_score' then false
           else (array(select unnest(selected_keys) order by 1) = array(select unnest(correct_option_keys) order by 1)) end as is_correct
    from per_question
  )
  select
    count(*) filter(where grading_rule<>'no_score'),
    count(*) filter(where grading_rule<>'no_score' and is_correct),
    count(*) filter(where grading_rule<>'no_score' and is_attempted and not is_correct and grading_rule not in ('all_candidates_credit','dropped_credit')),
    count(*) filter(where grading_rule<>'no_score' and not is_attempted and grading_rule not in ('all_candidates_credit','dropped_credit')),
    coalesce(sum(case when grading_rule='no_score' then 0
                      when is_correct then (v_attempt.configuration_snapshot->>'marks_per_correct')::numeric
                      when is_attempted then (v_attempt.configuration_snapshot->>'marks_per_wrong')::numeric
                      else (v_attempt.configuration_snapshot->>'marks_per_unattempted')::numeric end),0),
    coalesce(sum(case when grading_rule='no_score' then 0 else (v_attempt.configuration_snapshot->>'marks_per_correct')::numeric end),0),
    count(*) filter(where is_attempted and grading_rule<>'no_score')
  into v_total,v_correct,v_incorrect,v_unanswered,v_score,v_max,v_attempted
  from graded;
  v_time := greatest(0,extract(epoch from (least(now(),coalesce(v_attempt.deadline_at,now()))-v_attempt.started_at))::integer);
  v_accuracy := case when v_attempted=0 then 0 else round((v_correct::numeric/v_attempted)*100,3) end;
  v_completion := case when v_total=0 then 0 else round((v_attempted::numeric/v_total)*100,3) end;
  v_breakdown := jsonb_build_object('correct',v_correct,'incorrect',v_incorrect,'unanswered',v_unanswered,'attempted',v_attempted,'total',v_total);
  insert into public.test_results(attempt_id,correct_count,incorrect_count,unanswered_count,marks_obtained,maximum_marks,accuracy,completion_rate,time_taken_seconds,breakdown)
  values(p_attempt_id,v_correct,v_incorrect,v_unanswered,v_score,v_max,v_accuracy,v_completion,v_time,v_breakdown)
  on conflict(attempt_id) do update set correct_count=excluded.correct_count,incorrect_count=excluded.incorrect_count,unanswered_count=excluded.unanswered_count,marks_obtained=excluded.marks_obtained,maximum_marks=excluded.maximum_marks,accuracy=excluded.accuracy,completion_rate=excluded.completion_rate,time_taken_seconds=excluded.time_taken_seconds,breakdown=excluded.breakdown,calculated_at=now();
  update public.test_attempts set status=case when v_auto then 'auto_submitted' else 'submitted' end,submitted_at=now(),duration_seconds=v_time where id=p_attempt_id;
  return jsonb_build_object('attempt_id',p_attempt_id,'status',case when v_auto then 'auto_submitted' else 'submitted' end,'correct',v_correct,'incorrect',v_incorrect,'unanswered',v_unanswered,'marks_obtained',v_score,'maximum_marks',v_max,'accuracy',v_accuracy,'completion_rate',v_completion,'time_taken_seconds',v_time);
end; $$;

create or replace function public.get_test_attempt_review(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result_json jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.test_attempts where id=p_attempt_id and user_id=auth.uid() and status in ('submitted','auto_submitted')) then
    raise exception 'Attempt review is available only after submission';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sequence_number',tq.sequence_number,'paper_number',tq.paper_number,'question_id',tq.question_id,
    'question',tq.question_snapshot,'selected_option_keys',coalesce(tr.selected_option_keys,'{}'::text[]),
    'correct_option_keys',ak.correct_option_keys,'answer_status',ak.answer_status,
    'grading_rule',ak.grading_rule,'explanation',ak.explanation_snapshot
  ) order by tq.sequence_number),'[]'::jsonb) into result_json
  from public.test_attempt_questions tq
  join public.test_attempt_answer_keys ak on ak.attempt_question_id=tq.id
  left join public.test_responses tr on tr.attempt_id=tq.attempt_id and tr.question_id=tq.question_id
  where tq.attempt_id=p_attempt_id;
  return result_json;
end; $$;
revoke all on function public.start_test_attempt(text,uuid[],smallint[],integer) from public;
revoke all on function public.submit_test_attempt(uuid) from public;
revoke all on function public.get_test_attempt_review(uuid) from public;
grant execute on function public.start_test_attempt(text,uuid[],smallint[],integer) to authenticated;
grant execute on function public.submit_test_attempt(uuid) to authenticated;
grant execute on function public.get_test_attempt_review(uuid) to authenticated;

-- RLS on all application tables.
do $$ declare t text; begin
  foreach t in array array[
    'profiles','admin_members','question_code_counters','subjects','syllabus_versions','syllabus_nodes','exam_events','exam_papers','source_documents','import_jobs','import_job_pages','source_question_items','questions','question_source_links','question_translations','question_options','question_option_translations','question_groups','question_group_translations','question_group_members','question_classifications','question_appearances','question_source_matches','answer_evidence','question_explanation_drafts','verified_answers','question_assets','question_reviews','question_approvals','question_revisions','audit_logs','test_blueprints','test_attempts','test_attempt_questions','test_attempt_answer_keys','test_responses','test_results','user_bookmarks'
  ] loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- Profiles: users see/update their own profile; admins can view all.
create policy "profile self read" on public.profiles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "profile self update" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profile self insert" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "admin question code counters" on public.question_code_counters for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "admin roles read" on public.admin_members for select to authenticated using (public.is_admin());
create policy "super admin manage roles" on public.admin_members for all to authenticated using (public.has_admin_role(array['super_admin'])) with check (public.has_admin_role(array['super_admin']));

-- Academic structure is publicly readable; only admins can mutate.
create policy "subjects public read" on public.subjects for select using (active = true or public.is_admin());
create policy "subjects admin write" on public.subjects for all to authenticated using (public.has_admin_role(array['super_admin'])) with check (public.has_admin_role(array['super_admin']));
create policy "syllabus versions public read" on public.syllabus_versions for select using (true);
create policy "syllabus versions admin write" on public.syllabus_versions for all to authenticated using (public.has_admin_role(array['super_admin'])) with check (public.has_admin_role(array['super_admin']));
create policy "syllabus nodes public read" on public.syllabus_nodes for select using (is_active = true or public.is_admin());
create policy "syllabus nodes admin write" on public.syllabus_nodes for all to authenticated using (public.has_admin_role(array['super_admin'])) with check (public.has_admin_role(array['super_admin']));
create policy "exam events public read" on public.exam_events for select using (true);
create policy "exam events admin write" on public.exam_events for all to authenticated using (public.has_admin_role(array['super_admin','importer'])) with check (public.has_admin_role(array['super_admin','importer']));
create policy "exam papers public read" on public.exam_papers for select using (true);
create policy "exam papers admin write" on public.exam_papers for all to authenticated using (public.has_admin_role(array['super_admin','importer','content_editor'])) with check (public.has_admin_role(array['super_admin','importer','content_editor']));

-- Published questions and their public-facing content.
create policy "published questions read" on public.questions for select using (status = 'published' or public.is_admin());
create policy "admin question write" on public.questions for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "published translations read" on public.question_translations for select using (exists(select 1 from public.questions q where q.id = question_id and q.status = 'published') or public.is_admin());
create policy "admin translations write" on public.question_translations for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "published options read" on public.question_options for select using (exists(select 1 from public.questions q where q.id = question_id and q.status = 'published') or public.is_admin());
create policy "admin options write" on public.question_options for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "published option translations read" on public.question_option_translations for select using (exists(select 1 from public.question_options o join public.questions q on q.id = o.question_id where o.id = option_id and q.status = 'published') or public.is_admin());
create policy "admin option translations write" on public.question_option_translations for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "published groups read" on public.question_groups for select using (true);
create policy "admin groups write" on public.question_groups for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "published group translations read" on public.question_group_translations for select using (true);
create policy "admin group translations write" on public.question_group_translations for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "published group members read" on public.question_group_members for select using (exists(select 1 from public.questions q where q.id = question_id and q.status = 'published') or public.is_admin());
create policy "admin group members write" on public.question_group_members for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "published classifications read" on public.question_classifications for select using (exists(select 1 from public.questions q where q.id = question_id and q.status = 'published') or public.is_admin());
create policy "admin classifications write" on public.question_classifications for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "published appearances read" on public.question_appearances for select using (exists(select 1 from public.questions q where q.id = question_id and q.status = 'published') or public.is_admin());
create policy "admin appearances write" on public.question_appearances for all to authenticated using (public.has_admin_role(array['super_admin','content_editor','importer'])) with check (public.has_admin_role(array['super_admin','content_editor','importer']));
create policy "published assets read" on public.question_assets for select using ((question_id is not null and exists(select 1 from public.questions q where q.id = question_id and q.status = 'published')) or public.is_admin());
create policy "admin assets write" on public.question_assets for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));

create policy "admin question source links" on public.question_source_links for all to authenticated using (public.has_admin_role(array['super_admin','content_editor','reviewer','importer'])) with check (public.has_admin_role(array['super_admin','content_editor','reviewer','importer']));

-- Sensitive source and answer material is admin-only.
create policy "admin source documents" on public.source_documents for all to authenticated using (public.has_admin_role(array['super_admin','importer'])) with check (public.has_admin_role(array['super_admin','importer']));
create policy "admin import jobs" on public.import_jobs for all to authenticated using (public.has_admin_role(array['super_admin','importer'])) with check (public.has_admin_role(array['super_admin','importer']));
create policy "admin import pages" on public.import_job_pages for all to authenticated using (public.has_admin_role(array['super_admin','importer'])) with check (public.has_admin_role(array['super_admin','importer']));
create policy "admin source items" on public.source_question_items for all to authenticated using (public.has_admin_role(array['super_admin','importer'])) with check (public.has_admin_role(array['super_admin','importer']));
-- Content editors and reviewers may read original source material for verification; only importers/Super Admin manage documents and import jobs.
create policy "review team read source documents" on public.source_documents for select to authenticated using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
create policy "review team read import jobs" on public.import_jobs for select to authenticated using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
create policy "review team read import pages" on public.import_job_pages for select to authenticated using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
create policy "review team read source items" on public.source_question_items for select to authenticated using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
create policy "content editors assign source item paper" on public.source_question_items for update to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "admin source matches" on public.question_source_matches for all to authenticated using (public.has_admin_role(array['super_admin','content_editor','reviewer'])) with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
create policy "admin answer evidence" on public.answer_evidence for all to authenticated using (public.has_admin_role(array['super_admin','reviewer','content_editor'])) with check (public.has_admin_role(array['super_admin','reviewer','content_editor']));
create policy "admin explanation drafts" on public.question_explanation_drafts for all to authenticated using (public.has_admin_role(array['super_admin','reviewer','content_editor'])) with check (public.has_admin_role(array['super_admin','reviewer','content_editor']));
create policy "admin verified answers" on public.verified_answers for all to authenticated using (public.has_admin_role(array['super_admin','reviewer'])) with check (public.has_admin_role(array['super_admin','reviewer']));
create policy "content editors read verified answers" on public.verified_answers for select to authenticated using (public.has_admin_role(array['super_admin','reviewer','content_editor']));
create policy "admin reviews" on public.question_reviews for all to authenticated using (public.has_admin_role(array['super_admin','reviewer','content_editor'])) with check (public.has_admin_role(array['super_admin','reviewer','content_editor']));
create policy "admin approvals" on public.question_approvals for all to authenticated using (public.has_admin_role(array['super_admin'])) with check (public.has_admin_role(array['super_admin']));
create policy "admin revisions" on public.question_revisions for all to authenticated using (public.has_admin_role(array['super_admin','content_editor'])) with check (public.has_admin_role(array['super_admin','content_editor']));
create policy "admin audit logs" on public.audit_logs for select to authenticated using (public.is_admin());
create policy "admin audit insert" on public.audit_logs for insert to authenticated with check (public.is_admin());

-- Blueprints are public; a user only sees and changes their own attempts and responses.
create policy "active blueprints read" on public.test_blueprints for select using (active = true or public.is_admin());
create policy "admin blueprint write" on public.test_blueprints for all to authenticated using (public.has_admin_role(array['super_admin'])) with check (public.has_admin_role(array['super_admin']));
create policy "attempts own rows" on public.test_attempts for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admin updates attempts" on public.test_attempts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "attempt questions own read" on public.test_attempt_questions for select to authenticated using (exists(select 1 from public.test_attempts a where a.id = attempt_id and (a.user_id = auth.uid() or public.is_admin())));
create policy "admin creates attempt questions" on public.test_attempt_questions for insert to authenticated with check (public.is_admin());
create policy "admin manages attempt answer keys" on public.test_attempt_answer_keys for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "responses own rows" on public.test_responses for all to authenticated using (exists(select 1 from public.test_attempts a where a.id = attempt_id and a.user_id = auth.uid() and a.status = 'in_progress')) with check (exists(select 1 from public.test_attempts a where a.id = attempt_id and a.user_id = auth.uid() and a.status = 'in_progress'));
create policy "results own read" on public.test_results for select to authenticated using (exists(select 1 from public.test_attempts a where a.id = attempt_id and (a.user_id = auth.uid() or public.is_admin())));
create policy "results admin write" on public.test_results for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "bookmarks own rows" on public.user_bookmarks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Storage buckets: create in Supabase dashboard or uncomment and run if storage schema is available.
-- insert into storage.buckets(id, name, public) values ('source-pdfs','source-pdfs',false) on conflict do nothing;
-- insert into storage.buckets(id, name, public) values ('question-assets','question-assets',false) on conflict do nothing;
-- Keep official/private PDFs private; serve reviewed public question assets through controlled signed URLs or a separate public bucket.

-- Private source/asset buckets and storage access.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
  ('source-pdfs','source-pdfs',false,104857600,array['application/pdf']),
  ('question-assets','question-assets',false,20971520,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;
create policy "admins manage source PDFs" on storage.objects for all to authenticated using (bucket_id = 'source-pdfs' and public.has_admin_role(array['super_admin','importer'])) with check (bucket_id = 'source-pdfs' and public.has_admin_role(array['super_admin','importer']));
create policy "review team read source PDFs" on storage.objects for select to authenticated using (bucket_id = 'source-pdfs' and public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
create policy "content team manages question assets" on storage.objects for all to authenticated using (bucket_id = 'question-assets' and public.has_admin_role(array['super_admin','content_editor'])) with check (bucket_id = 'question-assets' and public.has_admin_role(array['super_admin','content_editor']));
