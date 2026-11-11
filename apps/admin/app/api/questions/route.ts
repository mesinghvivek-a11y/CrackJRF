import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
export const runtime='nodejs';

export async function GET(request:Request){
 try{
  const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required'},{status:401});
  const {data:member}=await supabase.from('admin_members').select('role,active').eq('user_id',user.id).maybeSingle();
  if(!member?.active||!['super_admin','content_editor','reviewer','importer'].includes(member.role))return NextResponse.json({error:'Admin access required'},{status:403});
  const url=new URL(request.url);const query=url.searchParams.get('q')?.trim()??'';const status=url.searchParams.get('status')??'all';const subjectCode=url.searchParams.get('subject')??'all';
  let db=supabase.from('questions').select('id,question_code,question_type,status,answer_status,created_at,subjects(code,name),question_appearances(original_question_number,nta_question_id,paper_order,exam_papers(paper_number,shift,exam_events(year,session))),question_classifications(syllabus_node_id,syllabus_nodes(title))').order('created_at',{ascending:false}).limit(150);
  if(status!=='all')db=db.eq('status',status);
  if(subjectCode!=='all'){const {data:subject}=await supabase.from('subjects').select('id').eq('code',subjectCode).maybeSingle();if(!subject)return NextResponse.json({questions:[]});db=db.eq('subject_id',subject.id);}
  if(query)db=db.ilike('question_code',`%${query}%`);
  const {data,error}=await db;if(error)throw error;
  return NextResponse.json({questions:data??[]});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to load question bank'},{status:500})}
}
