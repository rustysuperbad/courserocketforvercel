import { invokeBackend } from "./backend";

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

export function buildTutorSystemPrompt({ courseTitle, moduleTitle, moduleSummary, concepts, lessons, sources }) {
  const lessonText = (lessons || []).map((lesson) => `• ${lesson.heading}: ${lesson.text}`).join("\n");
  const sourceText = (sources || [])
    .map((source, index) => `[${source.id || index + 1}] ${source.title} — ${source.url}`)
    .join("\n");
  return [
    "You are a concise, friendly tutor inside CourseRocket.",
    `Course: ${courseTitle || "Untitled"}`,
    `Current module: ${moduleTitle || "Unknown"}`,
    moduleSummary ? `Module summary: ${moduleSummary}` : "",
    concepts?.length ? `Key concepts: ${concepts.join(", ")}` : "",
    lessonText ? `Lesson notes:\n${lessonText}` : "",
    sourceText ? `Grounded sources for this module:\n${sourceText}` : "",
    "Keep answers to 3–6 sentences unless code is requested. Use bullets for steps. If asked something unrelated, gently steer back. Never invent citations; cite only listed sources when useful.",
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
