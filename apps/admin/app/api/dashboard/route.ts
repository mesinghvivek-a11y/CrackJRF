import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/server-supabase';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
    if (!member?.active || !['super_admin','content_editor','reviewer','importer'].includes(member.role)) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const [total, published, drafts, subjectsResult, yearsResult, papersResult, enResult, hiResult] = await Promise.all([
      supabase.from('questions').select('id', { count: 'exact', head: true }),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      supabase.from('subjects').select('id,code,name,paper_type').eq('active', true).order('name'),
      supabase.from('exam_events').select('id,year,session,event_type,label').order('year', { ascending: false }),
      supabase.from('exam_papers').select('id,paper_number,subject_id,subjects(code,name),exam_events(id,year,session,label)'),
      supabase.from('question_translations').select('id', { count: 'exact', head: true }).eq('language', 'en'),
      supabase.from('question_translations').select('id', { count: 'exact', head: true }).eq('language', 'hi'),
    ]);
    for (const result of [total,published,drafts,subjectsResult,yearsResult,papersResult,enResult,hiResult]) if (result.error) throw result.error;

    const subjects = await Promise.all((subjectsResult.data ?? []).map(async (subject: any) => {
      const { count, error } = await supabase.from('questions').select('id', { count: 'exact', head: true }).eq('subject_id', subject.id);
      if (error) throw error;
      return { id: subject.id, code: subject.code, name: subject.name, paperType: subject.paper_type, count: count ?? 0 };
    }));

    const papers = await Promise.all((papersResult.data ?? []).map(async (paper: any) => {
      const { count, error } = await supabase.from('question_appearances').select('id', { count: 'exact', head: true }).eq('exam_paper_id', paper.id);
      if (error) throw error;
      const event = Array.isArray(paper.exam_events) ? paper.exam_events[0] : paper.exam_events;
      const subject = Array.isArray(paper.subjects) ? paper.subjects[0] : paper.subjects;
      return { id: paper.id, paperNumber: paper.paper_number, subject: subject?.name ?? 'Unknown subject', subjectCode: subject?.code ?? '', year: event?.year ?? null, session: event?.session ?? 'Other', label: event?.label ?? '', count: count ?? 0 };
    }));

    const years = Array.from(new Set<number>((yearsResult.data ?? []).map((event: any) => Number(event.year)).filter((year: number) => Number.isFinite(year)))).sort((a, b) => b - a);
    const sessions = (yearsResult.data ?? []).reduce((acc: Record<string, number>, event: any) => {
      const key = `${event.year} · ${event.session}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return NextResponse.json({
      totals: { questions: total.count ?? 0, published: published.count ?? 0, drafts: drafts.count ?? 0, years: years.length },
      subjects,
      years,
      papers,
      sessions: Object.entries(sessions).map(([label, events]) => ({ label, events })),
      languages: { english: enResult.count ?? 0, hindi: hiResult.count ?? 0 },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load dashboard resources.' }, { status: 500 });
  }
}
