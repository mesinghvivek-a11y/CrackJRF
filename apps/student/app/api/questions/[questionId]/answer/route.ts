import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/server-supabase';
export const runtime='nodejs';
export async function POST(_request:Request,context:{params:Promise<{questionId:string}>}){
 try{const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Authentication required'},{status:401});const {questionId}=await context.params;const {data,error}=await supabase.rpc('get_practice_answer',{p_question_id:questionId});if(error)throw error;return NextResponse.json({answer:data});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Answer unavailable'},{status:409});}
}
