import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/server-supabase';

export const runtime = 'nodejs';
export const maxDuration = 30;

type TranslationRequest = {
  target?: 'hi' | 'hinglish';
  question?: string;
  options?: Record<string, string>;
  explanation?: string;
};

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { data: member } = await supabase.from('admin_members').select('role,active').eq('user_id', user.id).maybeSingle();
    if (!member?.active || !['super_admin','content_editor','reviewer'].includes(member.role)) return NextResponse.json({ error: 'Content team access required' }, { status: 403 });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI translation is not configured. Add GEMINI_API_KEY to the Admin Vercel environment variables.' }, { status: 503 });
    const body = await request.json() as TranslationRequest;
    const target = body.target === 'hinglish' ? 'hinglish' : body.target === 'hi' ? 'hi' : null;
    if (!target) return NextResponse.json({ error: 'Choose Hindi or Hinglish as the target.' }, { status: 400 });
    const question = String(body.question ?? '').trim();
    const options = body.options ?? {};
    const explanation = String(body.explanation ?? '').trim();
    if (!question) return NextResponse.json({ error: 'English question text is required before translation.' }, { status: 400 });
    if (question.length > 12000 || explanation.length > 16000 || Object.values(options).some((value) => String(value).length > 4000)) {
      return NextResponse.json({ error: 'The question or explanation is too long for one translation request.' }, { status: 413 });
    }
    const style = target === 'hi'
      ? 'Translate into natural, academically appropriate Hindi written in Devanagari script. Retain established English technical terms in parentheses only where this improves clarity.'
      : 'Translate into natural Hinglish: Hindi meaning written in the Roman alphabet. Retain standard English academic and geographical technical terms when they are clearer than forced transliteration. Do not use Devanagari characters.';
    const prompt = `You are a careful UGC NET educational translator. ${style}\n\nTranslate the question, its options and its explanation. Do not solve the question. Do not change factual meaning, numbers, symbols, equations, names, dates, units, option labels or option order. Do not add facts, hints, answers or commentary. Keep the explanation as a faithful translation. If a field is empty, return an empty string for that field.\n\nReturn only valid JSON with this exact structure: {"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"explanation":"..."}.\n\nSOURCE:\n${JSON.stringify({ question, options, explanation })}`;
    const configuredModel = String(process.env.GEMINI_MODEL ?? '').trim();
    if (!configuredModel) return NextResponse.json({ error: 'AI translation model is not configured. Set GEMINI_MODEL to a currently supported Gemini API model ID in the Admin environment.' }, { status: 503 });
    const model = configuredModel.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!model) return NextResponse.json({ error: 'GEMINI_MODEL is invalid.' }, { status: 503 });
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(25000),
    });
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
    if (!response.ok) return NextResponse.json({ error: payload.error?.message ?? `Translation provider returned HTTP ${response.status}.` }, { status: 502 });
    const generated = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? '';
    if (!generated) return NextResponse.json({ error: 'The translation provider returned an empty response.' }, { status: 502 });
    const clean = generated.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let result: { question?: string; options?: Record<string, string>; explanation?: string };
    try { result = JSON.parse(clean); } catch { return NextResponse.json({ error: 'The translation provider did not return valid structured text. Please try again.' }, { status: 502 }); }
    const resultOptions = result.options ?? {};
    return NextResponse.json({
      target,
      question: String(result.question ?? ''),
      options: { A: String(resultOptions.A ?? ''), B: String(resultOptions.B ?? ''), C: String(resultOptions.C ?? ''), D: String(resultOptions.D ?? '') },
      explanation: String(result.explanation ?? ''),
      origin: 'ai_draft',
      model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate a translation draft.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
