import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { assetId } = await context.params;
    const { data: asset, error } = await supabase
      .from('question_assets')
      .select('id,storage_path,question_id,questions!inner(status)')
      .eq('id', assetId)
      .eq('questions.status', 'published')
      .single();
    if (error || !asset) return NextResponse.json({ error: 'Published question image not found.' }, { status: 404 });
    const { data: signed, error: signedError } = await supabase.storage
      .from('question-assets')
      .createSignedUrl(asset.storage_path, 600);
    if (signedError || !signed?.signedUrl) throw signedError ?? new Error('Unable to create a secure image link.');
    return NextResponse.redirect(signed.signedUrl, { status: 302 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load question image.' }, { status: 500 });
  }
}
