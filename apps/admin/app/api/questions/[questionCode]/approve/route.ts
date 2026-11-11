import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../../lib/server-supabase";
export const runtime="nodejs";
export async function POST(_request:Request,context:{params:Promise<{questionCode:string}>}){
 try{
  const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
  const {data:admin}=await supabase.from("admin_members").select("role,active").eq("user_id",user.id).maybeSingle();if(!admin?.active||admin.role!=="super_admin")return NextResponse.json({error:"Only the Super Admin can approve and publish questions"},{status:403});
  const {questionCode}=await context.params;const {data:q,error}=await supabase.from("questions").select("id,status,answer_status").eq("question_code",questionCode).single();if(error)throw error;
  const {data:translations}=await supabase.from("question_translations").select("language,script_variant,reviewed,stem_blocks").eq("question_id",q.id);
  const {data:options}=await supabase.from("question_options").select("id,question_option_translations(language,script_variant,reviewed,content_blocks)").eq("question_id",q.id);
  const {data:classifications}=await supabase.from("question_classifications").select("syllabus_node_id,syllabus_nodes!inner(node_type)").eq("question_id",q.id);
  const {count:tagCount}=await supabase.from("question_classifications").select("question_id",{count:"exact",head:true}).eq("question_id",q.id);
  const english=(translations??[]).find((t:any)=>t.language==="en"&&t.script_variant==="native");
  const hasStem=Boolean(english?.reviewed)&&(english?.stem_blocks??[]).some((b:any)=>String(b.text??b.html??"").trim().length>0);
  const validOptions=(options??[]).length===4&&(options??[]).every((o:any)=>(o.question_option_translations??[]).some((t:any)=>t.language==="en"&&t.script_variant==="native"&&t.reviewed===true&&(t.content_blocks??[]).some((b:any)=>String(b.text??b.html??"").trim().length>0)));
  const hasTopic=(classifications??[]).some((c:any)=>{const node=Array.isArray(c.syllabus_nodes)?c.syllabus_nodes[0]:c.syllabus_nodes;return node?.node_type==="topic"||node?.node_type==="subtopic";});
  if(!hasStem||!validOptions||!tagCount||!hasTopic)return NextResponse.json({error:"Question is incomplete: verify the English question and all four English options, and assign at least one topic or sub-topic."},{status:409});
  if(q.answer_status==="pending"||q.answer_status==="disputed")return NextResponse.json({error:"Answer must be verified and not disputed before publication."},{status:409});
  const {data:verifiedAnswer}=await supabase.from("verified_answers").select("question_id").eq("question_id",q.id).maybeSingle();
  if(!verifiedAnswer && q.answer_status!=="dropped")return NextResponse.json({error:"Verified answer record is missing."},{status:409});
  const {error:updateError}=await supabase.from("questions").update({status:"published",published_at:new Date().toISOString(),updated_by:user.id}).eq("id",q.id);if(updateError)throw updateError;
  await supabase.from("question_approvals").insert({question_id:q.id,approved_by:user.id,decision:"published"});
  await supabase.from("audit_logs").insert({actor_id:user.id,entity_type:"question",entity_id:q.id,action:"published",after_data:{question_code:questionCode}});
  return NextResponse.json({questionCode,status:"published"});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Approval failed"},{status:500})}
}
