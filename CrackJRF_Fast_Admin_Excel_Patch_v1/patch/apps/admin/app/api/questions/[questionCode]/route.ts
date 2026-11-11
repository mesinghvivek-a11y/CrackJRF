
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/server-supabase";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ questionCode: string }> }
) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { data: role } = await supabase
      .from("admin_members")
      .select("role,active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (
      !role?.active ||
      !["super_admin", "content_editor", "reviewer"].includes(role.role)
    ) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const { questionCode } = await context.params;

    const { data: question, error } = await supabase
      .from("questions")
      .select(
        "id,question_code,question_type,status,answer_status,subject_id,current_revision,subjects(code,name)"
      )
      .eq("question_code", questionCode)
      .single();

    if (error) throw error;

    const [
      translationsResult,
      optionsResult,
      classificationsResult,
      answerResult,
      argumentsResult,
      explanationTranslationsResult,
      assetsResult,
      keywordsResult,
      answerEvidenceResult,
      editorDraftResult,
      appearancesResult,
    ] = await Promise.all([
      supabase
        .from("question_translations")
        .select("language,script_variant,origin,language_question_code,stem_blocks,instruction_blocks,reviewed")
        .eq("question_id", question.id),

      supabase
        .from("question_options")
        .select("id,option_key,sort_order,provider_option_id,question_option_translations(language,script_variant,origin,reviewed,content_blocks)")
        .eq("question_id", question.id)
        .order("sort_order"),

      supabase
        .from("question_classifications")
        .select("syllabus_node_id,is_primary")
        .eq("question_id", question.id),

      supabase
        .from("verified_answers")
        .select(
          "correct_option_keys,answer_status,explanation_overview,explanation_richtext,option_explanations,references_data"
        )
        .eq("question_id", question.id)
        .maybeSingle(),

      supabase
        .from("question_explanation_drafts")
        .select(
          "explanation_overview,explanation_richtext,option_explanations,references_data"
        )
        .eq("question_id", question.id)
        .maybeSingle(),
      supabase
        .from("question_explanation_translations")
        .select("language,script_variant,origin,explanation_overview,explanation_richtext,review_status")
        .eq("question_id", question.id),
      supabase
        .from("question_assets")
        .select("id,asset_type,storage_path,placement,alt_text,caption,sort_order")
        .eq("question_id", question.id)
        .order("sort_order"),
      supabase
        .from("question_keywords")
        .select("keyword,normalized_keyword")
        .eq("question_id", question.id)
        .order("keyword"),
      supabase
        .from("answer_evidence")
        .select("id,claimed_option_keys,explanation_richtext,provenance_note,verification_status,reviewed_by,reviewed_at")
        .eq("question_id", question.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("question_editor_drafts")
        .select("draft_payload,base_revision,updated_at")
        .eq("question_id", question.id)
        .maybeSingle(),
      supabase
        .from("question_appearances")
        .select("id,original_question_number,nta_question_id,paper_order,appearance_notes,source_metadata,exam_papers(id,paper_number,shift,exam_date,exam_events(year,session,event_type,label))")
        .eq("question_id", question.id),
    ]);

    for (const result of [
      translationsResult,
      optionsResult,
      classificationsResult,
      answerResult,
      argumentsResult,
      explanationTranslationsResult,
      assetsResult,
      keywordsResult,
      answerEvidenceResult,
      editorDraftResult,
      appearancesResult,
    ]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      question,
      translations: translationsResult.data ?? [],
      options: optionsResult.data ?? [],
      classifications: classificationsResult.data ?? [],
      verifiedAnswer: answerResult.data ?? null,
      explanationDraft: argumentsResult.data ?? null,
      explanationTranslations: explanationTranslationsResult.data ?? [],
      assets: assetsResult.data ?? [],
      keywords: keywordsResult.data ?? [],
      answerEvidence: answerEvidenceResult.data ?? [],
      editorDraft: editorDraftResult.data ?? null,
      appearances: appearancesResult.data ?? [],
      permissions: { canVerifyTranslations: role.role === "super_admin" || role.role === "reviewer", canPublish: role.role === "super_admin" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load question",
      },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ questionCode: string }> }
) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { data: role } = await supabase
      .from("admin_members")
      .select("role,active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!role?.active || !["super_admin", "content_editor", "reviewer"].includes(role.role)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { questionCode } = await context.params;
    const body = await request.json() as { action?: string; payload?: Record<string, unknown> };
    const action = body.action === "publish" ? "publish" : body.action === "draft" ? "draft" : "";
    if (!action || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
      return NextResponse.json({ error: "Provide an editor payload and choose Save Draft or Publish." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("save_question_editor", {
      p_question_code: questionCode,
      p_payload: body.payload,
      p_action: action,
    });
    if (error) {
      const message = error.message || "Unable to save question changes.";
      const status = message.includes("Only the Super Admin") ? 403 : 422;
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save question." },
      { status: 500 }
    );
  }
}
