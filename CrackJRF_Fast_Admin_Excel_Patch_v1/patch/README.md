# UGC NET Prep Platform

Monorepo starter for a multi-subject UGC NET preparation product, with Geography (Paper II, subject code 80) as the first subject and Paper I (code 00) represented as a separate shared subject/module.

## What is included

- `apps/student`: student-facing Next.js app (PYQ browsing, answer reveal, bookmarks, practice/full mock test flows, personal performance, static PYQ analytics and authentication).
- `apps/admin`: separate private Next.js Admin app with one-step trusted Excel import, compact bilingual editor, collapsible syllabus taxonomy, question bank and publishing controls.
- `packages/shared`: shared TypeScript models, test blueprints, demo data and expanded Geography/Paper I syllabus JSON.
- `supabase/migrations`: PostgreSQL schema, row-level security, private storage buckets, controlled answer reveal RPC, admin roles and test data tables.
- `scripts/seed-syllabus.ts`: seeds subjects, syllabus versions/nodes and initial test blueprints.

The repository is an implementation foundation with Supabase-backed API paths where credentials are configured. It does not contain the real 2014–2026 question dataset, and demo questions are synthetic. The approved content handoff is one provider-prepared Excel workbook per exam event/shift. A structurally valid trusted workbook is published as one atomic batch; questions remain fully editable afterwards. Admin editing has parallel English/Hindi content, a collapsible syllabus tree, and Save Draft / Publish actions. Hinglish and Gemini translation are not used. Dependency installation, production builds, SQL execution and end-to-end Supabase verification must be completed in your environment before launch.

## Requirements

- Node.js 20.9 or later (Node 22 recommended).
- npm 10+.
- A Supabase project for shared auth, PostgreSQL and private file storage.

## 1. Install dependencies

From the repository root:

```bash
npm install
```

## 2. Configure Supabase

Create a Supabase project. Copy `.env.example` to each app:

```bash
cp .env.example apps/student/.env.local
cp .env.example apps/admin/.env.local
```

Fill these values in both app files:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

For syllabus seeding, also create a root `.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

**Never put `SUPABASE_SERVICE_ROLE_KEY` in either app's `NEXT_PUBLIC_` variables or browser code. Never commit `.env.local`.** The service role key bypasses RLS and is only needed by trusted server/admin scripts.

### Apply the database migration

Apply `supabase/migrations/0001_initial_schema.sql`, then `0002_json_import_packages.sql`, then `0003_excel_import_workflow.sql`, and finally `0004_trusted_excel_publish_and_fast_editor.sql`, in that order. Skip any migration that has already completed successfully. Migration 0004 adds atomic trusted-workbook publication, private editor drafts, paper-order preservation and an English/native + Hindi/native-only translation policy. It removes legacy Roman-script Hindi variants. Keep the existing private `source-pdfs` and `question-assets` buckets.

Then seed the subject and syllabus rows:

```bash
npm run seed:syllabus
```

The seed contains the ten Geography units and ten Paper I units based on the PDFs supplied in this project. Finer sections and subtopics are organizational expansions; they should be reviewed before bulk question tagging.

### Create the first Super Admin

1. Register your own account through Supabase Auth (email/password).
2. Find its UUID in Supabase Authentication → Users.
3. Run this SQL, replacing the email:

```sql
insert into public.admin_members(user_id, role, active)
select id, 'super_admin', true
from auth.users
where email = 'YOUR_ADMIN_EMAIL'
on conflict (user_id) do update set role = 'super_admin', active = true;
```

The admin frontend checks `public.is_admin()` and the database policies enforce authorization. The admin URL itself is not a security control.

### Configure authentication

In Supabase Authentication → URL Configuration, add local redirect URLs for both apps, for example:

- `http://localhost:3000/**`
- `http://localhost:3001/**`

Enable Email/Password. To use Google, configure Google OAuth credentials in Google Cloud and add them to Supabase Auth → Providers → Google. The student app has email/password and Google OAuth sign-in buttons. The admin app currently has email/password sign-in; use a separately designated administrator account.

## 3. Run both applications

Open two terminals at the repository root:

```bash
npm run dev:student
```

Student app: <http://localhost:3000>

```bash
npm run dev:admin
```

Admin app: <http://localhost:3001>

Without Supabase environment values, both apps open in clearly labelled local preview mode. Admin changes then remain local in the browser and uploads/publishing are not persisted.

## 4. Trusted Excel import workflow

The approved content handoff is one provider-prepared `.xlsx` workbook per examination event/shift. A single `Questions` sheet can contain Paper I and Paper II rows. The workbook includes `Exam Metadata`, question text and options, correct answer(s), optional official Hindi, explanations, stable syllabus IDs, keywords, answer-source details and paper order.

In Admin → Import & Publish, selecting the workbook starts upload, structural validation and publication automatically. CrackJRF rejects the complete workbook if required fields, metadata, answer keys, subject mappings, taxonomy paths, duplicate checks or provider QA flags fail. A valid workbook is published through one PostgreSQL transaction. There is no second answer-verification queue or reviewer/promotion stage.

The Admin can later edit every question field in a compact English/Hindi editor. Save Draft stores a private working copy without changing the live version; Publish writes all changes transactionally and updates the Student Portal after the database confirms success. Hindi can be imported from Excel or entered manually. Hinglish and Gemini translation are not supported.

Download the current template from the Admin Import Centre or `public/templates/CrackJRF_Question_Import_Template_v3.xlsx`. Keep the worksheet names and column headers unchanged.

## 5. Question identity and content rules

- Use platform-owned canonical IDs (e.g. `GEO-Q-000001`, `P1-Q-000001`).
- Preserve NTA's question ID as optional source metadata, never as the primary key.
- Preserve each exam appearance separately (year, June/December/other, re-exam/special, paper, date, shift and original question number).
- English and Hindi are language variants of one canonical logical question, not separate question records. Preserve the external language-specific question codes ending in `E` and `H` on the language records.
- A/B/C/D remain the visible option keys and platform-owned option UUIDs remain stable across edits.
- Each imported question has one primary Unit → Section → Topic path and an optional Subtopic; use keywords for related concepts. Overall counts and test selection deduplicate by canonical question ID.
- Shared passages, tables and stimuli use question groups so related sub-questions can point to the same stimulus.
- Keep official question wording and answer-source provenance distinct in the workbook metadata and question rows.
- Preserve source provenance for the answer supplied in the trusted workbook. An Admin may change the current answer and publish a new revision; previous answer evidence and revisions remain traceable.
- The trusted workbook supplies the current answer key used by the platform. Admins can edit the answer and publish a new revision at any time.
- Historical papers retain their actual question counts/patterns. New complete mock blueprints use 50 Paper I + 100 Paper II questions over 180 minutes. Geography-only 100-question/120-minute mode is a platform practice configuration, not an official separate Paper II time allotment.

## 6. Main routes

### Student (`localhost:3000`)

- `/` – overview
- `/pyq` – published question browsing, filters, answer reveal and bookmarks
- `/tests` – Geography-only, full UGC NET and custom timed CBT; test attempts require enough published questions with an answer key
- `/analytics` – PYQ frequency and historical trend analysis from source appearances
- `/performance` – personal performance derived from completed attempts
- `/revision` – bookmarks and mistake notebook entry point
- `/auth` – email/password and Google OAuth UI

### Admin (`localhost:3001`)

- `/` – admin dashboard
- `/imports` – one-step trusted Excel upload, validation and batch publication
- `/imports/excel/[batchId]` – completed Excel batch and published question list
- `/review?questionCode=...` – compact English/Hindi question editor with Save Draft and Publish
- `/questions` – question bank management shell
- `/syllabus` – Geography and Paper I taxonomy viewer
- `/settings` – roles/security guidance
- `/auth` – admin sign in

## 7. Validation helpers

```bash
npm run validate:question -- examples/question-record.example.json
```

This validates structural fields only. It does not independently verify source authenticity, taxonomy meaning, translation quality or academic answer correctness. The trusted workbook workflow relies on the provider's pre-check and preserves answer/source provenance.

## 8. Important production work remaining

Before real candidates use the platform:

1. Apply migrations 0001–0004 in order, skipping any migration already successfully applied.
2. Run Admin and Student production builds in the target Codespaces environment.
3. Test a small trusted workbook and confirm all questions publish together, with no partial batch on structural failure.
4. Test Save Draft and Publish with a Super Admin account; confirm Save Draft leaves the published version unchanged and Publish updates it transactionally.
5. Test the English/Hindi editor, syllabus tree, answer changes, explanations, source provenance and image attachments.
6. Test the student CBT client against the server-authoritative `start_test_attempt`, response-save, `submit_test_attempt` and post-submit review RPCs. Never let the browser submit or read test answer keys.
7. Test the student PYQ reveal interface against the `get_practice_answer` RPC and active-test access checks.
8. Run RLS, role-permission, accessibility, reliability and load tests, and confirm production backups are available.

This repository is a runnable foundation and first-pass interface, not a claim that the entire production product or the 2014–2026 dataset is already complete.

## 9. Pilot validation

The older [`docs/PILOT_VALIDATION.md`](docs/PILOT_VALIDATION.md) document records a historical PDF workflow test. That workflow is retired and is not part of the current vendor JSON ingestion pipeline.
