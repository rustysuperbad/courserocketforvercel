import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { getSupabaseClient } from "./supabase";

export type CourseJob = { runId: string; status: "queued" | "running" | "completed" | "failed" | "blocked"; progress?: Record<string, unknown> };

const startCourseJobCall = httpsCallable<
  { goal: string; idempotencyKey: string; courseId?: string },
  { runId: string; status: "queued" }
>(functions, "startCourseJob");

const learningSourcesCall = httpsCallable<
  { query: string; limit?: number },
  { chunks: Array<{ id: string; citation: number; text: string; source: { id: string; title: string; url: string; license: string; attribution: string }; authorityScore: number; level: number; score: number }>; retrievalStatus: "attributed" | "no_approved_sources" | "unavailable"; provider: string; model: string; inputTokens: number; estimatedCostUsd: number }
>(functions, "searchLearningSources");

const saveBaselineCall = httpsCallable<{ knownConceptSlugs: string[] }, { saved: number }>(functions, "saveNetworkingBaseline");
const diagnosticAnswerCall = httpsCallable<{ conceptSlug: string; isCorrect: boolean }, { pKnown: number; attempts: number; correctAttempts: number }>(functions, "submitDiagnosticAnswer");
const networkingPathCall = httpsCallable<{ targetConceptSlug: string }, { targetConceptSlug: string; steps: Array<{ conceptId: string; title: string; action: "learn" | "shorten" | "skip"; pKnown: number; estimatedMinutes: number }>; totalEstimatedMinutes: number; contentStatus: "ai_generated" }>(functions, "generateNetworkingPath");

export async function startCourseJob(goal: string, idempotencyKey: string, courseId?: string): Promise<CourseJob> {
  const normalizedGoal = goal.trim();
  if (!normalizedGoal || normalizedGoal.length > 500) throw new Error("Enter a goal up to 500 characters.");
  if (idempotencyKey.trim().length < 8 || idempotencyKey.length > 128) throw new Error("A valid request key is required.");
  const { data } = await startCourseJobCall({ goal: normalizedGoal, idempotencyKey: idempotencyKey.trim(), courseId });
  return data;
}

export async function searchLearningSources(query: string, limit = 8) {
  const value = query.trim();
  if (value.length < 2 || value.length > 500) throw new Error("Enter a topic between 2 and 500 characters.");
  const { data } = await learningSourcesCall({ query: value, limit });
  return data;
}

export async function saveNetworkingBaseline(knownConceptSlugs: string[]) {
  const { data } = await saveBaselineCall({ knownConceptSlugs });
  return data;
}

export async function submitDiagnosticAnswer(conceptSlug: string, isCorrect: boolean) {
  const { data } = await diagnosticAnswerCall({ conceptSlug, isCorrect });
  return data;
}

export async function generateNetworkingPath(targetConceptSlug: string) {
  const { data } = await networkingPathCall({ targetConceptSlug });
  return data;
}

export async function getCourseJob(runId: string): Promise<CourseJob> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to view background job progress.");
  const { data, error } = await client.from("generation_runs")
    .select("id,status,progress")
    .eq("id", runId)
    .single();
  if (error || !data) throw new Error("Could not load this course run.");
  return { runId: data.id, status: data.status, progress: data.progress as Record<string, unknown> };
}
