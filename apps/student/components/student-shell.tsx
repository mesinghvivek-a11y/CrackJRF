"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ChartNoAxesCombined, ClipboardCheck, GraduationCap, LayoutDashboard, Menu, UserRound, Bookmark, X, Target } from "lucide-react";
import { useState } from "react";
const nav = [
  { href:"/", label:"Overview", icon:LayoutDashboard },
  { href:"/pyq", label:"PYQ Library", icon:BookOpen },
  { href:"/tests", label:"Practice & Tests", icon:ClipboardCheck },
  { href:"/analytics", label:"PYQ Analytics", icon:ChartNoAxesCombined },
  { href:"/performance", label:"My Performance", icon:Target },
  { href:"/revision", label:"Revision", icon:Bookmark },
];
export function StudentShell({children}:{children:React.ReactNode}) {
  const path=usePathname(); const [open,setOpen]=useState(false);
  return <div className="student-frame">
    <aside className={`sidebar ${open?"sidebar-open":""}`}>
      <div className="brand"><div className="brand-mark"><GraduationCap size={21}/></div><div><b>NET Prep</b><small>UGC NET learning workspace</small></div><button className="mobile-close" onClick={()=>setOpen(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="subject-switch"><span>ACTIVE SUBJECT</span><b>Geography <small>· Code 80</small></b><span className="switch-note">Paper II · English</span></div>
      <nav className="side-nav">{nav.map(n=>{const Icon=n.icon;return <Link key={n.href} href={n.href} className={`nav-link ${path===n.href?"active":""}`} onClick={()=>setOpen(false)}><Icon size={18}/>{n.label}</Link>})}</nav>
      <div className="sidebar-bottom"><div className="upgrade-card"><b>Study with direction</b><p>Track the topics you have mastered and the ones that need revision.</p><Link href="/analytics">View progress <span>→</span></Link></div><Link className="nav-link" href="/auth"><UserRound size={18}/>Account & settings</Link></div>
    </aside>
    {open && <button className="scrim" onClick={()=>setOpen(false)} aria-label="Close navigation"/>}
    <main className="main-area"><header className="topbar"><button className="mobile-menu" onClick={()=>setOpen(true)} aria-label="Open navigation"><Menu/></button><div className="crumb">UGC NET <span>/</span> Geography</div><div className="top-actions"><span className="status-dot"/> <span className="top-status">Learning workspace</span><Link className="avatar" href="/auth">S</Link></div></header><div className="page-content">{children}</div></main>
  </div>;
}
