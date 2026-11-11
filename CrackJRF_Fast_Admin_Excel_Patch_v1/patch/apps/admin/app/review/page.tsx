'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown, ChevronRight, FileImage, LoaderCircle, Save, Upload, X } from 'lucide-react';
import geography from '@ugcnet/shared/syllabus/geography';
import paper1 from '@ugcnet/shared/syllabus/paper1';
import { createSupabaseBrowserClient } from '../../lib/supabase';
import { RichEditor } from '../../components/rich-editor';

type LangOption = { key: string; en: string; hi: string };
type Asset = { id?: string; storage_path: string; asset_type: string; placement: string; alt_text?: string; caption?: string; file_name?: string; sort_order?: number };
type TreeTopic = { id: string; title: string; subtopics?: string[] };
type TreeSection = { id: string; title: string; topics: TreeTopic[] };
type TreeUnit = { id: string; title: string; sections: TreeSection[] };
type Tree = { units: TreeUnit[] };

const optionKeys = ['A', 'B', 'C', 'D'];
const sourceMetadataFields: Array<{ key: string; label: string; multiline?: boolean }> = [
  { key: 'vendor_row_id', label: 'Vendor row ID' },
  { key: 'answer_source_type', label: 'Answer source type' },
  { key: 'answer_source_title', label: 'Answer source title' },
  { key: 'answer_source_page', label: 'Answer source page' },
  { key: 'official_key_status', label: 'Official answer-key status' },
  { key: 'question_match_status', label: 'Question/source match status' },
  { key: 'match_confidence', label: 'Source-match confidence' },
  { key: 'qa_flag', label: 'QA flag' },
  { key: 'option_style_preference', label: 'Option style preference' },
  { key: 'media_required', label: 'Media required' },
  { key: 'media_description', label: 'Media description', multiline: true },
  { key: 'media_alt_text', label: 'Media alt text', multiline: true },
  { key: 'official_paper_page', label: 'Official paper page' },
  { key: 'institution_paper_page', label: 'Institution paper page' },
  { key: 'qa_note', label: 'QA note', multiline: true },
  { key: 'source_alignment_note', label: 'Source alignment note', multiline: true },
  { key: 'row_notes', label: 'Additional row notes', multiline: true },
];
const paperOne = paper1 as unknown as Tree;
const geographyTree = geography as unknown as Tree;

function blockText(blocks: any[] | undefined): string {
  return (blocks ?? []).map((block) => String(block.text ?? block.html ?? '')).join('\n').replace(/<\/?p[^>]*>/gi, '').replace(/<br\s*\/?\s*>/gi, '\n');
}
function languageText(entries: any[] | undefined, language: 'en' | 'hi'): string {
  const entry = (entries ?? []).find((item) => item.language === language && item.script_variant === 'native');
  return blockText(entry?.stem_blocks);
}
function contentText(entries: any[] | undefined, language: 'en' | 'hi'): string {
  const entry = (entries ?? []).find((item) => item.language === language && item.script_variant === 'native');
  return blockText(entry?.content_blocks);
}
function explanationText(entries: any[] | undefined, language: 'en' | 'hi'): string {
  const entry = (entries ?? []).find((item) => item.language === language && item.script_variant === 'native');
  if (entry?.explanation_overview) return String(entry.explanation_overview);
  return blockText(entry?.explanation_richtext);
}
function getPaperEvent(value: any) {
  const paper = Array.isArray(value?.exam_papers) ? value.exam_papers[0] : value?.exam_papers;
  const event = Array.isArray(paper?.exam_events) ? paper.exam_events[0] : paper?.exam_events;
  return { paper, event };
}

function ReviewEditorContent() {
  const search = useSearchParams();
  const questionCode = search.get('questionCode') ?? '';
  const [record, setRecord] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stemEn, setStemEn] = useState('');
  const [stemHi, setStemHi] = useState('');
  const [options, setOptions] = useState<LangOption[]>(optionKeys.map((key) => ({ key, en: '', hi: '' })));
  const [answerStatus, setAnswerStatus] = useState<'single_correct' | 'multiple_correct' | 'all_options_correct'>('single_correct');
  const [correctKeys, setCorrectKeys] = useState<string[]>([]);
  const [explanationEn, setExplanationEn] = useState('');
  const [explanationHi, setExplanationHi] = useState('');
  const [optionExplanations, setOptionExplanations] = useState<Record<string, string>>({});
  const [referencesText, setReferencesText] = useState('');
  const [questionType, setQuestionType] = useState('mcq');
  const [unitId, setUnitId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [subtopicId, setSubtopicId] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [appearanceId, setAppearanceId] = useState('');
  const [originalNumber, setOriginalNumber] = useState('');
  const [paperOrder, setPaperOrder] = useState('');
  const [appearanceNotes, setAppearanceNotes] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [sourceMetadata, setSourceMetadata] = useState<Record<string, string>>({});
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [openMedia, setOpenMedia] = useState(false);
  const [openExplanation, setOpenExplanation] = useState(false);
  const [openTaxonomy, setOpenTaxonomy] = useState(true);
  const [expandedUnits, setExpandedUnits] = useState<string[]>([]);
  const [expandedSections, setExpandedSections] = useState<string[]>([]);

  const subjectCode = String(record?.question?.subjects?.code ?? '80');
  const taxonomy: Tree = subjectCode === '00' ? paperOne : subjectCode === '80' ? geographyTree : { units: [] };
  const units = taxonomy.units ?? [];
  const currentUnit = units.find((unit) => unit.id === unitId) ?? null;
  const currentSection = currentUnit?.sections.find((section) => section.id === sectionId) ?? null;
  const currentTopic = currentSection?.topics.find((topic) => topic.id === topicId) ?? null;
  const currentSubtopics = (currentTopic?.subtopics ?? []).map((title, index) => ({ id: `${currentTopic?.id}-S${String(index + 1).padStart(2, '0')}`, title }));

  const load = useCallback(async () => {
    if (!questionCode) { setError('Open a question from the Question Bank or a completed Excel import.'); setLoading(false); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/questions/${encodeURIComponent(questionCode)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load question.');
      setRecord(payload);
      const draft = payload.editorDraft?.draft_payload;
      if (draft) {
        setStemEn(String(draft.stemEn ?? ''));
        setStemHi(String(draft.stemHi ?? ''));
        setOptions(Array.isArray(draft.options) ? optionKeys.map((key) => ({ key, en: String(draft.options.find((o: any) => o.key === key)?.en ?? ''), hi: String(draft.options.find((o: any) => o.key === key)?.hi ?? '') })) : optionKeys.map((key) => ({ key, en: '', hi: '' })));
        setAnswerStatus(draft.answerStatus ?? 'single_correct');
        setCorrectKeys(draft.correctOptionKeys ?? []);
        setExplanationEn(String(draft.explanationEn ?? ''));
        setExplanationHi(String(draft.explanationHi ?? ''));
        setOptionExplanations(draft.optionExplanations ?? {});
        setReferencesText((draft.references ?? []).map((item: any) => item.title ?? '').join('\n'));
        setQuestionType(String(draft.questionType ?? payload.question.question_type));
        setUnitId(String(draft.classification?.unitId ?? ''));
        setSectionId(String(draft.classification?.sectionId ?? ''));
        setTopicId(String(draft.classification?.topicId ?? ''));
        setSubtopicId(String(draft.classification?.subtopicId ?? ''));
        setKeywordsText((draft.keywords ?? []).join(', '));
        setAppearanceId(String(draft.appearance?.examPaperId ?? payload.appearances?.[0]?.exam_papers?.id ?? ''));
        setOriginalNumber(String(draft.appearance?.originalQuestionNumber ?? payload.appearances?.[0]?.original_question_number ?? ''));
        setPaperOrder(String(draft.appearance?.paperOrder ?? payload.appearances?.[0]?.paper_order ?? ''));
        setAppearanceNotes(String(draft.appearance?.notes ?? payload.appearances?.[0]?.appearance_notes ?? ''));
        setAssets(Array.isArray(draft.assets) ? draft.assets : payload.assets ?? []);
        setSourceNote(String(draft.sourceNote ?? payload.answerEvidence?.[0]?.provenance_note ?? ''));
        setSourceMetadata((draft.sourceMetadata ?? payload.appearances?.[0]?.source_metadata?.questionRow ?? {}) as Record<string, string>);
        setNotice('Draft changes loaded. The previously published version remains live until you publish these edits.');
      } else {
        setStemEn(languageText(payload.translations, 'en'));
        setStemHi(languageText(payload.translations, 'hi'));
        setOptions(optionKeys.map((key) => {
          const option = (payload.options ?? []).find((item: any) => item.option_key === key);
          return { key, en: contentText(option?.question_option_translations, 'en'), hi: contentText(option?.question_option_translations, 'hi') };
        }));
        setAnswerStatus(payload.verifiedAnswer?.answer_status ?? payload.question.answer_status ?? 'single_correct');
        setCorrectKeys(payload.verifiedAnswer?.correct_option_keys ?? []);
        setExplanationEn(explanationText(payload.explanationTranslations, 'en') || payload.explanationDraft?.explanation_overview || '');
        setExplanationHi(explanationText(payload.explanationTranslations, 'hi'));
        setOptionExplanations(payload.verifiedAnswer?.option_explanations ?? payload.explanationDraft?.option_explanations ?? {});
        setReferencesText((payload.verifiedAnswer?.references_data ?? payload.explanationDraft?.references_data ?? []).map((item: any) => item.title ?? item.book ?? '').join('\n'));
        setQuestionType(String(payload.question.question_type ?? 'mcq'));
        const classified = payload.classifications ?? [];
        const loadedSubjectCode = String(payload.question?.subjects?.code ?? '80');
        const loadedUnits = (loadedSubjectCode === '00' ? paperOne : loadedSubjectCode === '80' ? geographyTree : { units: [] }).units;
        const flat = loadedUnits.flatMap((unit) => unit.sections.flatMap((section) => section.topics.flatMap((topic) => [
          { id: unit.id, type: 'unit' }, { id: section.id, type: 'section' }, { id: topic.id, type: 'topic' },
          ...(topic.subtopics ?? []).map((_, index) => ({ id: `${topic.id}-S${String(index + 1).padStart(2, '0')}`, type: 'subtopic' })),
        ])));
        const ids = new Set(classified.map((item: any) => item.syllabus_node_id));
        const selectedUnitId = flat.find((item) => item.type === 'unit' && ids.has(item.id))?.id ?? '';
        const selectedSectionId = flat.find((item) => item.type === 'section' && ids.has(item.id))?.id ?? '';
        setUnitId(selectedUnitId);
        setSectionId(selectedSectionId);
        setTopicId(flat.find((item) => item.type === 'topic' && ids.has(item.id))?.id ?? '');
        setSubtopicId(flat.find((item) => item.type === 'subtopic' && ids.has(item.id))?.id ?? '');
        setExpandedUnits(selectedUnitId ? [selectedUnitId] : []);
        setExpandedSections(selectedSectionId ? [selectedSectionId] : []);
        setKeywordsText((payload.keywords ?? []).map((item: any) => item.keyword).join(', '));
        const appearance = payload.appearances?.[0];
        const { paper, event } = getPaperEvent(appearance);
        setAppearanceId(String(paper?.id ?? ''));
        setOriginalNumber(String(appearance?.original_question_number ?? ''));
        setPaperOrder(String(appearance?.paper_order ?? ''));
        setAppearanceNotes(String(appearance?.appearance_notes ?? `${event?.year ?? ''} ${event?.session ?? ''}`.trim()));
        setAssets(payload.assets ?? []);
        setSourceNote(String(payload.answerEvidence?.[0]?.provenance_note ?? ''));
        setSourceMetadata((appearance?.source_metadata?.questionRow ?? {}) as Record<string, string>);
      }
      const savedUnit = draft?.classification?.unitId ?? '';
      if (savedUnit) setExpandedUnits([String(savedUnit)]);
      const savedSection = draft?.classification?.sectionId ?? '';
      if (savedSection) setExpandedSections([String(savedSection)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load question.');
    } finally {
      setLoading(false);
    }
  }, [questionCode]);

  useEffect(() => { void load(); }, [load]);

  function changeOption(key: string, language: 'en' | 'hi', value: string) {
    setOptions((current) => current.map((option) => option.key === key ? { ...option, [language]: value } : option));
  }
  function toggleAnswer(key: string) {
    if (answerStatus === 'all_options_correct') return;
    setCorrectKeys((current) => {
      if (answerStatus === 'single_correct') return current.includes(key) ? [] : [key];
      return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    });
  }
  function setAnswerMode(value: string) {
    const next = value as typeof answerStatus;
    setAnswerStatus(next);
    if (next === 'all_options_correct') setCorrectKeys([...optionKeys]);
    else if (next === 'single_correct' && correctKeys.length > 1) setCorrectKeys(correctKeys.slice(0, 1));
    else if (next === 'multiple_correct' && correctKeys.length < 2) setCorrectKeys([]);
  }

  function selectTopic(unit: TreeUnit, section: TreeSection, topic: TreeTopic) {
    setUnitId(unit.id);
    setSectionId(section.id);
    setTopicId(topic.id);
    setSubtopicId('');
    setExpandedUnits((current) => current.includes(unit.id) ? current : [...current, unit.id]);
    setExpandedSections((current) => current.includes(section.id) ? current : [...current, section.id]);
  }

  async function attachImage(file: File) {
    if (!record?.question?.id) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Attach a PNG, JPG or WebP image.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('Images must be 20 MB or smaller.'); return; }
    const client = createSupabaseBrowserClient();
    if (!client) { setError('Supabase browser configuration is missing.'); return; }
    setUploading(true); setError('');
    try {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user) throw new Error('Admin session expired. Sign in again.');
      const nonce = crypto.randomUUID?.() ?? String(Date.now());
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
      const storagePath = `question-assets/${user.id}/${record.question.id}/${nonce}-${safeName}`;
      const { error: uploadError } = await client.storage.from('question-assets').upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      setAssets((current) => [...current, { storage_path: storagePath, asset_type: 'image', placement: 'question', alt_text: '', caption: file.name, file_name: file.name }]);
      setNotice('Image attached. Use Save Draft or Publish to save the question and attachment.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function save(action: 'draft' | 'publish') {
    if (action === 'publish') {
      if (!stemEn.trim()) { setError('Enter the English question before publishing.'); return; }
      if (options.some((option) => !option.en.trim())) { setError('Fill all four English options A–D.'); return; }
      if (answerStatus === 'single_correct' && correctKeys.length !== 1) { setError('Select exactly one correct option.'); return; }
      if (answerStatus === 'multiple_correct' && correctKeys.length < 2) { setError('Select at least two correct options.'); return; }
      const hasHindi = Boolean(stemHi.trim() || options.some((option) => option.hi.trim()));
      if (hasHindi && (!stemHi.trim() || options.some((option) => !option.hi.trim()))) { setError('For a Hindi version, provide the Hindi question and all four Hindi options.'); return; }
      if (!unitId || !sectionId || !topicId) { setError('Select the Unit, Section and Topic before publishing.'); setOpenTaxonomy(true); return; }
    }
    setSaving(true); setError(''); setNotice('');
    const payload = {
      subjectCode,
      baseRevision: Number(record.editorDraft?.base_revision ?? record.question.current_revision ?? 1),
      contentOrigin: 'manual',
      explanationOrigin: 'manual',
      sourceNote,
      sourceMetadata,
      questionType,
      stemEn,
      stemHi,
      options,
      answerStatus,
      correctOptionKeys: answerStatus === 'all_options_correct' ? optionKeys : correctKeys,
      explanationEn,
      explanationHi,
      optionExplanations,
      references: referencesText.split('\n').map((title) => title.trim()).filter(Boolean).map((title) => ({ title })),
      classification: { unitId, sectionId, topicId, subtopicId },
      keywords: keywordsText.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean),
      appearance: { examPaperId: appearanceId, originalQuestionNumber: originalNumber, paperOrder, notes: appearanceNotes },
      assets,
    };
    try {
      const response = await fetch(`/api/questions/${encodeURIComponent(questionCode)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Unable to ${action === 'draft' ? 'save draft' : 'publish'} question.`);
      if (action === 'draft') {
        setRecord((current: any) => current ? { ...current, editorDraft: { draft_payload: payload, base_revision: payload.baseRevision } } : current);
        setNotice('Draft saved. The current published version remains live until you publish these edits.');
      } else {
        setRecord((current: any) => current ? { ...current, question: { ...current.question, status: 'published', current_revision: result.revision ?? current.question.current_revision }, editorDraft: null } : current);
        setNotice(`${questionCode} published successfully. The Student Portal will now serve the updated version.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed. Your changes are still in this editor; please retry.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="admin-panel editor-loading"><LoaderCircle className="spin"/> Loading question…</div>;
  if (error && !record) return <section className="admin-panel"><div className="admin-callout">{error}</div><Link className="admin-button secondary" href="/questions"><ArrowLeft size={14}/> Question Bank</Link></section>;
  if (!record) return null;

  const appearance = record.appearances?.[0];
  const { paper, event } = getPaperEvent(appearance);
  const isDraft = Boolean(record.editorDraft);

  return (
    <div className="question-editor-page">
      <div className="admin-page-heading editor-page-heading">
        <div>
          <div className="admin-eyebrow">Compact bilingual editor · {record.question.subjects?.name ?? subjectCode}</div>
          <h1>{questionCode}</h1>
          <p>{event?.year ?? 'Year not set'} · {event?.session ?? 'Session not set'} · Paper {paper?.paper_number ?? '—'} · Original Q. {originalNumber || '—'}</p>
        </div>
        <div className="editor-heading-actions">
          <span className={`admin-tag ${record.question.status === 'published' ? 'green' : 'amber'}`}>{record.question.status}</span>
          <Link className="admin-button secondary" href="/questions"><ArrowLeft size={13}/> Question Bank</Link>
        </div>
      </div>

      {isDraft && <div className="admin-callout editor-draft-note">You have unsent draft edits. The existing published version remains visible to students until you choose Publish.</div>}

      <section className="admin-panel editor-main-panel">
        <div className="editor-section-topline">
          <div><b>Question & options</b><small>English and Hindi stay side by side. Edit either language directly.</small></div>
          <select className="admin-field editor-question-type" value={questionType} onChange={(event) => setQuestionType(event.target.value)} aria-label="Question type">
            <option value="mcq">MCQ</option><option value="matrix">Matching / sequence</option><option value="comprehension">Comprehension</option><option value="table">Table-based</option><option value="image">Image-based</option><option value="map">Map-based</option><option value="numeric">Numeric</option><option value="other">Other</option>
          </select>
        </div>

        <div className="editor-language-grid">
          <div className="editor-language-panel">
            <div className="editor-language-heading"><strong>English</strong><span className="admin-tag blue">Primary</span></div>
            <textarea className="admin-field editor-stem-input" value={stemEn} onChange={(event) => setStemEn(event.target.value)} placeholder="Enter English question…" />
          </div>
          <div className="editor-language-panel">
            <div className="editor-language-heading"><strong>हिन्दी</strong><span className="admin-tag">Optional</span></div>
            <textarea className="admin-field editor-stem-input" value={stemHi} onChange={(event) => setStemHi(event.target.value)} placeholder="हिंदी प्रश्न यहाँ लिखें…" />
          </div>
        </div>

        <div className="editor-options-heading"><b>Options</b><small>Each English option is paired with its Hindi version.</small></div>
        <div className="editor-option-grid">
          {options.map((option) => (
            <div className="editor-option-row" key={option.key}>
              <span className="editor-option-key">{option.key}</span>
              <input className="admin-field" value={option.en} onChange={(event) => changeOption(option.key, 'en', event.target.value)} placeholder={`Option ${option.key} · English`} />
              <input className="admin-field" value={option.hi} onChange={(event) => changeOption(option.key, 'hi', event.target.value)} placeholder={`विकल्प ${option.key} · हिन्दी (optional)`} />
            </div>
          ))}
        </div>

        <div className="editor-answer-row">
          <div><b>Correct answer</b><small>Imported answer is used directly. Change it whenever necessary.</small></div>
          <select className="admin-field editor-answer-type" value={answerStatus} onChange={(event) => setAnswerMode(event.target.value)}>
            <option value="single_correct">Single correct</option>
            <option value="multiple_correct">Multiple correct</option>
            <option value="all_options_correct">All options correct</option>
          </select>
          <div className="editor-answer-keys">
            {optionKeys.map((key) => <button type="button" key={key} className={`editor-answer-key ${correctKeys.includes(key) || answerStatus === 'all_options_correct' ? 'selected' : ''}`} onClick={() => toggleAnswer(key)} disabled={answerStatus === 'all_options_correct'}>{key}{(correctKeys.includes(key) || answerStatus === 'all_options_correct') && <Check size={12}/>}</button>)}
          </div>
        </div>
      </section>

      <section className="admin-panel editor-taxonomy-panel">
        <button type="button" className="editor-collapse-heading" onClick={() => setOpenTaxonomy((value) => !value)}>
          <span><b>Syllabus classification</b><small>{currentUnit?.title ?? 'Choose a unit'}{currentTopic ? ` · ${currentTopic.title}` : ''}</small></span>
          {openTaxonomy ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
        </button>
        {openTaxonomy && (
          <div className="editor-taxonomy-tree">
            {units.map((unit) => (
              <details key={unit.id} open={expandedUnits.includes(unit.id)} onToggle={(event) => {
                const open = (event.currentTarget as HTMLDetailsElement).open;
                setExpandedUnits((current) => open ? [...new Set([...current, unit.id])] : current.filter((id) => id !== unit.id));
              }}>
                <summary>{unit.title}<span>{unit.sections.reduce((count, section) => count + section.topics.length, 0)} topics</span></summary>
                {unit.sections.map((section) => (
                  <details className="editor-taxonomy-section" key={section.id} open={expandedSections.includes(section.id)} onToggle={(event) => {
                    const open = (event.currentTarget as HTMLDetailsElement).open;
                    setExpandedSections((current) => open ? [...new Set([...current, section.id])] : current.filter((id) => id !== section.id));
                  }}>
                    <summary>{section.title}<span>{section.topics.length}</span></summary>
                    <div className="editor-taxonomy-topics">
                      {section.topics.map((topic) => (
                        <div className={`editor-topic-choice ${topicId === topic.id ? 'active' : ''}`} key={topic.id}>
                          <button type="button" onClick={() => selectTopic(unit, section, topic)}><span className="editor-topic-radio"/>{topic.title}</button>
                          {topicId === topic.id && topic.subtopics?.length ? (
                            <div className="editor-subtopic-list">
                              {currentSubtopics.map((sub) => <button type="button" key={sub.id} className={subtopicId === sub.id ? 'active' : ''} onClick={() => setSubtopicId(sub.id)}>{subtopicId === sub.id ? '✓ ' : ''}{sub.title}</button>)}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </details>
            ))}
          </div>
        )}
        <div className="editor-selected-taxonomy">
          {currentUnit && <span>{currentUnit.title}</span>}
          {currentSection && <span>{currentSection.title}</span>}
          {currentTopic && <span>{currentTopic.title}</span>}
          {currentSubtopics.find((item) => item.id === subtopicId) && <span>{currentSubtopics.find((item) => item.id === subtopicId)?.title}</span>}
        </div>
        <input className="admin-field editor-keywords" value={keywordsText} onChange={(event) => setKeywordsText(event.target.value)} placeholder="Keywords (comma-separated)" />
      </section>

      <section className="admin-panel editor-extra-panel">
        <details open={openExplanation} onToggle={(event) => setOpenExplanation((event.currentTarget as HTMLDetailsElement).open)}>
          <summary>Explanations & references <span>Optional · EN and Hindi</span></summary>
          <div className="editor-language-grid editor-explanations-grid">
            <div className="editor-language-panel"><label>English explanation</label><RichEditor content={explanationEn} onChange={setExplanationEn} placeholder="Write or edit the English explanation…" /></div>
            <div className="editor-language-panel"><label>Hindi explanation</label><RichEditor content={explanationHi} onChange={setExplanationHi} placeholder="हिंदी में व्याख्या लिखें…" /></div>
          </div>
          <div className="editor-option-explanations">
            <b>Option-wise explanations</b>
            {optionKeys.map((key) => <label key={key}>Option {key}<textarea className="admin-field" rows={2} value={String(optionExplanations[key] ?? '')} onChange={(event) => setOptionExplanations((current) => ({ ...current, [key]: event.target.value }))} placeholder={`Explain option ${key} (optional)…`} /></label>)}
          </div>
          <textarea className="admin-field editor-references" rows={2} value={referencesText} onChange={(event) => setReferencesText(event.target.value)} placeholder="References — one per line" />
        </details>
      </section>

      <section className="admin-panel editor-extra-panel">
        <details open={openMedia} onToggle={(event) => setOpenMedia((event.currentTarget as HTMLDetailsElement).open)}>
          <summary>Images & source metadata <span>{assets.length} attachments</span></summary>
          <div className="editor-media-toolbar">
            <label className="admin-button secondary"><Upload size={13}/>{uploading ? 'Uploading…' : 'Attach image'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void attachImage(file); event.currentTarget.value = ''; }}/></label>
            <span className="admin-panel-sub">PNG, JPG or WebP · Max 20 MB each</span>
          </div>
          {assets.map((asset, index) => <div className="editor-asset-item" key={`${asset.storage_path}-${index}`}><FileImage size={15}/><span>{asset.file_name ?? asset.caption ?? asset.storage_path.split('/').pop()}</span><button type="button" onClick={() => setAssets((current) => current.filter((_, i) => i !== index))} aria-label="Remove attachment"><X size={15}/></button></div>)}
          <div className="editor-meta-grid">
            <label>Original question number<input className="admin-field" value={originalNumber} onChange={(event) => setOriginalNumber(event.target.value)} /></label>
            <label>Original paper order<input className="admin-field" inputMode="numeric" value={paperOrder} onChange={(event) => setPaperOrder(event.target.value.replace(/[^0-9]/g, ''))} /></label>
            <label>Exam appearance notes<input className="admin-field" value={appearanceNotes} onChange={(event) => setAppearanceNotes(event.target.value)} /></label>
            <label className="editor-source-note-field">Answer source / provenance<textarea className="admin-field" rows={2} value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} placeholder="General source/provenance note…" /></label>
          </div>
          <div className="editor-meta-grid editor-source-metadata-grid">
            {sourceMetadataFields.map((field) => (
              <label key={field.key}>{field.label}
                {field.multiline ? (
                  <textarea className="admin-field" rows={2} value={String(sourceMetadata[field.key] ?? '')} onChange={(event) => setSourceMetadata((current) => ({ ...current, [field.key]: event.target.value }))} />
                ) : (
                  <input className="admin-field" value={String(sourceMetadata[field.key] ?? '')} onChange={(event) => setSourceMetadata((current) => ({ ...current, [field.key]: event.target.value }))} />
                )}
              </label>
            ))}
          </div>
        </details>
      </section>

      {error && <div className="admin-callout editor-error" role="alert">{error}</div>}
      {notice && <div className="admin-callout editor-notice" role="status">{notice}</div>}

      <div className="editor-sticky-actions">
        <span>{record.question.status === 'published' ? 'Published version stays live until you publish edits.' : 'This question is currently a draft.'}</span>
        <div>
          <button type="button" className="admin-button secondary" onClick={() => void save('draft')} disabled={saving || uploading}><Save size={14}/>{saving ? 'Saving…' : 'Save Draft'}</button>
          <button type="button" className="admin-button success" onClick={() => void save('publish')} disabled={saving || uploading}><Check size={14}/>{saving ? 'Publishing…' : 'Publish'}</button>
        </div>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="admin-panel editor-loading">Loading question editor…</div>}>
      <ReviewEditorContent />
    </Suspense>
  );
}
