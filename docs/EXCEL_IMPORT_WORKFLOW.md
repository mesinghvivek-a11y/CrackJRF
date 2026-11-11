# CrackJRF Excel-first question intake and editorial workflow

## 1. Handoff rule

One `.xlsx` workbook per exam event/shift. Paper I and Paper II for that event may share one `Questions` worksheet. One row represents one logical question. Use the official question number as printed and a separate sequential `paper_order` within each paper/shift.

The current template is `public/templates/CrackJRF_Question_Import_Template_v2.xlsx`.

## 2. Source materials the external AI/provider receives

For each event, provide:

1. Official NTA bilingual paper (English + Hindi): controls question wording, options, original numbering and official sequence.
2. Institution solved paper (usually English): provides proposed correct option(s) and explanation, not authoritative question wording.
3. Official provisional/final/revised answer key, when available: final/revised official key has highest answer authority.
4. CrackJRF workbook template and relevant taxonomy tabs.

The provider records source filenames and page numbers in Exam Metadata/Questions. Enter `exam_date` as YYYY-MM-DD or use a normal Excel date cell; CrackJRF normalizes both forms. CrackJRF does not OCR, match or reconcile source PDFs. The provider is responsible for delivering a consolidated workbook, but all provider answers/classifications are still claims/suggestions until reviewed by CrackJRF.

## 3. Excel field guidance

- Required: `paper`, `subject_code`, `original_question_number`, `paper_order`, `question_type`, `question_english`, all four English options A-D.
- Paper I uses subject code `00`. Paper II uses the actual subject code (Geography `80`). `paper_ii_subject_code` is entered once in Exam Metadata and can be used as a default for Paper II rows.
- `correct_option` accepts A/B/C/D; multiple keys may be comma-separated. Blank is acceptable when unresolved.
- `answer_source_type`, `answer_source_title`, `answer_source_page`, `official_key_status`, match status/confidence and QA note preserve provenance.
- Use stable exact `unit_id`, `section_id`, `topic_id`, `subtopic_id`. Names alone do not create a classification. The staging editor can assign missing tags.
- Hindi Devanagari fields are optional. `*_hindi_official` fields are reserved for wording actually present in the official bilingual paper. Do not fill them with machine translations.
- Hinglish fields are optional Roman-script Hindi. They are distinct from official Hindi and remain drafts until reviewed.
- `media_required`, description and alt text flag image/map/diagram questions. Do not invent or redraw source diagrams in the workbook. Upload a source crop or explanatory media from the staging/editor UI.

The current canonical editor expects four A-D options. Other question types can be labelled for review, but non-four-option formats require a future format-specific editor before they can safely be promoted/published. Do not reshape them into fake MCQs.

## 4. Import and staging

1. Admin → Excel Import Centre downloads the current template and accepts one `.xlsx` file (25 MB maximum).
2. The browser sends the workbook to private Supabase Storage in the signed-in admin's folder.
3. The server validates ZIP/OpenXML structure, required sheets/headers, row count, metadata, paper codes, question order, English stem/options, answer key labels and references. It rejects an identical workbook hash already imported.
4. Each row is stored in `excel_import_rows` with original data, validation errors and warnings. This stage does not create a student-visible question.
5. In the batch editor, a Content Editor can correct row content, tags, Hindi/Hinglish and explanation text, upload images and save the row as in-review.
6. Only a Reviewer or Super Admin can mark the row reviewed. Reviewer/Super Admin can promote the reviewed row into the canonical Question Bank as a private draft.

## 5. Permanent identity and source integrity

CrackJRF generates the permanent question UUID and question code. English and Devanagari Hindi variants use the same logical question and have E/H language-specific codes. Hinglish is the Roman-script variant of Hindi, not a separate logical question. A-D option keys keep platform option UUIDs; a vendor row ID is only provenance and never a primary key.

Promotion records exam event/paper appearance, original question number, filenames/page references, match notes, proposed answer evidence, media references and an initial revision snapshot. A proposed answer is stored with `verification_status = unverified`; the canonical answer remains pending. No provider answer is auto-verified.

## 6. Hindi/Hinglish generation and editorial safeguards

The Admin can call the server-side translation endpoint to create a Hindi (Devanagari) or Hinglish (Roman script) draft from English. The endpoint does not solve the question. It returns text to the editor; it does not automatically save or publish it. The UI fills only blank target fields. Existing official Hindi or manually corrected text is never overwritten by a new generation.

Translation origin values: `official_source`, `ai_draft`, `manual`. English is the canonical content. Hindi and Hinglish question/option variants have independent `reviewed` flags. Explanations have independent `review_status`. Student APIs and test snapshots must return only reviewed language variants and verified explanation translations. English verification does not imply Hindi or Hinglish verification.

Configure `GEMINI_API_KEY` and `GEMINI_MODEL` only in the Admin server environment (Vercel project and local Admin `.env.local`, if used). Do not use `NEXT_PUBLIC_` prefixes and do not commit secrets. The model ID must be a model currently enabled for the selected Gemini API key; set it explicitly rather than relying on a stale hard-coded default.

## 7. Review, answer verification and publication

- Content Editor: edits draft content, options, tags and explanations; cannot mark a translation verified or publish.
- Reviewer: verifies content and language variants, classifies syllabus nodes, evaluates source evidence and verifies/corrects answer status; can promote a reviewed import row as a private draft.
- Super Admin: final approval and publication.
- A question cannot publish with unreviewed English stem/options, missing topic classification, pending/disputed answer, or missing verified answer record (unless explicitly dropped under a supported grading rule).
- Hindi/Hinglish fields remain unavailable to students until their independent review flags pass. Explanation translations remain unavailable until verified.
- Changes to published material must create revisions/audit records and never silently mutate historical test snapshots.

## 8. Images and rich explanations

The reviewer/editor can upload PNG/JPEG/WebP images up to 20 MB into the private `question-assets` bucket. Each asset has type, placement (`question` or `explanation`), caption, alt text and sort order. Student asset access is guarded by the question's published state. The rich explanation editor remains the place to add equations, tables, structured text, citations and image references. Keep appropriate source/licensing details with any imported or newly created visual.

## 9. Migration and validation

Apply migrations in order: 0001, 0002 (if not already applied), then 0003. Migration 0003 creates Excel staging, bilingual script/origin metadata, translation review fields, keywords, media placement and student-safe test snapshot behavior. Existing JSON import tables remain intact during the transition.

Before deployment, run:

```bash
npm run build:admin
npm run build:student
```

Then test with one synthetic/sample workbook: upload, correct a row, mark reviewed using a Reviewer/Super Admin account, promote as a draft, edit in `/review`, verify English, keep Hindi/Hinglish unreviewed, verify no student API exposure, then separately review a Hindi/Hinglish variant and verify its exposure. Finally test answer verification and Super Admin publication. Do not bulk-import real exam material until this flow passes.
