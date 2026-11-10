import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/server-supabase';
export const runtime='nodejs';
export async function POST(_request:Request,context:{params:Promise<{attemptId:string}>}){
 try{const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Authentication required'},{status:401});const {attemptId}=await context.params;const {data:result,error}=await supabase.rpc('submit_test_attempt',{p_attempt_id:attemptId});if(error)throw error;const {data:review,error:reviewError}=await supabase.rpc('get_test_attempt_review',{p_attempt_id:attemptId});if(reviewError)throw reviewError;return NextResponse.json({result,review});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to submit test'},{status:400});}
}
