import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{attemptId:string}>}){
 try{const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Authentication required'},{status:401});const {attemptId}=await context.params;const {data:attempt,error}=await supabase.from('test_attempts').select('id,status,started_at,deadline_at,configuration_snapshot').eq('id',attemptId).eq('user_id',user.id).single();if(error)throw error;const {data:items,error:itemsError}=await supabase.from('test_attempt_questions').select('id,question_id,sequence_number,paper_number,question_snapshot').eq('attempt_id',attemptId).order('sequence_number');if(itemsError)throw itemsError;const {data:responses,error:responseError}=await supabase.from('test_responses').select('question_id,selected_option_keys,response_state,time_spent_seconds').eq('attempt_id',attemptId);if(responseError)throw responseError;return NextResponse.json({attempt,items,responses});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to load test attempt'},{status:400});}
}
