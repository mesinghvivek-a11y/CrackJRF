import { inflateRawSync } from 'node:zlib';

export type WorkbookSheet = { name: string; rows: Array<Record<string, unknown>> };
export type ParsedQuestionWorkbook = {
  metadata: Record<string, string>;
  questions: Array<Record<string, unknown>>;
  sheetNames: string[];
};

type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };
const MAX_ENTRIES = 250;
const MAX_UNCOMPRESSED = 30 * 1024 * 1024;
const MAX_ENTRY = 20 * 1024 * 1024;

function fail(message: string): never { throw new Error(message); }
function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  const start = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('This file is not a valid .xlsx workbook (ZIP directory not found).');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  let directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount < 1 || entryCount > MAX_ENTRIES) fail('Workbook contains an unsupported number of internal files.');
  if (directoryOffset + directorySize > buffer.length) fail('Workbook ZIP directory is corrupt.');
  const entries = new Map<string, Buffer>();
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(directoryOffset) !== 0x02014b50) fail('Workbook ZIP directory entry is invalid.');
    const flags = buffer.readUInt16LE(directoryOffset + 8);
    const method = buffer.readUInt16LE(directoryOffset + 10);
    const compressedSize = buffer.readUInt32LE(directoryOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(directoryOffset + 24);
    const nameLength = buffer.readUInt16LE(directoryOffset + 28);
    const extraLength = buffer.readUInt16LE(directoryOffset + 30);
    const commentLength = buffer.readUInt16LE(directoryOffset + 32);
    const localOffset = buffer.readUInt32LE(directoryOffset + 42);
    const name = buffer.toString('utf8', directoryOffset + 46, directoryOffset + 46 + nameLength).replace(/\\/g, '/');
    directoryOffset += 46 + nameLength + extraLength + commentLength;
    if (!name || name.startsWith('/') || name.split('/').includes('..')) fail('Workbook contains an unsafe internal path.');
    if ((flags & 1) !== 0) fail('Password-protected Excel workbooks are not supported.');
    if (method !== 0 && method !== 8) fail(`Unsupported compression method in workbook entry: ${name}`);
    if (uncompressedSize > MAX_ENTRY) fail(`Workbook entry is too large: ${name}`);
    totalSize += uncompressedSize;
    if (totalSize > MAX_UNCOMPRESSED) fail('Workbook expands beyond the 30 MB safety limit.');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail(`Invalid workbook entry header: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) fail(`Workbook entry is truncated: ${name}`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    const data = method === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY }) : Buffer.from(compressed);
    if (data.length !== uncompressedSize) fail(`Workbook entry size mismatch: ${name}`);
    entries.set(name, data);
  }
  return entries;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}
function attrs(source: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) output[match[1]] = decodeXml(match[2]);
  return output;
}
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? '';
  let result = 0;
  for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
  return result - 1;
}
function readTextTags(xml: string): string {
  return [...xml.matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('');
}
function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si(?:\s+[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => readTextTags(match[1]));
}
function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttrs = attrs(cellMatch[1]);
      const body = cellMatch[2] ?? '';
      const index = columnIndex(cellAttrs.r ?? '');
      if (index < 0 || index > 500) continue;
      let value = '';
      if (cellAttrs.t === 'inlineStr') value = readTextTags(body);
      else {
        const raw = body.match(/<v(?:\s+[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? '';
        if (cellAttrs.t === 's') value = sharedStrings[Number(raw)] ?? '';
        else if (cellAttrs.t === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else value = decodeXml(raw);
      }
      row[index] = value;
    }
    rows.push(row);
  }
  return rows;
}
function relationshipTarget(entries: Map<string, Buffer>, relationshipId: string): string {
  const xml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!xml) fail('Workbook relationship metadata is missing.');
  for (const match of xml.matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)) {
    const a = attrs(match[1]);
    if (a.Id === relationshipId && a.Target) {
      const target = a.Target.replace(/^\//, '');
      return target.startsWith('xl/') ? target : `xl/${target.replace(/^\.\//, '')}`;
    }
  }
  return fail(`Workbook worksheet relationship ${relationshipId} could not be resolved.`);
}
function loadSheets(entries: Map<string, Buffer>): Map<string, string[][]> {
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8');
  if (!workbook) fail('Workbook metadata is missing. Please upload a normal .xlsx file, not CSV renamed as Excel.');
  const shared = readSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'));
  const result = new Map<string, string[][]>();
  for (const match of workbook.matchAll(/<sheet\b([^>]*?)\/?\s*>/g)) {
    const a = attrs(match[1]);
    if (!a.name || !a['r:id']) continue;
    const target = relationshipTarget(entries, a['r:id']);
    const sheetXml = entries.get(target)?.toString('utf8');
    if (!sheetXml) fail(`Worksheet data is missing for ${a.name}.`);
    result.set(a.name, parseWorksheet(sheetXml, shared));
  }
  return result;
}
function text(value: unknown): string { return value === null || value === undefined ? '' : String(value).trim(); }
function rowsToObjects(rows: string[][]): Array<Record<string, unknown>> {
  const headerIndex = rows.findIndex((row) => row.some((cell) => text(cell) === 'vendor_row_id') || row.some((cell) => text(cell) === 'question_english'));
  if (headerIndex < 0) fail('The Questions sheet does not contain the expected header row. Download the CrackJRF Excel template and keep its column names unchanged.');
  const headers = (rows[headerIndex] ?? []).map((cell) => text(cell));
  const output: Array<Record<string, unknown>> = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row?.some((cell) => text(cell) !== '')) continue;
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => { if (header) record[header] = row[index] ?? ''; });
    output.push(record);
  }
  return output;
}
function metadataFromRows(rows: string[][]): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const row of rows) {
    const key = text(row?.[0]);
    const value = text(row?.[1]);
    if (key && key !== 'field' && key !== 'EXAM EVENT METADATA') metadata[key] = value;
  }
  return metadata;
}

export function parseQuestionWorkbook(buffer: Buffer): ParsedQuestionWorkbook {
  if (buffer.length < 100) fail('The Excel workbook is empty or invalid.');
  const entries = readZipEntries(buffer);
  const sheets = loadSheets(entries);
  if (!sheets.has('Questions')) fail('The workbook must contain a worksheet named "Questions".');
  if (!sheets.has('Exam Metadata')) fail('The workbook must contain the "Exam Metadata" worksheet.');
  const questions = rowsToObjects(sheets.get('Questions') ?? []);
  if (questions.length < 1) fail('No question rows were found in the Questions sheet.');
  if (questions.length > 3000) fail('A single workbook is limited to 3,000 questions. Split unusually large examination events into separate workbooks.');
  return {
    metadata: metadataFromRows(sheets.get('Exam Metadata') ?? []),
    questions,
    sheetNames: [...sheets.keys()],
  };
}

export function normalizeQuestionRow(input: Record<string, unknown>, index: number) {
  const row: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    row[key] = value !== null && typeof value === 'object' ? value : text(value);
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const paperRaw = (row.paper ?? '').toUpperCase().replace(/PAPER\s*/g, '').trim();
  const paperNumber = paperRaw === 'I' || paperRaw === '1' ? 1 : paperRaw === 'II' || paperRaw === '2' ? 2 : 0;
  if (!paperNumber) errors.push('Paper must be I or II.');
  const rawSubjectCode = text(row.subject_code);
  const subjectCode = paperNumber === 1 ? (rawSubjectCode === '' || rawSubjectCode === '0' || rawSubjectCode === '00' ? '00' : rawSubjectCode) : rawSubjectCode;
  if (paperNumber === 1 && subjectCode !== '00') errors.push('Paper I must use subject code 00.');
  if (paperNumber === 2 && (!subjectCode || subjectCode === '00')) errors.push('Paper II requires its subject code, for example Geography 80.');
  if (!row.original_question_number) errors.push('Original question number is required.');
  const suppliedPaperOrder = text(row.paper_order);
  const paperOrder = Number(suppliedPaperOrder || index + 1);
  if (!suppliedPaperOrder) warnings.push(`Paper order was blank; imported worksheet order ${index + 1} was used. Confirm it matches the official paper.`);
  if (!Number.isInteger(paperOrder) || paperOrder < 1) errors.push('Paper order must be a positive whole number.');
  if (!row.question_english) errors.push('English question text is required.');
  const optionKeys = ['a','b','c','d'];
  const optionCount = optionKeys.filter((key) => Boolean(row[`option_${key}_english`])).length;
  if (optionCount !== 4) errors.push('The current Question Bank editor requires all four English options (A–D). Complete all four before promoting this row.');
const correct = (row.correct_option ?? '')
  .toUpperCase()
  .replace(/[;|]/g, ',')
  .split(',')
  .map((v: string) => v.trim())
  .filter(Boolean);

if (
  correct.some((key: string) => !['A', 'B', 'C', 'D'].includes(key))
) {
  errors.push(
    'Correct Option must contain A, B, C or D (multiple answers may be separated by commas).'
  );
}

if (
  correct.some(
    (key: string) => !row[`option_${key.toLowerCase()}_english`]
  )
) {
  errors.push(
    'Correct Option refers to an option that has no English option text.'
  );
}  if (correct.length > 1 && row.question_type === 'single_correct_mcq') warnings.push('Multiple proposed answers are present for a single-correct question type.');
  if (!row.answer_source_type && correct.length) warnings.push('An answer is supplied but answer_source_type is blank. Treat the claim as unverified.');
  if (!row.unit_id || !row.section_id || !row.topic_id) warnings.push('Syllabus classification is incomplete. Assign or correct Unit, Section and Topic in Admin.');
  if (row.subtopic && !row.subtopic_id) warnings.push('A sub-topic title is present without a stable subtopic_id. Select the sub-topic in Admin before promotion.');
  if (row.qa_flag && row.qa_flag !== 'none') warnings.push(`Provider QA flag: ${row.qa_flag}${row.qa_note ? ` — ${row.qa_note}` : ''}`);
  if (text(row.media_required).toLowerCase() === 'yes' && !text(row.media_description)) warnings.push('Media is required but no media description was supplied. Attach the source crop or diagram in Admin.');
  const questionTypeMap: Record<string,string> = {
    mcq:'mcq', single_correct:'mcq', single_correct_mcq:'mcq', multiple_correct:'mcq', multiple_correct_mcq:'mcq',
    assertion_reason:'mcq', match_the_following:'matrix', matching:'matrix', sequence_order:'matrix',
    comprehension:'comprehension', table:'table', table_based:'table', image:'image', diagram:'image', map:'map', map_based:'map', numeric:'numeric', other:'other',
  };
  const inputType = (row.question_type || 'single_correct_mcq').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const questionType = questionTypeMap[inputType] ?? 'other';
  row.paper = paperNumber === 1 ? 'I' : paperNumber === 2 ? 'II' : text(row.paper);
  row.subject_code = subjectCode;
  if (Number.isInteger(paperOrder) && paperOrder > 0) row.paper_order = String(paperOrder);
  row.original_question_number = text(row.original_question_number);
  const statusAnswer = 'pending';
  return {
    row,
    paperNumber,
    subjectCode,
    originalQuestionNumber: row.original_question_number,
    paperOrder,
    questionType,
    proposedAnswerKeys: correct,
    answerStatus: statusAnswer,
    errors,
    warnings,
  };
}
