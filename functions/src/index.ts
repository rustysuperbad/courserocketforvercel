import { Inngest, eventType } from "inngest";
import { serve } from "inngest/express";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import OpenAI from "openai";
import { z } from "zod";
import { getServiceSupabase } from "./supabase";
import { buildLearningPath } from "./learning";
import { flushObservability, reportWorkflowError, traceOperation, traceWorkflow } from "./observability";
import { createVerifiedLessonProvider } from "./providers";
import { generateVerifiedLesson, type EvidenceChunk } from "./verifiedLesson";
import { hybridSearchParams, rankRetrievedChunks, retrievalQuerySchema, toEvidenceChunks, toPublicChunks } from "./retrieval";
import {
  REGION, allowNonCommercialSources, booleanParam, dailyUserLimit, embeddingCostPerMillion, geminiApiKey, inngestEventKey,
  inngestSigningKey, langfusePublicKey, langfuseSecretKey, numberParam, openAiApiKey, projectDailySpendLimit, sentryDsn,
  supabaseSecrets, supabaseServiceRoleKey, supabaseUrl,
} from "./config";
import { guarded, parseInput, verifiedUid } from "./auth";
import { estimateRunCostUsd, publicRunView, reservationFailure, startJobSchema } from "./jobs";

const legacy = require("../index.js") as Record<string, unknown>;
if (!getApps().length) initializeApp();
export const generateStructuredContent = legacy.generateStructuredContent;
export const askCourseTutor = legacy.askCourseTutor;
export const searchYouTubeVideos = legacy.searchYouTubeVideos;
export const searchAcademicPapers = legacy.searchAcademicPapers;

const inngest = new Inngest({
  id: "courserocket",
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
const courseGenerationRequested = eventType("course/generation.requested", {
  schema: z.object({ runId: z.string().uuid() }),
});
const runIdSchema = z.string().uuid();

function serviceClient() {
  return getServiceSupabase(supabaseUrl.value(), supabaseServiceRoleKey.value());
}

async function persistProgress(runId: string, stage: string, percent: number, note?: string) {
  const { error } = await serviceClient().rpc("update_generation_progress", {
    p_run_id: runId,
    p_status: "running",
    p_progress: { stage, percent, ...(note ? { note } : {}) },
  });
  if (error) throw new Error("Could not save job progress.");
}

async function finalizeRun(runId: string, status: "completed" | "failed" | "blocked", latencyMs: number, errorCode?: string) {
  const { error } = await serviceClient().rpc("finalize_generation_run", {
    p_run_id: runId,
    p_status: status,
    p_actual_cost_usd: null,
    p_progress: { stage: status, percent: status === "completed" ? 100 : 0 },
    p_provider: null,
    p_model: null,
    p_input_tokens: null,
    p_output_tokens: null,
    p_latency_ms: latencyMs,
    p_fallback_used: false,
    p_error_code: errorCode ?? null,
  });
  if (error) throw new Error("Could not finalize generation run.");
}

type GenerationRun = { id: string; firebase_uid: string; goal: string; domain: "general" | "networking"; target_concept_slug: string | null; course_id: string | null };
type CourseConcept = { id: string; slug: string; title: string; estimated_minutes: number; level: number };
type JobStep = { conceptId: string; title: string; action: "learn" | "shorten" | "skip"; pKnown: number; estimatedMinutes: number };

async function retrieveForGeneration(query: string, options: { targetLevel?: number; conceptSlug?: string; ownerUid?: string } = {}): Promise<{ chunks: ReturnType<typeof toEvidenceChunks>; inputTokens: number; costUsd: number; retrievalStatus: "attributed" | "no_approved_sources" }> {
  const openai = new OpenAI({ apiKey: openAiApiKey.value() });
  const costPerMillion = numberParam(embeddingCostPerMillion.value(), 0.02);
  const embedded = await traceOperation("courserocket-course-retrieval", {
    provider: "openai", model: "text-embedding-3-small", fallbackUsed: false,
  }, async () => {
    const response = await openai.embeddings.create({ model: "text-embedding-3-small", input: query, dimensions: 1536 });
    const vector = response.data[0]?.embedding;
    if (!vector) throw new Error("Source retrieval did not return an embedding.");
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const costUsd = (inputTokens * costPerMillion) / 1_000_000;
    return { vector, inputTokens, costUsd };
  }, (result) => ({ inputTokens: result.inputTokens, outputTokens: 0, costEstimateUsd: result.costUsd }));
  const params = hybridSearchParams({
    query,
    embedding: embedded.vector,
    limit: 8,
    allowNonCommercial: booleanParam(allowNonCommercialSources.value()),
    targetLevel: options.targetLevel ?? 1,
    conceptSlugs: options.conceptSlug ? [options.conceptSlug] : null,
    ownerUid: options.ownerUid ?? null,
  });
  const { data, error } = await serviceClient().rpc("hybrid_search_source_chunks", params);
  if (error) throw new Error("Approved source retrieval failed.");
  const ranked = rankRetrievedChunks(data, 8);
  return {
    chunks: toEvidenceChunks(ranked),
    inputTokens: embedded.inputTokens,
    costUsd: embedded.costUsd,
    retrievalStatus: ranked.length ? "attributed" : "no_approved_sources",
  };
}

function inferNetworkingTarget(goal: string, concepts: CourseConcept[], requestedSlug: string | null): CourseConcept {
  const normalize = (value: string) => value.toLowerCase().replace(/^networking-/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const requested = requestedSlug ? concepts.find((concept) => concept.slug === (requestedSlug.startsWith("networking-") ? requestedSlug : `networking-${requestedSlug}`)) : undefined;
  if (requested) return requested;
  const words = new Set(normalize(goal).split(" ").filter((word) => word.length > 3));
  const ranked = concepts.map((concept) => ({ concept, matches: normalize(`${concept.slug} ${concept.title}`).split(" ").filter((word) => words.has(word)).length }))
    .sort((left, right) => right.matches - left.matches);
  return ranked[0]?.matches ? ranked[0].concept : concepts.find((concept) => concept.slug === "networking-network-purpose") ?? concepts[0]!;
}

async function loadCoursePath(run: GenerationRun): Promise<{ steps: JobStep[]; conceptById: Map<string, CourseConcept>; totalMinutes: number }> {
  if (run.domain !== "networking") {
    return { steps: [{ conceptId: "general-topic", title: run.goal, action: "learn", pKnown: 0.1, estimatedMinutes: 30 }], conceptById: new Map(), totalMinutes: 30 };
  }
  const supabase = serviceClient();
  const { data: concepts, error: conceptError } = await supabase.from("concepts").select("id,slug,title,estimated_minutes,level").eq("domain", "networking");
  if (conceptError || !concepts?.length) throw new Error("The networking concept graph has not been seeded.");
  const target = inferNetworkingTarget(run.goal, concepts, run.target_concept_slug);
  const conceptIds = concepts.map((concept) => concept.id);
  const [{ data: edges, error: edgeError }, { data: masteryRows, error: masteryError }] = await Promise.all([
    supabase.from("concept_prereqs").select("concept_id,prerequisite_id").in("concept_id", conceptIds),
    supabase.from("learner_mastery").select("concept_id,p_known").eq("firebase_uid", run.firebase_uid).in("concept_id", conceptIds),
  ]);
  if (edgeError || masteryError) throw new Error("Could not load learner prerequisite data.");
  const suffix = (slug: string) => slug.replace(/^networking-/, "");
  const graph = concepts.map((concept) => ({
    id: suffix(concept.slug), title: concept.title, estimatedMinutes: concept.estimated_minutes,
    prerequisiteIds: (edges ?? []).filter((edge) => edge.concept_id === concept.id).map((edge) => suffix(concepts.find((candidate) => candidate.id === edge.prerequisite_id)?.slug ?? "")),
  }));
  const mastery = Object.fromEntries((masteryRows ?? []).map((row) => [suffix(concepts.find((concept) => concept.id === row.concept_id)?.slug ?? ""), { pKnown: row.p_known }]));
  const steps = buildLearningPath(graph, suffix(target.slug), mastery);
  const conceptById = new Map(concepts.map((concept) => [suffix(concept.slug), concept]));
  return { steps, conceptById, totalMinutes: steps.reduce((sum, step) => sum + step.estimatedMinutes, 0) };
}

async function ensureCourse(run: GenerationRun, estimatedMinutes: number): Promise<string> {
  const supabase = serviceClient();
  const existing = await supabase.from("courses").select("id").eq("generation_run_id", run.id).maybeSingle();
  if (existing.error) throw new Error("Could not load the course for this generation run.");
  if (existing.data?.id) return existing.data.id;
  const { data, error } = await supabase.from("courses").insert({
    firebase_uid: run.firebase_uid, goal: run.goal, domain: run.domain,
    generation_run_id: run.id, status: "generating", content_status: "ai_generated", estimated_minutes: estimatedMinutes,
  }).select("id").single();
  if (error || !data) {
    const retryLookup = await supabase.from("courses").select("id").eq("generation_run_id", run.id).maybeSingle();
    if (retryLookup.data?.id) return retryLookup.data.id;
    throw new Error("Could not create the course record.");
  }
  const { error: attachError } = await supabase.from("generation_runs").update({ course_id: data.id }).eq("id", run.id);
  if (attachError) throw new Error("Could not attach the generation run to its course.");
  return data.id;
}

async function persistLessonModule(args: { run: GenerationRun; courseId: string; position: number; step: JobStep; concept?: CourseConcept; lesson: Awaited<ReturnType<typeof generateVerifiedLesson>>; sources: EvidenceChunk[] }) {
  const supabase = serviceClient();
  const { data: module, error: moduleError } = await supabase.from("modules").upsert({
    course_id: args.courseId,
    concept_id: args.concept?.id ?? null,
    position: args.position,
    title: args.lesson.title,
    summary: args.lesson.contentStatus === "ai_verified" ? `Verified lesson on ${args.step.title}.` : `Lesson draft on ${args.step.title}; evidence review is incomplete.`,
    body: { sections: args.lesson.sections, verificationIssues: args.lesson.verificationIssues, sources: args.sources.map((source, index) => ({ id: source.id, citation: index + 1, title: source.title, url: source.url, license: source.license, attribution: source.attribution })) },
    content_status: args.lesson.contentStatus,
  }, { onConflict: "course_id,position" }).select("id").single();
  if (moduleError || !module) throw new Error("Could not save the generated module.");
  if (args.lesson.claims.length) {
    const { error } = await supabase.from("lesson_claims").upsert(args.lesson.claims.map((claim) => ({
      module_id: module.id, claim_key: claim.id, claim_text: claim.text, supporting_chunk_ids: claim.sourceChunkIds,
      verified: claim.verified, verification_status: claim.verificationStatus,
      verifier_model: "gemini-independent-review",
    })), { onConflict: "module_id,claim_key" });
    if (error) throw new Error("Could not save claim verification results.");
  }
  if (args.lesson.quizItems.length) {
    const { error } = await supabase.from("quiz_items").upsert(args.lesson.quizItems.map((item) => ({
      module_id: module.id, item_key: item.id, concept_id: args.concept?.id ?? null, question: item.question,
      options: item.options, correct_answer: item.correctAnswer, explanation: item.explanation,
      question_type: item.questionType, verified: item.verified, source_chunk_ids: item.sourceChunkIds,
    })), { onConflict: "module_id,item_key" });
    if (error) throw new Error("Could not save verified quiz items.");
  }
  return module.id;
}

const processCourseGeneration = inngest.createFunction(
  {
    id: "course-generation-pipeline-v1",
    retries: 3,
    idempotency: "event.data.runId",
    triggers: courseGenerationRequested,
    onFailure: async ({ event, step: failureStep }) => {
      const originalEvent = (event.data as { event?: { data?: { runId?: unknown } } }).event;
      const parsedRunId = runIdSchema.safeParse(originalEvent?.data?.runId);
      if (!parsedRunId.success) return;
      reportWorkflowError(parsedRunId.data);
      await failureStep.run("mark-course-run-failed", async () => finalizeRun(parsedRunId.data, "failed", 0, "workflow_failed"));
      await flushObservability();
    },
  },
  async ({ event, step }) => {
    const runId = runIdSchema.parse(event.data.runId);
    const startedAt = Date.now();
    const { data: run, error: runError } = await serviceClient().from("generation_runs")
      .select("id,firebase_uid,goal,domain,target_concept_slug,course_id")
      .eq("id", runId).single();
    if (runError || !run) throw new Error("Generation run could not be loaded.");
    const snapshot = run as GenerationRun;
    try {
      return await traceWorkflow(runId, async () => {
        await step.run("mark-run-running", async () => {
          await persistProgress(runId, "accepted", 3);
          return { accepted: true };
        });
        const coursePath = await loadCoursePath(snapshot);
        const courseId = await step.run("ensure-course-record", () => ensureCourse(snapshot, coursePath.totalMinutes));
        const masteredTitles = coursePath.steps.filter((item) => item.action === "skip").map((item) => item.title).slice(0, 8).join(", ");
        let verifiedCount = 0;
        let evidenceMissingCount = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;

        for (let position = 0; position < coursePath.steps.length; position += 1) {
          const item = coursePath.steps[position]!;
          const concept = coursePath.conceptById.get(item.conceptId);
          const percent = 5 + Math.floor((position / Math.max(coursePath.steps.length, 1)) * 88);
          await persistProgress(runId, `module-${position + 1}-of-${coursePath.steps.length}`, percent);
          const result = await step.run(`build-module-${position + 1}`, async () => {
            if (item.action === "skip") {
              const { error } = await serviceClient().from("modules").upsert({
                course_id: courseId, concept_id: concept?.id ?? null, position, title: item.title,
                summary: "Skipped based on your current mastery estimate.",
                body: { learningStatus: "skipped_mastered", pKnown: item.pKnown }, content_status: "ai_generated",
              }, { onConflict: "course_id,position" });
              if (error) throw new Error("Could not save the mastered concept step.");
              return { status: "skipped", inputTokens: 0, outputTokens: 0, costUsd: 0 };
            }

            const query = snapshot.domain === "networking" ? `${item.title} ${snapshot.goal}` : snapshot.goal;
            const evidence = await retrieveForGeneration(query, {
              targetLevel: concept?.level ?? 1,
              conceptSlug: concept?.slug,
              ownerUid: snapshot.firebase_uid,
            });
            totalInputTokens += evidence.inputTokens;
            totalCostUsd += evidence.costUsd;
            if (!evidence.chunks.length) {
              evidenceMissingCount += 1;
              const emptyLesson = await generateVerifiedLesson({ goal: item.title, targetLevel: "beginner", chunks: [] }, {
                generate: async () => ({}), critique: async () => ({}),
              });
              await persistLessonModule({ run: snapshot, courseId, position, step: item, concept, lesson: emptyLesson, sources: [] });
              await serviceClient().rpc("record_generation_usage", {
                p_run_id: runId, p_usage_key: `module-${position}`, p_provider: "openai", p_model: "text-embedding-3-small",
                p_input_tokens: evidence.inputTokens, p_output_tokens: 0, p_cost_usd: evidence.costUsd, p_latency_ms: 0,
              });
              return { status: "evidence-missing", inputTokens: evidence.inputTokens, outputTokens: 0, costUsd: evidence.costUsd };
            }

            const model = process.env.OPENAI_MODEL || "gpt-6.1-sol";
            const criticModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
            const lessonWriter = createVerifiedLessonProvider({ openAiKey: openAiApiKey.value(), geminiKey: geminiApiKey.value(), openAiModel: model, geminiModel: criticModel });
            const lesson = await generateVerifiedLesson({
              goal: `${item.title}. Course goal: ${snapshot.goal}. Every quiz conceptSlug must be '${concept?.slug ?? "general-topic"}'.`,
              targetLevel: "beginner",
              analogyContext: masteredTitles,
              chunks: evidence.chunks,
            }, lessonWriter.provider);
            await persistLessonModule({ run: snapshot, courseId, position, step: item, concept, lesson, sources: evidence.chunks });
            const inputTokens = evidence.inputTokens + lessonWriter.usage.inputTokens;
            const outputTokens = lessonWriter.usage.outputTokens;
            const costUsd = evidence.costUsd + lessonWriter.usage.costUsd;
            const { error: usageError } = await serviceClient().rpc("record_generation_usage", {
              p_run_id: runId,
              p_usage_key: `module-${position}`,
              p_provider: "openai+google-gemini",
              p_model: `${model}+${criticModel}`,
              p_input_tokens: inputTokens,
              p_output_tokens: outputTokens,
              p_cost_usd: costUsd,
              p_latency_ms: Date.now() - startedAt,
            });
            if (usageError) throw new Error("Could not save generation usage metadata.");
            return { status: lesson.contentStatus, inputTokens, outputTokens, costUsd };
          });
          totalInputTokens += result.inputTokens;
          totalOutputTokens += result.outputTokens;
          totalCostUsd += result.costUsd;
          if (result.status === "ai_verified") verifiedCount += 1;
        }

        const allReviewed = verifiedCount + coursePath.steps.filter((item) => item.action === "skip").length === coursePath.steps.length && evidenceMissingCount === 0;
        const courseStatus = allReviewed ? "ready" : "draft";
        const courseContentStatus = allReviewed ? "ai_verified" : "ai_generated";
        await step.run("finish-course-record", async () => {
          const { error } = await serviceClient().from("courses").update({ status: courseStatus, content_status: courseContentStatus, estimated_minutes: coursePath.totalMinutes, updated_at: new Date().toISOString() }).eq("id", courseId);
          if (error) throw new Error("Could not finish the course record.");
          const resultStatus = evidenceMissingCount === coursePath.steps.length ? "blocked" : "completed";
          await persistProgress(runId, resultStatus === "blocked" ? "evidence-unavailable" : "course-ready", 100,
            resultStatus === "blocked" ? "No approved evidence was available; no lesson was marked complete." : allReviewed ? "Every generated module passed claim and quiz verification." : "Course saved with modules that still need evidence review.");
          await finalizeRun(runId, resultStatus, Date.now() - startedAt, resultStatus === "blocked" ? "evidence_unavailable" : undefined);
          return { status: resultStatus, contentStatus: courseContentStatus };
        });
        return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd, verifiedCount, moduleCount: coursePath.steps.length };
      });
    } finally {
      await flushObservability();
    }
  },
);

export const inngestEndpoint = onRequest({
  region: REGION,
  timeoutSeconds: 540,
  memory: "1GiB",
  maxInstances: 4,
  secrets: [supabaseUrl, supabaseServiceRoleKey, inngestSigningKey, langfusePublicKey, langfuseSecretKey, sentryDsn, openAiApiKey, geminiApiKey],
}, serve({ client: inngest, functions: [processCourseGeneration] }));

export const startCourseJob = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 30,
  secrets: [...supabaseSecrets, inngestEventKey, sentryDsn],
  memory: "512MiB",
}, guarded("start-course-job", async (request) => {
  const uid = await verifiedUid(request);
  const input = parseInput(startJobSchema, request.data, "Check the learning goal and try again.");
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

  // Idempotent re-dispatch: a run that already finished or is running is returned as-is.
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
}));

const runLookupSchema = z.object({ runId: z.string().uuid() }).strict();
/** Token-only job status: works even before Supabase third-party auth is configured. */
export const getCourseJobStatus = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 15,
  secrets: [...supabaseSecrets, sentryDsn],
}, guarded("course-job-status", async (request) => {
  const uid = await verifiedUid(request);
  const input = parseInput(runLookupSchema, request.data, "A valid run id is required.");
  const { data, error } = await serviceClient().from("generation_runs")
    .select("id,status,progress,course_id,domain,actual_cost_usd,cost_estimate_usd,error_code,fallback_used,created_at,updated_at")
    .eq("id", input.runId).eq("firebase_uid", uid).maybeSingle();
  if (error) throw new HttpsError("internal", "Could not load this run.");
  if (!data) throw new HttpsError("not-found", "That run does not exist or is not yours.");
  return publicRunView(data);
}));

export const listLearningRuns = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 15,
  secrets: [...supabaseSecrets, sentryDsn],
}, guarded("list-learning-runs", async (request) => {
  const uid = await verifiedUid(request);
  const { data, error } = await serviceClient().from("generation_runs")
    .select("id,status,progress,course_id,domain,goal,actual_cost_usd,cost_estimate_usd,error_code,fallback_used,created_at,updated_at")
    .eq("firebase_uid", uid).order("created_at", { ascending: false }).limit(20);
  if (error) throw new HttpsError("internal", "Could not load your learning runs.");
  return { runs: (data ?? []).map((row) => ({ ...publicRunView(row), goal: row.goal })) };
}));

export const searchLearningSources = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 30,
  secrets: [...supabaseSecrets, openAiApiKey, sentryDsn],
}, guarded("search-learning-sources", async (request) => {
  const uid = await verifiedUid(request);
  const input = parseInput(retrievalQuerySchema, request.data, "Enter a short topic to search learning sources.");
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
    const { data, error } = await supabase.rpc("hybrid_search_source_chunks", params);
    if (error) throw new Error("Hybrid source search failed.");
    const chunks = toPublicChunks(rankRetrievedChunks(data, input.limit));
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
}));

const baselineSchema = z.object({ knownConceptSlugs: z.array(z.string().trim().min(1).max(160)).max(100) }).strict();
export const saveNetworkingBaseline = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 20,
  secrets: [...supabaseSecrets, sentryDsn],
}, async (request) => {
  const uid = await verifiedUid(request);
  const input = baselineSchema.safeParse(request.data);
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

const diagnosticAnswerSchema = z.object({ conceptSlug: z.string().trim().min(1).max(160), isCorrect: z.boolean() }).strict();
export const submitDiagnosticAnswer = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 20,
  secrets: [...supabaseSecrets, sentryDsn],
}, async (request) => {
  const uid = await verifiedUid(request);
  const input = diagnosticAnswerSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "That diagnostic answer could not be saved.");
  const slug = input.data.conceptSlug.startsWith("networking-") ? input.data.conceptSlug : `networking-${input.data.conceptSlug}`;
  const supabase = serviceClient();
  const { data: concept, error: conceptError } = await supabase.from("concepts").select("id").eq("slug", slug).eq("domain", "networking").maybeSingle();
  if (conceptError || !concept) throw new HttpsError("not-found", "That networking concept is not available yet.");
  const { data, error } = await supabase.rpc("record_mastery_answer", { p_firebase_uid: uid, p_concept_id: concept.id, p_is_correct: input.data.isCorrect });
  if (error || !data?.[0]) throw new HttpsError("internal", "Could not update your concept mastery.");
  return { pKnown: data[0].p_known, attempts: data[0].attempts, correctAttempts: data[0].correct_attempts };
});

const pathSchema = z.object({ targetConceptSlug: z.string().trim().min(1).max(160) }).strict();
export const generateNetworkingPath = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 20,
  secrets: [...supabaseSecrets, sentryDsn],
}, async (request) => {
  const uid = await verifiedUid(request);
  const input = pathSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a networking learning goal.");
  const targetSlug = input.data.targetConceptSlug.startsWith("networking-") ? input.data.targetConceptSlug : `networking-${input.data.targetConceptSlug}`;
  const supabase = serviceClient();
  const { data: rows, error: conceptError } = await supabase.from("concepts").select("id,slug,title,estimated_minutes").eq("domain", "networking");
  if (conceptError || !rows?.length) throw new HttpsError("failed-precondition", "The networking concept graph has not been seeded yet.");
  const ids = rows.map((row) => row.id);
  const [{ data: edges, error: edgeError }, { data: masteryRows, error: masteryError }] = await Promise.all([
    supabase.from("concept_prereqs").select("concept_id,prerequisite_id").in("concept_id", ids),
    supabase.from("learner_mastery").select("concept_id,p_known").eq("firebase_uid", uid).in("concept_id", ids),
  ]);
  if (edgeError || masteryError) throw new HttpsError("internal", "Could not load your learning path data.");
  const suffix = (slug: string) => slug.replace(/^networking-/, "");
  const concepts = rows.map((row) => ({
    id: suffix(row.slug), title: row.title, estimatedMinutes: row.estimated_minutes,
    prerequisiteIds: (edges ?? []).filter((edge) => edge.concept_id === row.id).map((edge) => suffix(rows.find((candidate) => candidate.id === edge.prerequisite_id)?.slug ?? "")),
  }));
  const targetId = suffix(targetSlug);
  const mastery = Object.fromEntries((masteryRows ?? []).map((row) => [suffix(rows.find((candidate) => candidate.id === row.concept_id)?.slug ?? ""), { pKnown: row.p_known }]));
  let steps;
  try { steps = buildLearningPath(concepts, targetId, mastery); }
  catch { throw new HttpsError("not-found", "That networking goal is not in the launch concept graph yet."); }
  return { targetConceptSlug: targetSlug, steps, totalEstimatedMinutes: steps.reduce((total, step) => total + step.estimatedMinutes, 0), contentStatus: "ai_generated" as const };
});
