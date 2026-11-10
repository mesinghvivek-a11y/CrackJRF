import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

type JsonObject = Record<string, unknown>;
type ZipEntryMap = Map<string, Buffer>;

const MAX_ENTRIES = 5000;
const MAX_UNCOMPRESSED_TOTAL = 400 * 1024 * 1024;
const MAX_UNCOMPRESSED_ENTRY = 150 * 1024 * 1024;
const FORBIDDEN_TAXONOMY_KEYS = new Set([
  'classification', 'classifications', 'syllabus', 'syllabus_tags',
  'keywords', 'keyword_tags', 'topics', 'subtopics', 'units', 'unit_tags',
]);
const SOURCE_ROLES = new Set([
  'official_question_paper', 'official_provisional_answer_key',
  'official_final_answer_key', 'official_revised_answer_key',
  'private_solved_paper', 'supplementary_reference',
]);
const QUESTION_TYPES = new Set([
  'single_mcq', 'multiple_correct_mcq', 'comprehension_mcq', 'table_mcq',
  'image_mcq', 'map_mcq', 'matching_mcq', 'other_mcq',
]);
const OPTION_KEYS = ['A', 'B', 'C', 'D'];

export type ValidatedPackageQuestion = {
  base_question_id: string;
  language_question_codes: { en: string; hi?: string | null };
  order_index: number;
  original_question_number: string;
  question_type: string;
  common_data: JsonObject;
  english_data: JsonObject;
  hindi_data: JsonObject | null;
};

export type ValidatedQuestionPackage = {
  manifest: JsonObject;
  qaReport: JsonObject;
  common: JsonObject;
  english: JsonObject;
  hindi: JsonObject | null;
  assets: JsonObject;
  questions: ValidatedPackageQuestion[];
  warnings: string[];
  archiveSha256: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown, label: string): JsonObject {
  assert(isObject(value), `${label} must be a JSON object.`);
  return value;
}

function asArray(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  return value;
}

function asString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string.`);
  return value;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function safeArchivePath(raw: string): string {
  const normalized = raw.replace(/\\/g, '/');
  assert(!normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized), `Unsafe ZIP path: ${raw}`);
  const pieces = normalized.split('/').filter((part) => part.length > 0 && part !== '.');
  assert(pieces.length > 0 && pieces.every((part) => part !== '..'), `Unsafe ZIP path: ${raw}`);
  return pieces.join('/');
}

function unzipToMap(archive: Buffer): ZipEntryMap {
  assert(archive.length >= 22, 'The selected file is not a valid ZIP archive.');
  let eocd = -1;
  const searchStart = Math.max(0, archive.length - 22 - 65535);
  for (let offset = archive.length - 22; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  assert(eocd >= 0, 'ZIP end-of-central-directory record is missing.');
  assert(archive.readUInt16LE(eocd + 4) === 0 && archive.readUInt16LE(eocd + 6) === 0, 'Multi-disk ZIP files are not supported.');
  assert(eocd + 22 + archive.readUInt16LE(eocd + 20) === archive.length, 'ZIP end record comment length is invalid.');
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  assert(archive.readUInt16LE(eocd + 8) === entryCount, 'Multi-disk ZIP entry counts are not supported.');
  assert(entryCount > 0 && entryCount <= MAX_ENTRIES, `ZIP must contain between 1 and ${MAX_ENTRIES} entries.`);
  assert(centralOffset + centralSize <= archive.length, 'ZIP central directory is outside the archive.');

  const files: ZipEntryMap = new Map();
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    assert(cursor + 46 <= archive.length && archive.readUInt32LE(cursor) === 0x02014b50, 'ZIP central directory is malformed.');
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const rawName = nameBytes.toString((flags & 0x0800) ? 'utf8' : 'utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    assert((flags & 0x0001) === 0, `Encrypted ZIP entry is not supported: ${rawName}`);
    assert(compressedSize !== 0xffffffff && uncompressedSize !== 0xffffffff && localOffset !== 0xffffffff, 'ZIP64 archives are not supported; ask the provider to create a standard ZIP.');
    const mode = externalAttributes >>> 16;
    assert((mode & 0o170000) !== 0o120000, `Symbolic links are not accepted in ZIP packages: ${rawName}`);
    const normalizedName = safeArchivePath(rawName);
    if (rawName.endsWith('/') || rawName.endsWith('\\')) continue;
    assert(!files.has(normalizedName), `ZIP contains a duplicate path: ${normalizedName}`);
    assert(uncompressedSize <= MAX_UNCOMPRESSED_ENTRY, `ZIP entry is too large: ${normalizedName}`);
    totalUncompressed += uncompressedSize;
    assert(totalUncompressed <= MAX_UNCOMPRESSED_TOTAL, 'Expanded ZIP size exceeds the 400 MB safety limit.');

    assert(localOffset + 30 <= archive.length && archive.readUInt32LE(localOffset) === 0x04034b50, `ZIP local header is missing for ${normalizedName}.`);
    assert(archive.readUInt16LE(localOffset + 6) === flags && archive.readUInt16LE(localOffset + 8) === method, `ZIP local and central metadata disagree for ${normalizedName}.`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    assert(dataOffset + compressedSize <= archive.length, `ZIP entry data is truncated: ${normalizedName}`);
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    let content: Buffer;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) {
      content = inflateRawSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_ENTRY });
    } else fail(`Unsupported ZIP compression method ${method} for ${normalizedName}.`);
    assert(content.length === uncompressedSize, `Uncompressed size check failed for ${normalizedName}.`);
    assert(crc32(content) === expectedCrc, `CRC check failed for ${normalizedName}.`);
    files.set(normalizedName, content);
  }
  assert(cursor === centralOffset + centralSize, 'ZIP central directory length is inconsistent.');
  return files;
}

function parseJson(files: ZipEntryMap, path: string): JsonObject {
  const buffer = files.get(path);
  assert(buffer, `Required package file is missing: ${path}`);
  try {
    return asObject(JSON.parse(buffer.toString('utf8')) as unknown, path);
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} contains invalid JSON: ${error.message}`);
    throw error;
  }
}

function normalizePackageRoot(files: ZipEntryMap): ZipEntryMap {
  if (files.has('manifest.json')) return files;
  const manifestPaths = [...files.keys()].filter((path) => path.endsWith('/manifest.json'));
  assert(manifestPaths.length === 1, 'ZIP must contain manifest.json at its root or inside one enclosing folder.');
  const prefix = manifestPaths[0].slice(0, -'manifest.json'.length);
  const normalized: ZipEntryMap = new Map();
  for (const [path, content] of files) {
    assert(path.startsWith(prefix), 'ZIP must contain one package folder only; unrelated top-level files were found.');
    const relative = path.slice(prefix.length);
    if (relative) normalized.set(relative, content);
  }
  return normalized;
}

function assertPackageId(file: JsonObject, expected: string, label: string): void {
  assert(file.schema_version === '1.0.0', `${label} schema_version must be 1.0.0.`);
  assert(file.package_id === expected, `${label} package_id does not match manifest.json.`);
}

function rejectProviderTaxonomy(question: JsonObject, label: string): void {
  for (const key of Object.keys(question)) {
    assert(!FORBIDDEN_TAXONOMY_KEYS.has(key.toLowerCase()), `${label} contains provider syllabus field "${key}". Syllabus tagging belongs in CrackJRF.`);
  }
}

function requireArrayKeys(optionsValue: unknown, label: string): JsonObject[] {
  const options = asArray(optionsValue, label).map((option, index) => asObject(option, `${label}[${index + 1}]`));
  assert(options.length === 4, `${label} must contain exactly four options (A–D).`);
  const keys = options.map((option) => option.key);
  assert(keys.every((key, index) => key === OPTION_KEYS[index]), `${label} must be in A, B, C, D order.`);
  return options;
}

function validatePackage(filesInput: ZipEntryMap, archiveSha256: string): ValidatedQuestionPackage {
  const files = normalizePackageRoot(filesInput);
  const requiredFiles = [
    'manifest.json', 'questions_common.json', 'questions_en.json',
    'qa_report.json', 'checksums.sha256', 'assets/asset_manifest.json',
  ];
  for (const path of requiredFiles) assert(files.has(path), `Required package file is missing: ${path}`);

  const manifest = parseJson(files, 'manifest.json');
  assert(manifest.schema_name === 'crackjrf-question-package', 'Unsupported manifest schema_name.');
  assert(manifest.schema_version === '1.0.0', 'Only import package schema version 1.0.0 is supported.');
  assert(typeof manifest.generated_at === 'string' && !Number.isNaN(Date.parse(manifest.generated_at)), 'manifest.generated_at must be a valid date-time.');
  assert(['complete', 'partial'].includes(String(manifest.delivery_status)), 'manifest.delivery_status must be complete or partial.');
  const packageId = asString(manifest.package_id, 'manifest.package_id');
  assert(/^[A-Z0-9][A-Z0-9_-]{5,90}$/.test(packageId), 'manifest.package_id has an invalid format.');

  const exam = asObject(manifest.exam, 'manifest.exam');
  assert(exam.name === 'UGC NET' && exam.conducting_body === 'NTA', 'This importer accepts UGC NET / NTA packages only.');
  assert(['I', 'II'].includes(String(exam.paper)), 'manifest.exam.paper must be I or II.');
  assert(Number.isInteger(exam.year) && Number(exam.year) >= 2014 && Number(exam.year) <= 2100, 'manifest.exam.year is invalid.');
  assert(['June', 'December', 'Other'].includes(String(exam.session)), 'manifest.exam.session must be June, December or Other.');
  const subjectCode = asString(exam.subject_code, 'manifest.exam.subject_code');
  if (exam.paper === 'I') assert(subjectCode === '00', 'Paper I package subject_code must be 00.');
  else assert(subjectCode !== '00', 'Paper II packages require a subject-specific code, not 00.');
  asString(exam.subject_name, 'manifest.exam.subject_name');

  const assetDirectory = asObject(manifest.assets, 'manifest.assets');
  assert(assetDirectory.directory === 'assets/' && assetDirectory.inventory === 'assets/asset_manifest.json', 'manifest.assets must point to assets/asset_manifest.json.');
  const manifestFiles = asObject(manifest.files, 'manifest.files');
  assert(manifestFiles.common === 'questions_common.json' && manifestFiles.en === 'questions_en.json', 'manifest.files must identify the common and English question files.');
  assert(manifestFiles.qa_report === 'qa_report.json' && manifestFiles.asset_manifest === 'assets/asset_manifest.json', 'manifest.files must identify the QA report and asset manifest.');
  const sequence = asObject(manifest.question_sequence, 'manifest.question_sequence');
  assert(sequence.source === 'official_nta_question_paper' && sequence.order_preserved === true && sequence.order_start === 1, 'Question sequence must be preserved from the official NTA paper and start at 1.');
  const languages = asObject(manifest.languages, 'manifest.languages');
  assert(languages.primary === 'en', 'English must be the package primary language for this release.');
  const availableLanguages = asArray(languages.available, 'manifest.languages.available').map(String);
  assert(availableLanguages.includes('en') && availableLanguages.every((language) => language === 'en' || language === 'hi'), 'manifest.languages.available must include en and may include hi.');

  const common = parseJson(files, 'questions_common.json');
  const english = parseJson(files, 'questions_en.json');
  const qaReport = parseJson(files, 'qa_report.json');
  const assets = parseJson(files, 'assets/asset_manifest.json');
  assertPackageId(common, packageId, 'questions_common.json');
  assertPackageId(english, packageId, 'questions_en.json');
  assertPackageId(qaReport, packageId, 'qa_report.json');
  assertPackageId(assets, packageId, 'assets/asset_manifest.json');
  assert(english.language === 'en', 'questions_en.json language must be en.');

  const hiPath = typeof manifest.files === 'object' && manifest.files !== null ? (manifest.files as JsonObject).hi : null;
  let hindi: JsonObject | null = null;
  if (availableLanguages.includes('hi')) {
    assert(hiPath === 'questions_hi.json' && files.has('questions_hi.json'), 'Hindi is listed as available, but questions_hi.json is missing.');
    hindi = parseJson(files, 'questions_hi.json');
    assertPackageId(hindi, packageId, 'questions_hi.json');
    assert(hindi.language === 'hi', 'questions_hi.json language must be hi.');
  } else {
    assert(hiPath === null && !files.has('questions_hi.json'), 'Hindi file must be omitted when Hindi is not listed in manifest.languages.available.');
  }

  const sourceDocuments = asArray(manifest.source_documents, 'manifest.source_documents').map((item, index) => asObject(item, `manifest.source_documents[${index + 1}]`));
  assert(sourceDocuments.length > 0, 'At least one source document reference is required.');
  const sourceIds = new Set<string>();
  const sourceRoles = new Map<string, string>();
  for (const source of sourceDocuments) {
    const sourceId = asString(source.source_document_id, 'source_document_id');
    assert(!sourceIds.has(sourceId), `Duplicate source_document_id: ${sourceId}`);
    sourceIds.add(sourceId);
    assert(SOURCE_ROLES.has(String(source.role)), `Unsupported source role for ${sourceId}.`);
    sourceRoles.set(sourceId, String(source.role));
    asString(source.filename, `source_documents[${sourceId}].filename`);
    assert(typeof source.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(source.sha256), `Source ${sourceId} has an invalid SHA-256.`);
  }

  const commonQuestions = asArray(common.questions, 'questions_common.questions').map((item, index) => asObject(item, `common question ${index + 1}`));
  const englishQuestions = asArray(english.questions, 'questions_en.questions').map((item, index) => asObject(item, `English question ${index + 1}`));
  const hindiQuestions = hindi ? asArray(hindi.questions, 'questions_hi.questions').map((item, index) => asObject(item, `Hindi question ${index + 1}`)) : [];
  assert(commonQuestions.length > 0, 'The package contains no questions.');
  assert(Number(sequence.total_questions) === commonQuestions.length, 'manifest.question_sequence.total_questions does not match questions_common.json.');
  assert(englishQuestions.length === commonQuestions.length, 'Every common question must have one English translation.');
  assert(hindiQuestions.length === 0 || hindiQuestions.length === commonQuestions.length, 'Hindi file must contain one translation for every common question.');

  const englishById = new Map(englishQuestions.map((question) => [String(question.base_question_id), question]));
  const hindiById = new Map(hindiQuestions.map((question) => [String(question.base_question_id), question]));
  assert(englishById.size === englishQuestions.length && hindiById.size === hindiQuestions.length, 'Duplicate base_question_id found in a language file.');

  const assetList = asArray(assets.assets, 'assets/asset_manifest.assets').map((item, index) => asObject(item, `asset ${index + 1}`));
  const assetById = new Map<string, JsonObject>();
  for (const asset of assetList) {
    const assetId = asString(asset.asset_id, 'asset.asset_id');
    assert(!assetById.has(assetId), `Duplicate asset_id: ${assetId}`);
    assetById.set(assetId, asset);
    asString(asset.base_question_id, `asset ${assetId}.base_question_id`);
    assert(['en', 'hi', 'shared'].includes(String(asset.language)), `Asset ${assetId} has an invalid language.`);
    assert(['image/png', 'image/jpeg', 'image/webp'].includes(String(asset.mime_type)), `Asset ${assetId} has an unsupported MIME type.`);
    assert(typeof asset.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(asset.sha256), `Asset ${assetId} has an invalid SHA-256.`);
    const filename = asString(asset.filename, `asset ${assetId}.filename`);
    const assetPath = filename.startsWith('assets/') ? filename : `assets/${filename}`;
    const assetBytes = files.get(safeArchivePath(assetPath));
    assert(assetBytes, `Asset file is missing from ZIP: ${assetPath}`);
    assert(sha256(assetBytes).toLowerCase() === String(asset.sha256).toLowerCase(), `Asset SHA-256 mismatch: ${assetPath}`);
    assert(Number.isInteger(asset.width_px) && Number(asset.width_px) > 0 && Number.isInteger(asset.height_px) && Number(asset.height_px) > 0, `Asset ${assetId} has invalid dimensions.`);
  }

  const validatedQuestions: ValidatedPackageQuestion[] = [];
  const baseIds = new Set<string>();
  const languageCodes = new Set<string>();
  for (let index = 0; index < commonQuestions.length; index += 1) {
    const commonQuestion = commonQuestions[index];
    rejectProviderTaxonomy(commonQuestion, `Common question ${index + 1}`);
    const baseId = asString(commonQuestion.base_question_id, `Question ${index + 1} base_question_id`);
    assert(/^[A-Z0-9][A-Z0-9._-]{4,79}$/.test(baseId), `Invalid base_question_id: ${baseId}`);
    assert(!baseIds.has(baseId), `Duplicate base_question_id: ${baseId}`);
    baseIds.add(baseId);
    assert(Number(commonQuestion.order_index) === index + 1, `Question order_index must be sequential. Expected ${index + 1} for ${baseId}.`);
    const originalNumber = asString(commonQuestion.original_question_number, `${baseId}.original_question_number`);
    assert(QUESTION_TYPES.has(String(commonQuestion.question_type)), `${baseId} has an unsupported question_type.`);
    const codes = asObject(commonQuestion.language_question_codes, `${baseId}.language_question_codes`);
    const englishCode = asString(codes.en, `${baseId}.language_question_codes.en`);
    assert(englishCode === `${baseId}E` && !languageCodes.has(englishCode), `${baseId} English language code must be ${baseId}E and must be unique.`);
    languageCodes.add(englishCode);
    if (hindi) {
      const hindiCode = asString(codes.hi, `${baseId}.language_question_codes.hi`);
      assert(hindiCode === `${baseId}H` && !languageCodes.has(hindiCode), `${baseId} Hindi language code must be ${baseId}H and must be unique.`);
      languageCodes.add(hindiCode);
    } else assert(codes.hi === null || codes.hi === undefined, `${baseId} has a Hindi code although this package has no Hindi translation.`);

    const commonOptions = requireArrayKeys(commonQuestion.options, `${baseId}.options`);
    const optionIds = new Set<string>();
    for (const option of commonOptions) {
      const optionId = asString(option.option_id, `${baseId}.option_id`);
      assert(!optionIds.has(optionId), `${baseId} contains duplicate option_id ${optionId}.`);
      optionIds.add(optionId);
    }

    const answer = asObject(commonQuestion.answer, `${baseId}.answer`);
    assert(['single_correct', 'multiple_correct', 'all_options_correct', 'dropped', 'unknown'].includes(String(answer.resolution)), `${baseId} has an invalid answer resolution.`);
    assert(['provided', 'unavailable', 'ambiguous'].includes(String(answer.provider_status)), `${baseId} has an invalid provider_status.`);
    const claimedKeys = asArray(answer.proposed_correct_option_keys, `${baseId}.proposed_correct_option_keys`).map(String);
    assert(claimedKeys.every((key) => OPTION_KEYS.includes(key)), `${baseId} contains an invalid proposed answer key.`);
    for (const evidenceValue of asArray(answer.evidence, `${baseId}.answer.evidence`)) {
      const evidence = asObject(evidenceValue, `${baseId}.answer.evidence item`);
      const evidenceSourceId = String(evidence.source_document_id);
      assert(sourceIds.has(evidenceSourceId), `${baseId} answer evidence references an unknown source document.`);
      assert(evidence.source_role === sourceRoles.get(evidenceSourceId), `${baseId} answer evidence source role does not match the manifest for ${evidenceSourceId}.`);
    }
    const refs = asArray(commonQuestion.source_references, `${baseId}.source_references`);
    assert(refs.length > 0, `${baseId} must include at least one source reference.`);
    for (const refValue of refs) {
      const ref = asObject(refValue, `${baseId}.source reference`);
      const referenceSourceId = String(ref.source_document_id);
      assert(sourceIds.has(referenceSourceId), `${baseId} references an unknown source document.`);
      assert(ref.source_role === sourceRoles.get(referenceSourceId), `${baseId} source role does not match the manifest for ${referenceSourceId}.`);
      assert(['provider_matched', 'unresolved'].includes(String(ref.match_status)), `${baseId} has an invalid source match status.`);
    }
    const mediaIds = asArray(commonQuestion.media_asset_ids, `${baseId}.media_asset_ids`).map(String);
    for (const assetId of mediaIds) assert(assetById.has(assetId), `${baseId} references missing media asset ${assetId}.`);

    const englishQuestion = englishById.get(baseId);
    assert(englishQuestion, `English translation is missing for ${baseId}.`);
    rejectProviderTaxonomy(englishQuestion, `English question ${baseId}`);
    assert(englishQuestion.language_question_code === englishCode, `${baseId} English language_question_code does not match common data.`);
    assert(asArray(englishQuestion.question_blocks, `${baseId} English question_blocks`).length > 0, `${baseId} English question content is empty.`);
    const englishCrop = englishQuestion.question_crop_asset_id;
    if (englishCrop !== null && englishCrop !== undefined) assert(assetById.has(String(englishCrop)), `${baseId} English question crop references a missing asset.`);
    for (const mediaId of asArray(englishQuestion.media_asset_ids, `${baseId} English media_asset_ids`).map(String)) assert(assetById.has(mediaId), `${baseId} English data references missing asset ${mediaId}.`);
    const englishOptions = requireArrayKeys(englishQuestion.options, `${baseId} English options`);
    for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
      assert(englishOptions[optionIndex].option_id === commonOptions[optionIndex].option_id && englishOptions[optionIndex].key === commonOptions[optionIndex].key, `${baseId} English option identities/order do not match common data.`);
      assert(asArray(englishOptions[optionIndex].content_blocks, `${baseId} option ${OPTION_KEYS[optionIndex]} content_blocks`).length > 0, `${baseId} English option ${OPTION_KEYS[optionIndex]} is empty.`);
    }

    const hindiQuestion = hindiById.get(baseId) ?? null;
    if (hindi) {
      assert(hindiQuestion, `Hindi translation is missing for ${baseId}.`);
      rejectProviderTaxonomy(hindiQuestion, `Hindi question ${baseId}`);
      assert(hindiQuestion.language_question_code === codes.hi, `${baseId} Hindi language_question_code does not match common data.`);
      assert(asArray(hindiQuestion.question_blocks, `${baseId} Hindi question_blocks`).length > 0, `${baseId} Hindi question content is empty.`);
      const hindiCrop = hindiQuestion.question_crop_asset_id;
      if (hindiCrop !== null && hindiCrop !== undefined) assert(assetById.has(String(hindiCrop)), `${baseId} Hindi question crop references a missing asset.`);
      for (const mediaId of asArray(hindiQuestion.media_asset_ids, `${baseId} Hindi media_asset_ids`).map(String)) assert(assetById.has(mediaId), `${baseId} Hindi data references missing asset ${mediaId}.`);
      const hindiOptions = requireArrayKeys(hindiQuestion.options, `${baseId} Hindi options`);
      for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) {
        assert(hindiOptions[optionIndex].option_id === commonOptions[optionIndex].option_id && hindiOptions[optionIndex].key === commonOptions[optionIndex].key, `${baseId} Hindi option identities/order do not match common data.`);
        assert(asArray(hindiOptions[optionIndex].content_blocks, `${baseId} Hindi option ${OPTION_KEYS[optionIndex]} content_blocks`).length > 0, `${baseId} Hindi option ${OPTION_KEYS[optionIndex]} is empty.`);
      }
    }

    validatedQuestions.push({
      base_question_id: baseId,
      language_question_codes: { en: englishCode, ...(hindi ? { hi: String(codes.hi) } : {}) },
      order_index: index + 1,
      original_question_number: originalNumber,
      question_type: String(commonQuestion.question_type),
      common_data: commonQuestion,
      english_data: englishQuestion,
      hindi_data: hindiQuestion,
    });
  }

  for (const asset of assetList) assert(baseIds.has(String(asset.base_question_id)), `Asset ${String(asset.asset_id)} is linked to an unknown base_question_id.`);
  for (const entry of [...englishQuestions, ...hindiQuestions]) {
    const questionLabel = String(entry.base_question_id);
    const blockGroups: unknown[][] = [
      asArray(entry.question_blocks, `${questionLabel} question_blocks`),
      Array.isArray(entry.instructions_blocks) ? entry.instructions_blocks : [],
      ...asArray(entry.options, `${questionLabel} options`).map((value) => asArray(asObject(value, 'localized option').content_blocks, `${questionLabel} option content_blocks`)),
    ];
    const explanation = asObject(entry.explanation, `${questionLabel} explanation`);
    blockGroups.push(asArray(explanation.detailed_blocks, `${questionLabel} explanation detailed_blocks`));
    for (const blocks of blockGroups) {
      for (const blockValue of blocks) {
        const block = asObject(blockValue, 'content block');
        if (block.type === 'image' && typeof block.asset_id === 'string') assert(assetById.has(block.asset_id), `Content block references missing asset ${block.asset_id}.`);
      }
    }
  }

  assert(Number(qaReport.delivered_question_count) === commonQuestions.length, 'QA delivered_question_count does not match the delivered question data.');
  assert(Number(qaReport.english_count) === englishQuestions.length, 'QA english_count does not match questions_en.json.');
  assert(Number(qaReport.four_option_complete_count) === commonQuestions.length, 'QA four_option_complete_count must equal the delivered question count.');
  assert(qaReport.question_order_preserved === true, 'QA report must confirm that original NTA order was preserved.');
  assert(Number(qaReport.official_question_count) >= Number(qaReport.delivered_question_count), 'QA official_question_count cannot be lower than delivered_question_count.');
  if (qaReport.hindi_count !== undefined) assert(Number(qaReport.hindi_count) === hindiQuestions.length, 'QA hindi_count does not match questions_hi.json.');

  const checksumText = String(files.get('checksums.sha256')!.toString('utf8'));
  const checksumLines = checksumText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert(checksumLines.length > 0, 'checksums.sha256 is empty.');
  const checkedPaths = new Set<string>();
  for (const line of checksumLines) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    assert(match, `Invalid checksums.sha256 line: ${line.slice(0, 100)}`);
    const expectedHash = match[1].toLowerCase();
    const path = safeArchivePath(match[2].replace(/^\.\//, ''));
    const bytes = files.get(path);
    assert(bytes, `checksums.sha256 references a missing file: ${path}`);
    assert(sha256(bytes).toLowerCase() === expectedHash, `Checksum mismatch for ${path}.`);
    checkedPaths.add(path);
  }
  for (const path of ['manifest.json', 'questions_common.json', 'questions_en.json', 'qa_report.json', 'assets/asset_manifest.json']) {
    assert(checkedPaths.has(path), `checksums.sha256 does not include ${path}.`);
  }
  if (hindi) assert(checkedPaths.has('questions_hi.json'), 'checksums.sha256 does not include questions_hi.json.');

  const qaExceptions = Array.isArray(qaReport.exceptions) ? qaReport.exceptions.length : 0;
  const warnings: string[] = [];
  if (manifest.delivery_status === 'partial') warnings.push('Provider marked this package as partial.');
  if (qaExceptions > 0) warnings.push(`${qaExceptions} provider QA exception(s) need manual review.`);
  if (refsUnresolved(commonQuestions)) warnings.push('One or more supporting source references remain unresolved.');

  return { manifest, qaReport, common, english, hindi, assets, questions: validatedQuestions, warnings, archiveSha256 };
}

function refsUnresolved(questions: JsonObject[]): boolean {
  return questions.some((question) => Array.isArray(question.source_references)
    && (question.source_references as unknown[]).some((reference) => isObject(reference) && reference.match_status === 'unresolved'));
}

export function inspectQuestionPackage(archive: Buffer): ValidatedQuestionPackage {
  const archiveSha256 = sha256(archive);
  const files = unzipToMap(archive);
  return validatePackage(files, archiveSha256);
}
