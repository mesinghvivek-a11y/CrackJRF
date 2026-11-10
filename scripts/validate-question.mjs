import fs from 'node:fs';
import path from 'node:path';
const file=process.argv[2] ?? 'examples/question-record.example.json';
const q=JSON.parse(fs.readFileSync(file,'utf8'));
const errors=[];
const idPattern=/^[A-Z0-9-]{6,64}$/;
if(!q.question_code || !idPattern.test(q.question_code)) errors.push('question_code must be a stable platform-owned code.');
if(!q.subject_code) errors.push('subject_code is required.');
if(!['mcq','comprehension','table','image','map','matrix','numeric','other'].includes(q.question_type)) errors.push('question_type is invalid.');
if(!Array.isArray(q.translations)||q.translations.length===0) errors.push('At least one language translation is required.');
for(const t of q.translations??[]){if(!['en','hi'].includes(t.language))errors.push(`Unsupported language ${t.language}.`);if(!Array.isArray(t.stem_blocks)||!t.stem_blocks.length)errors.push(`${t.language}: stem_blocks required.`);if(q.question_type==='mcq' && (!Array.isArray(t.options)||t.options.length!==4))errors.push(`${t.language}: standard MCQ must contain exactly four options.`)}
if(!Array.isArray(q.classifications)||q.classifications.length===0)errors.push('At least one syllabus classification is required.');
if(!Array.isArray(q.exam_appearances))errors.push('exam_appearances must be an array.');
if(errors.length){console.error(errors.map((e,i)=>`${i+1}. ${e}`).join('\n'));process.exit(1)}
console.log(`Validated ${q.question_code}. This validates structure only; it does not verify answer correctness or source accuracy.`);
