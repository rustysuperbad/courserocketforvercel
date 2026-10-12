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

export type LearningCourse = {
  course: { id: string; goal: string; domain: string; status: string; content_status: ContentStatus; estimated_minutes: number | null; created_at: string; updated_at: string };
  modules: Array<{
    id: string;
    position: number;
    title: string;
    summary: string;
    body: {
      sections?: Array<{ heading: string; paragraphs: Array<{ text: string; claimIds: string[] }> }>;
      verificationIssues?: string[];
      sources?: Array<{ id: string; citation: number; title: string; url: string; license: string; attribution: string; linkStatus?: string }>;
      resources?: Array<{ kind: string; title: string; url: string; score?: number; snippet?: string }>;
      learningStatus?: string;
    };
    content_status: ContentStatus;
    claims: Array<{ claim_key: string; claim_text: string; supporting_chunk_ids: string[]; verified: boolean; verification_status: string }>;
    quizItems: Array<{ item_key: string; question: string; options: string[] | unknown; explanation: string; question_type: string; verified: boolean }>;
  }>;
};

const learningCourseCall = callable<{ courseId: string }, LearningCourse>("getLearningCourse", 20_000);

export async function getLearningCourse(courseId: string) {
  const { data } = await learningCourseCall({ courseId });
  return data;
}

export async function submitDiagnosticChoice(conceptSlug: string, selectedAnswer: string, targetConceptSlug?: string) {
  const payload: { conceptSlug: string; selectedAnswer: string; targetConceptSlug?: string } = { conceptSlug, selectedAnswer };
  if (targetConceptSlug) payload.targetConceptSlug = targetConceptSlug;
  const { data } = await diagnosticChoiceCall(payload);
  return data;
}

export type QuizAttemptResult = { isCorrect: boolean; duplicate: boolean; pKnown: number | null; remediationInserted: boolean; reviewDueAt?: string | null; verifiedKey: boolean };
export type DueReview = { cardId: string; conceptSlug: string; title: string; description: string; dueAt: string; question: { question: string; options: string[]; questionType: string } | null };

const quizAttemptCall = callable<{ moduleId: string; itemKey: string; selectedAnswer: string; responseKey: string }, QuizAttemptResult>("submitQuizAttempt", 20_000);
const dueReviewsCall = callable<Record<string, never>, { reviews: DueReview[] }>("listDueReviews", 20_000);
const reviewGradeCall = callable<{ conceptSlug: string; rating: "again" | "hard" | "good" | "easy" }, { dueAt: string; pKnown: number }>("submitReviewGrade", 20_000);
const projectCall = callable<{ courseId: string; writeup: string }, { id: string; score: number; rubric: { score: number; passed: string[]; missed: string[]; feedback: string }; created_at: string }>("submitCourseProject", 20_000);

export async function submitQuizAttempt(moduleId: string, itemKey: string, selectedAnswer: string) {
  const { data } = await quizAttemptCall({ moduleId, itemKey, selectedAnswer, responseKey: crypto.randomUUID() });
  return data;
}

export async function listDueReviews() {
  const { data } = await dueReviewsCall({});
  return data.reviews;
}

export async function submitReviewGrade(conceptSlug: string, rating: "again" | "hard" | "good" | "easy") {
  const { data } = await reviewGradeCall({ conceptSlug, rating });
  return data;
}

export async function submitCourseProject(courseId: string, writeup: string) {
  const { data } = await projectCall({ courseId, writeup });
  return data;
}

export type FeedbackCategory = "confusing" | "incorrect" | "too_easy" | "too_hard" | "useful";
export type OutcomeStage = "pre" | "post" | "delayed";
export type AnalyticsStats = { activation: number; completion: number; sevenDayReturn: number; costPerCompletionUsd: number };
export type ConceptMap = { nodes: Array<{ id: string; title: string; related: boolean }>; edges: Array<{ from: string; to: string }> };
export type Flashcard = { prompt: string; answer: string };

const feedbackCall = callable<{ courseId?: string; moduleId: string; category: FeedbackCategory; note?: string }, { saved: boolean }>("submitLessonFeedback", 20_000);
const outcomeCall = callable<{ conceptSlug: string; stage: OutcomeStage; score: number }, { saved: boolean }>("recordLearningOutcome", 20_000);
const exportCall = callable<Record<string, never>, { exportedAt: string; profile: unknown[]; mastery: unknown[]; courses: unknown[]; feedback: unknown[]; reviews: unknown[]; generationRuns: unknown[] }>("exportLearningData", 30_000);
const deleteCall = callable<{ confirm: "DELETE" }, { deleted: boolean }>("deleteLearningData", 30_000);
const analyticsCall = callable<Record<string, never>, { scope: "project" | "personal"; stats: AnalyticsStats; feedbackQueue: Array<{ id: string; category: string; note: string | null; review_status: string; created_at: string; module_id: string | null; course_id: string | null }> }>("getLearningAnalytics", 20_000);
const uploadNotesCall = callable<{ title: string; text: string; courseId?: string }, { sourceId: string; chunkCount: number; estimatedCostUsd: number; flashcards: Flashcard[]; conceptMap: ConceptMap; retrievalNote: string }>("uploadLearnerNotes", 60_000);
const conceptMapCall = callable<Record<string, never>, ConceptMap>("getNetworkingConceptMap", 15_000);

export async function submitLessonFeedback(moduleId: string, category: FeedbackCategory, courseId?: string, note?: string) {
  const payload: { moduleId: string; category: FeedbackCategory; courseId?: string; note?: string } = { moduleId, category };
  if (courseId) payload.courseId = courseId;
  if (note) payload.note = note;
  const { data } = await feedbackCall(payload);
  return data;
}

export async function recordLearningOutcome(conceptSlug: string, stage: OutcomeStage, score: number) {
  const { data } = await outcomeCall({ conceptSlug, stage, score });
  return data;
}

export async function exportLearningData() {
  const { data } = await exportCall({});
  return data;
}

export async function deleteLearningData() {
  const { data } = await deleteCall({ confirm: "DELETE" });
  return data;
}

export async function getLearningAnalytics() {
  const { data } = await analyticsCall({});
  return data;
}

export async function uploadLearnerNotes(title: string, text: string, courseId?: string) {
  const payload: { title: string; text: string; courseId?: string } = { title: title.trim(), text: text.trim() };
  if (courseId) payload.courseId = courseId;
  const { data } = await uploadNotesCall(payload);
  return data;
}

export async function getNetworkingConceptMap() {
  const { data } = await conceptMapCall({});
  return data;
}

export { describeCallableError };
