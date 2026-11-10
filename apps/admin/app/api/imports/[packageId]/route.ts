import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ packageId: string }> }) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
    if (!member?.active || !['super_admin', 'importer', 'content_editor', 'reviewer'].includes(member.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const { packageId } = await context.params;
    const { data: packageRow, error: packageError } = await supabase.from('import_packages')
      .select('id,package_id,schema_version,exam_year,exam_session,paper_number,shift,total_questions,imported_questions,validation_status,status,languages,manifest,qa_report,created_at,subjects(code,name)')
      .eq('id', packageId).single();
    if (packageError) throw packageError;
    const { data: questions, error: questionsError } = await supabase.from('import_package_questions')
      .select('id,base_question_id,language_question_codes,order_index,original_question_number,question_type,common_data,english_data,hindi_data,classification_status,review_status')
      .eq('import_package_id', packageId).order('order_index', { ascending: true }).limit(1000);
    if (questionsError) throw questionsError;
    return NextResponse.json({ package: packageRow, questions: questions ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load imported package.' }, { status: 500 });
  }
}
