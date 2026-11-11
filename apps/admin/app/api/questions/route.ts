import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
export const runtime='nodejs';

async function context() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, role: null as string | null, error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
  if (!member?.active || !['super_admin','content_editor','reviewer','importer'].includes(member.role)) return { supabase, role: null, error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) };
  return { supabase, role: member.role as string, error: null };
}

export async function GET() {
  try {
    const { supabase, role, error } = await context(); if (error) return error;
    const [questionsResult, subjectsResult, eventsResult, nodesResult] = await Promise.all([
      supabase.from('questions').select('id,question_code,question_type,status,answer_status,created_at,subjects(id,code,name),question_translations(language,stem_blocks),question_keywords(keyword),question_appearances(original_question_number,nta_question_id,paper_order,exam_papers(id,paper_number,shift,exam_events(year,session))),question_classifications(syllabus_node_id,syllabus_nodes(id,title,node_type,parent_id))').order('created_at',{ascending:false}).range(0,999),
      supabase.from('subjects').select('id,code,name').eq('active',true).order('name'),
      supabase.from('exam_events').select('year,session').order('year',{ascending:false}),
      supabase.from('syllabus_nodes').select('id,title,node_type,parent_id').eq('is_active',true).order('sort_order'),
    ]);
    for (const result of [questionsResult,subjectsResult,eventsResult,nodesResult]) if (result.error) throw result.error;
    return NextResponse.json({ role, questions: questionsResult.data ?? [], subjects: subjectsResult.data ?? [], events: eventsResult.data ?? [], nodes: nodesResult.data ?? [], truncated: (questionsResult.data?.length ?? 0) >= 1000 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load question bank' }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const { supabase, role, error } = await context(); if (error) return error;
    const body = await request.json() as { action?: string; questionIds?: unknown; syllabusNodeIds?: unknown };
    const questionIds = Array.isArray(body.questionIds) ? body.questionIds.filter((x): x is string => typeof x === 'string') : [];
    if (!questionIds.length || questionIds.length > 500) return NextResponse.json({ error: 'Select between 1 and 500 questions.' }, { status: 400 });
    if (body.action === 'delete') {
      if (role !== 'super_admin') return NextResponse.json({ error: 'Only Super Admin can bulk delete questions.' }, { status: 403 });
      const { data, error: rpcError } = await supabase.rpc('admin_bulk_delete_questions', { p_question_ids: questionIds });
      if (rpcError) throw rpcError;
      return NextResponse.json({ deleted: Number(data ?? questionIds.length) });
    }
    if (body.action === 'reclassify') {
      if (!['super_admin','content_editor'].includes(role ?? '')) return NextResponse.json({ error: 'Content Editor or Super Admin access is required to reclassify questions.' }, { status: 403 });
      const nodeIds = Array.isArray(body.syllabusNodeIds) ? body.syllabusNodeIds.filter((x): x is string => typeof x === 'string') : [];
      if (!nodeIds.length) return NextResponse.json({ error: 'Choose at least one syllabus node.' }, { status: 400 });
      const { data, error: rpcError } = await supabase.rpc('admin_bulk_reclassify_questions', { p_question_ids: questionIds, p_syllabus_node_ids: nodeIds });
      if (rpcError) throw rpcError;
      return NextResponse.json({ updated: Number(data ?? questionIds.length) });
    }
    return NextResponse.json({ error: 'Unsupported bulk action.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Bulk operation failed.' }, { status: 500 }); }
}
