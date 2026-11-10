import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
    if (!member?.active || !['super_admin','importer','content_editor','reviewer'].includes(member.role)) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 250);
    let query = supabase.from('source_question_items').select('id,source_document_id,import_job_id,source_page_start,source_page_end,source_question_number,source_native_question_id,paper_number,language,raw_content,extracted_text,segmentation_status,created_at,source_documents(file_name,source_type,paper_scope,shift,metadata)').order('created_at', { ascending: false }).limit(limit);
    if (status) query = query.eq('segmentation_status', status);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ items: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load staging queue' }, { status: 500 });
  }
}
