import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/server-supabase';
export const runtime='nodejs';
export async function PUT(request:Request,context:{params:Promise<{attemptId:string}>}){
 try{const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Authentication required'},{status:401});const {attemptId}=await context.params;const body=await request.json();
  const {data:attempt,error:attemptError}=await supabase.from('test_attempts').select('id,status,deadline_at').eq('id',attemptId).eq('user_id',user.id).single();if(attemptError)throw attemptError;if(attempt.status!=='in_progress')return NextResponse.json({error:'This test is no longer active.'},{status:409});
  if(attempt.deadline_at&&Date.now()>=new Date(attempt.deadline_at).getTime()){const {data}=await supabase.rpc('submit_test_attempt',{p_attempt_id:attemptId});return NextResponse.json({error:'Time has expired. Test was auto-submitted.',result:data},{status:409});}
  const keys=Array.isArray(body.selectedOptionKeys)?body.selectedOptionKeys:[];if(keys.some((x:string)=>!['A','B','C','D'].includes(x)))return NextResponse.json({error:'Invalid option key.'},{status:400});
  const state=keys.length?(body.marked?'answered_marked_review':'answered'):(body.marked?'marked_review':'not_answered');
  const {error}=await supabase.from('test_responses').upsert({attempt_id:attemptId,question_id:body.questionId,selected_option_keys:keys,response_state:state,time_spent_seconds:Math.max(0,Number(body.timeSpentSeconds??0))},{onConflict:'attempt_id,question_id'});if(error)throw error;return NextResponse.json({saved:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to save response'},{status:400});}
}
