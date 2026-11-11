# CrackJRF Fast Admin + Trusted Excel Workflow Patch v1.0

Built against the latest project snapshot supplied in this conversation (`crackjrf-latest 2.zip`). This is a source patch, not a deployment.

## Product behavior

- One `.xlsx` workbook per exam event/shift; Paper I and Paper II may be combined.
- Super Admin selects one workbook; the upload starts immediately.
- The workbook is treated as pre-checked provider content. The importer performs structural and database relationship checks, then publishes the complete batch in a single PostgreSQL transaction. There is no second manual answer-review/promotion/approval queue.
- Invalid workbook rows reject the entire batch; no partial canonical question batch is published.
- Admin can edit all published questions afterward using a compact English/Hindi editor.
- The editor has only two primary actions: Save Draft and Publish. Save Draft stores a private working copy; Publish applies all fields transactionally.
- Syllabus selection is a collapsible Unit → Section → Topic → Subtopic tree.
- Hindi can be provided in Excel or manually edited. No Hinglish or Gemini translation integration remains in active Admin/Student source.
- Source/answer provenance is retained in structured question appearance metadata and answer evidence.
- The Student Portal continues to consume only published questions and the normal canonical answer data.

## Files

- `patch/` contains the complete changed/new source files.
- `0004_trusted_excel_publish_and_fast_editor.sql` is included under `patch/supabase/migrations/`.
- `CrackJRF_Question_Import_Template_v3.xlsx` is included under `patch/public/templates/`.
- `CHANGED_FILES.txt` lists copied files.
- `REMOVED_FILES.txt` lists retired legacy routes/scripts/templates.
- `apply_patch.sh` backs up affected existing files under `/tmp`, copies the patch, and removes only the listed legacy files.

## Important scope/limitations

- Embedded images inside Excel drawing objects are not extracted by the `.xlsx` parser. The workbook may flag an image and describe it; attach the image later in the Admin editor using the private `question-assets` bucket.
- The importer currently supports `.xlsx`, not legacy binary `.xls`.
- Batch publication is performed by a database RPC. The HTTP import route creates a batch and staging rows first; the canonical question creation/publication itself is one atomic Postgres transaction. On RPC failure, the route attempts to delete the batch and cascading staging rows.
- The `source_documents` PDFs are represented by their filename/page provenance in the workbook metadata. This patch does not automatically upload/attach the vendor's source PDFs.
- This patch does not create real UGC NET question content. Use a controlled demo workbook first.

## Validation performed in the patch workspace

- 15 changed/added TypeScript/TSX files transpiled with TypeScript's syntax transpiler with no syntax diagnostics.
- `excel-workbook.ts` parsed a two-question test workbook (Paper I code `00` and Geography code `80`) with 7 expected sheets, zero row errors and zero warnings.
- Strict negative parser checks had previously rejected a blank QA flag, ambiguous match and low confidence.
- SQL migration delimiters/quotes/parentheses passed a lightweight lexical check.

## Not performed here

- Full Next.js production builds: this source ZIP had no `node_modules`; package installation was not available in this environment.
- PostgreSQL execution of migration 0004: no PostgreSQL client/server or SQL parser is available here. Run the migration in your Supabase project and inspect any error before deploying.
- Live Supabase import/publish test: requires your Supabase project and Super Admin session.

Do not treat the patch as production-ready until both builds, migration execution and controlled end-to-end testing have passed in Codespaces/Supabase.
