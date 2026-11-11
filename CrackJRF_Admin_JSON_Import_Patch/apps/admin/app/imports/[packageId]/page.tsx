'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, CircleAlert, FileJson2, Languages, ShieldAlert } from 'lucide-react';

type PackageQuestion = {
  id: string;
  base_question_id: string;
  language_question_codes: { en: string; hi?: string };
  order_index: number;
  original_question_number: string;
  question_type: string;
  common_data: Record<string, any>;
  english_data: Record<string, any>;
  hindi_data: Record<string, any> | null;
  classification_status: string;
  review_status: string;
};

type PackageDetails = {
  package: {
    id: string; package_id: string; schema_version: string; exam_year: number;
    exam_session: string; paper_number: number; shift: string; total_questions: number;
    imported_questions: number; validation_status: string; status: string;
    languages: string[]; manifest: Record<string, any>; qa_report: Record<string, any>;
    subjects?: { code: string; name: string } | null;
  };
  questions: PackageQuestion[];
};

function blocksToText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((block) => {
    if (!block || typeof block !== 'object') return '';
    const item = block as Record<string, unknown>;
    if (typeof item.text === 'string') return item.text;
    if (typeof item.latex === 'string') return item.latex;
    if (Array.isArray(item.items)) return item.items.filter((part) => typeof part === 'string').join(' · ');
    if (Array.isArray(item.rows)) return item.rows.map((row) => Array.isArray(row) ? row.join(' | ') : '').join('\n');
    return item.type === 'image' ? `[Image: ${String(item.alt_text ?? 'attached asset')}]` : '';
  }).filter(Boolean).join('\n');
}

export default function ImportPackageReviewPage({ params }: { params: Promise<{ packageId: string }> }) {
  const [packageId, setPackageId] = useState('');
  const [details, setDetails] = useState<PackageDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { void params.then((value) => setPackageId(value.packageId)); }, [params]);
  useEffect(() => {
    if (!packageId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/imports/${packageId}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Unable to load package.');
        if (!cancelled) setDetails(payload as PackageDetails);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load package.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [packageId]);

  if (loading) return <div className="admin-panel">Loading imported questions…</div>;
  if (error || !details) return <div className="admin-panel"><div className="admin-callout"><CircleAlert size={14} /> {error || 'Package not found.'}</div><Link className="admin-button secondary" href="/imports"><ArrowLeft size={13} /> Back to imports</Link></div>;

  const imported = details.package;
  return <>
    <div className="admin-page-heading">
      <div>
        <div className="admin-eyebrow">Private import staging · {imported.schema_version}</div>
        <h1>{imported.package_id}</h1>
        <p>{imported.subjects?.name ?? 'Subject'} · Paper {imported.paper_number} · {imported.exam_year} {imported.exam_session} · {imported.shift}</p>
      </div>
      <Link className="admin-button secondary" href="/imports"><ArrowLeft size={13} /> All packages</Link>
    </div>
    <div className="admin-stat-grid">
      {[
        { label: 'Questions staged', value: imported.imported_questions },
        { label: 'Languages', value: imported.languages.map((language) => language.toUpperCase()).join(' + ') },
        { label: 'Official question count', value: imported.qa_report.official_question_count ?? '—' },
        { label: 'QA exceptions', value: Array.isArray(imported.qa_report.exceptions) ? imported.qa_report.exceptions.length : 0 },
      ].map((item) => <div className="admin-stat" key={item.label}><div className="admin-stat-label">{item.label}</div><div className="admin-stat-value">{item.value}</div></div>)}
    </div>
    <div className="admin-callout"><ShieldAlert size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} /><b>Staging only.</b> Provider answer claims are not verified answers. These records have not yet been promoted into the canonical Question Bank, classified against the syllabus, or made visible to students.</div>
    {Array.isArray(imported.qa_report.exceptions) && imported.qa_report.exceptions.length > 0 && <section className="admin-panel" style={{ marginBottom: 14 }}>
      <div className="admin-panel-title">Provider QA exceptions</div>
      <div className="admin-panel-sub">These exceptions were supplied by the conversion provider and require manual review.</div>
      {imported.qa_report.exceptions.map((issue: Record<string, any>, index: number) => <div className="admin-row" key={`${issue.base_question_id}-${index}`}>
        <div className="admin-row-icon"><CircleAlert size={14} /></div>
        <div className="admin-row-main"><b>{issue.base_question_id}</b><small>{issue.issue}{issue.notes ? ` · ${issue.notes}` : ''}</small></div>
      </div>)}
    </section>}
    <section className="admin-panel">
      <div className="admin-panel-title">Imported question sequence</div>
      <div className="admin-panel-sub">Questions are displayed in original NTA order. The printed question number is retained separately from the order index.</div>
      <div className="package-question-list">
        {details.questions.map((question) => {
          const answer = question.common_data.answer ?? {};
          const languageCodes = question.language_question_codes;
          return <article className="package-question-card" key={question.id}>
            <div className="package-question-head">
              <div><span className="admin-tag blue">Order {question.order_index}</span><span className="package-original-number">NTA Q. {question.original_question_number}</span><b>{question.base_question_id}</b></div>
              <span className="admin-tag amber">Unreviewed</span>
            </div>
            <div className="package-code-row"><span>{languageCodes.en}</span>{languageCodes.hi && <span>{languageCodes.hi}</span>}<span>{question.question_type.replaceAll('_', ' ')}</span></div>
            <div className="package-language-preview">
              <div><h4><Languages size={13} /> English</h4><p>{blocksToText(question.english_data.question_blocks)}</p></div>
              {question.hindi_data && <div><h4><Languages size={13} /> Hindi</h4><p>{blocksToText(question.hindi_data.question_blocks)}</p></div>}
            </div>
            <div className="package-option-grid">
              {(question.english_data.options ?? []).map((option: Record<string, any>) => <div key={option.option_id}><b>{option.key}.</b> {blocksToText(option.content_blocks)}</div>)}
            </div>
            <div className="package-answer-preview">
              <div><small>Provider proposed answer</small><b>{Array.isArray(answer.proposed_correct_option_keys) && answer.proposed_correct_option_keys.length ? answer.proposed_correct_option_keys.join(', ') : 'Not provided'}</b></div>
              <span className="admin-tag amber">{String(answer.resolution ?? 'unknown').replaceAll('_', ' ')} · not verified</span>
            </div>
            <div className="package-source-evidence">
              <div><b>Question source references</b>{(question.common_data.source_references ?? []).map((reference: Record<string, any>, index: number) => <small key={`${reference.source_document_id}-${index}`}>{reference.source_document_id} · {reference.source_role?.replaceAll('_', ' ')} · page {reference.page_number ?? '—'} · {reference.match_status}</small>)}</div>
              <div><b>Answer evidence</b>{(answer.evidence ?? []).length ? (answer.evidence ?? []).map((evidence: Record<string, any>, index: number) => <small key={`${evidence.source_document_id}-${index}`}>{evidence.source_document_id} · {evidence.source_role?.replaceAll('_', ' ')} · page {evidence.page_number ?? '—'} · {evidence.claim_type?.replaceAll('_', ' ')}</small>) : <small>No provider answer evidence supplied.</small>}</div>
            </div>
            <div className="package-classification-row"><span>CrackJRF syllabus classification: <b>{question.classification_status}</b></span><span>Content review: <b>{question.review_status}</b></span></div>
          </article>;
        })}
      </div>
      {details.questions.length === 0 && <div className="admin-callout">This package contains no staged questions.</div>}
    </section>
    <div className="admin-callout" style={{ marginTop: 15 }}><CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Package validation confirms structural integrity only. Next Admin stage will create canonical questions, map E/H language codes and option IDs, attach source evidence, then route content, taxonomy and answers for review.</div>
  </>;
}
