'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Pencil, RefreshCw } from 'lucide-react';

type ImportRow = {
  id: string;
  paper_number: number | null;
  subject_code: string | null;
  original_question_number: string | null;
  paper_order: number | null;
  row_data: Record<string, any>;
  canonical_question_id: string | null;
};
type Batch = {
  id: string; batch_code: string; file_name: string; exam_metadata: Record<string, string>;
  status: string; total_rows: number; rows_promoted: number; created_at: string;
};

export default function ExcelBatchPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params.batchId;
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/excel-imports/${batchId}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load this import.');
      setBatch(payload.batch);
      setRows(payload.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load this import.');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <section className="admin-panel">Loading imported questions…</section>;
  if (!batch) return <section className="admin-panel"><div className="admin-callout">{error || 'Import batch not found.'}</div><Link className="admin-button secondary" href="/imports"><ArrowLeft size={14}/> Imports</Link></section>;

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <div className="admin-eyebrow">Import batch · {batch.batch_code}</div>
          <h1>Published questions</h1>
          <p>{batch.file_name} · {batch.exam_metadata?.exam_year} {batch.exam_metadata?.exam_session} · {batch.exam_metadata?.shift || 'Shift not specified'}</p>
        </div>
        <div className="admin-filter-row">
          <button className="admin-button secondary" onClick={() => void load()}><RefreshCw size={13}/> Refresh</button>
          <Link className="admin-button secondary" href="/imports"><ArrowLeft size={13}/> All imports</Link>
        </div>
      </div>
      <div className="admin-stat-grid">
        <div className="admin-stat"><div className="admin-stat-label">Workbook questions</div><div className="admin-stat-value">{batch.total_rows}</div></div>
        <div className="admin-stat"><div className="admin-stat-label">Published</div><div className="admin-stat-value">{batch.rows_promoted}</div></div>
        <div className="admin-stat"><div className="admin-stat-label">Batch status</div><div className="admin-stat-value" style={{fontSize:18}}>{batch.status}</div></div>
      </div>
      <section className="admin-panel">
        <div className="admin-panel-title">Questions from this workbook</div>
        <div className="admin-panel-sub">The imported workbook has been published. Open any question to edit it; the live version remains unchanged until you publish your edits.</div>
        {error && <div className="admin-callout">{error}</div>}
        <div className="excel-published-list">
          {rows.map((row) => {
            const code = String(row.row_data?.canonical_question_code ?? '');
            const stem = String(row.row_data?.question_english ?? 'Question text unavailable');
            return (
              <div className="excel-published-row" key={row.id}>
                <div className="excel-published-number">{row.paper_order ?? '—'}</div>
                <div className="excel-published-main">
                  <div className="excel-published-meta"><span className="admin-tag blue">Paper {row.paper_number}</span><span className="admin-tag green"><CheckCircle2 size={11}/> Published</span><span className="admin-tag">Q. {row.original_question_number}</span></div>
                  <b>{code || 'Question code unavailable'}</b>
                  <p>{stem}</p>
                </div>
                {code ? <Link className="admin-button" href={`/review?questionCode=${encodeURIComponent(code)}`}><Pencil size={13}/> Edit question</Link> : <span className="admin-tag amber">Question link unavailable</span>}
              </div>
            );
          })}
        </div>
        {rows.length === 0 && <div className="import-empty">No questions were returned for this batch.</div>}
      </section>
    </>
  );
}
