// Groq helpers: on-course tutor chat + structured JSON for course generation.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Model tiers — override in .env for stronger APIs when available.
 * VITE_GROQ_WRITER_MODEL / VITE_GROQ_PLANNER_MODEL (e.g. llama-3.3-70b-versatile, openai/gpt-oss-120b)
 * Never use lite/mini models for final lesson prose.
 */
export const GROQ_WRITER_MODEL =
  import.meta.env.VITE_GROQ_WRITER_MODEL || "llama-3.3-70b-versatile";
export const GROQ_PLANNER_MODEL =
  import.meta.env.VITE_GROQ_PLANNER_MODEL || "llama-3.3-70b-versatile";

/** @deprecated alias */
export const GROQ_COURSE_MODEL = GROQ_WRITER_MODEL;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function groqApiKey() {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing VITE_GROQ_API_KEY in .env");
  return apiKey;
}

function isLikelyGroqRateLimit(msg) {
  return (
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("quota") ||
    /limit/i.test(msg)
  );
}

function retryDelay(msg, attempt) {
  const m = (msg || "").match(/try again in\s+([\d.]+)s/i);
  if (m?.[1]) return Math.min(Math.ceil(Number(m[1]) * 1000) + 200, 3500);
  return Math.min(600 * Math.pow(2, attempt) + Math.floor(Math.random() * 150), 2500);
}

export async function askGroq(messages, { model = "llama-3.1-8b-instant", maxTokens = 600, temperature = 0.4 } = {}) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + groqApiKey(),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    let message = "Groq request failed.";
    try {
      const err = await res.json();
      message = err.error?.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(res.status + ": " + message);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Structured JSON generation for course pipeline (structure + lessons).
 */
export async function groqGenerateJson(
  systemPrompt,
  userMessage,
  {
    model = GROQ_WRITER_MODEL,
    maxTokens = 3600,
    temperature = 0.35,
    timeoutMs = 45000,
    retries = 2,
  } = {}
) {
  const apiKey = groqApiKey();
  let last;

  for (let i = 0; i < retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        let message = "Groq request failed.";
        try {
          const err = await res.json();
          message = err.error?.message || message;
        } catch {
          /* ignore */
        }
        throw new Error(res.status + ": " + message);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("Groq empty response.");
      return text;
    } catch (e) {
      last = e;
      const msg = String(e?.message || "");
      if (!isLikelyGroqRateLimit(msg) || i === retries - 1) break;
      await wait(retryDelay(msg, i));
    } finally {
      clearTimeout(timer);
    }
  }

  throw last;
}

export function buildSystemPrompt({ courseTitle, moduleTitle, moduleSummary, concepts, lessons }) {
  const lessonText = (lessons || [])
    .map((l) => "• " + l.heading + ": " + l.text)
    .join("\n");
  return [
    "You are a concise, friendly teaching assistant inside a learning app called CourseRocket.",
    "The student is studying:",
    "Course: " + (courseTitle || "Untitled"),
    "Current module: " + (moduleTitle || "Unknown"),
    moduleSummary ? "Module summary: " + moduleSummary : "",
    concepts?.length ? "Key concepts: " + concepts.join(", ") : "",
    lessonText ? "Lesson notes:\n" + lessonText : "",
    "Rules: keep answers short (3–6 sentences max unless code is asked for). Use bullet points when listing steps. " +
      "If asked something unrelated to the module/course, gently steer back. Never invent citations.",
  ]
    .filter(Boolean)
    .join("\n");
}
