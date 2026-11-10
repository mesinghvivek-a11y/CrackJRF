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
  let db=supabase.from('questions').select('id,question_code,question_type,status,answer_status,created_at,subjects(code,name),question_appearances(original_question_number,nta_question_id,exam_papers(paper_number,shift,exam_events(year,session))),question_classifications(syllabus_node_id,syllabus_nodes(title))').order('created_at',{ascending:false}).limit(150);
  if(status!=='all')db=db.eq('status',status);
  if(subjectCode!=='all'){const {data:subject}=await supabase.from('subjects').select('id').eq('code',subjectCode).maybeSingle();if(!subject)return NextResponse.json({questions:[]});db=db.eq('subject_id',subject.id);}
  if(query)db=db.ilike('question_code',`%${query}%`);
  const {data,error}=await db;if(error)throw error;
  return NextResponse.json({questions:data??[]});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to load question bank'},{status:500})}
}

export async function POST(request:Request){
 try{
  const supabase=await createServerSupabaseClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required'},{status:401});
  const {data:member}=await supabase.from('admin_members').select('role,active').eq('user_id',user.id).maybeSingle();
  if(!member?.active||!['super_admin','content_editor'].includes(member.role))return NextResponse.json({error:'Content editor or Super Admin access required'},{status:403});
  const body=await request.json();
  const sourceItemId=String(body.sourceItemId??'');
  if(!sourceItemId)return NextResponse.json({error:'A staging source item is required.'},{status:400});
  const {data:item,error:itemError}=await supabase.from('source_question_items').select('id,source_document_id,source_page_start,source_question_number,source_native_question_id,language,paper_number,source_documents(exam_paper_id,exam_event_id,paper_scope,shift,metadata)').eq('id',sourceItemId).single();
  if(itemError)throw itemError;
  const doc=(Array.isArray(item.source_documents)?item.source_documents[0]:item.source_documents) as {exam_paper_id:string|null;exam_event_id:string|null;paper_scope:string;shift:string|null;metadata:any}|null;
  const paperNumber=Number(body.paperNumber??item.paper_number??doc?.metadata?.paper_number??0);
  if(![1,2].includes(paperNumber))return NextResponse.json({error:'Assign this source item to Paper I or Paper II before creating a question.'},{status:400});
  const subjectCode=paperNumber===1?'00':String(body.subjectCode??doc?.metadata?.subject_code??'80');
  if(paperNumber===2&&subjectCode==='00')return NextResponse.json({error:'Paper II requires a subject code, such as Geography 80.'},{status:400});
  const {data:subject,error:subjectError}=await supabase.from('subjects').select('id').eq('code',subjectCode).single();if(subjectError)throw subjectError;
  let examPaperId=doc?.exam_paper_id??null;
  if(doc?.paper_scope==='combined' || !examPaperId){
   if(!doc?.exam_event_id)return NextResponse.json({error:'Source document has no examination event. Re-register the source PDF.'},{status:409});
   const {data:paper,error:paperError}=await supabase.from('exam_papers').upsert({exam_event_id:doc.exam_event_id,subject_id:subject.id,paper_number:paperNumber,shift:doc.shift||'Unknown',exam_date:doc.metadata?.exam_date||null},{onConflict:'exam_event_id,subject_id,paper_number,shift'}).select('id').single();
   if(paperError)throw paperError;examPaperId=paper.id;
  }
  if(!examPaperId)return NextResponse.json({error:'Unable to resolve examination paper for this source item.'},{status:409});
  await supabase.from('source_question_items').update({paper_number:paperNumber}).eq('id',sourceItemId);
  if(item.source_question_number){
   const {data:existingAppearance}=await supabase.from('question_appearances').select('question_id').eq('exam_paper_id',examPaperId).eq('original_question_number',item.source_question_number).maybeSingle();
   if(existingAppearance){
    const {data:existingQuestion}=await supabase.from('questions').select('id,question_code,status').eq('id',existingAppearance.question_id).single();
    if(existingQuestion){const {error:linkError}=await supabase.from('question_source_links').upsert({question_id:existingQuestion.id,source_question_item_id:item.id,purpose:item.language==='hi'?'translation':'question_content',language:item.language},{onConflict:'question_id,source_question_item_id'});if(linkError)throw linkError;return NextResponse.json({questionId:existingQuestion.id,questionCode:existingQuestion.question_code,status:existingQuestion.status,existing:true});}
   }
  }
  const {data:code,error:codeError}=await supabase.rpc('next_question_code',{p_subject_code:subjectCode});if(codeError)throw codeError;
  const {data:question,error}=await supabase.from('questions').insert({question_code:code,subject_id:subject.id,question_type:'mcq',status:'draft',answer_status:'pending',created_by:user.id,updated_by:user.id}).select('id,question_code').single();if(error)throw error;
  const {error:linkError}=await supabase.from('question_source_links').upsert({question_id:question.id,source_question_item_id:item.id,purpose:item.language==='hi'?'translation':'question_content',language:item.language},{onConflict:'question_id,source_question_item_id'});if(linkError)throw linkError;
  if(item.source_question_number){const {error:appearanceError}=await supabase.from('question_appearances').insert({question_id:question.id,exam_paper_id:examPaperId,original_question_number:item.source_question_number,nta_question_id:item.source_native_question_id,source_question_item_id:item.id});if(appearanceError)throw appearanceError;}
  await supabase.from('source_question_items').update({segmentation_status:'segmented',paper_number:paperNumber}).eq('id',item.id);
  await supabase.from('question_revisions').insert({question_id:question.id,revision_number:1,snapshot:{source_item_id:item.id,extracted_text:'staging source attached',paper_number:paperNumber},changed_by:user.id,change_summary:'Created draft from extraction staging item'});
  return NextResponse.json({questionId:question.id,questionCode:question.question_code,status:'draft'},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to create draft question'},{status:500});}
}
