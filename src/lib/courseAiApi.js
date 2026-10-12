import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const generateStructuredContentCall = httpsCallable(functions, "generateStructuredContent", { timeout: 120000 });
const askCourseTutorCall = httpsCallable(functions, "askCourseTutor", { timeout: 45000 });
const searchYouTubeCall = httpsCallable(functions, "searchYouTubeVideos", { timeout: 35000 });
const searchPapersCall = httpsCallable(functions, "searchAcademicPapers", { timeout: 30000 });

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
  const response = await generateStructuredContentCall({ kind, systemPrompt, userMessage, evidenceQuery });
  return response.data?.content || null;
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
  const response = await askCourseTutorCall({ systemPrompt, messages });
  return String(response.data?.text || "").trim();
}

export async function searchYouTubeResults({ query, maxResults, language, signal }) {
  const response = await raceWithAbort(searchYouTubeCall({ query, maxResults, language }), signal);
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

export async function searchAcademicPapers({ query, signal }) {
  const response = await raceWithAbort(searchPapersCall({ query }), signal);
  return Array.isArray(response.data?.papers) ? response.data.papers : [];
}
