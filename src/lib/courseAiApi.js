import { invokeBackend } from "./backend";
import { startGeneration, waitForJob } from "./courseJobs";

function raceWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("Request aborted."));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("Request aborted."));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}

export async function requestStructuredContent({ kind, systemPrompt, userMessage, evidenceQuery = "" }) {
  const response = await invokeBackend("generateStructuredContent", { kind, systemPrompt, userMessage, evidenceQuery }, 120000);
  return response?.content || null;
}

export async function generateStructuredJson({ kind, systemPrompt, userMessage, evidenceQuery = "" }) {
  const content = await requestStructuredContent({ kind, systemPrompt, userMessage, evidenceQuery });
  if (!content || typeof content !== "object") throw new Error("The course writer returned no content.");
  return JSON.stringify(content);
}

/** Job-based generate. Polls until the course is ready so existing callers keep working. */
export async function requestRagCourse({ topic, onProgress }) {
  const started = await startGeneration(String(topic || ""));
  const job = await waitForJob(started.jobId, 720000, onProgress);
  if (job.status === "needs_clarification") {
    return {
      runId: job.jobId,
      spec: job.spec || { status: "needs_clarification", question: job.learnerMessage },
      status: "needs_clarification",
      publishable: false,
      summary: job.summary || { ready: 0, needs_review: 0, blocked: 0 },
      modules: [],
    };
  }
  if (job.status === "failed") {
    throw new Error(job.learnerMessage || "Something went wrong on our side. Please try again.");
  }
  if (job.status === "blocked" && !job.course) {
    throw new Error(job.learnerMessage || "We couldn't find enough reliable material to teach this well. Try a more specific topic or rephrase it.");
  }
  const course = job.course && typeof job.course === "object" ? job.course : {};
  return {
    runId: job.jobId,
    spec: job.spec,
    status: job.spec?.status || job.status,
    publishable: Boolean(job.publishable),
    summary: job.summary || { ready: 0, needs_review: 0, blocked: 0 },
    costUsd: job.costUsd,
    modules: Array.isArray(course.modules) ? course.modules : [],
  };
}

export function buildTutorSystemPrompt({ courseTitle, moduleTitle, moduleSummary, concepts, lessons, sources }) {
  const lessonText = (lessons || []).map((lesson) => `• ${lesson.heading}: ${lesson.text}`).join("\n");
  const sourceText = (sources || [])
    .map((source, index) => `[${source.id || index + 1}] ${source.title} — ${source.url}`)
    .join("\n");
  return [
    "You are a concise tutor inside CourseRocket.",
    "Must: answer in 3–6 sentences unless the learner asks for code.",
    "Must: use bullets for steps.",
    "Must not: invent citations. Cite only listed sources, as [1] or [2].",
    "If the question is off-module, steer back to the current lesson.",
    `Course: ${courseTitle || "Untitled"}`,
    `Current module: ${moduleTitle || "Unknown"}`,
    moduleSummary ? `Module summary: ${moduleSummary}` : "",
    concepts?.length ? `Key concepts: ${concepts.join(", ")}` : "",
    lessonText ? `Lesson notes:\n${lessonText}` : "",
    sourceText ? `Grounded sources for this module:\n${sourceText}` : "",
  ].filter(Boolean).join("\n");
}

export async function requestCourseTutor({ systemPrompt, messages }) {
  const response = await invokeBackend("askCourseTutor", { systemPrompt, messages }, 45000);
  return String(response?.text || "").trim();
}

export async function searchYouTubeResults({ query, maxResults, language, signal }) {
  const response = await raceWithAbort(invokeBackend("searchYouTubeVideos", { query, maxResults, language }, 35000), signal);
  return Array.isArray(response?.items) ? response.items : [];
}

export async function searchAcademicPapers({ query, signal }) {
  const response = await raceWithAbort(invokeBackend("searchAcademicPapers", { query }, 30000), signal);
  return Array.isArray(response?.papers) ? response.papers : [];
}
