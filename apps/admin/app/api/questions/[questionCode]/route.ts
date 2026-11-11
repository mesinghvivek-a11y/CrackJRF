
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
        .order("created_at"),
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
        {
          error:
            "Content editor, reviewer or Super Admin access required",
        },
        { status: 403 }
      );
    }

    const { questionCode } = await context.params;
    const body = await request.json();

    const wantsVerifiedAnswer = Boolean(
      body.answerStatus &&
        body.answerStatus !== "pending" &&
        body.answerStatus !== "disputed"
    );

    if (!Array.isArray(body.options) || body.options.length !== 4) {
      return NextResponse.json(
        { error: "Exactly four options are required for this MCQ editor" },
        { status: 400 }
      );
    }

    if (body.classifications !== undefined && !Array.isArray(body.classifications)) {
      return NextResponse.json(
        { error: "classifications must be an array" },
        { status: 400 }
      );
    }
    const requestedClassifications = Array.isArray(body.classifications) ? body.classifications : [];
    const includesTopic = requestedClassifications.some((item: { nodeId?: string }) => {
      const nodeId = String(item?.nodeId ?? "");
      return /-T\d{2}(?:-S\d{2})?$/.test(nodeId);
    });
    if (body.submitForApproval && !includesTopic) {
      return NextResponse.json(
        { error: "Assign at least one topic or sub-topic before submitting for approval." },
        { status: 400 }
      );
    }

    const {
      data: subject,
      error: subjectError,
    } = await supabase
      .from("subjects")
      .select("id")
      .eq("code", body.subjectCode ?? "80")
      .single();

    if (subjectError) throw subjectError;

    const { data: existing } = await supabase
      .from("questions")
      .select("id,current_revision,answer_status")
      .eq("question_code", questionCode)
      .maybeSingle();

    if (
      role.role === "content_editor" &&
      existing &&
      body.answerStatus !== existing.answer_status
    ) {
      return NextResponse.json(
        {
          error:
            "Only a Reviewer or Super Admin can change answer verification status.",
        },
        { status: 403 }
      );
    }

    if (
      role.role === "content_editor" &&
      !existing &&
      body.answerStatus !== "pending"
    ) {
      return NextResponse.json(
        {
          error:
            "A Content Editor must leave the answer pending and send it for review.",
        },
        { status: 403 }
      );
    }

    let questionId: string;

    const status = body.submitForApproval
      ? "ready_for_approval"
      : "draft";

    if (existing) {
      questionId = existing.id;

      const { error } = await supabase
        .from("questions")
        .update({
          subject_id: subject.id,
          question_type: body.questionType ?? "mcq",
          status,
          answer_status: body.answerStatus ?? "pending",
          updated_by: user.id,
          current_revision: (existing.current_revision ?? 1) + 1,
        })
        .eq("id", existing.id);

      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("questions")
        .insert({
          question_code: questionCode,
          subject_id: subject.id,
          question_type: body.questionType ?? "mcq",
          status,
          answer_status: body.answerStatus ?? "pending",
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;

      questionId = data.id;
    }

    const localizedEntries: Array<{ language: "en" | "hi"; script_variant: "native" | "roman"; locale: any }> = [
      ...(body.localized?.en ? [{ language: "en" as const, script_variant: "native" as const, locale: body.localized.en }] : []),
      ...(body.localized?.hi ? [{ language: "hi" as const, script_variant: "native" as const, locale: body.localized.hi }] : []),
      ...(body.localized?.hinglish ? [{ language: "hi" as const, script_variant: "roman" as const, locale: body.localized.hinglish }] : []),
    ];
    for (const entry of localizedEntries) {
      const { data: currentTranslation, error: lookupError } = await supabase
        .from("question_translations")
        .select("id,origin,language_question_code,reviewed,stem_blocks")
        .eq("question_id", questionId)
        .eq("language", entry.language)
        .eq("script_variant", entry.script_variant)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (entry.locale.reviewed === true && !["super_admin", "reviewer"].includes(role.role)) {
        const unchangedVerifiedText = currentTranslation?.reviewed && JSON.stringify(currentTranslation.stem_blocks ?? []) === JSON.stringify(entry.locale.stem ?? []);
        if (!unchangedVerifiedText) throw new Error("Only a Reviewer or Super Admin can mark question translations as reviewed.");
      }
      const values = {
        question_id: questionId,
        language: entry.language,
        script_variant: entry.script_variant,
        origin: entry.locale.origin ?? currentTranslation?.origin ?? "manual",
        stem_blocks: entry.locale.stem ?? [],
        instruction_blocks: entry.locale.instructions ?? [],
        reviewed: Boolean(entry.locale.reviewed),
        ...(currentTranslation?.language_question_code ? { language_question_code: currentTranslation.language_question_code } : {}),
      };
      const hasStem = Array.isArray(values.stem_blocks) && values.stem_blocks.some((block: any) => String(block.text ?? block.html ?? "").trim());
      if (!hasStem && currentTranslation) {
        const { error } = await supabase.from("question_translations").delete().eq("id", currentTranslation.id);
        if (error) throw error;
      } else if (hasStem) {
        const result = currentTranslation
          ? await supabase.from("question_translations").update(values).eq("id", currentTranslation.id)
          : await supabase.from("question_translations").insert(values);
        if (result.error) throw result.error;
      }
    }

    const { data: existingOptions, error: existingOptionsError } = await supabase
      .from("question_options")
      .select("id,option_key,provider_option_id")
      .eq("question_id", questionId);
    if (existingOptionsError) throw existingOptionsError;
    const existingOptionByKey = new Map((existingOptions ?? []).map((option) => [option.option_key, option]));
    const retainedOptionKeys = new Set<string>();
    for (const [idx, opt] of body.options.entries()) {
      const key = String(opt.key ?? "");
      if (!["A", "B", "C", "D", "E", "F"].includes(key)) throw new Error(`Invalid option key: ${key}`);
      retainedOptionKeys.add(key);
      const previous = existingOptionByKey.get(key);
      let optionId = previous?.id;
      if (previous) {
        const { error } = await supabase.from("question_options").update({ sort_order: idx, ...(previous.provider_option_id ? { provider_option_id: previous.provider_option_id } : {}) }).eq("id", previous.id);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase
          .from("question_options")
          .insert({ question_id: questionId, option_key: key, sort_order: idx })
          .select("id")
          .single();
        if (error || !inserted) throw error ?? new Error(`Unable to create option ${key}.`);
        optionId = inserted.id;
      }
      if (!optionId) throw new Error(`Unable to resolve canonical option ${key}.`);
      const variants: Array<{ language: "en" | "hi"; script_variant: "native" | "roman"; content: any; origin?: string }> = [
        ...(opt.localized?.en ? [{ language: "en" as const, script_variant: "native" as const, content: opt.localized.en, origin: opt.origins?.en }] : []),
        ...(opt.localized?.hi ? [{ language: "hi" as const, script_variant: "native" as const, content: opt.localized.hi, origin: opt.origins?.hi }] : []),
        ...(opt.localized?.hinglish ? [{ language: "hi" as const, script_variant: "roman" as const, content: opt.localized.hinglish, origin: opt.origins?.hinglish }] : []),
      ];
      for (const variant of variants) {
        const { data: currentOptionTranslation, error: optionLookupError } = await supabase
          .from("question_option_translations")
          .select("id,origin,reviewed,content_blocks")
          .eq("option_id", optionId)
          .eq("language", variant.language)
          .eq("script_variant", variant.script_variant)
          .maybeSingle();
        if (optionLookupError) throw optionLookupError;
        const optionReviewed = variant.language === "en" ? Boolean(opt.reviewed?.en) : Boolean(opt.reviewed?.[variant.script_variant === "roman" ? "hinglish" : "hi"]);
        if (optionReviewed && !["super_admin", "reviewer"].includes(role.role)) {
          const unchangedVerifiedOption = currentOptionTranslation?.reviewed && JSON.stringify(currentOptionTranslation.content_blocks ?? []) === JSON.stringify(variant.content ?? []);
          if (!unchangedVerifiedOption) throw new Error("Only a Reviewer or Super Admin can mark option translations as reviewed.");
        }
        const optionValues = { option_id: optionId, language: variant.language, script_variant: variant.script_variant, origin: variant.origin ?? variant.content.origin ?? currentOptionTranslation?.origin ?? "manual", reviewed: optionReviewed, content_blocks: variant.content };
        const hasContent = Array.isArray(optionValues.content_blocks) && optionValues.content_blocks.some((block: any) => String(block.text ?? block.html ?? "").trim());
        if (!hasContent && currentOptionTranslation) {
          const { error } = await supabase.from("question_option_translations").delete().eq("id", currentOptionTranslation.id);
          if (error) throw error;
        } else if (hasContent) {
          const optionResult = currentOptionTranslation
            ? await supabase.from("question_option_translations").update(optionValues).eq("id", currentOptionTranslation.id)
            : await supabase.from("question_option_translations").insert(optionValues);
          if (optionResult.error) throw optionResult.error;
        }
      }
    }
    const removedOptions = (existingOptions ?? []).filter((option) => !retainedOptionKeys.has(option.option_key));
    if (removedOptions.length) {
      const { error } = await supabase.from("question_options").delete().in("id", removedOptions.map((option) => option.id));
      if (error) throw error;
    }

    const { error: deleteClassificationsError } = await supabase
      .from("question_classifications")
      .delete()
      .eq("question_id", questionId);

    if (deleteClassificationsError) throw deleteClassificationsError;

    if (requestedClassifications.length > 0) {
      const { error: classificationError } = await supabase
        .from("question_classifications")
        .insert(
          requestedClassifications.map(
            (c: { nodeId: string; isPrimary?: boolean }) => ({
              question_id: questionId,
              syllabus_node_id: c.nodeId,
              is_primary: Boolean(c.isPrimary),
              assigned_by: user.id,
            })
          )
        );
      if (classificationError) throw classificationError;
    }

    if (Array.isArray(body.keywords)) {
      const { error: deleteKeywordsError } = await supabase
        .from("question_keywords")
        .delete()
        .eq("question_id", questionId);
      if (deleteKeywordsError) throw deleteKeywordsError;
      const cleanKeywordMap = new Map<string, string>();
      for (const value of body.keywords) {
        const keyword = String(value ?? "").trim().slice(0, 80);
        const normalized = keyword.toLocaleLowerCase("en-IN");
        if (keyword && !cleanKeywordMap.has(normalized)) cleanKeywordMap.set(normalized, keyword);
      }
      const cleanKeywords = [...cleanKeywordMap.entries()].slice(0, 30);
      if (cleanKeywords.length) {
        const { error: insertKeywordsError } = await supabase
          .from("question_keywords")
          .insert(cleanKeywords.map(([normalized_keyword, keyword]) => ({ question_id: questionId, keyword, normalized_keyword })));
        if (insertKeywordsError) throw insertKeywordsError;
      }
    }

    const { error: draftError } = await supabase
      .from("question_explanation_drafts")
      .upsert(
        {
          question_id: questionId,
          explanation_overview: body.explanationOverview ?? null,
          explanation_richtext: body.explanationRichtext ?? [],
          option_explanations: body.optionExplanations ?? {},
          references_data: body.references ?? [],
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "question_id" }
      );

    if (draftError) throw draftError;

    const explanationVariants: Array<{ language: "en" | "hi"; script_variant: "native" | "roman"; value: any }> = [
      ...(body.explanationTranslations?.en ? [{ language: "en" as const, script_variant: "native" as const, value: body.explanationTranslations.en }] : []),
      ...(body.explanationTranslations?.hi ? [{ language: "hi" as const, script_variant: "native" as const, value: body.explanationTranslations.hi }] : []),
      ...(body.explanationTranslations?.hinglish ? [{ language: "hi" as const, script_variant: "roman" as const, value: body.explanationTranslations.hinglish }] : []),
    ];
    for (const variant of explanationVariants) {
      const wantsVerifyExplanation = Boolean(variant.value.verified);
      const { data: currentExplanation, error: explanationLookupError } = await supabase
        .from("question_explanation_translations")
        .select("id,origin,review_status,explanation_richtext")
        .eq("question_id", questionId)
        .eq("language", variant.language)
        .eq("script_variant", variant.script_variant)
        .maybeSingle();
      if (explanationLookupError) throw explanationLookupError;
      if (variant.language === "hi" && wantsVerifyExplanation && !["super_admin", "reviewer"].includes(role.role)) {
        const unchangedVerifiedExplanation = currentExplanation?.review_status === "verified" && JSON.stringify(currentExplanation.explanation_richtext ?? []) === JSON.stringify(variant.value.richtext ?? []);
        if (!unchangedVerifiedExplanation) throw new Error("Only a Reviewer or Super Admin can verify Hindi/Hinglish explanations.");
        continue;
      }
      const explanationValues = {
        question_id: questionId,
        language: variant.language,
        script_variant: variant.script_variant,
        origin: variant.value.origin ?? currentExplanation?.origin ?? "manual",
        explanation_overview: variant.value.overview ?? "",
        explanation_richtext: variant.value.richtext ?? [],
        review_status: wantsVerifyExplanation && ["super_admin", "reviewer"].includes(role.role) ? "verified" : "draft",
        updated_by: user.id,
      };
      const hasExplanation = Array.isArray(explanationValues.explanation_richtext) && explanationValues.explanation_richtext.some((block: any) => String(block.text ?? block.html ?? "").trim());
      if (!hasExplanation && currentExplanation) {
        const { error } = await supabase.from("question_explanation_translations").delete().eq("id", currentExplanation.id);
        if (error) throw error;
      } else if (hasExplanation) {
        const explanationResult = currentExplanation
          ? await supabase.from("question_explanation_translations").update(explanationValues).eq("id", currentExplanation.id)
          : await supabase.from("question_explanation_translations").insert(explanationValues);
        if (explanationResult.error) throw explanationResult.error;
      }
    }

    const { data: currentAssets, error: currentAssetsError } = await supabase
      .from("question_assets")
      .select("id,storage_path")
      .eq("question_id", questionId);
    if (currentAssetsError) throw currentAssetsError;
    const requestedAssets = Array.isArray(body.mediaAssets) ? body.mediaAssets : (currentAssets ?? []);
    const requestedPaths = new Set(requestedAssets.map((asset: any) => String(asset.storage_path ?? "")).filter(Boolean));
    const removedAssets = (currentAssets ?? []).filter((asset) => !requestedPaths.has(asset.storage_path));
    if (removedAssets.length) {
      const { error } = await supabase.from("question_assets").delete().in("id", removedAssets.map((asset) => asset.id));
      if (error) throw error;
    }
    for (const [assetIndex, asset] of requestedAssets.entries()) {
      const storagePath = String(asset.storage_path ?? "");
      if (!storagePath) continue;
      const currentAsset = (currentAssets ?? []).find((item) => item.storage_path === storagePath);
      if (!currentAsset && !storagePath.startsWith(`question-assets/${user.id}/`)) {
        throw new Error("A new image must be uploaded into your own private question-assets folder.");
      }
      const assetType = ["image","map","diagram","table_image","page_crop","other"].includes(asset.asset_type) ? asset.asset_type : "image";
      const placement = asset.placement === "explanation" ? "explanation" : "question";
      const assetValues = { question_id: questionId, asset_type: assetType, storage_path: storagePath, placement, alt_text: String(asset.alt_text ?? ""), caption: String(asset.caption ?? ""), sort_order: assetIndex + 1 };
      const assetResult = currentAsset
        ? await supabase.from("question_assets").update(assetValues).eq("id", currentAsset.id)
        : await supabase.from("question_assets").insert(assetValues);
      if (assetResult.error) throw assetResult.error;
    }

    if (
      (role.role === "super_admin" || role.role === "reviewer") &&
      body.answerStatus &&
      body.answerStatus !== "pending" &&
      body.answerStatus !== "disputed" &&
      (
        (Array.isArray(body.correctOptionKeys) &&
          body.correctOptionKeys.length > 0) ||
        body.answerStatus === "dropped"
      )
    ) {
      const { error } = await supabase
        .from("verified_answers")
        .upsert(
          {
            question_id: questionId,
            correct_option_keys:
              body.answerStatus === "all_options_correct"
                ? ["A", "B", "C", "D"]
                : body.correctOptionKeys,
            answer_status: body.answerStatus,
            grading_rule:
              body.gradingRule ??
              (body.answerStatus === "dropped"
                ? "dropped_credit"
                : "normal"),
            explanation_overview: body.explanationOverview ?? null,
            explanation_richtext: body.explanationRichtext ?? [],
            option_explanations: body.optionExplanations ?? {},
            references_data: body.references ?? [],
            verified_by: user.id,
            verified_at: new Date().toISOString(),
          },
          { onConflict: "question_id" }
        );

      if (error) throw error;
    }

    if (
      (role.role === "super_admin" || role.role === "reviewer") &&
      (body.answerStatus === "pending" ||
        body.answerStatus === "disputed")
    ) {
      const { error } = await supabase
        .from("verified_answers")
        .delete()
        .eq("question_id", questionId);

      if (error) throw error;
    }

    if ((role.role === "super_admin" || role.role === "reviewer") && body.answerStatus) {
      const { data: evidenceRows, error: evidenceLookupError } = await supabase
        .from("answer_evidence")
        .select("id,claimed_option_keys")
        .eq("question_id", questionId);
      if (evidenceLookupError) throw evidenceLookupError;
      for (const evidence of evidenceRows ?? []) {
        const claimed = [...(evidence.claimed_option_keys ?? [])].map((key: string) => String(key).toUpperCase()).sort();
        const verified = [...(body.answerStatus === "all_options_correct" ? ["A","B","C","D"] : (body.correctOptionKeys ?? []))].map((key: string) => String(key).toUpperCase()).sort();
        const decision = body.answerStatus === "pending" ? "unverified" : body.answerStatus === "disputed" ? "disputed" : body.answerStatus === "dropped" ? "rejected" : JSON.stringify(claimed) === JSON.stringify(verified) ? "accepted" : "rejected";
        const { error: evidenceUpdateError } = await supabase.from("answer_evidence").update({ verification_status: decision, reviewed_by: decision === "unverified" ? null : user.id, reviewed_at: decision === "unverified" ? null : new Date().toISOString() }).eq("id", evidence.id);
        if (evidenceUpdateError) throw evidenceUpdateError;
      }
    }

    // Link the question to its original source item.
    const source = body.source;

    if (source?.sourceItemId) {
      const { data: item, error: itemError } = await supabase
        .from("source_question_items")
        .select(
          "id,language,source_document_id,source_page_start,source_question_number,source_native_question_id,source_documents(exam_paper_id)"
        )
        .eq("id", source.sourceItemId)
        .maybeSingle();

      if (itemError) throw itemError;

      const doc = (
        Array.isArray(item?.source_documents)
          ? item.source_documents[0]
          : item?.source_documents
      ) as { exam_paper_id: string | null } | null;

      if (item) {
        const { error: linkError } = await supabase
          .from("question_source_links")
          .upsert(
            {
              question_id: questionId,
              source_question_item_id: item.id,
              purpose:
                item.language === "hi"
                  ? "translation"
                  : "question_content",
              language: item.language,
            },
            { onConflict: "question_id,source_question_item_id" }
          );

        if (linkError) throw linkError;
      }

      if (item && doc?.exam_paper_id && source.originalNumber) {
        const { error: appearanceError } = await supabase
          .from("question_appearances")
          .upsert(
            {
              question_id: questionId,
              exam_paper_id: doc.exam_paper_id,
              original_question_number: String(source.originalNumber),
              nta_question_id:
                source.ntaQuestionId || item.source_native_question_id,
              source_question_item_id: item.id,
            },
            {
              onConflict:
                "question_id,exam_paper_id,original_question_number",
            }
          );

        if (appearanceError) throw appearanceError;
      }
    }

    const { error: revisionError } = await supabase
      .from("question_revisions")
      .insert({
        question_id: questionId,
        revision_number: existing
          ? (existing.current_revision ?? 1) + 1
          : 1,
        snapshot: body,
        changed_by: user.id,
        change_summary: body.submitForApproval
          ? "Submitted for approval"
          : "Draft saved",
      });

    if (revisionError) throw revisionError;

    return NextResponse.json({
      questionId,
      questionCode,
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected save error",
      },
      { status: 500 }
    );
  }
}
