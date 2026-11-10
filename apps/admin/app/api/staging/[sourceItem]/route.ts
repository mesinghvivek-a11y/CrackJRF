import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{sourceItem:string}> }) {
 try {
  const supabase=await createServerSupabaseClient(); const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required'},{status:401});
  const {data:member}=await supabase.from('admin_members').select('role,active').eq('user_id',user.id).maybeSingle();
  if(!member?.active || !['super_admin','content_editor','reviewer','importer'].includes(member.role))return NextResponse.json({error:'Admin access required'},{status:403});
  const {sourceItem}=await context.params;
  const {data,error}=await supabase.from('source_question_items').select('*,source_documents(id,file_name,source_type,storage_path,exam_paper_id,exam_event_id,paper_scope,shift,metadata)').eq('id',sourceItem).single();
  if(error)throw error;
  const doc=(Array.isArray(data.source_documents)?data.source_documents[0]:data.source_documents) as {storage_path:string|null}|null;
  let signedUrl:string|null=null;
  if(doc?.storage_path){const {data:signed}=await supabase.storage.from('source-pdfs').createSignedUrl(doc.storage_path,3600);signedUrl=signed?.signedUrl??null;}
  return NextResponse.json({item:data,signedUrl});
 } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:'Unable to load source item'},{status:500}); }
}
