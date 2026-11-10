'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, CheckCircle2, CircleAlert, FileJson2, FileUp, RefreshCw, ShieldCheck } from 'lucide-react';
import { createSupabaseBrowserClient } from '../../lib/supabase';

type ImportPackage = {
  id: string;
  package_id: string;
  schema_version: string;
  exam_year: number;
  exam_session: string;
  paper_number: number;
  shift: string | null;
  total_questions: number;
  imported_questions: number;
  validation_status: 'valid' | 'valid_with_warnings';
  status: string;
  languages: string[];
  created_at: string;
  subjects?: { code: string; name: string } | null;
};

type UploadSuccess = {
  importPackageId: string;
  packageId: string;
  questionCount: number;
  validationStatus: string;
  warnings: string[];
};

export default function ImportsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [packages, setPackages] = useState<ImportPackage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<UploadSuccess | null>(null);

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/imports', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load import history.');
      setPackages(payload.packages ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load import history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPackages(); }, [loadPackages]);

  async function uploadPackage() {
    if (!file) {
      setError('Choose a vendor ZIP package first.');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Only ZIP packages are accepted. Do not upload PDFs or extraction JSON files separately.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('The ZIP package must be 100 MB or smaller.');
      return;
    }

    const client = createSupabaseBrowserClient();
    if (!client) {
      setError('Supabase browser configuration is missing.');
      return;
    }

    setBusy(true);
    setError('');
    setSuccess(null);
    let storagePath = '';
    try {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user) throw new Error('Your admin session has expired. Sign in again.');
      const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
      storagePath = `packages/${user.id}/${Date.now()}-${nonce}.zip`;

      const { error: storageError } = await client.storage.from('source-pdfs').upload(storagePath, file, {
        contentType: 'application/zip',
        cacheControl: '3600',
        upsert: false,
      });
      if (storageError) throw new Error(`Private storage upload failed: ${storageError.message}. Apply the JSON import migration first.`);

      const response = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath }),
      });
      const payload = await response.json();
      if (!response.ok) {
        await client.storage.from('source-pdfs').remove([storagePath]);
        storagePath = '';
        throw new Error(payload.error ?? 'Package validation failed.');
      }
      setSuccess(payload as UploadSuccess);
      setFile(null);
      const input = document.getElementById('package-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await loadPackages();
    } catch (uploadError) {
      if (storagePath) await client.storage.from('source-pdfs').remove([storagePath]);
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload JSON package.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="admin-page-heading">
      <div>
        <div className="admin-eyebrow">Vendor data intake · Schema v1.0.0</div>
        <h1>JSON Import Centre</h1>
        <p>Upload a consolidated NTA paper package. CrackJRF validates it and places every question in private staging.</p>
      </div>
      <span className="admin-tag blue"><FileJson2 size={12} style={{ marginRight: 5 }} /> ZIP · Max 100 MB</span>
    </div>

    <div className="admin-grid import-centre-grid">
      <section className="admin-panel">
        <div className="admin-panel-title">Upload provider package</div>
        <div className="admin-panel-sub">One ZIP per paper, year, session, shift and re-examination event.</div>
        <div className="drop-zone">
          <Archive size={29} />
          <h3>{file ? file.name : 'Choose a CrackJRF JSON package'}</h3>
          <p>ZIP must contain manifest, common question data, English data, QA report, checksums and assets folder.</p>
          <label className="admin-button secondary" style={{ cursor: 'pointer' }}>
            <FileUp size={14} /> Choose ZIP
            <input id="package-file" type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setFile(event.target.files?.[0] ?? null); setError(''); setSuccess(null); }} />
          </label>
          {file && <div style={{ marginTop: 12, fontSize: 10, color: '#16865d' }}>{(file.size / 1024 / 1024).toFixed(2)} MB selected</div>}
        </div>
        <button className="admin-button" style={{ marginTop: 16 }} onClick={uploadPackage} disabled={busy || !file}>
          <ShieldCheck size={14} /> {busy ? 'Uploading and validating…' : 'Upload and validate package'}
        </button>
        {busy && <div className="admin-callout">The ZIP is uploaded directly to private Supabase Storage. The Admin server then validates its structure, question sequence, language pairing, source references, checksums and media files. No PDF OCR is run.</div>}
        {success && <div className="admin-callout" style={{ background: '#edf9f2', borderColor: '#d7efdf', color: '#28704d' }}>
          <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          <b>{success.packageId}</b> validated and staged: {success.questionCount} question(s).
          <div style={{ marginTop: 8 }}><Link className="admin-button success" href={`/imports/${success.importPackageId}`}>Open staged package</Link></div>
          {success.warnings.map((warning) => <div key={warning} style={{ marginTop: 6 }}>• {warning}</div>)}
        </div>}
        {error && <div className="admin-callout" style={{ background: '#fff4ed', borderColor: '#f4ddd0', color: '#9a4c2b' }}><CircleAlert size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{error}</div>}
      </section>

      <aside className="admin-panel">
        <div className="admin-panel-title">What the importer checks</div>
        <div className="admin-panel-sub">A structurally valid package is not an academically approved question bank.</div>
        {[
          ['Package integrity', 'Required files, JSON syntax, checksums and media hashes.'],
          ['Question identity', 'Stable base IDs, E/H language codes and shared option IDs.'],
          ['Official sequence', 'Sequential order_index and original NTA question number preserved.'],
          ['Sources and answers', 'Source references must exist; answer claims remain unverified.'],
          ['Taxonomy separation', 'Provider syllabus tags and keywords are rejected. CrackJRF assigns them.'],
          ['Private staging', 'Nothing is converted into a student-visible question during import.'],
        ].map(([title, description], index) => <div className="admin-row" key={title}>
          <div className="admin-row-icon">{index + 1}</div>
          <div className="admin-row-main"><b>{title}</b><small>{description}</small></div>
        </div>)}
        <div className="admin-callout">The provider performs PDF extraction, source matching and NTA-order consolidation. This Admin application does not run OCR or attempt to match solved papers.</div>
      </aside>
    </div>

    <section className="admin-panel" style={{ marginTop: 16 }}>
      <div className="admin-panel-title">Recent imported packages</div>
      <div className="admin-panel-sub">Imported content remains in staging until content review, taxonomy assignment, answer verification and Super Admin approval are complete.</div>
      <div className="admin-filter-row" style={{ justifyContent: 'flex-end' }}>
        <button className="admin-button secondary" onClick={loadPackages} disabled={loading}><RefreshCw size={13} /> Refresh</button>
      </div>
      {loading ? <p className="import-empty">Loading package history…</p> : packages.length === 0 ? <div className="admin-callout">No JSON packages imported yet. Use the uploader above to import your first provider delivery.</div> :
        <div className="import-package-list">
          {packages.map((item) => <article className="import-package-row" key={item.id}>
            <div className="import-package-icon"><FileJson2 size={19} /></div>
            <div className="import-package-main">
              <b>{item.package_id}</b>
              <small>{item.subjects?.name ?? 'Subject'} · Paper {item.paper_number} · {item.exam_year} {item.exam_session} · {item.shift ?? 'Shift not set'}</small>
              <small>{item.total_questions} questions · {item.languages.map((language) => language.toUpperCase()).join(' + ')} · {new Date(item.created_at).toLocaleString()}</small>
            </div>
            <div className="import-package-status">
              <span className={`admin-tag ${item.validation_status === 'valid' ? 'green' : 'amber'}`}>{item.validation_status.replaceAll('_', ' ')}</span>
              <small>{item.status.replaceAll('_', ' ')}</small>
            </div>
            <Link className="admin-button secondary" href={`/imports/${item.id}`}>Review package</Link>
          </article>)}
        </div>}
    </section>
  </>;
}
