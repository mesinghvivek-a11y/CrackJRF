import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/server-supabase";
export const runtime="nodejs";

export async function GET(_request:Request,context:{params:Promise<{questionCode:string}>}){
 try{
  const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
  const {data:role}=await supabase.from("admin_members").select("role,active").eq("user_id",user.id).maybeSingle();
  if(!role?.active||!(role.role === "super_admin" || role.role === "content_editor" || role.role === "reviewer"))return NextResponse.json({error:"Admin access required"},{status:403});
  const {questionCode}=await context.params;
  const {data:question,error}=await supabase.from("questions").select("id,question_code,question_type,status,answer_status,subject_id,current_revision,subjects(code,name)").eq("question_code",questionCode).single();if(error)throw error;
  const [translationsResult,optionsResult,classificationsResult,answerResult,argumentsResult]=await Promise.all([
   supabase.from("question_translations").select("language,stem_blocks,instruction_blocks,reviewed").eq("question_id",question.id),
   supabase.from("question_options").select("id,option_key,sort_order,question_option_translations(language,content_blocks)").eq("question_id",question.id).order("sort_order"),
   supabase.from("question_classifications").select("syllabus_node_id,is_primary").eq("question_id",question.id),
   supabase.from("verified_answers").select("correct_option_keys,answer_status,explanation_overview,explanation_richtext,option_explanations,references_data").eq("question_id",question.id).maybeSingle(),
   supabase.from("question_explanation_drafts").select("explanation_overview,explanation_richtext,option_explanations,references_data").eq("question_id",question.id).maybeSingle()
  ]);
  for(const result of [translationsResult,optionsResult,classificationsResult,answerResult,argumentsResult])if(result.error)throw result.error;
  return NextResponse.json({question,translations:translationsResult.data??[],options:optionsResult.data??[],classifications:classificationsResult.data??[],verifiedAnswer:answerResult.data??null,explanationDraft:argumentsResult.data??null});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load question"},{status:500})}
}
export async function PUT(request:Request,context:{params:Promise<{questionCode:string}>}){
 try{
  const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
  const {data:role}=await supabase.from("admin_members").select("role,active").eq("user_id",user.id).maybeSingle();
  if(!role?.active||!(role.role === "super_admin" || role.role === "content_editor" || role.role === "reviewer"))return NextResponse.json({error:"Content editor, reviewer or Super Admin access required"},{status:403});
  const {questionCode}=await context.params;const body=await request.json();
  const wantsVerifiedAnswer=Boolean(body.answerStatus&&body.answerStatus!=="pending"&&body.answerStatus!=="disputed");
  
  if(!Array.isArray(body.options)||body.options.length!==4)return NextResponse.json({error:"Exactly four options are required for this MCQ editor"},{status:400});
  if(!Array.isArray(body.classifications)||body.classifications.length===0)return NextResponse.json({error:"At least one syllabus classification is required"},{status:400});
  const {data:subject,error:subjectError}=await supabase.from("subjects").select("id").eq("code",body.subjectCode??"80").single();if(subjectError)throw subjectError;
  const {data:existing}=await supabase.from("questions").select("id,current_revision,answer_status").eq("question_code",questionCode).maybeSingle();
  if(role.role==="content_editor" && existing && body.answerStatus!==existing.answer_status)return NextResponse.json({error:"Only a Reviewer or Super Admin can change answer verification status."},{status:403});
  if(role.role==="content_editor" && !existing && body.answerStatus!=="pending")return NextResponse.json({error:"A Content Editor must leave the answer pending and send it for review."},{status:403});
  let questionId:string;
  const status=body.submitForApproval?"ready_for_approval":"draft";
  if(existing){questionId=existing.id;const {error}=await supabase.from("questions").update({subject_id:subject.id,question_type:body.questionType??"mcq",status,answer_status:body.answerStatus??"pending",updated_by:user.id,current_revision:(existing.current_revision??1)+1}).eq("id",existing.id);if(error)throw error}
  else{const {data,error}=await supabase.from("questions").insert({question_code:questionCode,subject_id:subject.id,question_type:body.questionType??"mcq",status,answer_status:body.answerStatus??"pending",created_by:user.id,updated_by:user.id}).select("id").single();if(error)throw error;questionId=data.id}
  for(const lang of ["en","hi"]){const locale=body.localized?.[lang];if(!locale)continue;const {error}=await supabase.from("question_translations").upsert({question_id:questionId,language:lang,stem_blocks:locale.stem??[],instruction_blocks:locale.instructions??[],reviewed:Boolean(locale.reviewed)},{onConflict:"question_id,language"});if(error)throw error}
  await supabase.from("question_options").delete().eq("question_id",questionId);
  for(const [idx,opt] of body.options.entries()){
   const {data:option,error}=await supabase.from("question_options").insert({question_id:questionId,option_key:opt.key,sort_order:idx}).select("id").single();if(error)throw error;
   for(const lang of ["en","hi"]){const content=opt.localized?.[lang];if(content){const {error:translationError}=await supabase.from("question_option_translations").insert({option_id:option.id,language:lang,content_blocks:content});if(translationError)throw translationError}}
  }
  await supabase.from("question_classifications").delete().eq("question_id",questionId);
  const {error:classificationError}=await supabase.from("question_classifications").insert(body.classifications.map((c:{nodeId:string;isPrimary?:boolean})=>({question_id:questionId,syllabus_node_id:c.nodeId,is_primary:Boolean(c.isPrimary),assigned_by:user.id})));if(classificationError)throw classificationError;
  const {error:draftError}=await supabase.from("question_explanation_drafts").upsert({question_id:questionId,explanation_overview:body.explanationOverview??null,explanation_richtext:body.explanationRichtext??[],option_explanations:body.optionExplanations??{},references_data:body.references??[],updated_by:user.id,updated_at:new Date().toISOString()},{onConflict:"question_id"});if(draftError)throw draftError;
  if((role.role==="super_admin"||role.role==="reviewer")&&body.answerStatus&&body.answerStatus!=="pending"&&body.answerStatus!=="disputed"&&(Array.isArray(body.correctOptionKeys)&&body.correctOptionKeys.length || body.answerStatus==="dropped")){
   const {error}=await supabase.from("verified_answers").upsert({question_id:questionId,correct_option_keys:body.answerStatus==="all_options_correct"?["A","B","C","D"]:body.correctOptionKeys,answer_status:body.answerStatus,grading_rule:body.gradingRule??(body.answerStatus==="dropped"?"dropped_credit":"normal"),explanation_overview:body.explanationOverview??null,explanation_richtext:body.explanationRichtext??[],option_explanations:body.optionExplanations??{},references_data:body.references??[],verified_by:user.id,verified_at:new Date().toISOString()},{onConflict:"question_id"});if(error)throw error;
  }
  if((role.role==="super_admin"||role.role==="reviewer")&&(body.answerStatus === "pending" || body.answerStatus === "disputed")) await supabase.from("verified_answers").delete().eq("question_id",questionId);
  const source=body.source;
  if(source?.sourceItemId){
   const {data:item}=await supabase.from("source_question_items").select("id,source_document_id,source_page_start,source_question_number,source_native_question_id,source_documents(exam_paper_id)").eq("id",source.sourceItemId).maybeSingle();
   const doc=(Array.isArray(item?.source_documents)?item?.source_documents[0]:item?.source_documents) as {exam_paper_id:string|null}|null;
   if(item){const {error:linkError}=await supabase.from("question_source_links").upsert({question_id:questionId,source_question_item_id:item.id,purpose:item.language==="hi"?"translation":"question_content",language:item.language},{onConflict:"question_id,source_question_item_id"});if(linkError)throw linkError;}
   if(item&&doc?.exam_paper_id&&source.originalNumber){
    const {error:appearanceError}=await supabase.from("question_appearances").upsert({question_id:questionId,exam_paper_id:doc.exam_paper_id,original_question_number:String(source.originalNumber),nta_question_id:source.ntaQuestionId||item.source_native_question_id,source_question_item_id:item.id},{onConflict:"question_id,exam_paper_id,original_question_number"});if(appearanceError)throw appearanceError;
   }
  }
  await supabase.from("question_revisions").insert({question_id:questionId,revision_number:existing?(existing.current_revision??1)+1:1,snapshot:body,changed_by:user.id,change_summary:body.submitForApproval?"Submitted for approval":"Draft saved"});
  return NextResponse.json({questionId,questionCode,status});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unexpected save error"},{status:500})}
}
