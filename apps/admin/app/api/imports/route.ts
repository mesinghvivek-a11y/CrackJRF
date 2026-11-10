import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/server-supabase";
export const runtime="nodejs";
export async function POST(request:Request){
 try{
  const supabase=await createServerSupabaseClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
  const {data:adminRole,error:roleError}=await supabase.from("admin_members").select("role,active").eq("user_id",user.id).maybeSingle();
  if(roleError||!adminRole?.active||!(adminRole.role === "super_admin" || adminRole.role === "importer"))return NextResponse.json({error:"Super Admin or Importer role required"},{status:403});
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File))return NextResponse.json({error:"PDF file is required"},{status:400});
  if(file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf"))return NextResponse.json({error:"Only PDF documents are accepted"},{status:415});
  if(file.size>100*1024*1024)return NextResponse.json({error:"Maximum PDF size is 100 MB"},{status:413});
  const metadata={source_type:String(form.get("source_type")??"nta_official"),subject_code:String(form.get("subject_code")??"80"),paper_number:Number(form.get("paper_number")??2),year:Number(form.get("year")??2025),session:String(form.get("session")??"June"),event_type:String(form.get("event_type")??"regular"),label:String(form.get("event_label")??""),exam_date:String(form.get("exam_date")??""),shift:String(form.get("shift")??""),language:String(form.get("language")??"bilingual")};
  if(![0,1,2].includes(metadata.paper_number))return NextResponse.json({error:"Paper number must be 1, 2 or 0 for a combined PDF."},{status:400});
  const paperScope=metadata.paper_number===0?"combined":metadata.paper_number===1?"paper1":"paper2";
  const effectiveSubjectCode=metadata.paper_number===1?"00":metadata.subject_code;
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");const storagePath=`${user.id}/${Date.now()}-${safeName}`;
  const {error:uploadError}=await supabase.storage.from("source-pdfs").upload(storagePath,file,{contentType:"application/pdf",upsert:false});
  if(uploadError)return NextResponse.json({error:`Storage upload failed: ${uploadError.message}. Check that the private source-pdfs bucket and policies exist.`},{status:500});
  const {data:event,error:eventError}=await supabase.from("exam_events").upsert({year:metadata.year,session:metadata.session,event_type:metadata.event_type,label:metadata.label},{onConflict:"year,session,event_type,label"}).select("id").single();
  if(eventError)throw eventError;
  let paperId:string|null=null;
  if(metadata.paper_number!==0){
   const {data:subject,error:subjectError}=await supabase.from("subjects").select("id").eq("code",effectiveSubjectCode).single();if(subjectError)throw subjectError;
   const {data:paper,error:paperError}=await supabase.from("exam_papers").upsert({exam_event_id:event.id,subject_id:subject.id,paper_number:metadata.paper_number,shift:metadata.shift||"Unknown",exam_date:metadata.exam_date||null},{onConflict:"exam_event_id,subject_id,paper_number,shift"}).select("id").single();
   if(paperError)throw paperError;paperId=paper.id;
  }
  const {data:doc,error:docError}=await supabase.from("source_documents").insert({source_type:metadata.source_type,file_name:file.name,storage_path:storagePath,exam_paper_id:paperId,exam_event_id:event.id,paper_scope:paperScope,shift:metadata.shift||null,language:metadata.language,uploaded_by:user.id,metadata:{...metadata,effective_subject_code:effectiveSubjectCode}}).select("id").single();
  if(docError)throw docError;
  const {data:job,error:jobError}=await supabase.from("import_jobs").insert({source_document_id:doc.id,status:"queued",created_by:user.id}).select("id").single();
  if(jobError)throw jobError;
  return NextResponse.json({sourceDocumentId:doc.id,importJobId:job.id,storagePath,status:"queued"},{status:201});
 }catch(error){const message=error instanceof Error?error.message:"Unexpected import error";return NextResponse.json({error:message},{status:500})}
}
