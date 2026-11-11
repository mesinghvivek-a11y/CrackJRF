import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';

export const runtime = 'nodejs';
async function getContext(roles: string[] = ['super_admin','importer','content_editor','reviewer']) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, role: null };
  const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
  if (!member?.active || !roles.includes(member.role)) return { supabase, user, role: null };
  return { supabase, user, role: member.role as string };
}

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    const { batchId } = await context.params;
    const { supabase, user, role } = await getContext();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (!role) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const { data: batch, error: batchError } = await supabase.from('excel_import_batches').select('*').eq('id', batchId).single();
    if (batchError || !batch) return NextResponse.json({ error: 'Excel import batch not found.' }, { status: 404 });
    const { data: rows, error: rowsError } = await supabase.from('excel_import_rows').select('*').eq('batch_id', batchId).order('paper_number').order('paper_order').limit(3000);
    if (rowsError) throw rowsError;
    return NextResponse.json({ batch, rows: rows ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Excel import batch.' }, { status: 500 });
  }
}
