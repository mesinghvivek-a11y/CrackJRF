import dotenv from "dotenv";
dotenv.config({path:".env.local"});
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import geography from "../packages/shared/data/geography-syllabus.json" with { type: "json" };
import paper1 from "../packages/shared/data/paper1-syllabus.json" with { type: "json" };
import { flattenSyllabus } from "../packages/shared/src/index";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the root .env.local or environment.");
const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

async function seed(tree:any,paperType:"common"|"subject_specific"){
 const {data:subject,error:subjectError}=await supabase.from("subjects").upsert({code:tree.subject.code,name:tree.subject.name,paper_type:paperType,active:true},{onConflict:"code"}).select("id").single();
 if(subjectError)throw subjectError;
 const {data:version,error:versionError}=await supabase.from("syllabus_versions").upsert({subject_id:subject.id,version:tree.version,source_document:tree.subject.source,is_current:true},{onConflict:"subject_id,version"}).select("id").single();
 if(versionError)throw versionError;
 const nodes=flattenSyllabus(tree).map((n:any,i:number)=>({id:n.id,syllabus_version_id:version.id,parent_id:n.parentId,node_type:n.type,title:n.title,sort_order:i,source_text:n.title,metadata:{path:n.path}}));
 const batchSize=100;
 for(let i=0;i<nodes.length;i+=batchSize){const {error}=await supabase.from("syllabus_nodes").upsert(nodes.slice(i,i+batchSize),{onConflict:"id"});if(error)throw error;}
 console.log(`${tree.subject.name}: upserted ${nodes.length} syllabus nodes.`);
}
await seed(geography as any,"subject_specific");
await seed(paper1 as any,"common");
const {error:blueprintError}=await supabase.from("test_blueprints").upsert([
 {code:"GEOGRAPHY_100_120",name:"Geography Paper II Practice",mode:"geography_only",paper_i_question_count:0,paper_ii_question_count:100,duration_minutes:120,marks_per_correct:2,marks_per_wrong:0,marks_per_unattempted:0,settings:{time_per_question_seconds:72,description:"Dedicated practice configuration, not official separately allotted Paper II time."}},
 {code:"UGCNET_FULL_150_180",name:"Complete UGC NET Mock",mode:"full_ugc_net",paper_i_question_count:50,paper_ii_question_count:100,duration_minutes:180,marks_per_correct:2,marks_per_wrong:0,marks_per_unattempted:0,settings:{paper_i_code:"00",paper_ii_subject:"selected_by_candidate"}},
 {code:"CUSTOM_GEOGRAPHY",name:"Custom Geography Test",mode:"custom",paper_i_question_count:0,paper_ii_question_count:0,duration_minutes:120,marks_per_correct:2,marks_per_wrong:0,marks_per_unattempted:0,settings:{time_per_question_seconds:72}}
],{onConflict:"code"});
if(blueprintError)throw blueprintError;
console.log("Test blueprints seeded.");
