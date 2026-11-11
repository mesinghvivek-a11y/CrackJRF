import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
export const runtime='nodejs';
export async function GET(request:Request){
 try{
  const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Sign in to access the question library.'},{status:401});
  const u=new URL(request.url);const subjectCode=u.searchParams.get('subject')??'80';const unitId=u.searchParams.get('unit');const topicId=u.searchParams.get('topic');const year=u.searchParams.get('year');const session=u.searchParams.get('session');const limit=Math.min(Math.max(Number(u.searchParams.get('limit')??60),1),150);
  let query=supabase.from('questions').select('id,question_code,question_type,answer_status,question_translations(language,script_variant,reviewed,stem_blocks,instruction_blocks),question_options(option_key,sort_order,question_option_translations(language,script_variant,reviewed,content_blocks)),question_assets(id,asset_type,placement,alt_text,caption,sort_order),question_classifications(syllabus_node_id,is_primary),question_appearances(original_question_number,nta_question_id,exam_papers(paper_number,shift,exam_date,exam_events(year,session,event_type))) ,subjects!inner(code)').eq('status','published').eq('subjects.code',subjectCode).limit(limit);
  const {data,error}=await query;if(error)throw error;
  const items=(data??[]).map((q:any)=>({
   ...q,
   question_translations:(q.question_translations??[]).filter((t:any)=>t.reviewed===true),
   question_options:(q.question_options??[]).map((option:any)=>({...option,question_option_translations:(option.question_option_translations??[]).filter((t:any)=>t.reviewed===true)})),
  })).filter((q:any)=>{
   const tags=q.question_classifications??[];if(unitId&&!tags.some((t:any)=>t.syllabus_node_id===unitId))return false;if(topicId&&!tags.some((t:any)=>t.syllabus_node_id===topicId))return false;
   if(year||session){const matches=(q.question_appearances??[]).some((a:any)=>{const event=Array.isArray(a.exam_papers?.exam_events)?a.exam_papers.exam_events[0]:a.exam_papers?.exam_events;return (!year||String(event?.year)===year)&&(!session||event?.session===session)});if(!matches)return false;}return true;
  });
  return NextResponse.json({items});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to load questions'},{status:500});}
}
