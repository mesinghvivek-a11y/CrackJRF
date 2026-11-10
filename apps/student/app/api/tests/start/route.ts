import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';
export const runtime='nodejs';
const shuffled=<T,>(items:T[])=>[...items].sort(()=>Math.random()-.5);
export async function POST(request:Request){
 try{
  const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Sign in before starting a test.'},{status:401});
  const body=await request.json();const mode=String(body.mode??'geography_only');const subjectCode=String(body.subjectCode??'80');const units:string[]=Array.isArray(body.unitIds)?body.unitIds:[];const topics:string[]=Array.isArray(body.topicIds)?body.topicIds:[];const years:number[]=Array.isArray(body.years)?body.years.map(Number):[];const session=body.session?String(body.session):null;const requested=Number(body.questionCount??(mode==='full_ugc_net'?150:mode==='geography_only'?100:20));
  if(!Number.isInteger(requested)||requested<1||requested>150)return NextResponse.json({error:'Question count must be between 1 and 150.'},{status:400});
  const getCandidates=async(code:string,paper:number,need:number)=>{
   const {data,error}=await supabase.from('questions').select('id,answer_status,question_classifications(syllabus_node_id),question_appearances(original_question_number,exam_papers(paper_number,exam_events(year,session))) ,subjects!inner(code)').eq('status','published').eq('subjects.code',code).limit(3000);if(error)throw error;
   const eligible=(data??[]).filter((q:any)=>{
    if(!['single_correct','multiple_correct','all_options_correct','dropped'].includes(q.answer_status))return false;
    const tags=(q.question_classifications??[]).map((x:any)=>x.syllabus_node_id);if(units.length+topics.length&&!units.concat(topics).some(x=>tags.includes(x)))return false;
    const appearances=q.question_appearances??[];if(years.length||session){if(!appearances.some((a:any)=>{const p=a.exam_papers;const ev=Array.isArray(p?.exam_events)?p.exam_events[0]:p?.exam_events;return p?.paper_number===paper&&(!years.length||years.includes(Number(ev?.year)))&&(!session||ev?.session===session)}))return false;}
    if(appearances.length&&!appearances.some((a:any)=>a.exam_papers?.paper_number===paper))return false;
    return true;
   });
   const unique=[...new Map(eligible.map((q:any)=>[q.id,q])).values()];if(unique.length<need)throw new Error(`${code==='00'?'Paper I':'Geography Paper II'} has only ${unique.length} eligible published questions; ${need} are required. Review and publish more questions first.`);return shuffled(unique).slice(0,need).map((q:any)=>({id:q.id,paper}));
  };
  let chosen:{id:string;paper:number}[]=[];let blueprint='';
  if(mode==='full_ugc_net'){
   if(units.length||topics.length||years.length||session) return NextResponse.json({error:'Full UGC NET mocks use the complete current syllabus; use Custom Test for filters.'},{status:400});
   chosen=[...await getCandidates('00',1,50),...await getCandidates(subjectCode,2,100)];blueprint='UGCNET_FULL_150_180';
  }else if(mode==='geography_only'){
   chosen=await getCandidates('80',2,100);blueprint='GEOGRAPHY_100_120';
  }else{
   if(subjectCode!=='80')return NextResponse.json({error:'Custom tests are initially enabled for Geography. Other subjects will be activated in later releases.'},{status:400});
   chosen=await getCandidates('80',2,requested);blueprint='CUSTOM_GEOGRAPHY';
  }
  const duration=mode==='custom'?Math.max(1,Math.ceil(chosen.length*72/60)):null;
  const {data:attemptId,error}=await supabase.rpc('start_test_attempt',{p_blueprint_code:blueprint,p_question_ids:chosen.map(x=>x.id),p_paper_numbers:chosen.map(x=>x.paper),p_duration_minutes:duration});if(error)throw error;
  const {data:attempt,error:attemptError}=await supabase.from('test_attempts').select('id,started_at,deadline_at,status,configuration_snapshot').eq('id',attemptId).single();if(attemptError)throw attemptError;
  const {data:items,error:itemsError}=await supabase.from('test_attempt_questions').select('id,question_id,sequence_number,paper_number,question_snapshot').eq('attempt_id',attemptId).order('sequence_number');if(itemsError)throw itemsError;
  return NextResponse.json({attempt,items},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to start test'},{status:400});}
}
