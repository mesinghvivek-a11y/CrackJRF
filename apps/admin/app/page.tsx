'use client';
import { useEffect, useState } from 'react';
import { Languages, RefreshCw } from 'lucide-react';

type DashboardData = {
  totals: { questions: number; published: number; drafts: number; years: number };
  subjects: Array<{ id: string; code: string; name: string; paperType: string; count: number }>;
  years: number[];
  papers: Array<{ id: string; paperNumber: number; subject: string; subjectCode: string; year: number | null; session: string; count: number }>;
  sessions: Array<{ label: string; events: number }>;
  languages: { english: number; hindi: number };
};
const number = (value: number) => new Intl.NumberFormat('en-IN').format(value);
export default function AdminHome() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try { const response = await fetch('/api/dashboard', { cache: 'no-store' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load dashboard.'); setData(payload); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load dashboard.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  return <>
    <div className="admin-page-heading"><div><div className="admin-eyebrow">CrackJRF · Live resources</div><h1>Dashboard</h1><p>Live question-bank coverage from your Supabase database.</p></div><button className="admin-button secondary" onClick={() => void load()} disabled={busy}><RefreshCw size={13}/> Refresh data</button></div>
    {error && <div className="admin-callout" role="alert">{error}</div>}
    <div className="admin-stat-grid">
      {[['Total questions',data?.totals.questions,'All stored questions'],['Published questions',data?.totals.published,'Visible to students'],['Draft questions',data?.totals.drafts,'Not published'],['Years covered',data?.totals.years,'Exam years represented']].map(([label,value,foot])=><section className="admin-stat" key={String(label)}><div className="admin-stat-label">{label}</div><div className="admin-stat-value">{busy?'—':number(Number(value??0))}</div><div className="admin-stat-foot">{foot}</div></section>)}
    </div>
    <div className="admin-dashboard-grid">
      <section className="admin-panel"><div className="admin-panel-title">Subject coverage</div><div className="admin-panel-sub">Questions grouped by configured subject</div>{(data?.subjects??[]).map(s=><div className="dashboard-meter-row" key={s.id}><div><b>{s.name}</b><small>Code {s.code} · {s.paperType==='common'?'Common Paper I':'Paper II'}</small></div><strong>{number(s.count)}</strong><div className="dashboard-meter"><span style={{width:`${data?.totals.questions?Math.max(1,s.count/data.totals.questions*100):0}%`}}/></div></div>)}{!busy&&!data?.subjects.length&&<div className="admin-empty">No active subjects configured.</div>}</section>
      <section className="admin-panel"><div className="admin-panel-title">Paper coverage</div><div className="admin-panel-sub">Question appearances grouped by paper and subject</div><div className="dashboard-paper-grid">{[1,2].map(p=>{const count=(data?.papers??[]).filter(x=>x.paperNumber===p).reduce((n,x)=>n+x.count,0);return <div className="dashboard-paper-card" key={p}><span>Paper {p===1?'I':'II'}</span><b>{number(count)}</b><small>Question appearances</small></div>})}</div><div className="dashboard-coverage-list">{(data?.papers??[]).filter(p=>p.count>0).sort((a,b)=>(b.year??0)-(a.year??0)).slice(0,8).map(p=><div key={p.id}><span>{p.year??'Year unavailable'} · {p.session} · Paper {p.paperNumber}</span><b>{number(p.count)}</b></div>)}</div></section>
    </div>
    <div className="admin-dashboard-grid dashboard-bottom-grid">
      <section className="admin-panel"><div className="admin-panel-title">Exam years</div><div className="admin-panel-sub">Years represented in exam-event metadata</div><div className="dashboard-year-chips">{(data?.years??[]).map(y=><span key={y}>{y}</span>)}</div><div className="dashboard-coverage-list">{(data?.sessions??[]).map(s=><div key={s.label}><span>{s.label}</span><b>{s.events} event{s.events===1?'':'s'}</b></div>)}</div></section>
      <section className="admin-panel"><div className="admin-panel-title">Language coverage</div><div className="admin-panel-sub">Saved translation records</div><div className="dashboard-language-row"><Languages size={17}/><span>English records</span><b>{number(data?.languages.english??0)}</b></div><div className="dashboard-language-row"><Languages size={17}/><span>Hindi records</span><b>{number(data?.languages.hindi??0)}</b></div><div className="admin-panel-sub dashboard-language-note">Hindi is optional at import. Missing Hindi can be added later from Question Bank.</div></section>
    </div>
  </>;
}
