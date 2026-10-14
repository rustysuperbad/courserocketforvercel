import { z } from "zod";
import { guarded, parseInput } from "./auth";
import { HttpsError } from "./errors";
import { LEARNER_MESSAGES } from "./pipeline/intake";
import { createMemoryJobStore, publicJob, startGenerationJob, startGenerationSchema } from "./pipeline/jobs";
import { createSupabaseJobStore } from "./pipeline/store";
import { readEnv } from "./env";
import { generateStructuredContent, askCourseTutor, searchYouTubeVideos, searchAcademicPapers } from "./legacyAi";

const jobLookupSchema = z.object({ jobId: z.string().uuid() }).strict();
const runLookupSchema = z.object({ runId: z.string().uuid() }).strict();
const startJobSchema = z.object({
  goal: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(8).max(128),
  domain: z.string().optional(),
  targetConceptSlug: z.string().optional(),
  courseId: z.string().trim().max(128).optional(),
}).strict();

function v3Store() {
  return readEnv("SUPABASE_URL") && readEnv("SUPABASE_SERVICE_ROLE_KEY")
    ? createSupabaseJobStore()
    : createMemoryJobStore();
}

function asRunView(row: ReturnType<typeof publicJob>) {
  return {
    ...row,
    runId: row.jobId,
    progress: { stage: row.stage, percent: row.percent },
    courseId: null,
    domain: "general",
    actualCostUsd: row.costUsd,
    estimatedCostUsd: row.costUsd,
    fallbackUsed: false,
  };
}

const startGeneration = guarded("start-generation", async (data, uid) => {
  const input = parseInput(startGenerationSchema, data, "Say what you want to learn in a short sentence.");
  try {
    return await startGenerationJob(input.text, uid, v3Store());
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", LEARNER_MESSAGES.provider);
  }
});

const getJob = guarded("get-job", async (data, uid) => {
  const input = parseInput(jobLookupSchema, data, "A valid job id is required.");
  const row = await v3Store().get(input.jobId, uid);
  if (!row) throw new HttpsError("not-found", "That run does not exist or is not yours.");
  return publicJob(row);
});

const startCourseJob = guarded("start-course-job", async (data, uid) => {
  const input = parseInput(startJobSchema, data, "Check the learning goal and try again.");
  const started = await startGenerationJob(input.goal, uid, v3Store());
  return { runId: started.jobId, status: started.status };
});

const getCourseJobStatus = guarded("course-job-status", async (data, uid) => {
  const input = parseInput(runLookupSchema, data, "A valid run id is required.");
  const row = await v3Store().get(input.runId, uid);
  if (!row) throw new HttpsError("not-found", "That run does not exist or is not yours.");
  return asRunView(publicJob(row));
});

const listLearningRuns = guarded("list-learning-runs", async () => {
  return { runs: [] as unknown[] };
});

const gone = (name: string, message: string) => guarded(name, async () => {
  throw new HttpsError("failed-precondition", message);
});

const emptyCatalog = guarded("list-networking-catalog", async () => ({ concepts: [], interestSuggestions: [] }));
const emptySearch = guarded("search-learning-sources", async () => ({
  chunks: [],
  retrievalStatus: "unavailable",
  provider: "none",
  model: "none",
  inputTokens: 0,
  estimatedCostUsd: 0,
}));
const emptyMap = guarded("get-networking-concept-map", async () => ({ nodes: [], edges: [] }));
const emptyBaseline = guarded("save-networking-baseline", async () => ({ saved: 0 }));
const emptyPath = guarded("generate-networking-path", async () => ({ steps: [] }));

export type CallableHandler = (data: unknown, uid: string) => Promise<unknown>;

export const CALLABLES: Record<string, CallableHandler> = {
  startGeneration,
  getJob,
  startCourseJob,
  getCourseJobStatus,
  listLearningRuns,
  searchLearningSources: emptySearch,
  saveNetworkingBaseline: emptyBaseline,
  generateNetworkingPath: emptyPath,
  listNetworkingCatalog: emptyCatalog,
  getNetworkingConceptMap: emptyMap,
  generateStructuredContent,
  askCourseTutor,
  searchYouTubeVideos,
  searchAcademicPapers,
  saveLearnerProfile: gone("save-learner-profile", "Onboarding for a single launch topic has been removed. Generate a course from any goal instead."),
  getNextDiagnosticQuestion: gone("next-diagnostic", "Topic diagnostics have been removed."),
  submitDiagnosticChoice: gone("diagnostic-choice", "Topic diagnostics have been removed."),
  submitDiagnosticAnswer: gone("diagnostic-answer", "Topic diagnostics have been removed."),
  getLearningCourse: gone("get-learning-course", "Use your generated course from the library."),
  submitQuizAttempt: gone("submit-quiz", "Quiz attempts now live on generated courses."),
  listDueReviews: gone("list-due-reviews", "Reviews for the old launch catalog have been removed."),
  submitReviewGrade: gone("submit-review-grade", "Reviews for the old launch catalog have been removed."),
  submitCourseProject: gone("submit-course-project", "The launch-topic project has been removed."),
  submitLessonFeedback: gone("submit-lesson-feedback", "Feedback capture is paused during the pipeline cutover."),
  recordLearningOutcome: gone("record-learning-outcome", "Outcome capture is paused during the pipeline cutover."),
  exportLearningData: gone("export-learning-data", "Export will return after the cutover."),
  deleteLearningData: gone("delete-learning-data", "Deletion will return after the cutover."),
  getLearningAnalytics: gone("get-learning-analytics", "Analytics will return after the cutover."),
  uploadLearnerNotes: gone("upload-learner-notes", "Private notes upload is paused during the pipeline cutover."),
};
