'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, AlertCircle, CheckCircle2, Download, FileSpreadsheet, FileUp, RefreshCw, ShieldCheck } from 'lucide-react';
import { createSupabaseBrowserClient } from '../../lib/supabase';

type Batch = {
  id: string; batch_code: string; file_name: string; exam_metadata: Record<string, string>;
  status: string; total_rows: number; valid_rows: number; rows_with_errors: number;
  rows_promoted: number; created_at: string;
};
type UploadResult = { batchId: string; batchCode: string; totalRows: number; validRows: number; rowsWithErrors: number };

export default function ImportsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<UploadResult | null>(null);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/excel-imports', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load import history.');
      setBatches(payload.batches ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load import history.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadBatches(); }, [loadBatches]);

  async function uploadWorkbook() {
    if (!file) { setError('Choose the CrackJRF .xlsx workbook first.'); return; }
    if (!file.name.toLowerCase().endsWith('.xlsx')) { setError('Only .xlsx Excel workbooks are accepted.'); return; }
    if (file.size > 25 * 1024 * 1024) { setError('Workbook must be 25 MB or smaller.'); return; }
    const client = createSupabaseBrowserClient();
    if (!client) { setError('Supabase browser configuration is missing.'); return; }
    setBusy(true); setError(''); setSuccess(null);
    let storagePath = '';
    try {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user) throw new Error('Your admin session has expired. Sign in again.');
      const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
      storagePath = `excel-imports/${user.id}/${Date.now()}-${nonce}-${safeName}`;
      const { error: storageError } = await client.storage.from('source-pdfs').upload(storagePath, file, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', cacheControl: '3600', upsert: false,
      });
      if (storageError) throw new Error(`Private workbook upload failed: ${storageError.message}. Apply migration 0003 first.`);
      const response = await fetch('/api/excel-imports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath, fileName: file.name }),
      });
      const payload = await response.json();
      if (!response.ok) {
        await client.storage.from('source-pdfs').remove([storagePath]); storagePath = '';
        throw new Error(payload.error ?? 'Workbook validation failed.');
      }
      setSuccess(payload as UploadResult); setFile(null);
      const input = document.getElementById('excel-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await loadBatches();
    } catch (uploadError) {
      if (storagePath) await client.storage.from('source-pdfs').remove([storagePath]);
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to import Excel workbook.');
    } finally { setBusy(false); }
  }

  return <>
    <div className="admin-page-heading">
      <div>
        <div className="admin-eyebrow">Single-file question intake · Excel-first</div>
        <h1>Excel Import Centre</h1>
        <p>Upload one workbook containing Paper I and Paper II. CrackJRF checks each row and creates editable private drafts; nothing is published automatically.</p>
      </div>
      <span className="admin-tag blue"><FileSpreadsheet size={12} style={{ marginRight: 5 }} /> XLSX · Max 25 MB</span>
    </div>

    <div className="admin-grid import-centre-grid">
      <section className="admin-panel">
        <div className="admin-panel-title">Upload one examination workbook</div>
        <div className="admin-panel-sub">Use one workbook for an exam year, session and shift. Fill the Exam Metadata sheet once; use one row per question.</div>
        <div className="drop-zone">
          <FileSpreadsheet size={30} />
          <h3>{file ? file.name : 'Choose the CrackJRF question workbook'}</h3>
          <p>English is required. Official Hindi and Hinglish columns are optional. Paper I and Paper II can be in the same sheet.</p>
          <label className="admin-button secondary" style={{ cursor: 'pointer' }}>
            <FileUp size={14} /> Choose Excel workbook
            <input id="excel-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); setSuccess(null); }} />
          </label>
          {file && <div style={{ marginTop: 12, fontSize: 10, color: '#16865d' }}>{(file.size / 1024 / 1024).toFixed(2)} MB selected</div>}
        </div>
        <div className="admin-filter-row" style={{ marginTop: 14 }}>
          <a className="admin-button secondary" href="/templates/CrackJRF_Question_Import_Template_v2.xlsx" download><Download size={13} /> Download Excel template</a>
          <button className="admin-button" onClick={uploadWorkbook} disabled={busy || !file}><ShieldCheck size={14} /> {busy ? 'Uploading and validating…' : 'Upload and validate workbook'}</button>
        </div>
        {busy && <div className="admin-callout">The workbook is uploaded to private storage. CrackJRF reads the Questions and Exam Metadata sheets, validates rows and stores them in private staging. Answer claims remain unverified.</div>}
        {success && <div className="admin-callout" style={{ background: '#edf9f2', borderColor: '#d7efdf', color: '#28704d' }}>
          <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} /><b>{success.batchCode}</b> imported.
          <div style={{ marginTop: 7 }}>{success.totalRows} rows · {success.validRows} structurally valid · {success.rowsWithErrors} require correction.</div>
          <div style={{ marginTop: 9 }}><Link className="admin-button success" href={`/imports/excel/${success.batchId}`}>Open editable staging</Link></div>
        </div>}
        {error && <div className="admin-callout" style={{ background: '#fff4ed', borderColor: '#f4ddd0', color: '#9a4c2b' }}><AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{error}</div>}
      </section>
      <aside className="admin-panel">
        <div className="admin-panel-title">How this import works</div>
        {[
          ['One workbook', 'The Exam Metadata sheet identifies year, session, shift and source filenames. The Questions sheet holds all papers.'],
          ['Editable staging', 'Each row can be corrected before it becomes a canonical Question Bank draft.'],
          ['Classification suggestions', 'Unit, section, topic and subtopic values are suggestions; edit them against the CrackJRF taxonomy.'],
          ['Translation drafts', 'Generate Hindi or Roman-script Hinglish through the configured Gemini API. Existing text is never overwritten automatically.'],
          ['Answer safety', 'Institution and AI answer claims are saved as unverified evidence. The Question Bank answer remains pending.'],
          ['Private until approved', 'A promoted question remains a draft. Only the existing Reviewer/Super Admin approval workflow can publish it.'],
        ].map(([title, description], index) => <div className="admin-row" key={title}><div className="admin-row-icon">{index + 1}</div><div className="admin-row-main"><b>{title}</b><small>{description}</small></div></div>)}
        <div className="admin-callout">The Excel file records source filenames and page references. The original PDFs are not embedded in the workbook; keep them archived with your source collection. You can add actual image crops or diagrams to a staged question from its editor.</div>
      </aside>
    </div>

    <section className="admin-panel" style={{ marginTop: 15 }}>
      <div className="admin-panel-title" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><span>Recent Excel imports</span><button className="admin-button secondary" onClick={loadBatches}><RefreshCw size={13} /> Refresh</button></div>
      {loading ? <div className="import-empty">Loading import history…</div> : batches.length === 0 ? <div className="import-empty">No Excel workbooks imported yet.</div> : <div className="import-package-list">{batches.map((batch) => <div className="import-package-row" key={batch.id}>
        <div className="import-package-icon"><FileSpreadsheet size={19} /></div>
        <div className="import-package-main"><b>{batch.batch_code}</b><small>{batch.file_name} · {batch.exam_metadata?.exam_year ?? 'Year?'} {batch.exam_metadata?.exam_session ?? ''} · {batch.exam_metadata?.shift ?? 'Shift not specified'}</small></div>
        <div className="import-package-status"><span className={`admin-tag ${batch.rows_with_errors ? 'amber' : 'green'}`}>{batch.rows_with_errors ? `${batch.rows_with_errors} corrections` : 'Validated'}</span><small>{batch.rows_promoted}/{batch.total_rows} added to Question Bank</small></div>
        <Link className="admin-button secondary" href={`/imports/excel/${batch.id}`}>Open</Link>
      </div>)}</div>}
    </section>
  </>;
}
