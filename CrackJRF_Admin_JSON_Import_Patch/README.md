# UGC NET Prep Platform

Monorepo starter for a multi-subject UGC NET preparation product, with Geography (Paper II, subject code 80) as the first subject and Paper I (code 00) represented as a separate shared subject/module.

## What is included

- `apps/student`: student-facing Next.js app (PYQ browsing, answer reveal, bookmarks, practice/full mock test flows, personal performance, static PYQ analytics and authentication).
- `apps/admin`: separate private Next.js admin app (dashboard, vendor JSON Import Centre, package staging review, three-panel content review workspace, rich explanation editor, question bank, syllabus viewer, roles/settings).
- `packages/shared`: shared TypeScript models, test blueprints, demo data and expanded Geography/Paper I syllabus JSON.
- `supabase/migrations`: PostgreSQL schema, row-level security, private storage buckets, controlled answer reveal RPC, admin roles and test data tables.
- `scripts/seed-syllabus.ts`: seeds subjects, syllabus versions/nodes and initial test blueprints.

The repository is an implementation foundation with Supabase-backed API paths where credentials are configured. It does not contain the real 2014–2026 question dataset, and the demo questions are synthetic. The approved ingestion boundary is vendor-delivered consolidated JSON: CrackJRF does not perform PDF OCR, segmentation or solved-paper matching. Imported records are structurally validated and remain private until content review, syllabus classification, answer verification and Super Admin approval. Dependency installation, a production build, SQL execution and end-to-end Supabase verification must be completed in your environment before launch.

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

Run `supabase/migrations/0001_initial_schema.sql` in the Supabase SQL Editor first. Then run `supabase/migrations/0002_json_import_packages.sql`. The second migration adds the private vendor-package staging tables, E/H language question codes, stable provider option IDs, language-specific explanation storage, the relevant RLS policies and ZIP support for the private `source-pdfs` bucket.

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

## 4. Vendor JSON package ingestion workflow

The provider delivers one ZIP package per examination paper, year, session, shift and re-examination event. The package is the consolidated result of the provider's PDF extraction, source matching and NTA-order preservation. CrackJRF does not run OCR, segment PDF pages or match solved-paper questions.

The provider-facing standard and sample package are versioned in [`docs/vendor-import-standard-v1.0.0/`](docs/vendor-import-standard-v1.0.0/). The separate distribution bundle is `CrackJRF_Import_Contract_v1.0.zip`. The ZIP must contain:

- `manifest.json`
- `questions_common.json`
- `questions_en.json` (mandatory) and `questions_hi.json` (optional)
- `qa_report.json`, `checksums.sha256` and `assets/asset_manifest.json`
- Original high-resolution question crops, maps, diagrams and tables under `assets/` when referenced

Apply migration `0002_json_import_packages.sql` before using this feature. In Admin → JSON Import Centre, choose the ZIP file. The browser uploads it directly to the private Supabase Storage bucket; the Admin API validates the archive and registers the metadata and question records in private staging. The API checks package structure and IDs, question sequence, E/H pairing, shared A/B/C/D option IDs, source references, QA counts, checksums and asset hashes. It does not inspect or process source PDFs.

A successful structural validation is not an academic verification. Imported answers and explanations remain provider claims. CrackJRF must separately assign syllabus units, sections, topics, subtopics and keywords, review each language, verify answer evidence and approve publication. A package with a provider QA exception or unresolved match remains visibly flagged for manual review. Nothing is automatically published.

The provider must not include internal database UUIDs or syllabus classification/keyword fields. For the complete identity, media and answer-evidence rules, follow the versioned import contract rather than inventing provider-specific fields.

## 5. Question identity and content rules

- Use platform-owned canonical IDs (e.g. `GEO-Q-000001`, `P1-Q-000001`).
- Preserve NTA's question ID as optional source metadata, never as the primary key.
- Preserve each exam appearance separately (year, June/December/other, re-exam/special, paper, date, shift and original question number).
- English and Hindi are language variants of one canonical logical question, not separate question records. Preserve the external language-specific question codes ending in `E` and `H` on the language records.
- Provider option IDs remain stable across language files and are mapped to platform-owned option UUIDs; A/B/C/D remain the visible option keys.
- A question can map to multiple units/topics, but overall unique-question totals and test selection must deduplicate by canonical question ID.
- Shared passages, tables and stimuli use question groups so related sub-questions can point to the same stimulus.
- Keep official and private source records separate. Preserve the provider's question-match provenance; a provider match is not answer verification and CrackJRF does not independently match solved-paper content.
- An answer claim from a private source is not verified until reviewed. Keep disputed answer evidence and references.
- Do not publish a question with a pending or disputed answer into a scored test. Handle dropped/multiple-correct questions with explicit grading rules.
- Historical papers retain their actual question counts/patterns. New complete mock blueprints use 50 Paper I + 100 Paper II questions over 180 minutes. Geography-only 100-question/120-minute mode is a platform practice configuration, not an official separate Paper II time allotment.

## 6. Main routes

### Student (`localhost:3000`)

- `/` – overview
- `/pyq` – published question browsing, filters, answer reveal and bookmarks
- `/tests` – Geography-only, full UGC NET and custom timed CBT; test attempts require enough verified, published questions
- `/analytics` – PYQ frequency and historical trend analysis from source appearances
- `/performance` – personal performance derived from completed attempts
- `/revision` – bookmarks and mistake notebook entry point
- `/auth` – email/password and Google OAuth UI

### Admin (`localhost:3001`)

- `/` – admin dashboard
- `/imports` – vendor ZIP upload, validation and import history
- `/imports/[packageId]` – ordered question preview in private staging
- `/review` – three-panel review/editor workspace with rich explanation editor
- `/questions` – question bank management shell
- `/syllabus` – Geography and Paper I taxonomy viewer
- `/settings` – roles/security guidance
- `/auth` – admin sign in

## 7. Validation helpers

```bash
npm run validate:question -- examples/question-record.example.json
```

This validates structural fields only. It does not verify source authenticity, taxonomy correctness, translations, or answer correctness.

## 8. Important production work remaining

Before real candidates use the platform:

1. Complete canonical-question promotion from package staging, including safe retries, provenance links and language-specific external question codes.
2. Verify question revision snapshots and approval actions with real Supabase accounts and RLS.
3. Test the student CBT client against the server-authoritative `start_test_attempt`, response-save, `submit_test_attempt` and post-submit review RPCs. Never let the browser submit or read test answer keys.
4. Test the student PYQ reveal interface against the `get_practice_answer` RPC and active-test access checks.
5. Replace remaining demo data with reviewed, licensed content; validate student library and dashboard queries.
6. Complete the bilingual content review and explanation workflow without overwriting independently edited Hindi.
7. Add import correction/supersession tools, resilient batch recovery and a full audit trail for large vendor deliveries.
8. Run security review, RLS tests, accessibility checks, load tests and production backups.

This repository is a runnable foundation and first-pass interface, not a claim that the entire production product or the 2014–2026 dataset is already complete.

## 9. Pilot validation

The older [`docs/PILOT_VALIDATION.md`](docs/PILOT_VALIDATION.md) document records a historical PDF workflow test. That workflow is retired and is not part of the current vendor JSON ingestion pipeline.
