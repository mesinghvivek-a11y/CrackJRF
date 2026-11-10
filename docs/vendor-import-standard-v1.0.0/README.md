# CrackJRF Import Package Standard v1.0.0

This package is the vendor-facing JSON delivery contract and the implementation target for the CrackJRF Admin JSON import engine.

## Scope boundary

The third-party provider delivers the consolidated, ordered question data. The provider matches official NTA question papers with supplementary solved materials and preserves the official NTA question order. CrackJRF does **not** perform PDF OCR, PDF question segmentation, or third-party question matching.

CrackJRF is responsible for validating the delivered package, mapping it into the database, assigning syllabus units/topics/subtopics/keywords, reviewing content and answer evidence, approving and publishing questions.

## Package layout

```text
GEO_2024_JUNE_PAPER_II/
  manifest.json
  questions_common.json
  questions_en.json          # required for initial English release
  questions_hi.json          # optional now; can be delivered later
  qa_report.json
  checksums.sha256
  assets/
    asset_manifest.json
    questions/
    figures/
    maps/
    tables/
```

The provider should deliver one ZIP per examination paper / year / session / shift / re-examination event. A combined NTA file containing Paper I and Paper II must be delivered as two independently identified paper packages, unless the buyer requests a combined package explicitly.

## Responsibilities

### Provider
- Consolidate official NTA question wording/options with supplementary answers and explanations.
- Preserve the official NTA question sequence and exact printed question number.
- Provide 4 options in original order for each standard MCQ.
- Keep source evidence distinguishing official answer keys from private solved-paper claims.
- Maintain stable `base_question_id` values across English and Hindi.
- Use suffix `E` for English and `H` for Hindi language-specific codes.
- Supply image/diagram/map/table assets separately and reference them by `asset_id`.
- Supply QA report, file hashes and all unresolved exceptions.
- Do not supply syllabus classification, keywords, topic tags or internal database UUIDs.

### CrackJRF
- Validate package schema, checksums, cross-file links and question sequence.
- Create internal UUIDs and map external codes.
- Assign units, sections, topics, subtopics and keywords using the platform's syllabus taxonomy.
- Treat imported answers as unverified until reviewed by an authorized reviewer.
- Preserve source provenance and immutable import artifacts.
- Publish only after Super Admin approval.

## Identity rules

- `base_question_id` identifies the logical question independent of language.
- `language_question_code` is `base_question_id` + `E` for English or + `H` for Hindi.
- The same option IDs and A/B/C/D keys must occur in both language files.
- `order_index` is the sequential position in the original official NTA paper (1-based).
- `original_question_number` is the exact number printed by NTA. Do not silently renumber it.
- Do not merge merely similar questions. Exact repeated question content may share a logical identity only when the buyer/provider's ID registry confirms that match; each exam appearance must remain separately recorded.

## Source and answer rules

`questions_common.json` holds language-independent identity, option identity, answer claims and source references. `questions_en.json` and `questions_hi.json` hold language-specific question/options/explanation content.

The provider must not mark an answer as verified by CrackJRF. All imported claims become platform-side `pending/unverified` pending reviewer action.

Use `resolution: unknown`, an empty `proposed_correct_option_keys`, `provider_status: unavailable` when an answer cannot be reliably supplied. Never guess.

## Content blocks

Supported block types: `paragraph`, `ordered_list`, `unordered_list`, `table`, `image`, `equation`. Images are files, never Base64 in JSON. Content must be UTF-8 JSON, without comments or trailing commas.

## Media requirements

- PNG recommended for text, diagrams, maps and tables; JPEG/WebP permitted for photographic content.
- Aim for 300 DPI at original print dimensions where the source permits; do not artificially upscale and claim true high resolution.
- Full question crop should include all question text and its options when available.
- Longest edge target: 2000 px or higher where original source permits.
- Each asset must have a unique ID, relative path, dimensions, MIME type and SHA-256.

## Validation

Run the included validator from the package root:

```bash
python tools/validate_package.py examples/GEO_2024_JUNE_P2
```

The validator checks JSON syntax, required files, base ID pairing, E/H suffixes, order consistency, four options, option IDs/keys, source references, asset references, asset hashes and that no syllabus tags have been included. It does not decide whether an answer is academically correct.

## Versioning

Do not change a previously delivered base question ID in a language update or corrected delivery. Increment package `schema_version` only when the contract changes. Use a distinct package ID for a corrected delivery and indicate the superseded delivery in `delivery_notes` or a delivery manifest extension agreed with CrackJRF.
