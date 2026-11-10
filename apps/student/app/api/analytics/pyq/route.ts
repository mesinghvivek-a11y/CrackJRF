import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';
import geography from '@ugcnet/shared/syllabus/geography';
import { flattenSyllabus } from '@ugcnet/shared';
export const runtime='nodejs';
const nodes=flattenSyllabus(geography as any);const nodeMap=new Map(nodes.map(n=>[n.id,n]));
function classificationPath(id:string){let node=nodeMap.get(id);let unitId:string|null=null;let topicId:string|null=null;while(node){if(node.type==='unit')unitId=node.id;if(node.type==='topic')topicId=node.id;node=node.parentId?nodeMap.get(node.parentId):undefined;}return {unitId,topicId};}
export async function GET(){
 try{
  const db=await createServerSupabaseClient();const {data:{user}}=await db.auth.getUser();if(!user)return NextResponse.json({error:'Sign in to view PYQ analytics.'},{status:401});
  const {data:subject,error:subjectError}=await db.from('subjects').select('id').eq('code','80').single();if(subjectError)throw subjectError;
  const {data:questions,error:qError}=await db.from('questions').select('id,question_classifications(syllabus_node_id)').eq('subject_id',subject.id).eq('status','published').limit(10000);if(qError)throw qError;
  const qids=(questions??[]).map((q:any)=>q.id);if(!qids.length)return NextResponse.json({uniqueQuestions:0,totalAppearances:0,repeatedQuestions:0,years:[],unitTrends:[],topicTrends:[],sessionTotals:[]});
  const qTags=new Map<string,{units:Set<string>;topics:Set<string>}>();for(const q of questions as any[]){const tags={units:new Set<string>(),topics:new Set<string>()};for(const c of q.question_classifications??[]){const p=classificationPath(c.syllabus_node_id);if(p.unitId)tags.units.add(p.unitId);if(p.topicId)tags.topics.add(p.topicId);}qTags.set(q.id,tags)}
  const appearances:any[]=[];for(let i=0;i<qids.length;i+=500){const {data,error}=await db.from('question_appearances').select('id,question_id,exam_paper_id').in('question_id',qids.slice(i,i+500));if(error)throw error;appearances.push(...(data??[]));}
  const paperIds=[...new Set(appearances.map(a=>a.exam_paper_id))];const {data:papers,error:paperError}=paperIds.length?await db.from('exam_papers').select('id,paper_number,exam_event_id').in('id',paperIds):{data:[],error:null};if(paperError)throw paperError;
  const eventIds=[...new Set((papers??[]).map((p:any)=>p.exam_event_id))];const {data:events,error:eventError}=eventIds.length?await db.from('exam_events').select('id,year,session,event_type').in('id',eventIds):{data:[],error:null};if(eventError)throw eventError;
  const paperMap=new Map((papers??[]).map((p:any)=>[p.id,p]));const eventMap=new Map((events??[]).map((e:any)=>[e.id,e]));
  const annual=new Map<number,number>();const unitYear=new Map<string,number>();const topicYear=new Map<string,number>();const sessions=new Map<string,number>();const appearancesByQ=new Map<string,number>();
  for(const a of appearances){const p=paperMap.get(a.exam_paper_id) as any;const ev=p?eventMap.get(p.exam_event_id) as any:null;if(!ev||p.paper_number!==2)continue;annual.set(ev.year,(annual.get(ev.year)??0)+1);const sk=`${ev.session} ${ev.year}`;sessions.set(sk,(sessions.get(sk)??0)+1);appearancesByQ.set(a.question_id,(appearancesByQ.get(a.question_id)??0)+1);const tags=qTags.get(a.question_id);for(const id of tags?.units??[]){const k=`${id}|${ev.year}`;unitYear.set(k,(unitYear.get(k)??0)+1)}for(const id of tags?.topics??[]){const k=`${id}|${ev.year}`;topicYear.set(k,(topicYear.get(k)??0)+1)}}
  const years=[...new Set([...annual.keys()])].sort((a,b)=>a-b);const units=(geography as any).units;
  return NextResponse.json({uniqueQuestions:qids.length,totalAppearances:[...annual.values()].reduce((a,b)=>a+b,0),repeatedQuestions:[...appearancesByQ.values()].filter(n=>n>1).length,years,annualTotals:years.map(year=>({year,count:annual.get(year)??0})),unitTrends:units.map((u:any)=>({unitId:u.id,title:u.title,total:years.reduce((sum,y)=>sum+(unitYear.get(`${u.id}|${y}`)??0),0),values:years.map(year=>({year,count:unitYear.get(`${u.id}|${year}`)??0}))})),topicTrends:nodes.filter(n=>n.type==='topic').map(n=>({topicId:n.id,title:n.title,path:n.path,total:years.reduce((sum,y)=>sum+(topicYear.get(`${n.id}|${y}`)??0),0),values:years.map(year=>({year,count:topicYear.get(`${n.id}|${year}`)??0}))})).sort((a,b)=>b.total-a.total),sessionTotals:[...sessions.entries()].map(([label,count])=>({label,count})).sort((a,b)=>a.label.localeCompare(b.label)),note:'Unit and topic totals overlap because a single question can be classified in more than one unit/topic. Overall question and appearance totals are calculated separately.'});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to calculate PYQ analytics'},{status:400});}
}
