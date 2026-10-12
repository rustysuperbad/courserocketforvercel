import { httpsCallable, type HttpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { describeCallableError, idempotencyScope, type ContentStatus } from "./learningUtils";

/**
 * Typed client for the learner-model callables. Every call carries the Firebase
 * ID token; the server re-verifies it and never trusts client-side identity.
 */

export type RunStatus = "queued" | "running" | "completed" | "failed" | "blocked";
export type JobDomain = "general" | "networking";
export type { ContentStatus };

export type RunView = {
  runId: string;
  status: RunStatus;
  progress: { stage?: string; percent?: number; note?: string } & Record<string, unknown>;
  courseId: string | null;
  domain: string;
  actualCostUsd: number;
  estimatedCostUsd: number;
  errorCode: string | null;
  fallbackUsed: boolean;
  createdAt: string;
  updatedAt: string;
  goal?: string;
};

export type PathStep = { conceptId: string; title: string; action: "learn" | "shorten" | "skip"; pKnown: number; estimatedMinutes: number };

export type SourceChunk = {
  id: string;
  citation: number;
  text: string;
  source: { id: string; title: string; url: string; publisher?: string; license: string; attribution: string };
  authorityScore: number;
  level: number;
  score: number;
  conceptTags?: string[];
  isPrivate?: boolean;
};

function callable<TIn, TOut>(name: string, timeout = 30_000): HttpsCallable<TIn, TOut> {
  return httpsCallable<TIn, TOut>(functions, name, { timeout });
}

const startCourseJobCall = callable<{ goal: string; idempotencyKey: string; domain: JobDomain; targetConceptSlug?: string }, { runId: string; status: RunStatus }>("startCourseJob");
const jobStatusCall = callable<{ runId: string }, RunView>("getCourseJobStatus", 15_000);
const listRunsCall = callable<Record<string, never>, { runs: RunView[] }>("listLearningRuns", 15_000);
const learningSourcesCall = callable<{ query: string; limit?: number; targetLevel?: number; conceptSlugs?: string[] }, { chunks: SourceChunk[]; retrievalStatus: "attributed" | "no_approved_sources" | "unavailable"; provider: string; model: string; inputTokens: number; estimatedCostUsd: number }>("searchLearningSources");
export type PublicConcept = {
  id: string;
  title: string;
  description: string;
  level: number;
  estimatedMinutes: number;
  prerequisiteIds: string[];
  objectives: string[];
  diagnostic: { question: string; options: string[]; questionType: "recall" | "explain" | "apply" };
};

export type DiagnosticQuestion = {
  conceptSlug: string;
  title: string;
  question: string;
  options: string[];
  questionType: "recall" | "explain" | "apply";
};

export type DiagnosticState = {
  done: boolean;
  askedCount: number;
  question: DiagnosticQuestion | null;
  steps: PathStep[] | null;
  totalEstimatedMinutes: number | null;
  isCorrect?: boolean;
  explanation?: string;
  pKnown?: number;
};

const saveBaselineCall = callable<{ knownConceptSlugs: string[] }, { saved: number }>("saveNetworkingBaseline", 20_000);
const diagnosticAnswerCall = callable<{ conceptSlug: string; isCorrect: boolean }, { pKnown: number; attempts: number; correctAttempts: number }>("submitDiagnosticAnswer", 20_000);
const networkingPathCall = callable<{ targetConceptSlug: string }, { targetConceptSlug: string; steps: PathStep[]; totalEstimatedMinutes: number; contentStatus: ContentStatus; interests?: string[]; goal?: string }>("generateNetworkingPath", 20_000);
const catalogCall = callable<Record<string, never>, { concepts: PublicConcept[]; interestSuggestions: string[] }>("listNetworkingCatalog", 15_000);
const saveProfileCall = callable<{ goal: string; targetConceptSlug: string; knownConceptSlugs: string[]; interests: string[] }, { savedKnown: number; targetConceptSlug: string }>("saveLearnerProfile", 20_000);
const nextDiagnosticCall = callable<{ targetConceptSlug?: string }, DiagnosticState>("getNextDiagnosticQuestion", 20_000);
const diagnosticChoiceCall = callable<{ conceptSlug: string; selectedAnswer: string; targetConceptSlug?: string }, DiagnosticState>("submitDiagnosticChoice", 20_000);

/** Stable per-browser idempotency key so a retry after a network blip reuses the same run. */
export function idempotencyKeyFor(uid: string, goal: string, domain: JobDomain, targetConceptSlug?: string): string {
  const storageKey = idempotencyScope(uid, goal, domain, targetConceptSlug);
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(storageKey, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

export function clearIdempotencyKey(uid: string, goal: string, domain: JobDomain, targetConceptSlug?: string): void {
  try { sessionStorage.removeItem(idempotencyScope(uid, goal, domain, targetConceptSlug)); } catch { /* ignore */ }
}

export async function startCourseJob(input: { goal: string; idempotencyKey: string; domain: JobDomain; targetConceptSlug?: string }) {
  const goal = input.goal.trim();
  if (!goal || goal.length > 500) throw new Error("Enter a goal up to 500 characters.");
  if (input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 128) throw new Error("A valid request key is required.");
  const payload: { goal: string; idempotencyKey: string; domain: JobDomain; targetConceptSlug?: string } = { goal, idempotencyKey: input.idempotencyKey.trim(), domain: input.domain };
  if (input.targetConceptSlug) payload.targetConceptSlug = input.targetConceptSlug;
  const { data } = await startCourseJobCall(payload);
  return data;
}

export async function getCourseJobStatus(runId: string): Promise<RunView> {
  const { data } = await jobStatusCall({ runId });
  return data;
}

export async function listLearningRuns(): Promise<RunView[]> {
  const { data } = await listRunsCall({});
  return data.runs;
}

export async function searchLearningSources(query: string, options: { limit?: number; targetLevel?: number; conceptSlugs?: string[] } = {}) {
  const value = query.trim();
  if (value.length < 2 || value.length > 500) throw new Error("Enter a topic between 2 and 500 characters.");
  const payload: { query: string; limit?: number; targetLevel?: number; conceptSlugs?: string[] } = { query: value, limit: options.limit ?? 8 };
  if (options.targetLevel) payload.targetLevel = options.targetLevel;
  if (options.conceptSlugs?.length) payload.conceptSlugs = options.conceptSlugs;
  const { data } = await learningSourcesCall(payload);
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

export async function listNetworkingCatalog() {
  const { data } = await catalogCall({});
  return data;
}

export async function saveLearnerProfile(input: { goal: string; targetConceptSlug: string; knownConceptSlugs: string[]; interests: string[] }) {
  const { data } = await saveProfileCall(input);
  return data;
}

export async function getNextDiagnosticQuestion(targetConceptSlug?: string) {
  const { data } = await nextDiagnosticCall(targetConceptSlug ? { targetConceptSlug } : {});
  return data;
}

export async function submitDiagnosticChoice(conceptSlug: string, selectedAnswer: string, targetConceptSlug?: string) {
  const payload: { conceptSlug: string; selectedAnswer: string; targetConceptSlug?: string } = { conceptSlug, selectedAnswer };
  if (targetConceptSlug) payload.targetConceptSlug = targetConceptSlug;
  const { data } = await diagnosticChoiceCall(payload);
  return data;
}

export { describeCallableError };
