import { Inngest } from "inngest";
import OpenAI from "openai";
import { z } from "zod";
import { guarded, parseInput } from "./auth";
import { loadNetworkingCatalog, withNetworkingPrefix } from "./catalog";
import {
  allowNonCommercialSources, booleanParam, dailyUserLimit, embeddingCostPerMillion, inngestEventKey,
  isAdminUid, numberParam, openAiApiKey, projectDailySpendLimit,
} from "./config";
import { openAiEmbedder } from "./embeddings";
import { HttpsError } from "./errors";
import { estimateRunCostUsd, publicRunView, reservationFailure, startJobSchema } from "./jobs";
import {
  diagnosticChoiceSchema, learnerProfileSchema, loadPathForUser, nextDiagnosticQuestion as loadNextDiagnostic,
  publicNetworkingCatalog, saveLearnerOnboarding, submitDiagnosticChoice as recordDiagnosticChoice,
} from "./onboarding";
import { gradeReviewCard, listDueReviews as loadDueReviews, quizAttemptSchema, reviewGradeSchema, scoreNetworkingProject, submitQuizAttempt as persistQuizAttempt } from "./masteryLoop";
import { hybridSearchParams, rankRetrievedChunks, retrievalQuerySchema, toPublicChunks } from "./retrieval";
import { traceOperation } from "./observability";
import { finalizeRun, serviceClient } from "./server";
import {
  conceptMapFromCatalog, deleteLearnerData, exportLearnerData, feedbackSchema, flashcardsFromChunks, listFeedbackQueue,
  notesToPrivateSource, outcomeSchema, persistPrivateNotes, projectAnalytics, recordOutcome, relatedConceptIds,
  submitFeedback, uploadNotesSchema,
} from "./trust";
import { generateStructuredContent, askCourseTutor, searchYouTubeVideos, searchAcademicPapers } from "./legacyAi";
import { courseGenerationRequested } from "./events";
import { createConfiguredProvider } from "./rag/providers";
import { runRagCourse, toLegacyModule } from "./rag/pipeline";
import { liveOrFakeRetrieve } from "./rag/liveRetrieve";
import { fakeProvidersEnabled } from "./rag/config";
import { saveRagArtifact } from "./rag/artifacts";
import { settleGenerationQuota } from "./rag/quotaSettle";

const runLookupSchema = z.object({ runId: z.string().uuid() }).strict();
const baselineSchema = z.object({ knownConceptSlugs: z.array(z.string().trim().min(1).max(160)).max(100) }).strict();
const diagnosticAnswerSchema = z.object({ conceptSlug: z.string().trim().min(1).max(160), isCorrect: z.boolean() }).strict();
const pathSchema = z.object({ targetConceptSlug: z.string().trim().min(1).max(160) }).strict();
const nextDiagnosticSchema = z.object({ targetConceptSlug: z.string().trim().min(1).max(160).optional() }).strict();
const courseLookupSchema = z.object({ courseId: z.string().uuid() }).strict();
const projectSchema = z.object({ courseId: z.string().uuid(), writeup: z.string().trim().min(40).max(8000) }).strict();

const startCourseJob = guarded("start-course-job", async (data, uid) => {
  const input = parseInput(startJobSchema, data, "Check the learning goal and try again.");
  const targetSlug = input.targetConceptSlug
    ? (input.targetConceptSlug.startsWith("networking-") ? input.targetConceptSlug : `networking-${input.targetConceptSlug}`)
    : null;

  const { error: reservationError, data: runId } = await serviceClient().rpc("reserve_generation_run", {
    p_firebase_uid: uid,
    p_idempotency_key: input.idempotencyKey,
    p_goal: input.goal,
    p_estimate_usd: estimateRunCostUsd(input.domain),
    p_daily_user_limit: Math.max(1, Math.floor(numberParam(dailyUserLimit.value(), 3, 1))),
    p_project_daily_limit_usd: Math.max(1, numberParam(projectDailySpendLimit.value(), 25, 1)),
    p_domain: input.domain,
    p_target_concept_slug: input.domain === "networking" ? targetSlug : null,
  });
  if (reservationError || !runId) {
    const failure = reservationFailure(reservationError?.message);
    throw new HttpsError(failure.code, failure.message);
  }

  const { data: existing } = await serviceClient().from("generation_runs").select("status").eq("id", runId).maybeSingle();
  if (existing && existing.status !== "queued") return { runId, status: existing.status };

  try {
    const client = new Inngest({ id: "courserocket", eventKey: inngestEventKey.value() });
    await client.send(courseGenerationRequested.create({ runId: String(runId) }));
  } catch {
    try { await finalizeRun(runId, "failed", 0, "queue_dispatch_failed"); } catch { /* The run remains queryable for support. */ }
    throw new HttpsError("unavailable", "The course job queue is not connected yet. Please try again later.");
  }
  return { runId, status: "queued" };
});

const getCourseJobStatus = guarded("course-job-status", async (data, uid) => {
  const input = parseInput(runLookupSchema, data, "A valid run id is required.");
  const { data: row, error } = await serviceClient().from("generation_runs")
    .select("id,status,progress,course_id,domain,actual_cost_usd,cost_estimate_usd,error_code,fallback_used,created_at,updated_at")
    .eq("id", input.runId).eq("firebase_uid", uid).maybeSingle();
  if (error) throw new HttpsError("internal", "Could not load this run.");
  if (!row) throw new HttpsError("not-found", "That run does not exist or is not yours.");
  return publicRunView(row);
});

const listLearningRuns = guarded("list-learning-runs", async (_data, uid) => {
  const { data, error } = await serviceClient().from("generation_runs")
    .select("id,status,progress,course_id,domain,goal,actual_cost_usd,cost_estimate_usd,error_code,fallback_used,created_at,updated_at")
    .eq("firebase_uid", uid).order("created_at", { ascending: false }).limit(20);
  if (error) throw new HttpsError("internal", "Could not load your learning runs.");
  return { runs: (data ?? []).map((row) => ({ ...publicRunView(row), goal: row.goal })) };
});

const searchLearningSources = guarded("search-learning-sources", async (data, uid) => {
  const input = parseInput(retrievalQuerySchema, data, "Enter a short topic to search learning sources.");
  const supabase = serviceClient();
  const costPerMillion = numberParam(embeddingCostPerMillion.value(), 0.02);
  const reservedUsd = 0.00005;
  const { data: usageDay, error: reserveError } = await supabase.rpc("reserve_source_search", {
    p_firebase_uid: uid,
    p_estimate_usd: reservedUsd,
    p_daily_search_limit: 100,
    p_project_daily_limit_usd: Math.max(1, numberParam(projectDailySpendLimit.value(), 25, 1)),
  });
  if (reserveError || !usageDay) {
    if (reserveError?.message.includes("source_search_quota_exceeded")) throw new HttpsError("resource-exhausted", "You have reached today's source-search limit.");
    if (reserveError?.message.includes("project_spend_limit_exceeded")) throw new HttpsError("resource-exhausted", "Source search is paused because today's project budget has been reached.");
    throw new HttpsError("internal", "Could not reserve a source-search request.");
  }

  let actualUsd = 0;
  try {
    const openai = new OpenAI({ apiKey: openAiApiKey.value() });
    const embedding = await traceOperation("courserocket-source-retrieval", {
      provider: "openai", model: "text-embedding-3-small", fallbackUsed: false,
    }, async () => {
      const response = await openai.embeddings.create({ model: "text-embedding-3-small", input: input.query, dimensions: 1536 });
      const vector = response.data[0]?.embedding;
      if (!vector) throw new Error("OpenAI did not return an embedding.");
      const tokens = response.usage?.prompt_tokens ?? 0;
      actualUsd = (tokens * costPerMillion) / 1_000_000;
      return { vector, tokens };
    }, (result) => ({ inputTokens: result.tokens, outputTokens: 0, costEstimateUsd: actualUsd }));
    const params = hybridSearchParams({
      query: input.query,
      embedding: embedding.vector,
      limit: input.limit,
      allowNonCommercial: booleanParam(allowNonCommercialSources.value()),
      targetLevel: input.targetLevel,
      conceptSlugs: input.conceptSlugs ?? null,
      ownerUid: uid,
    });
    const { data: rows, error } = await supabase.rpc("hybrid_search_source_chunks", params);
    if (error) throw new Error("Hybrid source search failed.");
    const chunks = toPublicChunks(rankRetrievedChunks(rows, input.limit));
    return {
      chunks,
      retrievalStatus: chunks.length ? "attributed" as const : "no_approved_sources" as const,
      provider: "supabase-pgvector",
      model: "text-embedding-3-small",
      inputTokens: embedding.tokens,
      estimatedCostUsd: actualUsd,
    };
  } catch {
    return { chunks: [], retrievalStatus: "unavailable" as const, provider: "openai+supabase", model: "text-embedding-3-small", inputTokens: 0, estimatedCostUsd: actualUsd };
  } finally {
    await supabase.rpc("settle_source_search", { p_firebase_uid: uid, p_usage_day: usageDay, p_reserved_usd: reservedUsd, p_actual_usd: actualUsd });
  }
});

const saveNetworkingBaseline = guarded("save-networking-baseline", async (data, uid) => {
  const input = baselineSchema.safeParse(data);
  if (!input.success) throw new HttpsError("invalid-argument", "Select known networking topics and retry.");
  const slugs = [...new Set(input.data.knownConceptSlugs.map((slug) => slug.startsWith("networking-") ? slug : `networking-${slug}`))];
  if (!slugs.length) return { saved: 0 };
  const supabase = serviceClient();
  const { data: concepts, error } = await supabase.from("concepts").select("id, slug").eq("domain", "networking").in("slug", slugs);
  if (error) throw new HttpsError("internal", "Could not load the networking diagnostic.");
  const rows = (concepts ?? []).map((concept) => ({ firebase_uid: uid, concept_id: concept.id, p_known: 0.7, attempts: 0, correct_attempts: 0 }));
  if (rows.length) {
    const { error: saveError } = await supabase.from("learner_mastery").upsert(rows, { onConflict: "firebase_uid,concept_id" });
    if (saveError) throw new HttpsError("internal", "Could not save your starting knowledge.");
  }
  return { saved: rows.length };
});

const submitDiagnosticAnswer = guarded("submit-diagnostic-answer", async (data, uid) => {
  const input = diagnosticAnswerSchema.safeParse(data);
  if (!input.success) throw new HttpsError("invalid-argument", "That diagnostic answer could not be saved.");
  const slug = input.data.conceptSlug.startsWith("networking-") ? input.data.conceptSlug : `networking-${input.data.conceptSlug}`;
  const supabase = serviceClient();
  const { data: concept, error: conceptError } = await supabase.from("concepts").select("id").eq("slug", slug).eq("domain", "networking").maybeSingle();
  if (conceptError || !concept) throw new HttpsError("not-found", "That networking concept is not available yet.");
  const { data: mastery, error } = await supabase.rpc("record_mastery_answer", { p_firebase_uid: uid, p_concept_id: concept.id, p_is_correct: input.data.isCorrect });
  if (error || !mastery?.[0]) throw new HttpsError("internal", "Could not update your concept mastery.");
  return { pKnown: mastery[0].p_known, attempts: mastery[0].attempts, correctAttempts: mastery[0].correct_attempts };
});

const generateNetworkingPath = guarded("generate-networking-path", async (data, uid) => {
  const input = parseInput(pathSchema, data, "Choose a networking learning goal.");
  try {
    return await loadPathForUser(serviceClient(), uid, input.targetConceptSlug);
  } catch (error) {
    if (error instanceof Error && error.message === "unknown_target") throw new HttpsError("not-found", "That networking goal is not in the launch concept graph yet.");
    throw error;
  }
});

const listNetworkingCatalog = guarded("list-networking-catalog", async () => publicNetworkingCatalog());

const saveLearnerProfile = guarded("save-learner-profile", async (data, uid) => {
  const input = parseInput(learnerProfileSchema, data, "Check your goal, known topics, and interests.");
  try {
    return await saveLearnerOnboarding(serviceClient(), uid, input);
  } catch (error) {
    if (error instanceof Error && error.message === "unknown_target") throw new HttpsError("not-found", "That networking goal is not in the launch concept graph yet.");
    throw error;
  }
});

const getNextDiagnosticQuestion = guarded("next-diagnostic", async (data, uid) => {
  const input = parseInput(nextDiagnosticSchema, data ?? {}, "Choose a networking learning goal.");
  try {
    return await loadNextDiagnostic(serviceClient(), uid, input.targetConceptSlug);
  } catch (error) {
    if (error instanceof Error && error.message === "unknown_target") throw new HttpsError("not-found", "That networking goal is not in the launch concept graph yet.");
    throw error;
  }
});

const submitDiagnosticChoice = guarded("submit-diagnostic-choice", async (data, uid) => {
  const input = parseInput(diagnosticChoiceSchema, data, "That diagnostic answer could not be saved.");
  try {
    return await recordDiagnosticChoice(serviceClient(), uid, input);
  } catch (error) {
    if (error instanceof Error && (error.message === "unknown_target" || error.message === "unknown_concept")) {
      throw new HttpsError("not-found", "That networking concept is not available yet.");
    }
    throw error;
  }
});

const getLearningCourse = guarded("get-learning-course", async (data, uid) => {
  const input = parseInput(courseLookupSchema, data, "A valid course id is required.");
  const supabase = serviceClient();
  const { data: course, error } = await supabase.from("courses")
    .select("id, goal, domain, status, content_status, estimated_minutes, created_at, updated_at")
    .eq("id", input.courseId).eq("firebase_uid", uid).maybeSingle();
  if (error) throw new HttpsError("internal", "Could not load this course.");
  if (!course) throw new HttpsError("not-found", "That course does not exist or is not yours.");
  const { data: modules, error: moduleError } = await supabase.from("modules")
    .select("id, position, title, summary, body, content_status, concept_id, remediation_for_concept")
    .eq("course_id", course.id).order("position");
  if (moduleError) throw new HttpsError("internal", "Could not load course modules.");
  const moduleIds = (modules ?? []).map((row) => row.id);
  const [{ data: claims }, { data: quizzes }] = await Promise.all([
    moduleIds.length ? supabase.from("lesson_claims").select("module_id, claim_key, claim_text, supporting_chunk_ids, verified, verification_status").in("module_id", moduleIds) : Promise.resolve({ data: [] }),
    moduleIds.length ? supabase.from("quiz_items").select("module_id, item_key, question, options, explanation, question_type, verified, source_chunk_ids, concept_id").in("module_id", moduleIds) : Promise.resolve({ data: [] }),
  ]);
  return {
    course,
    modules: (modules ?? []).map((module) => ({
      ...module,
      claims: (claims ?? []).filter((claim) => claim.module_id === module.id),
      quizItems: (quizzes ?? []).filter((item) => item.module_id === module.id),
    })),
  };
});

const submitQuizAttempt = guarded("submit-quiz-attempt", async (data, uid) => {
  const input = parseInput(quizAttemptSchema, data, "That quiz answer could not be saved.");
  try {
    return await persistQuizAttempt(serviceClient(), uid, input);
  } catch (error) {
    if (error instanceof Error && error.message === "unknown_quiz") throw new HttpsError("not-found", "That quiz item is not on your course.");
    throw error;
  }
});

const listDueReviews = guarded("list-due-reviews", async (_data, uid) => ({ reviews: await loadDueReviews(serviceClient(), uid) }));

const submitReviewGrade = guarded("submit-review-grade", async (data, uid) => {
  const input = parseInput(reviewGradeSchema, data, "Choose a review rating.");
  try {
    return await gradeReviewCard(serviceClient(), uid, input);
  } catch (error) {
    if (error instanceof Error && error.message === "unknown_concept") throw new HttpsError("not-found", "That review card is not available.");
    throw error;
  }
});

const submitCourseProject = guarded("submit-course-project", async (data, uid) => {
  const input = parseInput(projectSchema, data, "Write at least a short explanation of the packet journey.");
  const supabase = serviceClient();
  const { data: course } = await supabase.from("courses").select("id, domain").eq("id", input.courseId).eq("firebase_uid", uid).maybeSingle();
  if (!course) throw new HttpsError("not-found", "That course does not exist or is not yours.");
  const rubric = scoreNetworkingProject(input.writeup);
  const { data: row, error } = await supabase.from("project_submissions").insert({
    firebase_uid: uid, course_id: course.id, writeup: input.writeup, rubric, score: rubric.score,
  }).select("id, score, rubric, created_at").single();
  if (error || !row) throw new HttpsError("internal", "Could not save your project.");
  return row;
});

const submitLessonFeedback = guarded("submit-lesson-feedback", async (data, uid) => {
  const input = parseInput(feedbackSchema, data, "Choose a feedback category.");
  return submitFeedback(serviceClient(), uid, input);
});

const recordLearningOutcome = guarded("record-learning-outcome", async (data, uid) => {
  const input = parseInput(outcomeSchema, data, "Choose a pre, post, or delayed check score.");
  const slug = withNetworkingPrefix(input.conceptSlug);
  const { data: concept } = await serviceClient().from("concepts").select("id").eq("slug", slug).maybeSingle();
  if (!concept) throw new HttpsError("not-found", "That concept is not in the launch catalog.");
  return recordOutcome(serviceClient(), uid, { ...input, conceptId: concept.id });
});

const exportLearningData = guarded("export-learning-data", async (_data, uid) => exportLearnerData(serviceClient(), uid));

const deleteLearningData = guarded("delete-learning-data", async (data, uid) => {
  const confirm = z.object({ confirm: z.literal("DELETE") }).strict().safeParse(data);
  if (!confirm.success) throw new HttpsError("invalid-argument", "Type DELETE to confirm account learning-data removal.");
  return deleteLearnerData(serviceClient(), uid);
});

const getLearningAnalytics = guarded("get-learning-analytics", async (_data, uid) => {
  const admin = isAdminUid(uid);
  const supabase = serviceClient();
  const stats = await projectAnalytics(supabase, admin ? undefined : uid);
  const queue = admin ? await listFeedbackQueue(supabase) : [];
  return { scope: admin ? "project" as const : "personal" as const, stats, feedbackQueue: queue };
});

const uploadLearnerNotes = guarded("upload-learner-notes", async (data, uid) => {
  const input = parseInput(uploadNotesSchema, data, "Paste at least a short excerpt from your notes.");
  const supabase = serviceClient();
  const packed = notesToPrivateSource(uid, input.title, input.text, input.courseId);
  if (!packed.chunks.length) throw new HttpsError("invalid-argument", "Those notes did not contain enough text to store.");
  const costPerMillion = numberParam(embeddingCostPerMillion.value(), 0.02);
  const reservedUsd = Math.max(0.0001, (packed.chunks.length * 400 * costPerMillion) / 1_000_000);
  const { data: usageDay, error: reserveError } = await supabase.rpc("reserve_source_search", {
    p_firebase_uid: uid,
    p_estimate_usd: reservedUsd,
    p_daily_search_limit: 100,
    p_project_daily_limit_usd: Math.max(1, numberParam(projectDailySpendLimit.value(), 25, 1)),
  });
  if (reserveError || !usageDay) {
    if (reserveError?.message.includes("source_search_quota_exceeded")) throw new HttpsError("resource-exhausted", "You have reached today's private-source upload limit.");
    if (reserveError?.message.includes("project_spend_limit_exceeded")) throw new HttpsError("resource-exhausted", "Uploads are paused because today's project budget has been reached.");
    throw new HttpsError("internal", "Could not reserve an embedding request.");
  }
  let actualUsd = 0;
  try {
    const openai = new OpenAI({ apiKey: openAiApiKey.value() });
    const embed = openAiEmbedder(openai);
    const embeddings = await traceOperation("courserocket-private-notes", {
      provider: "openai", model: "text-embedding-3-small", fallbackUsed: false,
    }, async () => {
      const vectors: number[][] = [];
      for (let offset = 0; offset < packed.chunks.length; offset += 50) {
        const batch = packed.chunks.slice(offset, offset + 50);
        vectors.push(...await embed(batch));
      }
      actualUsd = (packed.chunks.join(" ").length / 4 * costPerMillion) / 1_000_000;
      return vectors;
    }, () => ({ inputTokens: packed.chunks.length, outputTokens: 0, costEstimateUsd: actualUsd }));
    const saved = await persistPrivateNotes(supabase, packed, embeddings);
    const catalog = await loadNetworkingCatalog();
    const related = relatedConceptIds(input.text, catalog);
    return {
      sourceId: saved.sourceId,
      chunkCount: saved.chunkCount,
      estimatedCostUsd: actualUsd,
      flashcards: flashcardsFromChunks(packed.chunks),
      conceptMap: conceptMapFromCatalog(catalog, related),
      retrievalNote: "Private notes are retrieved only for your account and are never labelled as verified sources.",
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new Error("Could not embed private notes.");
  } finally {
    await supabase.rpc("settle_source_search", { p_firebase_uid: uid, p_usage_day: usageDay, p_reserved_usd: reservedUsd, p_actual_usd: actualUsd });
  }
});

const getNetworkingConceptMap = guarded("get-networking-concept-map", async () => {
  const catalog = await loadNetworkingCatalog();
  return conceptMapFromCatalog(catalog);
});

const ragCourseSchema = z.object({
  topic: z.string().max(8000),
}).strict();

const generateRagCourse = guarded("generate-rag-course", async (data, uid) => {
  const input = parseInput(ragCourseSchema, data, "A learning topic is required.");
  const fake = fakeProvidersEnabled();
  const client = fake ? null : serviceClient();
  const started = Date.now();
  let quotaRunId: string | null = null;
  if (!fake && client) {
    const goal = input.topic.trim().slice(0, 500) || "course request";
    const { error: reservationError, data: reservedId } = await client.rpc("reserve_generation_run", {
      p_firebase_uid: uid,
      p_idempotency_key: `rag-${globalThis.crypto.randomUUID()}`,
      p_goal: goal,
      p_estimate_usd: 0.12,
      p_daily_user_limit: Math.max(1, Math.floor(numberParam(dailyUserLimit.value(), 3, 1))),
      p_project_daily_limit_usd: Math.max(1, numberParam(projectDailySpendLimit.value(), 25, 1)),
      p_domain: "general",
      p_target_concept_slug: null,
    });
    if (reservationError || !reservedId) {
      const failure = reservationFailure(reservationError?.message);
      throw new HttpsError(failure.code, failure.message);
    }
    quotaRunId = String(reservedId);
  }
  try {
    const result = await runRagCourse(input.topic, {
      provider: createConfiguredProvider(),
      retrieve: (query, concepts) => liveOrFakeRetrieve(query, concepts, uid),
      ownerUid: uid,
      saveArtifact: client ? (row) => saveRagArtifact(client, row) : undefined,
    });
    await settleGenerationQuota({
      quotaRunId,
      started,
      finalize: finalizeRun,
      result,
    });
    return {
      runId: result.runId,
      spec: result.spec,
      status: result.spec.status,
      publishable: result.publishable,
      summary: result.summary,
      costUsd: result.costUsd,
      ingestionRequested: result.ingestionRequested,
      modules: result.lessons.map((lesson, index) => {
        const mapped = toLegacyModule(lesson);
        return {
          id: `module_${index + 1}`,
          title: mapped.title,
          summary: mapped.summary,
          lessons: mapped.lessons,
          quiz: mapped.quiz,
          concepts: result.spec.topic.split(" ").slice(0, 4),
          youtubeQueries: [mapped.title],
          paperTopics: [mapped.title],
          generationQuality: mapped.generationQuality,
          gaps: mapped.gaps,
          status: lesson.status,
        };
      }),
    };
  } catch (error) {
    try {
      await settleGenerationQuota({
        quotaRunId,
        started,
        finalize: finalizeRun,
        failed: true,
      });
    } catch { /* run remains queryable */ }
    throw error;
  }
});

export type CallableHandler = (data: unknown, uid: string) => Promise<unknown>;

export const CALLABLES: Record<string, CallableHandler> = {
  startCourseJob,
  getCourseJobStatus,
  listLearningRuns,
  searchLearningSources,
  saveNetworkingBaseline,
  submitDiagnosticAnswer,
  generateNetworkingPath,
  listNetworkingCatalog,
  saveLearnerProfile,
  getNextDiagnosticQuestion,
  submitDiagnosticChoice,
  getLearningCourse,
  submitQuizAttempt,
  listDueReviews,
  submitReviewGrade,
  submitCourseProject,
  submitLessonFeedback,
  recordLearningOutcome,
  exportLearningData,
  deleteLearningData,
  getLearningAnalytics,
  uploadLearnerNotes,
  getNetworkingConceptMap,
  generateRagCourse,
  generateStructuredContent,
  askCourseTutor,
  searchYouTubeVideos,
  searchAcademicPapers,
};
