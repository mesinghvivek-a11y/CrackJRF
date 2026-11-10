# UGC NET Prep Platform

Monorepo starter for a multi-subject UGC NET preparation product, with Geography (Paper II, subject code 80) as the first subject and Paper I (code 00) represented as a separate shared subject/module.

## What is included

- `apps/student`: student-facing Next.js app (PYQ browsing, answer reveal, bookmarks, practice/full mock test flows, personal performance, static PYQ analytics and authentication).
- `apps/admin`: separate private Next.js admin app (dashboard, PDF registration/upload, extraction staging queue, combined Paper I + Paper II source assignment, three-panel review workspace, rich explanation editor, question table, syllabus viewer, roles/settings).
- `packages/shared`: shared TypeScript models, test blueprints, demo data and expanded Geography/Paper I syllabus JSON.
- `supabase/migrations`: PostgreSQL schema, row-level security, private storage buckets, controlled answer reveal RPC, admin roles and test data tables.
- `scripts/extract_pdf.py`: page-aware PDF text extraction and OCR into a review-only JSON format.
- `scripts/match_solved_papers.py`: content-based candidate matching between separate official and solved-paper extractions; never auto-verifies answers.
- `scripts/seed-syllabus.ts`: seeds subjects, syllabus versions/nodes and initial test blueprints.
- `scripts/import-extraction.ts`: uploads OCR extraction JSON into the private database staging tables; candidates remain unverified.

The repository is an implementation foundation with Supabase-backed API paths where credentials are configured. It does not contain the real 2014–2026 question dataset, and the demo questions are synthetic. PDF OCR/extraction remains a local operator-run process; extracted candidates must be checked and edited in the Admin Panel. Dependency installation, a production build, SQL execution and end-to-end Supabase verification must be completed in your environment before launch.

## Requirements

- Node.js 20.9 or later (Node 22 recommended).
- npm 10+.
- Python 3.10+ for PDF processing.
- Tesseract OCR with English and Hindi language data (`eng`, `hin`). The script will fall back to English if the requested language pack is unavailable.
- A Supabase project for shared auth, PostgreSQL and private file storage.

## 1. Install dependencies

From the repository root:

```bash
npm install
```

For PDF processing:

```bash
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r scripts/requirements.txt
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

Run `supabase/migrations/0001_initial_schema.sql` in the Supabase SQL Editor, or use the Supabase CLI from a linked local project. It creates the schema, RLS policies, `source-pdfs` and `question-assets` private buckets, and the `get_practice_answer` RPC.

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

## 4. PDF ingestion workflow

The official NTA question paper is the primary source for question wording, options, original question number, NTA question ID when present, language versions and paper metadata. Private solved PDFs are supporting evidence only. Never match by source question number or page position alone.

Run the extractor on an official paper:

```bash
python scripts/extract_pdf.py \
  /path/to/official-paper.pdf \
  --out imports/ocr \
  --source-type nta_official \
  --subject-code 80 \
  --paper 0 \
  --year 2025 \
  --session June \
  --lang eng+hin
```

Use `--paper 0` for a combined official PDF containing both Paper I and Paper II. The extractor makes a page-level paper assignment from exact section headings when it can; this is a heuristic, not a trusted classification. Verify or correct every staging item in Admin → Review before creating the canonical question. For a single-paper file, use `--paper 1` or `--paper 2`.

Run it separately on the private solved paper:

```bash
python scripts/extract_pdf.py \
  /path/to/private-solved-paper.pdf \
  --out imports/ocr \
  --source-type private_solution \
  --subject-code 80 \
  --paper 2 \
  --year 2025 \
  --session June \
  --lang eng+hin
```

Suggest possible content matches:

```bash
python scripts/match_solved_papers.py \
  imports/ocr/official-paper.extraction.json \
  imports/ocr/private-solved-paper.extraction.json \
  --out imports/ocr/match-suggestions.json
```

After the upload endpoint returns an `importJobId`, run OCR against the same source PDF locally. Then import the extraction JSON into the staging queue:

```bash
npm run import:extraction -- <IMPORT_JOB_UUID> imports/ocr/official-paper.extraction.json
```

Open Admin → Extraction Queue to inspect the staged OCR text. Selecting a candidate opens the review workspace. For combined PDFs, assign the candidate to Paper I or Paper II before creating/loading its canonical question. English and Hindi source candidates with the same exam appearance are linked to one platform question ID. A source page preview is generated with a short-lived signed URL for authorized administrators. The editor must clean the extracted stem/options, add syllabus classifications, verify the answer separately and save/submit the draft.

The extractor deliberately creates page-level candidate records where reliable question boundaries cannot be established. In the supplied 29 June 2025 Geography paper, the PDF text layer exposes metadata but key question statements are embedded in rendered page images. OCR and manual visual review are therefore required. All candidates must be segmented and checked against the original page images. The match tool only creates ranked suggestions; it does not verify answers, transfer answer keys or publish questions.

The web Admin PDF upload endpoint registers the private PDF in Storage and creates an `import_jobs` row. The local OCR scripts are run by an operator; a hosted background worker/queue is a later deployment task.

## 5. Question identity and content rules

- Use platform-owned canonical IDs (e.g. `GEO-Q-000001`, `P1-Q-000001`).
- Preserve NTA's question ID as optional source metadata, never as the primary key.
- Preserve each exam appearance separately (year, June/December/other, re-exam/special, paper, date, shift and original question number).
- English and Hindi are translations of one question, not separate question records.
- Ignore opaque NTA option IDs. Use local stable option keys A/B/C/D.
- A question can map to multiple units/topics, but overall unique-question totals and test selection must deduplicate by canonical question ID.
- Shared passages, tables and stimuli use question groups so related sub-questions can point to the same stimulus.
- Keep official and private source items separate. Match on question text and option content; reordered options do not change the meaning of an answer.
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
- `/imports` – PDF upload and source metadata
- `/staging` – database-backed extracted candidate queue
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

1. Complete and test the PDF worker queue and question-boundary segmentation, including bilingual page pairing, tables, comprehension stimuli, maps and diagrams.
2. Verify question revision snapshots and approval actions with real Supabase accounts and RLS.
3. Test the student CBT client against the server-authoritative `start_test_attempt`, response-save, `submit_test_attempt` and post-submit review RPCs. Never let the browser submit or read test answer keys.
4. Test the student PYQ reveal interface against the `get_practice_answer` RPC and active-test access checks.
5. Replace remaining demo data with reviewed, licensed content; validate student library and dashboard queries.
6. Implement stronger duplicate/near-duplicate matching, bilingual pairing, robust failure recovery and a hosted worker queue.
7. Add/verify an external OCR job runner for large batches; the current workflow runs extraction locally and imports the JSON to staging.
8. Run security review, RLS tests, accessibility checks, load tests and production backups.

This repository is a runnable foundation and first-pass interface, not a claim that the entire production product or the 2014–2026 dataset is already complete.

## 9. Pilot validation

See [`docs/PILOT_VALIDATION.md`](docs/PILOT_VALIDATION.md) for the combined-paper PDF smoke-test results and explicit validation limits. The sample page ranges demonstrated the Paper I / Geography page assignment, but no full 129-page extraction or question publication was performed.
