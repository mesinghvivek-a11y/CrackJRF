'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, CheckCircle2, FileImage, Languages, Save, Sparkles, Upload, WandSparkles } from 'lucide-react';
import geography from '@ugcnet/shared/syllabus/geography';
import paper1 from '@ugcnet/shared/syllabus/paper1';
import { RichEditor } from '../../../../components/rich-editor';
import { createSupabaseBrowserClient } from '../../../../lib/supabase';

type ImportRow = {
  id: string; paper_number: number | null; subject_code: string | null; subject_name: string | null;
  original_question_number: string | null; paper_order: number | null; row_data: Record<string, unknown>;
  validation_errors: string[]; validation_warnings: string[]; review_status: string; canonical_question_id: string | null;
};
type Batch = { id: string; batch_code: string; file_name: string; exam_metadata: Record<string, string>; status: string; total_rows: number; valid_rows: number; rows_with_errors: number; rows_promoted: number; created_at: string };
type Taxonomy = { units: Array<{ id: string; title: string; sections: Array<{ id: string; title: string; topics: Array<{ id: string; title: string; subtopics: string[] }> }> }> };

const geographyTree = geography as unknown as Taxonomy;
const paperOneTree = paper1 as unknown as Taxonomy;
const optionLetters = ['A','B','C','D'];
const optionField = (key: string, language: 'english'|'hindi_official'|'hindi_final'|'hinglish_roman') => `option_${key.toLowerCase()}_${language}`;

export default function ExcelBatchPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params.batchId;
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState<'hi'|'hinglish'|null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [canMarkReviewed, setCanMarkReviewed] = useState(false);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const activeSubjectCode = String(data.subject_code ?? selected?.subject_code ?? '');
  const taxonomyConfigured = activeSubjectCode === '00' || activeSubjectCode === '80';
  const taxonomy = activeSubjectCode === '00' ? paperOneTree : activeSubjectCode === '80' ? geographyTree : { units: [] };
  const units = taxonomy.units ?? [];
  const currentUnit = units.find((unit) => unit.id === String(data.unit_id ?? '')) ?? null;
  const sections = currentUnit?.sections ?? [];
  const currentSection = sections.find((section) => section.id === String(data.section_id ?? '')) ?? null;
  const topics = currentSection?.topics ?? [];
  const currentTopic = topics.find((topic) => topic.id === String(data.topic_id ?? '')) ?? null;
  const subtopics = (currentTopic?.subtopics ?? []).map((title, index) => ({ id: `${currentTopic?.id}-S${String(index + 1).padStart(2, '0')}`, title }));
  const rowErrors = selected?.validation_errors ?? [];
  const rowWarnings = selected?.validation_warnings ?? [];

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/excel-imports/${batchId}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load workbook rows.');
      setBatch(payload.batch); setRows(payload.rows ?? []); setCanMarkReviewed(Boolean(payload.permissions?.canMarkReviewed));
      setSelectedId((current) => current && (payload.rows ?? []).some((r: ImportRow) => r.id === current) ? current : payload.rows?.[0]?.id ?? '');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load workbook.'); }
    finally { setLoading(false); }
  }, [batchId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) { setData({}); return; }
    const raw = { ...selected.row_data };
    raw.question_hindi_final = raw.question_hindi_final || raw.question_hindi_official || '';
    raw.question_hindi_origin = raw.question_hindi_origin || (raw.question_hindi_official ? 'official_source' : '');
    raw.provider_explanation_hindi_final = raw.provider_explanation_hindi_final || raw.provider_explanation_hindi || '';
    raw.provider_explanation_hindi_origin = raw.provider_explanation_hindi_origin || (raw.provider_explanation_hindi ? 'institution_solution' : '');
    for (const key of optionLetters) {
      raw[optionField(key, 'hindi_final')] = raw[optionField(key, 'hindi_final')] || raw[optionField(key, 'hindi_official')] || '';
      raw[`option_${key.toLowerCase()}_hindi_origin`] = raw[`option_${key.toLowerCase()}_hindi_origin`] || (raw[optionField(key, 'hindi_official')] ? 'official_source' : '');
    }
    raw.question_hinglish_roman = raw.question_hinglish_roman || '';
    raw.subtopic_id = raw.subtopic_id || '';
    raw.media_placement = raw.media_placement || 'question';
    raw.media_asset_type = raw.media_asset_type || 'image';
    raw.provider_explanation_hinglish_roman = raw.provider_explanation_hinglish_roman || '';
    setData(raw); setMessage('');
  }, [selected?.id]);

  function update(field: string, value: unknown) { setData((current) => ({ ...current, [field]: value })); }

  async function saveRow(status = 'in_review'): Promise<boolean> {
    if (!selected) return false;
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/excel-imports/${batchId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId: selected.id, rowData: data, reviewStatus: status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save row.');
      setRows((current) => current.map((row) => row.id === selected.id ? { ...row, row_data: payload.row.row_data, validation_errors: payload.row.validation_errors, validation_warnings: payload.row.validation_warnings, review_status: payload.row.review_status } : row));
      setMessage('Saved. This row is still private and has not been published.');
      return true;
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save row.'); return false; }
    finally { setSaving(false); }
  }

  async function generateTranslation(target: 'hi'|'hinglish') {
    if (!selected) return;
    setTranslating(target); setError(''); setMessage('');
    try {
      const options = Object.fromEntries(optionLetters.map((key) => [key, String(data[optionField(key, 'english')] ?? '')]));
      const response = await fetch('/api/translations/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, question: data.question_english, options, explanation: data.provider_explanation_english }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to generate translation.');
      setData((current) => {
        const next = { ...current };
        if (target === 'hi') {
          if (!String(next.question_hindi_final ?? '').trim()) { next.question_hindi_final = payload.question; next.question_hindi_origin = 'ai_draft'; }
          if (!String(next.provider_explanation_hindi_final ?? '').trim()) { next.provider_explanation_hindi_final = payload.explanation; next.provider_explanation_hindi_origin = 'ai_draft'; }
          for (const key of optionLetters) {
            const field = optionField(key, 'hindi_final');
            if (!String(next[field] ?? '').trim()) { next[field] = payload.options?.[key] ?? ''; next[`option_${key.toLowerCase()}_hindi_origin`] = 'ai_draft'; }
          }
        } else {
          if (!String(next.question_hinglish_roman ?? '').trim()) { next.question_hinglish_roman = payload.question; next.question_hinglish_origin = 'ai_draft'; }
          if (!String(next.provider_explanation_hinglish_roman ?? '').trim()) { next.provider_explanation_hinglish_roman = payload.explanation; next.provider_explanation_hinglish_origin = 'ai_draft'; }
          for (const key of optionLetters) {
            const field = optionField(key, 'hinglish_roman');
            if (!String(next[field] ?? '').trim()) { next[field] = payload.options?.[key] ?? ''; next[`option_${key.toLowerCase()}_hinglish_origin`] = 'ai_draft'; }
          }
        }
        return next;
      });
      setMessage(`${target === 'hi' ? 'Hindi' : 'Hinglish'} translation draft generated. Existing text was preserved; review every field and save it yourself.`);
    } catch (translationError) { setError(translationError instanceof Error ? translationError.message : 'Translation failed.'); }
    finally { setTranslating(null); }
  }

  async function uploadAsset(file: File) {
    if (!selected) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { setError('Use PNG, JPEG or WebP image files.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('Each image must be 20 MB or smaller.'); return; }
    const client = createSupabaseBrowserClient();
    if (!client) { setError('Supabase browser configuration is missing.'); return; }
    setUploading(true); setError('');
    try {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user) throw new Error('Your admin session expired. Sign in again.');
      const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g,'_').slice(-80);
      const storagePath = `excel-staging/${user.id}/${batchId}/${nonce}-${safeName}`;
      const { error: uploadError } = await client.storage.from('question-assets').upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      setData((current) => ({ ...current, media_assets: [...(Array.isArray(current.media_assets) ? current.media_assets : []), { storage_path: storagePath, file_name: file.name, asset_type: String(current.media_asset_type ?? 'image'), placement: String(current.media_placement ?? 'question'), alt_text: String(current.media_alt_text ?? ''), caption: String(current.media_description ?? '') }] }));
      setMessage('Image attached to this staged row. Save the row before leaving.');
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'Image upload failed.'); }
    finally { setUploading(false); }
  }

  async function promote() {
    if (!selected) return;
    const saved = await saveRow('reviewed');
    if (!saved) return;
    setPromoting(true); setError('');
    try {
      const response = await fetch(`/api/excel-imports/${batchId}/promote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowId: selected.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create Question Bank draft.');
      setData((current) => ({ ...current, canonical_question_code: payload.questionCode }));
      setMessage(`Created ${payload.questionCode} as a private draft. It must still pass content, answer and approval review.`);
      await load();
    } catch (promoteError) { setError(promoteError instanceof Error ? promoteError.message : 'Unable to promote row.'); }
    finally { setPromoting(false); }
  }

  if (loading) return <div className="admin-panel">Loading Excel import…</div>;
  if (!batch) return <section className="admin-panel"><div className="admin-callout">{error || 'Import batch not found.'}</div><Link className="admin-button secondary" href="/imports"><ArrowLeft size={13}/> Back to imports</Link></section>;

  return <>
    <div className="admin-page-heading">
      <div><div className="admin-eyebrow">Excel staging · {batch.batch_code}</div><h1>Question Review & Editing</h1><p>{batch.file_name} · {batch.exam_metadata?.exam_year} {batch.exam_metadata?.exam_session} · {batch.exam_metadata?.shift || 'Shift not specified'}</p></div>
      <Link className="admin-button secondary" href="/imports"><ArrowLeft size={13}/> All imports</Link>
    </div>
    <div className="admin-stat-grid">
      {[['Total rows',batch.total_rows],['Valid rows',batch.valid_rows],['Need correction',batch.rows_with_errors],['Question Bank drafts',batch.rows_promoted]].map(([label,value]) => <div className="admin-stat" key={String(label)}><div className="admin-stat-label">{label}</div><div className="admin-stat-value">{value}</div></div>)}
    </div>
    <div className="admin-callout"><ShieldText/> Excel rows are private staging records. “Add to Question Bank” creates a canonical draft only; it does not verify the answer or publish the question.</div>
    <div className="excel-review-layout">
      <aside className="admin-panel excel-row-list">
        <div className="admin-panel-title">Imported questions</div>
        <div className="admin-panel-sub">Original paper order is preserved. Select a row to edit it.</div>
        {rows.map((row) => <button type="button" key={row.id} className={`excel-row-button ${selectedId === row.id ? 'active' : ''}`} onClick={() => setSelectedId(row.id)}>
          <span className="excel-row-order">{row.paper_order ?? '—'}</span>
          <span className="excel-row-text"><b>Paper {row.paper_number ?? '?'} · Q. {row.original_question_number ?? 'Unnumbered'}</b><small>{String(row.row_data.question_english ?? 'Question text missing').slice(0,100)}</small></span>
          <span className={`admin-tag ${row.canonical_question_id ? 'green' : row.validation_errors?.length ? 'amber' : 'blue'}`}>{row.canonical_question_id ? 'In bank' : row.validation_errors?.length ? 'Fix' : 'Draft'}</span>
        </button>)}
      </aside>
      <section className="admin-panel excel-editor-panel">
        {!selected ? <div className="import-empty">No question row selected.</div> : <>
          <div className="excel-editor-head"><div><div className="admin-eyebrow">Paper {selected.paper_number} · Order {selected.paper_order ?? '—'} · Original Q. {selected.original_question_number ?? '—'}</div><h2>{String(data.vendor_row_id || `Row ${selected.paper_order ?? ''}`)}</h2></div><span className={`admin-tag ${selected.canonical_question_id ? 'green' : 'amber'}`}>{selected.review_status.replaceAll('_',' ')}</span></div>
          {rowErrors.length > 0 && <div className="admin-callout" style={{ background:'#fff4ed',borderColor:'#f4ddd0',color:'#9a4c2b' }}><b>Corrections required</b>{rowErrors.map((item,index) => <div key={index}>• {item}</div>)}</div>}
          {rowWarnings.length > 0 && <div className="admin-callout"><b>Review notes</b>{rowWarnings.map((item,index) => <div key={index}>• {item}</div>)}</div>}
          <div className="excel-form-grid">
            <Field label="Paper"><select className="admin-field" value={String(data.paper ?? (selected.paper_number === 1 ? 'I':'II'))} onChange={(event) => { update('paper',event.target.value); update('subject_code',event.target.value === 'I' ? '00' : String(batch.exam_metadata?.paper_ii_subject_code ?? '80')); }}><option value="I">Paper I</option><option value="II">Paper II</option></select></Field>
            <Field label="Subject code"><input className="admin-field" value={String(data.subject_code ?? selected.subject_code ?? '')} onChange={(event) => update('subject_code',event.target.value)} /></Field>
            <Field label="Original question number"><input className="admin-field" value={String(data.original_question_number ?? '')} onChange={(event) => update('original_question_number',event.target.value)} /></Field>
            <Field label="Paper order"><input className="admin-field" type="number" min="1" value={String(data.paper_order ?? '')} onChange={(event) => update('paper_order',event.target.value)} /></Field>
          </div>
          <Field label="Question type"><select className="admin-field" value={String(data.question_type ?? 'single_correct_mcq')} onChange={(event) => update('question_type',event.target.value)}><option value="single_correct_mcq">Single-correct MCQ</option><option value="multiple_correct_mcq">Multiple-correct MCQ</option><option value="match_the_following">Match the following</option><option value="sequence_order">Sequence / order</option><option value="assertion_reason">Assertion–Reason</option><option value="comprehension">Comprehension</option><option value="table">Table-based</option><option value="image">Image-based</option><option value="map">Map-based</option><option value="numeric">Numeric</option><option value="other">Other</option></select></Field>
          <Field label="Question — English (canonical source)" multiline value={String(data.question_english ?? '')} onChange={(value) => update('question_english',value)} />
          <div className="excel-options-grid">{optionLetters.map((key) => <Field key={key} label={`Option ${key} — English`} value={String(data[optionField(key,'english')] ?? '')} onChange={(value) => update(optionField(key,'english'),value)} />)}</div>
          <div className="excel-section-heading"><h3><Languages size={15}/> Hindi — Devanagari</h3><button className="admin-button secondary" onClick={() => void generateTranslation('hi')} disabled={!!translating || !String(data.question_english ?? '').trim()}><Sparkles size={13}/>{translating === 'hi' ? 'Generating…' : 'Generate Hindi draft'}</button></div>
          <Field label="Hindi question for publication" multiline value={String(data.question_hindi_final ?? '')} onChange={(value) => { update('question_hindi_final',value); update('question_hindi_origin','manual'); }} />
          <div className="excel-options-grid">{optionLetters.map((key) => <Field key={key} label={`Option ${key} — Hindi`} value={String(data[optionField(key,'hindi_final')] ?? '')} onChange={(value) => { update(optionField(key,'hindi_final'),value); update(`option_${key.toLowerCase()}_hindi_origin`,'manual'); }} />)}</div>
          <div className="excel-section-heading"><h3><Languages size={15}/> Hinglish — Roman script (optional)</h3><button className="admin-button secondary" onClick={() => void generateTranslation('hinglish')} disabled={!!translating || !String(data.question_english ?? '').trim()}><WandSparkles size={13}/>{translating === 'hinglish' ? 'Generating…' : 'Generate Hinglish draft'}</button></div>
          <Field label="Hinglish question" multiline value={String(data.question_hinglish_roman ?? '')} onChange={(value) => { update('question_hinglish_roman',value); update('question_hinglish_origin','manual'); }} />
          <div className="excel-options-grid">{optionLetters.map((key) => <Field key={key} label={`Option ${key} — Hinglish`} value={String(data[optionField(key,'hinglish_roman')] ?? '')} onChange={(value) => { update(optionField(key,'hinglish_roman'),value); update(`option_${key.toLowerCase()}_hinglish_origin`,'manual'); }} />)}</div>
          <Field label="Provider's proposed correct option(s) — NOT verified" value={String(data.correct_option ?? '')} onChange={(value) => update('correct_option',value.toUpperCase())} placeholder="A or A,C. Keep blank when unknown." />
          <div className="admin-callout">Answer source: {String(data.answer_source_type ?? 'not supplied')} · Official key: {String(data.official_key_status ?? 'not supplied')}. CrackJRF keeps all imported answer claims unverified until a Reviewer or Super Admin verifies them.</div>
          <div className="excel-section-heading"><h3>Explanation — English</h3></div><RichEditor content={String(data.provider_explanation_english ?? '')} onChange={(value) => update('provider_explanation_english',value)} />
          <Field label="Explanation — Hindi" multiline value={String(data.provider_explanation_hindi_final ?? '')} onChange={(value) => { update('provider_explanation_hindi_final',value); update('provider_explanation_hindi_origin','manual'); }} />
          <Field label="Explanation — Hinglish" multiline value={String(data.provider_explanation_hinglish_roman ?? '')} onChange={(value) => { update('provider_explanation_hinglish_roman',value); update('provider_explanation_hinglish_origin','manual'); }} />
          <div className="excel-section-heading"><h3>CrackJRF syllabus classification</h3><span className="admin-tag blue">{activeSubjectCode === '00' ? 'Paper I taxonomy' : activeSubjectCode === '80' ? 'Geography taxonomy' : 'Taxonomy not configured'}</span></div>
          {!taxonomyConfigured && <div className="admin-callout">This subject code does not yet have a taxonomy configured in CrackJRF. Import the question as a draft and add its subject-specific taxonomy before classification; Geography labels will not be shown for other subjects.</div>}
          <div className="excel-form-grid">
            <Field label="Unit"><select className="admin-field" value={String(data.unit_id ?? '')} onChange={(event) => { const unit = units.find((item) => item.id === event.target.value); update('unit_id',event.target.value); update('unit_name',unit?.title ?? ''); update('section_id',''); update('section_name',''); update('topic_id',''); update('topic_name',''); update('subtopic',''); update('subtopic_id',''); }}><option value="">Select unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.id} · {unit.title}</option>)}</select></Field>
            <Field label="Section"><select className="admin-field" value={String(data.section_id ?? '')} onChange={(event) => { const section = sections.find((item) => item.id === event.target.value); update('section_id',event.target.value); update('section_name',section?.title ?? ''); update('topic_id',''); update('topic_name',''); update('subtopic',''); update('subtopic_id',''); }}><option value="">Select section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.id} · {section.title}</option>)}</select></Field>
            <Field label="Topic"><select className="admin-field" value={String(data.topic_id ?? '')} onChange={(event) => { const topic = topics.find((item) => item.id === event.target.value); update('topic_id',event.target.value); update('topic_name',topic?.title ?? ''); update('subtopic',''); update('subtopic_id',''); }}><option value="">Select topic</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.id} · {topic.title}</option>)}</select></Field>
            <Field label="Sub-topic"><select className="admin-field" value={String(data.subtopic_id ?? '')} onChange={(event) => { const subtopic = subtopics.find((item) => item.id === event.target.value); update('subtopic_id',event.target.value); update('subtopic',subtopic?.title ?? ''); }}><option value="">Select sub-topic (optional)</option>{subtopics.map((subtopic) => <option key={subtopic.id} value={subtopic.id}>{subtopic.title}</option>)}</select></Field>
          </div>
          <Field label="Keywords (comma-separated)" value={String(data.keywords ?? '')} onChange={(value) => update('keywords',value)} />
          <div className="excel-section-heading"><h3>Images, diagrams and maps</h3><label className="admin-button secondary" style={{ cursor:'pointer' }}><Upload size={13}/>{uploading ? 'Uploading…' : 'Attach image'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAsset(file); event.currentTarget.value = ''; }}/></label></div>
          <Field label="Attach image to"><select className="admin-field" value={String(data.media_placement ?? 'question')} onChange={(event) => { update('media_placement',event.target.value); update('media_assets',(Array.isArray(data.media_assets) ? data.media_assets : []).map((asset: Record<string, unknown>) => ({ ...asset, placement: event.target.value }))); }}><option value="question">Question</option><option value="explanation">Explanation</option></select></Field>
          <Field label="Media type"><select className="admin-field" value={String(data.media_asset_type ?? 'image')} onChange={(event) => { update('media_asset_type',event.target.value); update('media_assets',(Array.isArray(data.media_assets) ? data.media_assets : []).map((asset: Record<string, unknown>) => ({ ...asset, asset_type: event.target.value }))); }}><option value="image">Image</option><option value="map">Map</option><option value="diagram">Diagram</option><option value="table_image">Table image</option><option value="page_crop">Paper page crop</option><option value="other">Other</option></select></Field>
          <Field label="What should the image show?" value={String(data.media_description ?? '')} onChange={(value) => update('media_description',value)} />
          <Field label="Image alt text" value={String(data.media_alt_text ?? '')} onChange={(value) => update('media_alt_text',value)} />
          {(Array.isArray(data.media_assets) ? data.media_assets : []).map((asset: Record<string, unknown>, index: number) => <div className="excel-asset-row" key={`${String(asset.storage_path)}-${index}`}><FileImage size={16}/><span>{String(asset.file_name ?? asset.storage_path)}</span><button className="admin-button secondary" onClick={() => update('media_assets',(data.media_assets as unknown[]).filter((_,i) => i !== index))}>Remove</button></div>)}
          <Field label="Official paper page" value={String(data.official_paper_page ?? '')} onChange={(value) => update('official_paper_page',value)} />
          <Field label="Institution solved-paper page" value={String(data.institution_paper_page ?? '')} onChange={(value) => update('institution_paper_page',value)} />
          <Field label="Source alignment / unresolved issue" multiline value={String(data.source_alignment_note ?? data.qa_note ?? '')} onChange={(value) => update('source_alignment_note',value)} />
          {message && <div className="admin-callout" style={{ background:'#edf9f2',borderColor:'#d7efdf',color:'#28704d' }}><CheckCircle2 size={14} style={{ verticalAlign:'middle',marginRight:6 }}/>{message}</div>}
          {error && <div className="admin-callout" style={{ background:'#fff4ed',borderColor:'#f4ddd0',color:'#9a4c2b' }}><AlertCircle size={14} style={{ verticalAlign:'middle',marginRight:6 }}/>{error}</div>}
          <div className="excel-editor-actions"><button className="admin-button secondary" onClick={() => void saveRow('in_review')} disabled={saving || promoting}><Save size={13}/>{saving ? 'Saving…' : 'Save changes'}</button>{canMarkReviewed && <button className="admin-button" onClick={() => void saveRow('reviewed')} disabled={saving || promoting}><CheckCircle2 size={13}/>Mark reviewed</button>}{selected.canonical_question_id ? <Link className="admin-button success" href={`/review?questionCode=${encodeURIComponent(String(data.canonical_question_code ?? ''))}`}>Open Question Review</Link> : <button className="admin-button success" onClick={() => void promote()} disabled={saving || promoting || rowErrors.length > 0}><CheckCircle2 size={13}/>{promoting ? 'Creating draft…' : 'Add to Question Bank as draft'}</button>}</div>
        </>}
      </section>
    </div>
  </>;
}

function Field({ label, value, onChange, multiline = false, placeholder, children }: { label: string; value?: string; onChange?: (value: string) => void; multiline?: boolean; placeholder?: string; children?: ReactNode }) {
  return <div className="admin-field-group"><label className="admin-label-field">{label}</label>{children ?? (multiline ? <textarea className="admin-field" rows={4} value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder}/> : <input className="admin-field" value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder}/>)}</div>;
}
function ShieldText() { return <><strong>Private staging and answer safety.</strong> </>; }
