import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
export const runtime='nodejs';
async function adminContext(){
 const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();
 if(!user)return{supabase,role:null as string|null,error:NextResponse.json({error:'Authentication required'},{status:401})};
 const {data:member}=await supabase.from('admin_members').select('role,active').eq('user_id',user.id).maybeSingle();
 if(!member?.active||!['super_admin','content_editor','reviewer'].includes(member.role))return{supabase,role:null,error:NextResponse.json({error:'Admin access required'},{status:403})};
 return{supabase,role:member.role as string,error:null};
}
export async function GET(){
 try{
  const {supabase,role,error}=await adminContext();if(error)return error;
  const [nodesResult,countsResult,subjectsResult]=await Promise.all([
   supabase.from('syllabus_nodes').select('id,syllabus_version_id,parent_id,node_type,title,sort_order,is_active,metadata,syllabus_versions(id,version,subject_id,subjects(code,name,paper_type))').order('sort_order'),
   supabase.rpc('admin_syllabus_question_counts'),
   supabase.from('subjects').select('id,code,name,paper_type').eq('active',true).order('name'),
  ]);
  for(const result of [nodesResult,countsResult,subjectsResult])if(result.error)throw result.error;
  const counts=(countsResult.data??{}) as Record<string,number>;
  return NextResponse.json({nodes:(nodesResult.data??[]).map((node:any)=>({...node,question_count:Number(counts[node.id]??0)})),subjects:subjectsResult.data??[],canManage:role==='super_admin'});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to load syllabus taxonomy.'},{status:500})}
}
export async function PATCH(request:Request){
 try{
  const {supabase,role,error}=await adminContext();if(error)return error;if(role!=='super_admin')return NextResponse.json({error:'Only Super Admin can edit syllabus entries.'},{status:403});
  const body=await request.json() as {id?:string;title?:string};const id=String(body.id??'').trim();const title=String(body.title??'').trim();
  if(!id||!title||title.length>180)return NextResponse.json({error:'Provide a syllabus node ID and a title of 1–180 characters.'},{status:400});
  const {data,error:dbError}=await supabase.from('syllabus_nodes').update({title}).eq('id',id).select('id,title').single();
  if(dbError)throw dbError;return NextResponse.json({node:data});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to update syllabus entry.'},{status:500})}
}
export async function POST(request:Request){
 try{
  const {supabase,role,error}=await adminContext();if(error)return error;if(role!=='super_admin')return NextResponse.json({error:'Only Super Admin can add syllabus entries.'},{status:403});
  const body=await request.json() as {parentId?:string;title?:string};const parentId=String(body.parentId??'').trim();const title=String(body.title??'').trim();
  if(!parentId||!title||title.length>180)return NextResponse.json({error:'Choose a parent entry and enter a title (maximum 180 characters).'}, {status:400});
  const {data:parent,error:parentError}=await supabase.from('syllabus_nodes').select('id,node_type,syllabus_version_id').eq('id',parentId).single();
  if(parentError||!parent)throw parentError??new Error('Parent syllabus node was not found.');
  const nextType:Record<string,string>={unit:'section',section:'topic',topic:'subtopic'};const nodeType=nextType[parent.node_type];
  if(!nodeType)return NextResponse.json({error:'Subtopics are the lowest supported syllabus level.'},{status:400});
  const {data:existing,error:existingError}=await supabase.from('syllabus_nodes').select('id,sort_order').eq('parent_id',parentId).order('sort_order',{ascending:false}).limit(1);
  if(existingError)throw existingError;
  const suffix=crypto.randomUUID().replace(/-/g,'').slice(0,10).toUpperCase();
  const {data:node,error:insertError}=await supabase.from('syllabus_nodes').insert({id:`CUSTOM-${suffix}`,syllabus_version_id:parent.syllabus_version_id,parent_id:parentId,node_type:nodeType,title,sort_order:(existing?.[0]?.sort_order??0)+1,is_active:true,metadata:{created_in_admin:true}}).select('id,parent_id,node_type,title,sort_order,is_active').single();
  if(insertError)throw insertError;return NextResponse.json({node},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to add syllabus entry.'},{status:500})}
}
