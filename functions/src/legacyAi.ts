import { groqApiKey, youtubeApiKey } from "./config";
import { readEnv } from "./env";
import { HttpsError } from "./errors";

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

function assertText(value: unknown, name: string, maxLength: number): string {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) {
    throw new HttpsError("invalid-argument", `${name} must be between 1 and ${maxLength} characters.`);
  }
  return text;
}

function requireKey(name: string, value: string): string {
  if (!value) throw new HttpsError("failed-precondition", `${name} is not configured for CourseRocket.`);
  return value;
}

function safeHttpUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function fetchJson(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (/insufficient_quota|credit_balance_exhausted/i.test(body)) {
      throw new HttpsError("resource-exhausted", "The writing account is out of credits.");
    }
    if (response.status === 429) {
      throw new HttpsError("resource-exhausted", "The writer is rate-limited. Wait a moment and retry.");
    }
    throw new Error(`Upstream API returned ${response.status}: ${body.slice(0, 240)}`);
  }
  return await response.json() as Record<string, unknown>;
}

function extractOpenAiText(response: Record<string, unknown>): string {
  const output: string[] = [];
  for (const item of (Array.isArray(response.output) ? response.output : [])) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "output_text" && typeof (part as { text?: string }).text === "string") {
        output.push((part as { text: string }).text);
      }
    }
  }
  return output.join("\n").trim();
}

function extractGeminiText(candidate: Record<string, unknown> | undefined): string {
  const parts = (candidate?.content as { parts?: Array<{ text?: string }> } | undefined)?.parts || [];
  return parts.map((part) => part?.text || "").join("\n").trim();
}

function normalizedGroundingSources(candidate: Record<string, unknown> | undefined): Array<{ id: number; title: string; url: string }> {
  const chunks = (candidate?.groundingMetadata as { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } | undefined)?.groundingChunks || [];
  const seen = new Set<string>();
  const sources: Array<{ id: number; title: string; url: string }> = [];
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

function geminiModelList(): string[] {
  const preferred = readEnv("GEMINI_MODEL", "gemini-3.5-flash");
  const fallbacks = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-flash-latest"];
  return [preferred, ...fallbacks.filter((model) => model !== preferred)];
}

function stripJsonPayload(text: string): string {
  let t = String(text || "").trim().replace(/^\uFEFF/, "");
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = t.search(/[{[]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

async function groundedEvidence(query: string, apiKey: string) {
  let lastError: unknown;
  for (const model of geminiModelList()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const response = await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Find current, credible learning sources for this course module: ${query}. Prefer official documentation, universities, primary sources, and respected educational material. Summarize only facts supported by the sources and keep the source titles and links in grounding metadata.` }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1600 },
        }),
      }, 25000);
      const candidate = (response.candidates as Array<Record<string, unknown>> | undefined)?.[0];
      return {
        evidence: extractGeminiText(candidate).slice(0, 7000),
        sources: normalizedGroundingSources(candidate),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini evidence search failed.");
}

function parseJsonObject(text: string): Record<string, unknown> {
  try { return JSON.parse(stripJsonPayload(text)) as Record<string, unknown>; } catch {
    throw new HttpsError("internal", "The course writer returned content that could not be read. Please retry.");
  }
}

function finalizeWriterJson(
  parsed: Record<string, unknown>,
  kind: "outline" | "module",
  evidence: string,
  sources: Array<{ id: number; title: string; url: string }>,
): Record<string, unknown> {
  if (kind === "outline") {
    if (!Array.isArray(parsed.modules) || !parsed.modules.length || parsed.modules.length > 12) {
      throw new HttpsError("internal", "The course outline needs another attempt. Please retry.");
    }
    parsed.modules = (parsed.modules as Array<Record<string, unknown>>).map((mod, index) => ({
      ...mod,
      id: String(mod.id || `module_${index + 1}`),
      concepts: Array.isArray(mod.concepts) ? mod.concepts : [],
      youtubeQueries: Array.isArray(mod.youtubeQueries) ? mod.youtubeQueries : [],
      paperTopics: Array.isArray(mod.paperTopics) ? mod.paperTopics : [],
    }));
    return parsed;
  }
  const lessons = parsed.lessons;
  const quiz = parsed.quiz;
  if (!Array.isArray(lessons) || lessons.length !== 2 || !Array.isArray(quiz) || quiz.length !== 2) {
    throw new HttpsError("internal", "A complete module was not generated. Please retry this module.");
  }
  for (const question of quiz as Array<{ options?: unknown; correctIndex?: unknown }>) {
    if (!Array.isArray(question.options) || question.options.length !== 4 ||
        !Number.isInteger(question.correctIndex) || Number(question.correctIndex) < 0 || Number(question.correctIndex) > 3) {
      throw new HttpsError("internal", "The module quiz needs another attempt. Please retry this module.");
    }
  }
  const hasGroundedEvidence = Boolean(evidence.trim() && sources.length);
  parsed.sources = hasGroundedEvidence ? sources : [];
  parsed.groundingStatus = hasGroundedEvidence ? "grounded" : "unavailable";
  return parsed;
}

async function geminiJson(input: { systemPrompt: string; userMessage: string; kind: "outline" | "module"; apiKey: string; evidence: string; sources: Array<{ id: number; title: string; url: string }> }) {
  const prompt = [
    input.systemPrompt,
    "Return ONLY valid JSON. No markdown fences.",
    input.userMessage,
  ].filter(Boolean).join("\n\n");
  let lastError: unknown;
  for (const model of geminiModelList()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const response = await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: input.kind === "outline" ? 8192 : 8192,
            responseMimeType: "application/json",
          },
        }),
      }, 65000);
      const candidate = (response.candidates as Array<Record<string, unknown>> | undefined)?.[0];
      const parsed = parseJsonObject(extractGeminiText(candidate));
      return finalizeWriterJson(parsed, input.kind, input.evidence, input.sources);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new HttpsError("internal", "Gemini could not write this course. Please retry.");
}

async function openAiJson(input: { systemPrompt: string; userMessage: string; kind: "outline" | "module"; apiKey: string; evidence: string; sources: Array<{ id: number; title: string; url: string }> }) {
  const schema = input.kind === "outline" ? outlineSchema : moduleSchema;
  let instructions = input.systemPrompt;
  let user = input.userMessage;
  if (input.kind === "module") {
    instructions += [
      "Ground factual teaching in the evidence included by the application.",
      "Do not invent URLs, organizations, paper titles, or citations.",
      "Where an important factual explanation is directly supported by a listed source, cite it in the lesson as [1], [2], using that source's id.",
      "Keep citations sparse and accurate. If evidence is insufficient, explain the stable concept without a citation rather than guessing.",
    ].join("\n");
    user += "\n\nResearch evidence retrieved for this module:\n" + (input.evidence || "No grounded web evidence was available for this module.");
    if (input.sources.length) {
      user += "\n\nUse only these source ids for inline citations:\n" +
        input.sources.map((source) => `[${source.id}] ${source.title} — ${source.url}`).join("\n");
    }
  }

  const response = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({
      model: readEnv("OPENAI_MODEL", "gpt-4.1-mini"),
      instructions,
      input: user,
      max_output_tokens: input.kind === "outline" ? 5000 : 5200,
      store: false,
      text: { format: { type: "json_schema", name: input.kind === "outline" ? "course_outline" : "course_module", strict: true, schema } },
    }),
  }, 65000);

  const parsed = parseJsonObject(extractOpenAiText(response));
  if (input.kind === "outline") {
    if (!Array.isArray(parsed.modules) || !parsed.modules.length || parsed.modules.length > 12) {
      throw new HttpsError("internal", "The course outline needs another attempt. Please retry.");
    }
  } else {
    const lessons = parsed.lessons;
    const quiz = parsed.quiz;
    if (!Array.isArray(lessons) || lessons.length !== 2 || !Array.isArray(quiz) || quiz.length !== 2) {
      throw new HttpsError("internal", "A complete module was not generated. Please retry this module.");
    }
    for (const question of quiz as Array<{ options?: unknown; correctIndex?: unknown }>) {
      if (!Array.isArray(question.options) || question.options.length !== 4 ||
          !Number.isInteger(question.correctIndex) || Number(question.correctIndex) < 0 || Number(question.correctIndex) > 3) {
        throw new HttpsError("internal", "The module quiz needs another attempt. Please retry this module.");
      }
    }
    const hasGroundedEvidence = Boolean(input.evidence.trim() && input.sources.length);
    parsed.sources = hasGroundedEvidence ? input.sources : [];
    parsed.groundingStatus = hasGroundedEvidence ? "grounded" : "unavailable";
  }
  return parsed;
}

function writerPrompt(input: { systemPrompt: string; userMessage: string; kind: "outline" | "module"; evidence: string; sources: Array<{ id: number; title: string; url: string }> }) {
  let instructions = input.systemPrompt;
  let user = input.userMessage;
  if (input.kind === "module") {
    instructions += [
      "Ground factual teaching in the evidence included by the application.",
      "Do not invent URLs, organizations, paper titles, or citations.",
      "Where an important factual explanation is directly supported by a listed source, cite it in the lesson as [1], [2], using that source's id.",
      "Keep citations sparse and accurate. If evidence is insufficient, explain the stable concept without a citation rather than guessing.",
    ].join("\n");
    user += "\n\nResearch evidence retrieved for this module:\n" + (input.evidence || "No grounded web evidence was available for this module.");
    if (input.sources.length) {
      user += "\n\nUse only these source ids for inline citations:\n" +
        input.sources.map((source) => `[${source.id}] ${source.title} — ${source.url}`).join("\n");
    }
  }
  return { instructions, user };
}

function groqWriterUnavailable(): never {
  throw new HttpsError(
    "failed-precondition",
    "Add a Groq API key from console.groq.com/keys. OpenAI is not used, and Gemini is not used for writing.",
  );
}

function groqModelList(): string[] {
  const preferred = readEnv("GROQ_MODEL", "qwen/qwen3.8-27b");
  const fallbacks = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b"];
  return [preferred, ...fallbacks.filter((model) => model !== preferred)];
}

function extractGroqText(response: Record<string, unknown>): string {
  const choice = ((response.choices as Array<{ message?: { content?: unknown } }> | undefined) || [])[0];
  const content = choice?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : String((part as { text?: string })?.text || "")))
      .join("\n")
      .trim();
  }
  return "";
}

function groqKeyRejected(error: unknown): boolean {
  return /returned 401/i.test(error instanceof Error ? error.message : String(error || ""));
}

async function groqChat(input: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  timeoutMs: number;
  responseFormat?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: input.model,
    temperature: 0.4,
    max_tokens: input.maxTokens,
    messages: input.messages,
  };
  if (input.responseFormat) body.response_format = input.responseFormat;
  if (input.model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
  return fetchJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify(body),
  }, input.timeoutMs);
}

async function groqJson(input: { systemPrompt: string; userMessage: string; kind: "outline" | "module"; apiKey: string; evidence: string; sources: Array<{ id: number; title: string; url: string }> }) {
  const { instructions, user } = writerPrompt(input);
  const schema = input.kind === "outline" ? outlineSchema : moduleSchema;
  const schemaName = input.kind === "outline" ? "course_outline" : "course_module";
  const messages = [
    { role: "system", content: `${instructions}\n\nReturn JSON matching this schema:\n${JSON.stringify(schema)}` },
    { role: "user", content: `${user}\n\nReturn only valid JSON.` },
  ];
  const formats: Array<Record<string, unknown>> = [
    { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    { type: "json_object" },
  ];
  let lastError: unknown;
  for (const model of groqModelList()) {
    for (const responseFormat of formats) {
      try {
        const response = await groqChat({
          apiKey: input.apiKey,
          model,
          messages,
          maxTokens: input.kind === "outline" ? 8000 : 12000,
          timeoutMs: 65000,
          responseFormat,
        });
        return finalizeWriterJson(parseJsonObject(extractGroqText(response)), input.kind, input.evidence, input.sources);
      } catch (error) {
        lastError = error;
        if (groqKeyRejected(error)) {
          throw new HttpsError("failed-precondition", "The Groq API key was rejected. Create a new key at console.groq.com/keys.");
        }
        if (error instanceof HttpsError && error.code === "resource-exhausted") throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new HttpsError("internal", "The course writer could not complete this request. Please retry.");
}

export async function generateStructuredContent(data: unknown, _uid: string) {
  const payload = (data ?? {}) as { kind?: string; systemPrompt?: string; userMessage?: string; evidenceQuery?: string };
  const kind = payload.kind;
  if (kind !== "outline" && kind !== "module") throw new HttpsError("invalid-argument", "Choose a supported course content type.");
  const systemPrompt = assertText(payload.systemPrompt, "Course instructions", 12000);
  const userMessage = assertText(payload.userMessage, "Course request", 10000);
  const groqKey = groqApiKey.value();
  if (!groqKey) groqWriterUnavailable();
  const content = await groqJson({
    systemPrompt,
    userMessage,
    kind,
    apiKey: groqKey,
    evidence: "",
    sources: [],
  });
  return { content };
}

export async function askCourseTutor(data: unknown, _uid: string) {
  const payload = (data ?? {}) as { systemPrompt?: string; messages?: Array<{ role?: string; content?: string }> };
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : [];
  const system = assertText(payload.systemPrompt, "Tutor context", 24000);
  const safeMessages = messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => ({ role: message.role as string, content: String(message.content || "").slice(0, 5000) }))
    .filter((message) => message.content.trim());
  if (!safeMessages.length) throw new HttpsError("invalid-argument", "Send a question to the tutor.");
  const groqKey = groqApiKey.value();
  if (!groqKey) groqWriterUnavailable();
  let lastError: unknown;
  for (const model of groqModelList()) {
    try {
      const response = await groqChat({
        apiKey: groqKey,
        model,
        messages: [{ role: "system", content: system }, ...safeMessages],
        maxTokens: 1300,
        timeoutMs: 35000,
      });
      const text = extractGroqText(response);
      if (!text) throw new HttpsError("internal", "The tutor returned an empty answer. Please retry.");
      return { text };
    } catch (error) {
      lastError = error;
      if (groqKeyRejected(error)) {
        throw new HttpsError("failed-precondition", "The Groq API key was rejected. Create a new key at console.groq.com/keys.");
      }
      if (error instanceof HttpsError && error.code !== "internal") throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new HttpsError("internal", "The tutor could not answer. Please retry.");
}

function reconstructAbstract(index: Record<string, number[]> | undefined): string {
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index || {})) {
    for (const position of positions || []) words[position] = word;
  }
  return words.join(" ");
}

function normalizePaperTitle(title: string): string {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function fetchOpenAlex(query: string) {
  const params = new URLSearchParams({ search: query, per_page: "5" });
  const response = await fetchJson(`https://api.openalex.org/works?${params}`);
  const results = Array.isArray(response.results) ? response.results as Array<Record<string, unknown>> : [];
  return results.map((paper) => ({
    title: String(paper.display_name || "Untitled paper"),
    authors: ((paper.authorships as Array<{ author?: { display_name?: string } }> | undefined) || []).slice(0, 3).map((item) => item.author?.display_name).filter(Boolean).join(", "),
    year: paper.publication_year || null,
    abstract: paper.abstract_inverted_index ? reconstructAbstract(paper.abstract_inverted_index as Record<string, number[]>).slice(0, 420) : "",
    url: safeHttpUrl(paper.doi ? `https://doi.org/${String(paper.doi).replace(/^https?:\/\/doi\.org\//, "")}` : paper.id),
    doi: String(paper.doi || ""),
    citationCount: Number(paper.cited_by_count || 0),
    provider: "OpenAlex",
  }));
}

async function fetchSemanticScholar(query: string) {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "title,year,authors,abstract,url,openAccessPdf,citationCount,externalIds");
  const headers: Record<string, string> = {};
  const apiKey = readEnv("SEMANTIC_SCHOLAR_API_KEY");
  if (apiKey) headers["x-api-key"] = apiKey;
  const response = await fetchJson(url.toString(), { headers });
  const rows = Array.isArray(response.data) ? response.data as Array<Record<string, unknown>> : [];
  return rows.map((paper) => ({
    title: String(paper.title || "Untitled paper"),
    authors: ((paper.authors as Array<{ name?: string }> | undefined) || []).slice(0, 3).map((author) => author.name).filter(Boolean).join(", "),
    year: paper.year || null,
    abstract: String(paper.abstract || "").slice(0, 420),
    url: safeHttpUrl(paper.url || (paper.openAccessPdf as { url?: string } | undefined)?.url || ""),
    openAccessPdf: safeHttpUrl((paper.openAccessPdf as { url?: string } | undefined)?.url || ""),
    doi: String((paper.externalIds as { DOI?: string } | undefined)?.DOI || ""),
    citationCount: Number(paper.citationCount || 0),
    provider: "Semantic Scholar",
  }));
}

export async function searchAcademicPapers(data: unknown, _uid: string) {
  const query = assertText((data as { query?: string } | undefined)?.query, "Paper search", 300);
  const results = await Promise.allSettled([fetchOpenAlex(query), fetchSemanticScholar(query)]);
  const papers = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const seen = new Set<string>();
  return {
    papers: papers
      .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
      .filter((paper) => {
        const key = String(paper.doi || normalizePaperTitle(paper.title)).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return Boolean(paper.url);
      })
      .slice(0, 5),
  };
}

export async function searchYouTubeVideos(data: unknown, _uid: string) {
  const payload = (data ?? {}) as { query?: string; language?: string; maxResults?: number };
  const query = assertText(payload.query, "Video search", 300);
  const language = /^[a-z]{2}$/i.test(String(payload.language || "")) ? String(payload.language).toLowerCase() : "en";
  const maxResults = Math.min(Math.max(Number(payload.maxResults) || 20, 1), 47);
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("safeSearch", "moderate");
  url.searchParams.set("videoDuration", "medium");
  url.searchParams.set("relevanceLanguage", language);
  url.searchParams.set("regionCode", "US");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("fields", "items(id/videoId,snippet/title,snippet/channelTitle,snippet/thumbnails/medium,snippet/description)");
  url.searchParams.set("q", query);
  url.searchParams.set("key", requireKey("YOUTUBE_API_KEY", youtubeApiKey.value()));
  const response = await fetchJson(url.toString());
  return { items: Array.isArray(response.items) ? response.items : [] };
}
