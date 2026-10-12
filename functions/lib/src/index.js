"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNetworkingPath = exports.submitDiagnosticAnswer = exports.saveNetworkingBaseline = exports.searchLearningSources = exports.startCourseJob = exports.inngestEndpoint = exports.searchAcademicPapers = exports.searchYouTubeVideos = exports.askCourseTutor = exports.generateStructuredContent = void 0;
const inngest_1 = require("inngest");
const express_1 = require("inngest/express");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const auth_1 = require("firebase-admin/auth");
const app_1 = require("firebase-admin/app");
const openai_1 = __importDefault(require("openai"));
const zod_1 = require("zod");
const supabase_1 = require("./supabase");
const learning_1 = require("./learning");
const observability_1 = require("./observability");
if (!(0, app_1.getApps)().length)
    (0, app_1.initializeApp)();
const REGION = "us-central1";
const supabaseUrl = (0, params_1.defineSecret)("SUPABASE_URL");
const supabaseServiceRoleKey = (0, params_1.defineSecret)("SUPABASE_SERVICE_ROLE_KEY");
const inngestEventKey = (0, params_1.defineSecret)("INNGEST_EVENT_KEY");
const inngestSigningKey = (0, params_1.defineSecret)("INNGEST_SIGNING_KEY");
const langfusePublicKey = (0, params_1.defineSecret)("LANGFUSE_PUBLIC_KEY");
const langfuseSecretKey = (0, params_1.defineSecret)("LANGFUSE_SECRET_KEY");
(0, params_1.defineString)("LANGFUSE_BASE_URL", { default: "https://cloud.langfuse.com" });
const sentryDsn = (0, params_1.defineSecret)("SENTRY_DSN");
const openAiApiKey = (0, params_1.defineSecret)("OPENAI_API_KEY");
const dailyUserLimit = (0, params_1.defineString)("DAILY_COURSE_RUN_LIMIT", { default: "3" });
const projectDailySpendLimit = (0, params_1.defineString)("PROJECT_DAILY_SPEND_LIMIT_USD", { default: "25" });
const embeddingCostPerMillion = (0, params_1.defineString)("OPENAI_EMBEDDING_COST_PER_MILLION_USD", { default: "0.02" });
const allowNonCommercialSources = (0, params_1.defineString)("ALLOW_NONCOMMERCIAL_SOURCES", { default: "false" });
const legacy = require("../index.js");
exports.generateStructuredContent = legacy.generateStructuredContent;
exports.askCourseTutor = legacy.askCourseTutor;
exports.searchYouTubeVideos = legacy.searchYouTubeVideos;
exports.searchAcademicPapers = legacy.searchAcademicPapers;
const inngest = new inngest_1.Inngest({
    id: "courserocket",
    signingKey: process.env.INNGEST_SIGNING_KEY,
});
const courseGenerationRequested = (0, inngest_1.eventType)("course/generation.requested", {
    schema: zod_1.z.object({ runId: zod_1.z.string().uuid() }),
});
const runIdSchema = zod_1.z.string().uuid();
const startJobSchema = zod_1.z.object({
    goal: zod_1.z.string().trim().min(1).max(500),
    idempotencyKey: zod_1.z.string().trim().min(8).max(128),
    courseId: zod_1.z.string().trim().max(128).optional(),
    domain: zod_1.z.string().trim().max(80).default("general"),
}).strict();
function serviceClient() {
    return (0, supabase_1.getServiceSupabase)(supabaseUrl.value(), supabaseServiceRoleKey.value());
}
async function verifiedUid(request) {
    const callableUid = request.auth?.uid;
    if (!callableUid)
        throw new https_1.HttpsError("unauthenticated", "Sign in to start a learning job.");
    const header = request.rawRequest.headers.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token)
        throw new https_1.HttpsError("unauthenticated", "A Firebase ID token is required.");
    try {
        const decoded = await (0, auth_1.getAuth)().verifyIdToken(token, true);
        if (decoded.uid !== callableUid)
            throw new Error("token subject mismatch");
        return decoded.uid;
    }
    catch {
        throw new https_1.HttpsError("unauthenticated", "Your sign-in has expired. Please sign in again.");
    }
}
async function persistProgress(runId, status, stage, percent, note) {
    const { error } = await serviceClient().rpc("update_generation_progress", {
        p_run_id: runId,
        p_status: status,
        p_progress: { stage, percent, ...(note ? { note } : {}) },
    });
    if (error)
        throw new Error("Could not save job progress.");
}
async function finalizeRun(runId, status, latencyMs, errorCode) {
    const { error } = await serviceClient().rpc("finalize_generation_run", {
        p_run_id: runId,
        p_status: status,
        p_actual_cost_usd: 0,
        p_progress: { stage: status, percent: status === "completed" ? 100 : 0 },
        p_provider: "inngest",
        p_model: "workflow-skeleton",
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_latency_ms: latencyMs,
        p_fallback_used: false,
        p_error_code: errorCode ?? null,
    });
    if (error)
        throw new Error("Could not finalize generation run.");
}
const processCourseGeneration = inngest.createFunction({ id: "course-generation-skeleton", retries: 3, idempotency: "event.data.runId", triggers: courseGenerationRequested }, async ({ event, step }) => {
    const runId = runIdSchema.parse(event.data.runId);
    const startedAt = Date.now();
    try {
        await (0, observability_1.traceWorkflow)(runId, async () => {
            await step.run("mark-run-running", async () => {
                await persistProgress(runId, "running", "accepted", 10);
                return { runId, stage: "accepted" };
            });
            const snapshot = await step.run("load-run-metadata", async () => {
                const { data, error } = await serviceClient().from("generation_runs").select("id, firebase_uid, goal, status, cost_estimate_usd, actual_cost_usd").eq("id", runId).single();
                if (error || !data)
                    throw new Error("Generation run could not be loaded.");
                return data;
            });
            await step.run("record-skeleton-progress", async () => {
                await persistProgress(runId, "running", "pipeline-ready", 30, "Durable job accepted; content-generation steps are being connected.");
                return { runId, domain: "general", goalLength: snapshot.goal.length };
            });
            await step.run("finalize-skeleton-run", async () => {
                await persistProgress(runId, "completed", "pipeline-ready", 100, "Job queue and run tracking are ready.");
                await finalizeRun(runId, "completed", Date.now() - startedAt);
                return { status: "completed" };
            });
        });
    }
    catch (error) {
        (0, observability_1.reportWorkflowError)(runId);
        try {
            await finalizeRun(runId, "failed", Date.now() - startedAt, "workflow_failed");
        }
        catch { /* Inngest retries after the original failure. */ }
        throw error;
    }
    finally {
        await (0, observability_1.flushObservability)();
    }
});
exports.inngestEndpoint = (0, https_1.onRequest)({
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 4,
    secrets: [supabaseUrl, supabaseServiceRoleKey, inngestSigningKey, langfusePublicKey, langfuseSecretKey, sentryDsn],
}, (0, express_1.serve)({ client: inngest, functions: [processCourseGeneration] }));
exports.startCourseJob = (0, https_1.onCall)({
    region: REGION,
    cors: true,
    timeoutSeconds: 30,
    secrets: [supabaseUrl, supabaseServiceRoleKey, inngestEventKey],
    memory: "512MiB",
}, async (request) => {
    const uid = await verifiedUid(request);
    const input = startJobSchema.safeParse(request.data);
    if (!input.success)
        throw new https_1.HttpsError("invalid-argument", "Check the learning goal and try again.");
    const { error: reservationError, data: runId } = await serviceClient().rpc("reserve_generation_run", {
        p_firebase_uid: uid,
        p_idempotency_key: input.data.idempotencyKey,
        p_goal: input.data.goal,
        p_estimate_usd: 0.05,
        p_daily_user_limit: Math.max(1, Number(dailyUserLimit.value()) || 3),
        p_project_daily_limit_usd: Math.max(1, Number(projectDailySpendLimit.value()) || 25),
    });
    if (reservationError || !runId) {
        const message = reservationError?.message ?? "Run reservation failed.";
        if (message.includes("quota_exceeded"))
            throw new https_1.HttpsError("resource-exhausted", "You have reached today's course-generation limit.");
        if (message.includes("spend_limit_exceeded"))
            throw new https_1.HttpsError("resource-exhausted", "Course generation is paused because today's project budget has been reached.");
        throw new https_1.HttpsError("internal", "Could not reserve a course-generation run.");
    }
    try {
        const client = new inngest_1.Inngest({ id: "courserocket", eventKey: inngestEventKey.value() });
        await client.send(courseGenerationRequested.create({ runId: String(runId) }));
    }
    catch {
        try {
            await finalizeRun(runId, "failed", 0, "queue_dispatch_failed");
        }
        catch { /* The run remains queryable for support. */ }
        throw new https_1.HttpsError("unavailable", "The course job queue is not connected yet. Please try again later.");
    }
    return { runId, status: "queued" };
});
const sourceSearchSchema = zod_1.z.object({ query: zod_1.z.string().trim().min(2).max(500), limit: zod_1.z.number().int().min(1).max(20).default(8) }).strict();
exports.searchLearningSources = (0, https_1.onCall)({
    region: REGION,
    cors: true,
    timeoutSeconds: 30,
    secrets: [supabaseUrl, supabaseServiceRoleKey, openAiApiKey],
}, async (request) => {
    const uid = await verifiedUid(request);
    const input = sourceSearchSchema.safeParse(request.data);
    if (!input.success)
        throw new https_1.HttpsError("invalid-argument", "Enter a short topic to search learning sources.");
    const supabase = serviceClient();
    const costPerMillion = Math.max(0, Number(embeddingCostPerMillion.value()) || 0.02);
    const reservedUsd = 0.00005;
    const { data: usageDay, error: reserveError } = await supabase.rpc("reserve_source_search", {
        p_firebase_uid: uid,
        p_estimate_usd: reservedUsd,
        p_daily_search_limit: 100,
        p_project_daily_limit_usd: Math.max(1, Number(projectDailySpendLimit.value()) || 25),
    });
    if (reserveError || !usageDay) {
        if (reserveError?.message.includes("source_search_quota_exceeded"))
            throw new https_1.HttpsError("resource-exhausted", "You have reached today's source-search limit.");
        if (reserveError?.message.includes("project_spend_limit_exceeded"))
            throw new https_1.HttpsError("resource-exhausted", "Source search is paused because today's project budget has been reached.");
        throw new https_1.HttpsError("internal", "Could not reserve a source-search request.");
    }
    let actualUsd = 0;
    try {
        const openai = new openai_1.default({ apiKey: openAiApiKey.value() });
        const embedding = await (0, observability_1.traceOperation)("courserocket-source-retrieval", {
            provider: "openai", model: "text-embedding-3-small", fallbackUsed: false,
        }, async () => {
            const response = await openai.embeddings.create({ model: "text-embedding-3-small", input: input.data.query, dimensions: 1536 });
            const vector = response.data[0]?.embedding;
            if (!vector)
                throw new Error("OpenAI did not return an embedding.");
            const tokens = response.usage?.prompt_tokens ?? 0;
            actualUsd = (tokens * costPerMillion) / 1_000_000;
            return { vector, tokens };
        });
        const { data, error } = await supabase.rpc("hybrid_search_source_chunks", {
            p_query: input.data.query,
            p_query_embedding: `[${embedding.vector.join(",")}]`,
            p_limit: input.data.limit,
            p_allow_noncommercial: allowNonCommercialSources.value().toLowerCase() === "true",
        });
        if (error)
            throw new Error("Hybrid source search failed.");
        const chunks = (data ?? []).map((chunk, index) => ({
            id: chunk.chunk_id,
            citation: index + 1,
            text: chunk.chunk_text,
            source: { id: chunk.source_id, title: chunk.title, url: chunk.url, license: chunk.license, attribution: chunk.attribution },
            authorityScore: chunk.authority_score,
            level: chunk.level,
            score: chunk.final_score,
        }));
        return { chunks, retrievalStatus: chunks.length ? "attributed" : "no_approved_sources", provider: "supabase-pgvector", model: "text-embedding-3-small", inputTokens: embedding.tokens, estimatedCostUsd: actualUsd };
    }
    catch {
        return { chunks: [], retrievalStatus: "unavailable", provider: "openai+supabase", model: "text-embedding-3-small", inputTokens: 0, estimatedCostUsd: actualUsd };
    }
    finally {
        await supabase.rpc("settle_source_search", { p_firebase_uid: uid, p_usage_day: usageDay, p_reserved_usd: reservedUsd, p_actual_usd: actualUsd });
    }
});
const baselineSchema = zod_1.z.object({ knownConceptSlugs: zod_1.z.array(zod_1.z.string().trim().min(1).max(160)).max(100) }).strict();
exports.saveNetworkingBaseline = (0, https_1.onCall)({
    region: REGION,
    cors: true,
    timeoutSeconds: 20,
    secrets: [supabaseUrl, supabaseServiceRoleKey],
}, async (request) => {
    const uid = await verifiedUid(request);
    const input = baselineSchema.safeParse(request.data);
    if (!input.success)
        throw new https_1.HttpsError("invalid-argument", "Select known networking topics and retry.");
    const slugs = [...new Set(input.data.knownConceptSlugs.map((slug) => slug.startsWith("networking-") ? slug : `networking-${slug}`))];
    if (!slugs.length)
        return { saved: 0 };
    const supabase = serviceClient();
    const { data: concepts, error } = await supabase.from("concepts").select("id, slug").eq("domain", "networking").in("slug", slugs);
    if (error)
        throw new https_1.HttpsError("internal", "Could not load the networking diagnostic.");
    const rows = (concepts ?? []).map((concept) => ({ firebase_uid: uid, concept_id: concept.id, p_known: 0.7, attempts: 0, correct_attempts: 0 }));
    if (rows.length) {
        const { error: saveError } = await supabase.from("learner_mastery").upsert(rows, { onConflict: "firebase_uid,concept_id" });
        if (saveError)
            throw new https_1.HttpsError("internal", "Could not save your starting knowledge.");
    }
    return { saved: rows.length };
});
const diagnosticAnswerSchema = zod_1.z.object({ conceptSlug: zod_1.z.string().trim().min(1).max(160), isCorrect: zod_1.z.boolean() }).strict();
exports.submitDiagnosticAnswer = (0, https_1.onCall)({
    region: REGION,
    cors: true,
    timeoutSeconds: 20,
    secrets: [supabaseUrl, supabaseServiceRoleKey],
}, async (request) => {
    const uid = await verifiedUid(request);
    const input = diagnosticAnswerSchema.safeParse(request.data);
    if (!input.success)
        throw new https_1.HttpsError("invalid-argument", "That diagnostic answer could not be saved.");
    const slug = input.data.conceptSlug.startsWith("networking-") ? input.data.conceptSlug : `networking-${input.data.conceptSlug}`;
    const supabase = serviceClient();
    const { data: concept, error: conceptError } = await supabase.from("concepts").select("id").eq("slug", slug).eq("domain", "networking").maybeSingle();
    if (conceptError || !concept)
        throw new https_1.HttpsError("not-found", "That networking concept is not available yet.");
    const { data, error } = await supabase.rpc("record_mastery_answer", { p_firebase_uid: uid, p_concept_id: concept.id, p_is_correct: input.data.isCorrect });
    if (error || !data?.[0])
        throw new https_1.HttpsError("internal", "Could not update your concept mastery.");
    return { pKnown: data[0].p_known, attempts: data[0].attempts, correctAttempts: data[0].correct_attempts };
});
const pathSchema = zod_1.z.object({ targetConceptSlug: zod_1.z.string().trim().min(1).max(160) }).strict();
exports.generateNetworkingPath = (0, https_1.onCall)({
    region: REGION,
    cors: true,
    timeoutSeconds: 20,
    secrets: [supabaseUrl, supabaseServiceRoleKey],
}, async (request) => {
    const uid = await verifiedUid(request);
    const input = pathSchema.safeParse(request.data);
    if (!input.success)
        throw new https_1.HttpsError("invalid-argument", "Choose a networking learning goal.");
    const targetSlug = input.data.targetConceptSlug.startsWith("networking-") ? input.data.targetConceptSlug : `networking-${input.data.targetConceptSlug}`;
    const supabase = serviceClient();
    const { data: rows, error: conceptError } = await supabase.from("concepts").select("id,slug,title,estimated_minutes").eq("domain", "networking");
    if (conceptError || !rows?.length)
        throw new https_1.HttpsError("failed-precondition", "The networking concept graph has not been seeded yet.");
    const ids = rows.map((row) => row.id);
    const [{ data: edges, error: edgeError }, { data: masteryRows, error: masteryError }] = await Promise.all([
        supabase.from("concept_prereqs").select("concept_id,prerequisite_id").in("concept_id", ids),
        supabase.from("learner_mastery").select("concept_id,p_known").eq("firebase_uid", uid).in("concept_id", ids),
    ]);
    if (edgeError || masteryError)
        throw new https_1.HttpsError("internal", "Could not load your learning path data.");
    const suffix = (slug) => slug.replace(/^networking-/, "");
    const concepts = rows.map((row) => ({
        id: suffix(row.slug), title: row.title, estimatedMinutes: row.estimated_minutes,
        prerequisiteIds: (edges ?? []).filter((edge) => edge.concept_id === row.id).map((edge) => suffix(rows.find((candidate) => candidate.id === edge.prerequisite_id)?.slug ?? "")),
    }));
    const targetId = suffix(targetSlug);
    const mastery = Object.fromEntries((masteryRows ?? []).map((row) => [suffix(rows.find((candidate) => candidate.id === row.concept_id)?.slug ?? ""), { pKnown: row.p_known }]));
    let steps;
    try {
        steps = (0, learning_1.buildLearningPath)(concepts, targetId, mastery);
    }
    catch {
        throw new https_1.HttpsError("not-found", "That networking goal is not in the launch concept graph yet.");
    }
    return { targetConceptSlug: targetSlug, steps, totalEstimatedMinutes: steps.reduce((total, step) => total + step.estimatedMinutes, 0), contentStatus: "ai_generated" };
});
