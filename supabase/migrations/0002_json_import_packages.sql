-- CrackJRF JSON package ingestion and bilingual content support.
-- Apply after 0001_initial_schema.sql.

alter table public.question_translations
  add column if not exists language_question_code text;
create unique index if not exists question_translations_language_code_uidx
  on public.question_translations(language_question_code)
  where language_question_code is not null;

alter table public.question_options
  add column if not exists provider_option_id text;
create unique index if not exists question_options_provider_option_uidx
  on public.question_options(question_id, provider_option_id)
  where provider_option_id is not null;

create table if not exists public.question_explanation_translations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  language text not null check (language in ('en','hi')),
  explanation_overview text,
  explanation_richtext jsonb not null default '[]'::jsonb,
  option_explanations jsonb not null default '[]'::jsonb,
  references_data jsonb not null default '[]'::jsonb,
  review_status text not null default 'draft' check (review_status in ('draft','pending_review','verified','changes_requested')),
  updated_by uuid references auth.users(id),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(question_id, language)
);
create trigger question_explanation_translations_updated_at
  before update on public.question_explanation_translations
  for each row execute function public.set_updated_at();
create or replace function public.enforce_explanation_verification_role()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.review_status = 'verified' then
    if not public.has_admin_role(array['super_admin','reviewer']) then
      raise exception 'Only a Reviewer or Super Admin can verify an explanation translation';
    end if;
    if new.verified_by is null then new.verified_by := auth.uid(); end if;
    if new.verified_at is null then new.verified_at := now(); end if;
  else
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end; $$;
create trigger question_explanation_translations_verify_guard
  before insert or update on public.question_explanation_translations
  for each row execute function public.enforce_explanation_verification_role();

create table if not exists public.import_packages (
  id uuid primary key default gen_random_uuid(),
  package_id text not null unique,
  schema_version text not null,
  subject_id uuid not null references public.subjects(id),
  exam_event_id uuid not null references public.exam_events(id),
  exam_paper_id uuid not null references public.exam_papers(id),
  paper_number smallint not null check (paper_number in (1,2)),
  exam_year integer not null,
  exam_session text not null,
  shift text,
  archive_path text not null,
  archive_sha256 text not null,
  manifest jsonb not null,
  qa_report jsonb not null,
  languages text[] not null default array['en']::text[],
  total_questions integer not null check (total_questions > 0),
  imported_questions integer not null default 0,
  validation_status text not null default 'valid' check (validation_status in ('valid','valid_with_warnings')),
  status text not null default 'staged' check (status in ('staged','in_review','accepted','rejected','superseded')),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists import_packages_exam_idx
  on public.import_packages(exam_year desc, exam_session, paper_number, created_at desc);

create table if not exists public.import_package_questions (
  id uuid primary key default gen_random_uuid(),
  import_package_id uuid not null references public.import_packages(id) on delete cascade,
  base_question_id text not null,
  language_question_codes jsonb not null,
  order_index integer not null check (order_index > 0),
  original_question_number text not null,
  question_type text not null,
  common_data jsonb not null,
  english_data jsonb not null,
  hindi_data jsonb,
  classification_status text not null default 'unassigned' check (classification_status in ('unassigned','partially_assigned','assigned')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','in_review','verified','changes_requested','rejected')),
  created_at timestamptz not null default now(),
  unique(import_package_id, base_question_id),
  unique(import_package_id, order_index)
);
create index if not exists import_package_questions_queue_idx
  on public.import_package_questions(import_package_id, review_status, order_index);

alter table public.import_packages enable row level security;
alter table public.import_package_questions enable row level security;
alter table public.question_explanation_translations enable row level security;

create policy "admin import packages read" on public.import_packages
  for select to authenticated
  using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
create policy "importers create import packages" on public.import_packages
  for insert to authenticated
  with check (public.has_admin_role(array['super_admin','importer']));
create policy "admin import packages update" on public.import_packages
  for update to authenticated
  using (public.has_admin_role(array['super_admin','importer','reviewer']))
  with check (public.has_admin_role(array['super_admin','importer','reviewer']));
create policy "importers delete incomplete packages" on public.import_packages
  for delete to authenticated
  using (public.has_admin_role(array['super_admin','importer']));
create policy "admin package questions read" on public.import_package_questions
  for select to authenticated
  using (public.has_admin_role(array['super_admin','importer','content_editor','reviewer']));
create policy "importers create package questions" on public.import_package_questions
  for insert to authenticated
  with check (public.has_admin_role(array['super_admin','importer']));
create policy "content team update package questions" on public.import_package_questions
  for update to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));
create policy "importers delete incomplete package questions" on public.import_package_questions
  for delete to authenticated
  using (public.has_admin_role(array['super_admin','importer']));
create policy "published explanation translations read" on public.question_explanation_translations
  for select using (exists(select 1 from public.questions q where q.id = question_id and q.status = 'published') or public.is_admin());
create policy "content team manages explanation translations" on public.question_explanation_translations
  for all to authenticated
  using (public.has_admin_role(array['super_admin','content_editor','reviewer']))
  with check (public.has_admin_role(array['super_admin','content_editor','reviewer']));

-- The existing private source-pdfs bucket now also stores immutable vendor ZIP packages.
update storage.buckets
set file_size_limit = 104857600,
    allowed_mime_types = array['application/pdf','application/zip','application/x-zip-compressed']
where id = 'source-pdfs';
