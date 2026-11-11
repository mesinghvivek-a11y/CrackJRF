'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Download, FileSpreadsheet, LoaderCircle, RefreshCw, UploadCloud } from 'lucide-react';
import { createSupabaseBrowserClient } from '../../lib/supabase';

type Batch = {
  id: string;
  batch_code: string;
  file_name: string;
  exam_metadata: Record<string, string>;
  status: string;
  total_rows: number;
  valid_rows: number;
  rows_with_errors: number;
  rows_promoted: number;
  created_at: string;
};
type ImportResult = {
  batchId: string;
  batchCode: string;
  totalRows: number;
  publishedCount: number;
  questionCodes: Array<{ questionCode: string; paperNumber: number; originalQuestionNumber: string }>;
};

const TEMPLATE_URL = '/templates/CrackJRF_Question_Import_Template_v5.xlsx';

export default function ImportsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<ImportResult | null>(null);
  const [selectedName, setSelectedName] = useState('');

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/excel-imports', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load import history.');
      setBatches(payload.batches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load import history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBatches(); }, [loadBatches]);

  async function uploadWorkbook(file: File) {
    setSelectedName(file.name);
    setError('');
    setSuccess(null);
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Please select an .xlsx workbook.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('The workbook must be 25 MB or smaller.');
      return;
    }

    const client = createSupabaseBrowserClient();
    if (!client) {
      setError('Supabase browser configuration is missing.');
      return;
    }

    setUploading(true);
    let storagePath = '';
    try {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user) throw new Error('Your admin session has expired. Please sign in again.');
      const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
      storagePath = `excel-imports/${user.id}/${Date.now()}-${nonce}-${safeName}`;
      const { error: storageError } = await client.storage.from('source-pdfs').upload(storagePath, file, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        cacheControl: '3600',
        upsert: false,
      });
      if (storageError) throw new Error(`Workbook upload failed: ${storageError.message}`);

      const response = await fetch('/api/excel-imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath, fileName: file.name }),
      });
      const payload = await response.json();
      if (!response.ok) {
        await client.storage.from('source-pdfs').remove([storagePath]);
        storagePath = '';
        const rowDetails = Array.isArray(payload.rowErrors)
          ? payload.rowErrors.slice(0, 12).map((item: any) => `Row ${item.worksheetRow}: ${item.message}`).join('\n')
          : '';
        throw new Error([payload.error ?? 'Workbook import failed.', rowDetails].filter(Boolean).join('\n'));
      }
      setSuccess(payload as ImportResult);
      setSelectedName('');
      if (inputRef.current) inputRef.current.value = '';
      void loadBatches();
    } catch (err) {
      if (storagePath) await client.storage.from('source-pdfs').remove([storagePath]);
      setError(err instanceof Error ? err.message : 'Unable to import this workbook.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <div className="admin-eyebrow">One workbook · one operation</div>
          <h1>Excel Import Centre</h1>
          <p>Upload one completed workbook for an exam event or shift. Paper I and Paper II can be included together; all structurally valid rows publish atomically.</p>
        </div>
        <span className="admin-tag blue"><FileSpreadsheet size={12} style={{ marginRight: 5 }} /> XLSX · 25 MB max</span>
      </div>

      <section className="admin-panel excel-one-step-panel">
        <div className="excel-one-step-copy">
          <div className="admin-panel-title">Import an examination workbook</div>
          <div className="admin-panel-sub">One file per examination event or shift. Paper I and Paper II can be in the same workbook.</div>
        </div>
        <div className={`excel-one-step-drop ${uploading ? 'is-uploading' : ''}`}>
          {uploading ? <LoaderCircle className="spin" size={34} /> : <UploadCloud size={36} />}
          <b>{uploading ? 'Importing and publishing your questions…' : selectedName || 'Choose your completed Excel workbook'}</b>
          <span>{uploading ? 'The batch is being written as one database transaction. Please keep this page open.' : 'Select the .xlsx file. CrackJRF will validate the workbook and publish all valid rows together.'}</span>
          <label className="admin-button excel-upload-button">
            <FileSpreadsheet size={15} /> {uploading ? 'Please wait…' : 'Choose workbook & import'}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadWorkbook(file);
              }}
            />
          </label>
          <a className="excel-template-link" href={TEMPLATE_URL} download>
            <Download size={14} /> Download the Excel template v5
          </a>
        </div>
        <div className="excel-import-policy">
          <CheckCircle2 size={16} />
          <span><b>Trusted workbook workflow.</b> English question and A–D options are required. Hindi question, Hindi options and Hindi explanation columns are optional; blank or partial Hindi never blocks English publication and can be completed later in Question Bank.</span>
        </div>
      </section>

      {error && <div className="admin-callout excel-error-callout" role="alert" style={{ whiteSpace: 'pre-line' }}>{error}</div>}

      {success && (
        <section className="admin-panel excel-success-panel">
          <div className="excel-success-heading"><CheckCircle2 size={22} /><div><b>{success.batchCode} published</b><small>{success.publishedCount} of {success.totalRows} questions are now in the Question Bank.</small></div></div>
          <div className="excel-success-codes">
            {success.questionCodes?.slice(0, 12).map((item) => <span className="admin-tag green" key={item.questionCode}>{item.questionCode}</span>)}
            {(success.questionCodes?.length ?? 0) > 12 && <span className="admin-tag">+{success.questionCodes.length - 12} more</span>}
          </div>
          <Link className="admin-button" href={`/imports/excel/${success.batchId}`}>View imported questions</Link>
        </section>
      )}

      <section className="admin-panel excel-import-history">
        <div className="admin-panel-title" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
          <span>Recent imports</span>
          <button className="admin-button secondary" onClick={() => void loadBatches()} disabled={loading}><RefreshCw size={13} /> Refresh</button>
        </div>
        {loading ? <div className="import-empty">Loading…</div> : batches.length === 0 ? <div className="import-empty">No workbooks imported yet.</div> : (
          <div className="import-package-list">
            {batches.map((batch) => (
              <div className="import-package-row" key={batch.id}>
                <div className="import-package-icon"><FileSpreadsheet size={19} /></div>
                <div className="import-package-main"><b>{batch.batch_code}</b><small>{batch.file_name} · {batch.exam_metadata?.exam_year ?? '—'} {batch.exam_metadata?.exam_session ?? ''} · {batch.exam_metadata?.shift ?? 'Shift not specified'}</small></div>
                <div className="import-package-status"><span className={`admin-tag ${batch.status === 'completed' ? 'green' : 'amber'}`}>{batch.status === 'completed' ? 'Published' : batch.status}</span><small>{batch.rows_promoted}/{batch.total_rows} published</small></div>
                <Link className="admin-button secondary" href={`/imports/excel/${batch.id}`}>View</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
