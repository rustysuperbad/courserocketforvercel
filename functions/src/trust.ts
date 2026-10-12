import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentHash, EMBEDDING_DIMENSIONS, splitIntoChunks } from "./ingestion";
import { stripNetworkingPrefix } from "./catalog";

export const feedbackSchema = z.object({
  courseId: z.string().uuid().optional(),
  moduleId: z.string().uuid(),
  category: z.enum(["confusing", "incorrect", "too_easy", "too_hard", "useful"]),
  note: z.string().trim().max(500).optional(),
}).strict();

export const outcomeSchema = z.object({
  conceptSlug: z.string().trim().min(1).max(160),
  stage: z.enum(["pre", "post", "delayed"]),
  score: z.number().min(0).max(1),
}).strict();

export const uploadNotesSchema = z.object({
  title: z.string().trim().min(1).max(180),
  text: z.string().trim().min(40).max(50_000),
  courseId: z.string().uuid().optional(),
}).strict();

export async function submitFeedback(supabase: SupabaseClient, uid: string, input: z.infer<typeof feedbackSchema>) {
  const { error } = await supabase.from("feedback_reports").insert({
    firebase_uid: uid, course_id: input.courseId ?? null, module_id: input.moduleId,
    category: input.category, note: input.note ?? null,
  });
  if (error) throw new Error("Could not save feedback.");
  return { saved: true };
}

export async function recordOutcome(supabase: SupabaseClient, uid: string, input: z.infer<typeof outcomeSchema> & { conceptId: string }) {
  const { error } = await supabase.from("learning_outcomes").insert({
    firebase_uid: uid, concept_id: input.conceptId, stage: input.stage, score: input.score,
  });
  if (error) throw new Error("Could not save the outcome check.");
  return { saved: true };
}

export async function exportLearnerData(supabase: SupabaseClient, uid: string) {
  const [profile, mastery, courses, feedback, reviews, runs] = await Promise.all([
    supabase.from("learner_profiles").select("*").eq("firebase_uid", uid),
    supabase.from("learner_mastery").select("*").eq("firebase_uid", uid),
    supabase.from("courses").select("id, goal, domain, status, content_status, created_at").eq("firebase_uid", uid),
    supabase.from("feedback_reports").select("id, category, note, created_at").eq("firebase_uid", uid),
    supabase.from("review_cards").select("concept_id, due_at, last_reviewed_at").eq("firebase_uid", uid),
    supabase.from("generation_runs").select("id, goal, status, actual_cost_usd, created_at").eq("firebase_uid", uid),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: profile.data ?? [],
    mastery: mastery.data ?? [],
    courses: courses.data ?? [],
    feedback: feedback.data ?? [],
    reviews: reviews.data ?? [],
    generationRuns: runs.data ?? [],
  };
}

export async function deleteLearnerData(supabase: SupabaseClient, uid: string) {
  await Promise.all([
    supabase.from("learner_profiles").delete().eq("firebase_uid", uid),
    supabase.from("learner_mastery").delete().eq("firebase_uid", uid),
    supabase.from("review_cards").delete().eq("firebase_uid", uid),
    supabase.from("feedback_reports").delete().eq("firebase_uid", uid),
    supabase.from("learning_outcomes").delete().eq("firebase_uid", uid),
    supabase.from("quiz_attempts").delete().eq("firebase_uid", uid),
    supabase.from("project_submissions").delete().eq("firebase_uid", uid),
    supabase.from("sources").delete().eq("owner_uid", uid),
    supabase.from("courses").update({ status: "deleted", updated_at: new Date().toISOString() }).eq("firebase_uid", uid),
  ]);
  return { deleted: true };
}

export function analyticsFromRows(input: {
  firstRunAt: string[];
  completedAt: string[];
  returned7d: number;
  users: number;
  completed: number;
  costCompleted: number;
}) {
  return {
    activation: input.users,
    completion: input.completed,
    sevenDayReturn: input.returned7d,
    costPerCompletionUsd: input.completed ? input.costCompleted / input.completed : 0,
  };
}

export type RunAnalyticsRow = { firebase_uid: string; status: string; actual_cost_usd: number | string | null; created_at: string };

export function analyticsFromRunRows(runs: RunAnalyticsRow[]) {
  const users = new Set(runs.map((row) => row.firebase_uid)).size;
  const completedRows = runs.filter((row) => row.status === "completed");
  const completed = completedRows.length;
  const costCompleted = completedRows.reduce((sum, row) => sum + Number(row.actual_cost_usd || 0), 0);
  const firstByUser = new Map<string, string>();
  for (const row of runs) {
    const prev = firstByUser.get(row.firebase_uid);
    if (!prev || row.created_at < prev) firstByUser.set(row.firebase_uid, row.created_at);
  }
  let returned7d = 0;
  for (const [uid, first] of firstByUser) {
    const later = runs.some((row) => row.firebase_uid === uid && Date.parse(row.created_at) - Date.parse(first) >= 6 * 24 * 3600 * 1000);
    if (later) returned7d += 1;
  }
  return analyticsFromRows({ firstRunAt: [...firstByUser.values()], completedAt: completedRows.map((row) => row.created_at), returned7d, users, completed, costCompleted });
}

export async function projectAnalytics(supabase: SupabaseClient, uid?: string) {
  let query = supabase.from("generation_runs").select("firebase_uid, status, actual_cost_usd, created_at");
  if (uid) query = query.eq("firebase_uid", uid);
  const { data: runs } = await query;
  return analyticsFromRunRows((runs ?? []) as RunAnalyticsRow[]);
}

export async function listFeedbackQueue(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("feedback_reports")
    .select("id, category, note, review_status, created_at, module_id, course_id")
    .eq("review_status", "new")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Could not load the feedback queue.");
  return data ?? [];
}

export function notesToPrivateSource(uid: string, title: string, text: string, courseId?: string) {
  const seen = new Set<string>();
  const chunks = splitIntoChunks(text).filter((chunk) => {
    const hash = contentHash(chunk);
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
  return {
    source: {
      url: `private://notes/${uid}/${encodeURIComponent(title)}/${Date.now()}`,
      title, publisher: "Learner upload", license: "private-learner-upload",
      attribution: "Private notes supplied by the learner; not reused for other accounts.",
      authority_score: 0.4, level: 1, commercial_allowed: true, license_review_status: "approved",
      source_kind: "web", concept_tags: [], owner_uid: uid, course_id: courseId ?? null,
    },
    chunks,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  };
}

export function flashcardsFromChunks(chunks: string[]): Array<{ prompt: string; answer: string }> {
  return chunks.slice(0, 24).map((chunk, index) => {
    const sentences = chunk.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
    const first = sentences[0] ?? chunk.slice(0, 140);
    const rest = sentences.slice(1).join(" ") || chunk;
    const prompt = /[?]$/.test(first) ? first : `${first.replace(/[.!]$/, "")}?`;
    return { prompt: prompt || `What does notes section ${index + 1} cover?`, answer: rest.slice(0, 600) };
  });
}

export function relatedConceptIds(text: string, concepts: Array<{ id: string; title: string }>): string[] {
  const hay = text.toLowerCase();
  return concepts.filter((concept) => {
    const slug = stripNetworkingPrefix(concept.id).replace(/-/g, " ");
    return hay.includes(concept.title.toLowerCase()) || hay.includes(slug);
  }).map((concept) => concept.id);
}

export function conceptMapFromCatalog(
  concepts: Array<{ id: string; title: string; prerequisiteIds: string[] }>,
  relatedIds: readonly string[] = [],
) {
  const related = new Set(relatedIds);
  return {
    nodes: concepts.map((concept) => ({ id: concept.id, title: concept.title, related: related.has(concept.id) })),
    edges: concepts.flatMap((concept) => concept.prerequisiteIds.map((from) => ({ from, to: concept.id }))),
  };
}

export async function persistPrivateNotes(
  supabase: SupabaseClient,
  packed: ReturnType<typeof notesToPrivateSource>,
  embeddings: number[][],
): Promise<{ sourceId: string; chunkCount: number }> {
  if (embeddings.length !== packed.chunks.length) throw new Error("embedding_mismatch");
  const { data, error } = await supabase.from("sources").insert({
    ...packed.source,
    content_hash: contentHash(packed.chunks.join("\n")),
    chunk_count: packed.chunks.length,
    fetched_at: new Date().toISOString(),
  }).select("id").single();
  if (error || !data) throw new Error("Could not save private notes.");
  const records = packed.chunks.map((chunkText, index) => {
    const vector = embeddings[index];
    if (!vector) throw new Error("embedding_mismatch");
    return {
      source_id: data.id,
      chunk_index: index,
      chunk_text: chunkText,
      content_hash: contentHash(chunkText),
      embedding: `[${vector.join(",")}]`,
    };
  });
  const { error: chunkError } = await supabase.from("source_chunks").insert(records);
  if (chunkError) throw new Error("Could not save private note chunks.");
  return { sourceId: data.id, chunkCount: records.length };
}
