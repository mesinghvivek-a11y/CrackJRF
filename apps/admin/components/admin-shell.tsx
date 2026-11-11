"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldCheck, LayoutDashboard, FileSpreadsheet, BookOpenCheck, Tags, Settings, Menu, X, GraduationCap, BriefcaseBusiness, Users } from "lucide-react";
import { AdminGate } from "./admin-gate";
const links=[
 {href:"/",label:"Dashboard",icon:LayoutDashboard},
 {href:"/imports",label:"Excel Import Centre",icon:FileSpreadsheet},
 {href:"/questions",label:"Question Bank",icon:BookOpenCheck},
 {href:"/syllabus",label:"Syllabus",icon:Tags},
 {href:"/manager",label:"Manager",icon:BriefcaseBusiness},
 {href:"/settings",label:"Settings",icon:Settings},
 {href:"/role",label:"Role",icon:Users},
];
export function AdminShell({children}:{children:React.ReactNode}){
 const path=usePathname();const [open,setOpen]=useState(false);const [roleLabel,setRoleLabel]=useState("Administrator");const studentUrl=process.env.NEXT_PUBLIC_STUDENT_APP_URL||"http://localhost:3000";
 useEffect(()=>{fetch("/api/role",{cache:"no-store"}).then(async r=>{if(!r.ok)return;const d=await r.json();const labels:Record<string,string>={super_admin:"Super Admin",content_editor:"Content Editor",reviewer:"Reviewer",importer:"Importer"};setRoleLabel(labels[d.currentRole]??"Administrator");}).catch(()=>setRoleLabel("Administrator"));},[]);
 const active=links.find(l=>l.href===path||(l.href!=="/"&&path.startsWith(l.href+"/")));
 return <div className="admin-frame"><aside className={`admin-sidebar ${open?"open":""}`}><div className="admin-brand"><div className="admin-logo"><ShieldCheck/></div><div><b>CrackJRF Admin</b><small>Content management</small></div><button className="admin-mobile-close" onClick={()=>setOpen(false)} aria-label="Close menu"><X size={18}/></button></div><div className="admin-label">WORKSPACE</div><nav>{links.map(l=>{const I=l.icon;return <Link key={l.href} href={l.href} className={`admin-nav ${path===l.href||(l.href!=="/"&&path.startsWith(l.href+"/"))?"active":""}`} onClick={()=>setOpen(false)}><I size={17}/>{l.label}</Link>})}</nav><div className="admin-side-bottom"><div className="admin-role"><div className="role-icon"><GraduationCap size={17}/></div><div><b>{roleLabel}</b><small>Protected workspace</small></div></div><Link className="student-link" href={studentUrl} target="_blank">Open student website ↗</Link></div></aside>{open&&<button className="admin-scrim" onClick={()=>setOpen(false)} aria-label="Close navigation"/>}<main className="admin-main"><header className="admin-topbar"><button className="admin-menu" onClick={()=>setOpen(true)} aria-label="Open menu"><Menu/></button><div><span className="admin-crumb">ADMIN / </span><b>{active?.label??"Content workspace"}</b></div><div className="admin-top-right"><span className="admin-live-dot"/>Private workspace</div></header>{path === "/auth" ? <div className="admin-content">{children}</div> : <AdminGate><div className="admin-content">{children}</div></AdminGate>}</main></div>
}
