import OpenAI from "openai";
import { getServiceSupabase } from "./supabase";
import { allowNonCommercialSources, booleanParam, embeddingCostPerMillion, numberParam, openAiApiKey, supabaseServiceRoleKey, supabaseUrl, youtubeApiKey } from "./config";
import { traceOperation } from "./observability";
import { hybridSearchParams, rankRetrievedChunks, toEvidenceChunks } from "./retrieval";
import type { GenerationRun } from "./pipeline";
import type { VerifiedLessonResult } from "./verifiedLesson";
import { fetchOpenAlexItems, fetchYoutubeItems, resourceCacheKey, type ResourceItem } from "./resources";

export function serviceClient() {
  return getServiceSupabase(supabaseUrl.value(), supabaseServiceRoleKey.value());
}

export async function persistProgress(runId: string, stage: string, percent: number, note?: string) {
  const { error } = await serviceClient().rpc("update_generation_progress", {
    p_run_id: runId,
    p_status: "running",
    p_progress: { stage, percent, ...(note ? { note } : {}) },
  });
  if (error) throw new Error("Could not save job progress.");
}

export async function finalizeRun(runId: string, status: "completed" | "failed" | "blocked", latencyMs: number, errorCode?: string, actualCostUsd?: number) {
  const { error } = await serviceClient().rpc("finalize_generation_run", {
    p_run_id: runId,
    p_status: status,
    p_actual_cost_usd: actualCostUsd ?? null,
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

export async function retrieveForGeneration(query: string, options: { targetLevel?: number; conceptSlug?: string; ownerUid?: string } = {}): Promise<{ chunks: ReturnType<typeof toEvidenceChunks>; inputTokens: number; costUsd: number; retrievalStatus: "attributed" | "no_approved_sources" }> {
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

export async function ensureCourse(run: GenerationRun, estimatedMinutes: number): Promise<string> {
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

export async function lessonFromCache(conceptId: string, hash: string): Promise<VerifiedLessonResult | null> {
  const { data, error } = await serviceClient().from("verified_module_cache").select("lesson, content_status").eq("concept_id", conceptId).eq("evidence_hash", hash).maybeSingle();
  if (error || !data?.lesson || data.content_status !== "ai_verified") return null;
  return data.lesson as VerifiedLessonResult;
}

export async function storeVerifiedCache(conceptId: string, hash: string, lesson: VerifiedLessonResult): Promise<void> {
  if (lesson.contentStatus !== "ai_verified") return;
  await serviceClient().from("verified_module_cache").upsert({ concept_id: conceptId, evidence_hash: hash, lesson, content_status: lesson.contentStatus }, { onConflict: "concept_id,evidence_hash" });
}

export async function cachedResourceFetch(key: string, loader: () => Promise<ResourceItem[]>): Promise<ResourceItem[]> {
  const supabase = serviceClient();
  const { data } = await supabase.from("resource_cache").select("payload, expires_at").eq("cache_key", key).maybeSingle();
  if (data?.payload && data.expires_at && new Date(String(data.expires_at)).getTime() > Date.now()) {
    return Array.isArray(data.payload) ? data.payload as ResourceItem[] : [];
  }
  const payload = await loader();
  await supabase.from("resource_cache").upsert({ cache_key: key, payload, expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() });
  return payload;
}

export async function findResourcesForModule(query: string, _targetLevel: number): Promise<ResourceItem[]> {
  const [videos, papers] = await Promise.all([
    cachedResourceFetch(resourceCacheKey("youtube", query), () => fetchYoutubeItems(query, youtubeApiKey.value()).catch(() => [])),
    cachedResourceFetch(resourceCacheKey("paper", query), () => fetchOpenAlexItems(query).catch(() => [])),
  ]);
  return [...videos, ...papers];
}
