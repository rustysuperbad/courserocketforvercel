const crypto = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");

initializeApp();
const db = getFirestore();

const REGION = "us-central1";
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const YOUTUBE_API_KEY = defineSecret("YOUTUBE_API_KEY");
const OPENAI_MODEL = defineString("OPENAI_MODEL", { default: "gpt-4.1-mini" });
const GEMINI_MODEL = defineString("GEMINI_MODEL", { default: "gemini-2.0-flash" });
const RESOURCE_CACHE_MS = 12 * 60 * 60 * 1000;

setGlobalOptions({ region: REGION, maxInstances: 8 });

const outlineSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    level: { type: "string", enum: ["Beginner", "Intermediate", "Advanced"] },
    estimatedHours: { type: "number" },
    courseKeyConcepts: { type: "array", items: { type: "string" } },
    modules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          concepts: { type: "array", items: { type: "string" } },
          youtubeQueries: { type: "array", items: { type: "string" } },
          paperTopics: { type: "array", items: { type: "string" } },
        },
        required: ["id", "title", "summary", "concepts", "youtubeQueries", "paperTopics"],
      },
    },
  },
  required: ["title", "description", "level", "estimatedHours", "courseKeyConcepts", "modules"],
};

const moduleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { heading: { type: "string" }, text: { type: "string" } },
        required: ["heading", "text"],
      },
    },
    quiz: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer" },
          explanation: { type: "string" },
        },
        required: ["question", "options", "correctIndex", "explanation"],
      },
    },
  },
  required: ["lessons", "quiz"],
};

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in to use CourseRocket AI.");
  }
  return request.auth.uid;
}

function getSecret(secret, name) {
  let value = "";
  try { value = String(secret.value() || "").trim(); } catch { /* reported below */ }
  if (!value) throw new HttpsError("failed-precondition", `${name} is not configured for CourseRocket.`);
  return value;
}

async function consumeDailyQuota(uid, bucket, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection("courseApiUsage").doc(`${uid}_${day}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.get(bucket) || 0);
    if (count >= limit) {
      throw new HttpsError("resource-exhausted", "You have reached today's limit. Please try again tomorrow.");
    }
    tx.set(ref, { uid, day, [bucket]: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

function assertText(value, name, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) {
    throw new HttpsError("invalid-argument", `${name} must be between 1 and ${maxLength} characters.`);
  }
  return text;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}

function normalizedGroundingSources(candidate) {
  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const sources = [];
  for (const chunk of chunks) {
    const url = safeHttpUrl(chunk?.web?.uri);
    const title = String(chunk?.web?.title || "Source").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ id: sources.length + 1, title: title.slice(0, 240), url });
    if (sources.length >= 8) break;
  }
  return sources;
}

function extractGeminiText(candidate) {
  return (candidate?.content?.parts || []).map((part) => part?.text || "").join("\n").trim();
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Upstream API returned ${response.status}: ${body.slice(0, 240)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function groundedEvidence(query, apiKey) {
  const model = GEMINI_MODEL.value();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Find current, credible learning sources for this course module: ${query}. Prefer official documentation, universities, primary sources, and respected educational material. Summarize only facts supported by the sources and keep the source titles and links in grounding metadata.` }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1600 },
    }),
  }, 25000);
  const candidate = response.candidates?.[0];
  return {
    evidence: extractGeminiText(candidate).slice(0, 7000),
    sources: normalizedGroundingSources(candidate),
  };
}

function extractOpenAiText(response) {
  const output = [];
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && part.text) output.push(part.text);
    }
  }
  return output.join("\n").trim();
}

function parseJsonObject(text) {
  try { return JSON.parse(String(text || "").trim()); } catch {
    throw new HttpsError("internal", "The course writer returned content that could not be read. Please retry.");
  }
}

async function openAiJson({ systemPrompt, userMessage, kind, apiKey, evidence, sources }) {
  const schema = kind === "outline" ? outlineSchema : moduleSchema;
  let instructions = systemPrompt;
  let input = userMessage;
  if (kind === "module") {
    instructions += [
      "Ground factual teaching in the evidence included by the application.",
      "Do not invent URLs, organizations, paper titles, or citations.",
      "Where an important factual explanation is directly supported by a listed source, cite it in the lesson as [1], [2], using that source's id.",
      "Keep citations sparse and accurate. If evidence is insufficient, explain the stable concept without a citation rather than guessing.",
    ].join("\n");
    input += "\n\nResearch evidence retrieved for this module:\n" + (evidence || "No grounded web evidence was available for this module.");
    if (sources.length) {
      input += "\n\nUse only these source ids for inline citations:\n" +
        sources.map((source) => `[${source.id}] ${source.title} — ${source.url}`).join("\n");
    }
  }

  const response = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL.value(),
      instructions,
      input,
      max_output_tokens: kind === "outline" ? 5000 : 5200,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: kind === "outline" ? "course_outline" : "course_module",
          strict: true,
          schema,
        },
      },
    }),
  }, 65000);

  const parsed = parseJsonObject(extractOpenAiText(response));
  if (kind === "outline") {
    if (!Array.isArray(parsed.modules) || !parsed.modules.length || parsed.modules.length > 12) {
      throw new HttpsError("internal", "The course outline needs another attempt. Please retry.");
    }
  } else {
    if (!Array.isArray(parsed.lessons) || parsed.lessons.length !== 2 || !Array.isArray(parsed.quiz) || parsed.quiz.length !== 2) {
      throw new HttpsError("internal", "A complete module was not generated. Please retry this module.");
    }
    for (const question of parsed.quiz) {
      if (!Array.isArray(question.options) || question.options.length !== 4 ||
          !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) {
        throw new HttpsError("internal", "The module quiz needs another attempt. Please retry this module.");
      }
    }
    const hasGroundedEvidence = Boolean(evidence?.trim() && sources.length);
    parsed.sources = hasGroundedEvidence ? sources : [];
    parsed.groundingStatus = hasGroundedEvidence ? "grounded" : "unavailable";
  }
  return parsed;
}

exports.generateStructuredContent = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 120,
  memory: "1GiB",
  maxInstances: 5,
  secrets: [OPENAI_API_KEY, GEMINI_API_KEY],
}, async (request) => {
  const uid = requireAuth(request);
  const kind = request.data?.kind;
  if (kind !== "outline" && kind !== "module") {
    throw new HttpsError("invalid-argument", "Choose a supported course content type.");
  }
  const systemPrompt = assertText(request.data?.systemPrompt, "Course instructions", 12000);
  const userMessage = assertText(request.data?.userMessage, "Course request", 10000);
  const evidenceQuery = kind === "module"
    ? assertText(request.data?.evidenceQuery, "Evidence search", 700)
    : "";
  await consumeDailyQuota(uid, "courseContent", 40);

  const openAiKey = getSecret(OPENAI_API_KEY, "OPENAI_API_KEY");
  let evidence = "";
  let sources = [];
  if (kind === "module") {
    try {
      const result = await groundedEvidence(evidenceQuery, getSecret(GEMINI_API_KEY, "GEMINI_API_KEY"));
      evidence = result.evidence;
      sources = result.sources;
    } catch (error) {
      console.warn("Gemini grounding failed; the module will be generated without grounded web references.", error?.message);
    }
  }

  const content = await openAiJson({ systemPrompt, userMessage, kind, apiKey: openAiKey, evidence, sources });
  return { content };
});

exports.askCourseTutor = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 45,
  secrets: [OPENAI_API_KEY],
}, async (request) => {
  const uid = requireAuth(request);
  const messages = Array.isArray(request.data?.messages) ? request.data.messages.slice(-12) : [];
  const system = assertText(request.data?.systemPrompt, "Tutor context", 24000);
  const safeMessages = messages
    .filter((message) => ["user", "assistant"].includes(message?.role))
    .map((message) => ({ role: message.role, content: String(message.content || "").slice(0, 5000) }))
    .filter((message) => message.content.trim());
  if (!safeMessages.length) throw new HttpsError("invalid-argument", "Send a question to the tutor.");
  await consumeDailyQuota(uid, "tutor", 80);
  const response = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSecret(OPENAI_API_KEY, "OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: OPENAI_MODEL.value(),
      instructions: system,
      input: safeMessages,
      max_output_tokens: 1300,
      store: false,
    }),
  }, 35000);
  const text = extractOpenAiText(response);
  if (!text) throw new HttpsError("internal", "The tutor returned an empty answer. Please retry.");
  return { text };
});

function reconstructAbstract(index) {
  const words = [];
  for (const [word, positions] of Object.entries(index || {})) {
    for (const position of positions || []) words[position] = word;
  }
  return words.join(" ");
}

function normalizePaperTitle(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function fetchOpenAlex(query) {
  const params = new URLSearchParams({ search: query, per_page: "5" });
  const response = await fetchJson(`https://api.openalex.org/works?${params}`);
  return (response.results || []).map((paper) => ({
    title: paper.display_name || "Untitled paper",
    authors: (paper.authorships || []).slice(0, 3).map((a) => a.author?.display_name).filter(Boolean).join(", "),
    year: paper.publication_year || null,
    abstract: paper.abstract_inverted_index ? reconstructAbstract(paper.abstract_inverted_index).slice(0, 420) : "",
    url: safeHttpUrl(paper.doi ? `https://doi.org/${String(paper.doi).replace(/^https?:\/\/doi\.org\//, "")}` : paper.id) || "",
    doi: paper.doi || "",
    citationCount: Number(paper.cited_by_count || 0),
    provider: "OpenAlex",
  }));
}

async function fetchSemanticScholar(query) {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "title,year,authors,abstract,url,openAccessPdf,citationCount,externalIds");
  const headers = {};
  // Semantic Scholar works without a key at lower limits. Add an x-api-key on the server if provisioned.
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  const response = await fetchJson(url.toString(), { headers });
  return (response.data || []).map((paper) => ({
    title: paper.title || "Untitled paper",
    authors: (paper.authors || []).slice(0, 3).map((author) => author.name).filter(Boolean).join(", "),
    year: paper.year || null,
    abstract: String(paper.abstract || "").slice(0, 420),
    url: safeHttpUrl(paper.url || paper.openAccessPdf?.url || ""),
    openAccessPdf: safeHttpUrl(paper.openAccessPdf?.url || ""),
    doi: paper.externalIds?.DOI || "",
    citationCount: Number(paper.citationCount || 0),
    provider: "Semantic Scholar",
  }));
}

async function fetchPapersTogether(query) {
  const results = await Promise.allSettled([fetchOpenAlex(query), fetchSemanticScholar(query)]);
  const papers = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const seen = new Set();
  return papers
    .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
    .filter((paper) => {
      const key = String(paper.doi || normalizePaperTitle(paper.title)).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return Boolean(paper.url);
    })
    .slice(0, 5);
}

async function fetchYouTube(query, maxResults, language) {
  const apiKey = getSecret(YOUTUBE_API_KEY, "YOUTUBE_API_KEY");
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("safeSearch", "moderate");
  url.searchParams.set("videoDuration", "medium");
  url.searchParams.set("relevanceLanguage", language);
  url.searchParams.set("regionCode", language === "en" ? "US" : "US");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("fields", "items(id/videoId,snippet/title,snippet/channelTitle,snippet/thumbnails/medium,snippet/description)");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);
  const response = await fetchJson(url.toString());
  return Array.isArray(response.items) ? response.items : [];
}

async function cachedResult(cacheKey, load) {
  const id = crypto.createHash("sha256").update(cacheKey).digest("hex");
  const ref = db.collection("courseApiCache").doc(id);
  try {
    const cached = await ref.get();
    if (cached.exists && Number(cached.get("expiresAt")) > Date.now()) return cached.get("payload");
  } catch (error) {
    console.warn("API cache read failed.", error?.message);
  }
  const payload = await load();
  try {
    await ref.set({ payload, expiresAt: Date.now() + RESOURCE_CACHE_MS, updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    console.warn("API cache write failed.", error?.message);
  }
  return payload;
}

exports.searchYouTubeVideos = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 35,
  secrets: [YOUTUBE_API_KEY],
}, async (request) => {
  const uid = requireAuth(request);
  const query = assertText(request.data?.query, "Video search", 300);
  const language = /^[a-z]{2}$/i.test(String(request.data?.language || ""))
    ? String(request.data.language).toLowerCase() : "en";
  const maxResults = Math.min(Math.max(Number(request.data?.maxResults) || 20, 1), 47);
  await consumeDailyQuota(uid, "resources", 100);
  const videos = await cachedResult(`youtube:v2:${query.toLowerCase()}:${language}:${maxResults}`, () =>
    fetchYouTube(query, maxResults, language));
  return { items: videos };
});

exports.searchAcademicPapers = onCall({
  region: REGION,
  cors: true,
  timeoutSeconds: 30,
}, async (request) => {
  const uid = requireAuth(request);
  const query = assertText(request.data?.query, "Paper search", 300);
  await consumeDailyQuota(uid, "resources", 100);
  const papers = await cachedResult(`papers:v2:${query.toLowerCase()}`, () => fetchPapersTogether(query));
  return { papers };
});
