# CrackJRF trusted Excel import and fast editing workflow

## Product rule

A completed CrackJRF workbook is the trusted, pre-checked content handoff from the external AI/provider. CrackJRF performs structural and relationship validation, then publishes every row in a single database transaction. There is no second human answer-verification queue, reviewer queue, Hinglish variant, Gemini API, or separate promotion/approval stage.

The trusted workbook is expected to contain checked English questions, optional official Hindi question/options, four options, correct answer(s), explanations, event metadata, subject/paper identifiers, original order, syllabus IDs, keywords and source provenance.

## Import

1. Download `/templates/CrackJRF_Question_Import_Template_v3.xlsx` from the Admin Import Centre.
2. Prepare one workbook per exam event/shift. Paper I and Paper II may share the same `Questions` sheet.
3. Fill `Exam Metadata` and one row per question in `Questions`.
4. The Super Admin selects the `.xlsx` file. Selection starts upload, validation and publication automatically.
5. CrackJRF checks file type/size, required sheets/headers, exam metadata, subject mapping, question text, four English options, answer keys, paper order, duplicates, Hindi completeness, syllabus path, source provenance, exact/probable source matching, high/medium match confidence, explicit `qa_flag=none`, and official-key status.
6. If any row is structurally invalid, the complete workbook is rejected; no question is published. If it passes, the `publish_excel_import_batch` database function creates all canonical questions, translations, options, answers, classifications, appearances, evidence, assets/revisions and marks the batch complete in one database transaction.
7. The Admin receives the published question codes and can open any question for editing.

A successful import trusts the provider-supplied answer. The answer is recorded as accepted evidence and as the current answer key used by practice/tests. This is a product workflow decision, not a claim that CrackJRF independently verified the provider's academic work.

## Question editor

The editor presents English and Hindi side-by-side, with paired A–D option inputs and the answer selector directly below. Hindi is optional and can be supplied by Excel or edited manually. No automatic translation service is required. Hinglish/Roman Hindi is not supported.

The syllabus selector is a collapsible Unit → Section → Topic → Subtopic tree. English/Hindi explanations, option-wise explanations, references, images, source notes and original exam metadata are kept in collapsible advanced sections. Images are attached in the editor after import; the current `.xlsx` parser reads cell data and does not extract embedded Excel drawing objects.

The editor has exactly two primary actions:

- **Save Draft** stores a separate editable working copy; an existing published version remains live.
- **Publish** applies the current content, correct answer, classifications, explanation, source/evidence and assets in one database transaction and immediately updates the published Student Portal version after the database confirms success.

Changing the supplied answer is allowed. Publishing the change updates the answer used by future tests and creates a new revision/evidence record. No separate manual answer-verification step is imposed.

Basic data validation remains active: English stem, four English options, valid answer choice(s), subject and Unit/Section/Topic path must be valid before publishing. These are structural checks, not manual approval gates.

## Student visibility

The Student API serves only questions whose status is `published`, reviewed native English/Hindi variants, published assets, and the answer/explanation data available under the test/review rules. The database migration removes legacy Roman-script Hindi rows and prevents creating new Roman-script variants. Imported/published English and provided Hindi variants are marked available to students.

## Security and reliability

- Excel import and batch publishing are Super Admin-only.
- Editor Save Draft is available to authorized Admin roles; Publish is Super Admin-only.
- The batch publisher is a SECURITY DEFINER PostgreSQL function; canonical question creation and all question writes for a batch run inside one transaction.
- Duplicate workbook SHA-256 and duplicate exam appearance checks prevent accidental re-import.
- Storage remains private; question assets are exposed only for published questions through the Student API.
- A success notification is shown only after the database RPC returns success.
- Prior answer evidence and question revisions are preserved when an Admin changes a question.

## Migrations

Apply migrations in order only when not already applied: 0001, 0002, 0003, then 0004. Do not rerun earlier migrations that have already succeeded. Migration 0004 adds editor draft storage and the trusted batch/editor publish functions, removes legacy Roman-script Hindi variants, and enforces English/native plus Hindi/native only.

## Acceptance test

Use a small workbook containing one Paper I and one Geography Paper II sample. Confirm that both publish in one batch, appear in Question Bank, open in the compact bilingual editor, accept Save Draft, accept direct Publish, preserve the same canonical IDs, and display correctly in Student Portal. Test an invalid workbook and confirm no partial batch of questions is published. Do not treat synthetic questions as official PYQs.
