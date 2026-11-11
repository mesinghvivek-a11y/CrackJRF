import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
export const runtime='nodejs';
export async function GET(){
 try{
  const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required'},{status:401});
  const {data:member}=await supabase.from('admin_members').select('role,active').eq('user_id',user.id).maybeSingle();
  if(!member?.active||!['super_admin','content_editor','reviewer','importer'].includes(member.role))return NextResponse.json({error:'Admin access required'},{status:403});
  const [eventsResult,papersResult,batchesResult]=await Promise.all([
   supabase.from('exam_events').select('id,year,session,event_type,label,created_at').order('year',{ascending:false}).order('session'),
   supabase.from('exam_papers').select('id,exam_event_id,paper_number,shift,subjects(name,code)'),
   supabase.from('excel_import_batches').select('id,batch_code,file_name,exam_metadata,status,total_rows,valid_rows,rows_with_errors,rows_promoted,created_at').order('created_at',{ascending:false}).limit(100),
  ]);
  for(const result of [eventsResult,papersResult,batchesResult])if(result.error)throw result.error;
  const papers=await Promise.all((papersResult.data??[]).map(async(p:any)=>{const {count,error}=await supabase.from('question_appearances').select('id',{count:'exact',head:true}).eq('exam_paper_id',p.id);if(error)throw error;const subject=Array.isArray(p.subjects)?p.subjects[0]:p.subjects;return {...p,subject_name:subject?.name??'Unknown',subject_code:subject?.code??'',question_count:count??0}}));
  return NextResponse.json({events:eventsResult.data??[],papers,batches:batchesResult.data??[]});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to load resource manager.'},{status:500})}
}
