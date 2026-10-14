import { readEnv } from "../env";
import { normalizeModelJson } from "./coerce";
import {
  PIPELINE_CONFIG,
  estimateTokens,
  fakeProvidersEnabled,
  stageConfig,
  type StageName,
} from "./config";
import { groqResponseFormat, STAGE_JSON_SCHEMA, STAGE_ZOD } from "./jsonSchema";
import { loadPrompt, userBlocks, type PromptName } from "./prompts";
import { learnerSpecSchema } from "./schemas";
import { specFromLearnerText } from "./intake";
import { redactSecrets } from "./text";
import { fakeEmbed, type EmbedFn } from "./research/retrieve";

export type ProviderResult = {
  json: unknown;
  model: string;
  promptName: string;
  promptHash: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
  repairs: string[];
  retried: boolean;
};

export type JsonProvider = {
  complete(stage: StageName, blocks: Record<string, unknown>): Promise<ProviderResult>;
};

const STAGE_PROMPT: Record<StageName, PromptName> = {
  intake: "intake",
  planner: "planner",
  research_queries: "research-queries",
  extractor: "extractor",
  writer: "writer",
  verifier: "verifier",
  rewriter: "rewriter",
  quiz: "quiz",
};

function costUsd(provider: "groq" | "gemini", tokensIn: number, tokensOut: number): number {
  const inn = provider === "gemini" ? PIPELINE_CONFIG.geminiInputUsdPerMillion : PIPELINE_CONFIG.groqInputUsdPerMillion;
  const out = provider === "gemini" ? PIPELINE_CONFIG.geminiOutputUsdPerMillion : PIPELINE_CONFIG.groqOutputUsdPerMillion;
  return (tokensIn * inn + tokensOut * out) / 1_000_000;
}

function parseJsonObject(text: string): unknown {
  const cleaned = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start < 0) throw new Error("Provider returned no JSON.");
  return JSON.parse(cleaned.slice(start));
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const errText = redactSecrets(await response.text().catch(() => ""));
    throw new Error(`provider_http_${response.status}:${errText.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  return await response.json() as Record<string, unknown>;
}

function groqContent(payload: Record<string, unknown>): string {
  const choice = (Array.isArray(payload.choices) ? payload.choices[0] : undefined) as
    | { message?: { content?: unknown } }
    | undefined;
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  return "";
}

function geminiText(payload: Record<string, unknown>): string {
  const candidate = (Array.isArray(payload.candidates) ? payload.candidates[0] : undefined) as
    | { content?: { parts?: Array<{ text?: string; thought?: boolean }> } }
    | undefined;
  return (candidate?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("\n");
}

async function completeGroq(stage: StageName, system: string, user: string) {
  const key = readEnv("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY is not configured.");
  const cfg = stageConfig(stage);
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: cfg.mode === "thinking" ? 1 : cfg.temperature,
    max_completion_tokens: cfg.maxOutputTokens,
    reasoning_effort: cfg.mode === "thinking" ? "default" : "none",
    reasoning_format: "hidden",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: groqResponseFormat(stage),
  };
  const payload = await fetchJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  }, cfg.timeoutMs);
  const usage = payload.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    text: groqContent(payload),
    model: cfg.model,
    inTok: Number(usage?.prompt_tokens || estimateTokens(system + user)),
    outTok: Number(usage?.completion_tokens || 0),
  };
}

async function completeGemini(stage: StageName, system: string, user: string) {
  const key = readEnv("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");
  const cfg = stageConfig(stage);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const payload = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: STAGE_JSON_SCHEMA[stage],
        responseJsonSchema: STAGE_JSON_SCHEMA[stage],
        temperature: cfg.temperature,
        maxOutputTokens: cfg.maxOutputTokens,
      },
    }),
  }, cfg.timeoutMs);
  const metadata = payload.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  return {
    text: geminiText(payload),
    model: cfg.model,
    inTok: Number(metadata?.promptTokenCount || estimateTokens(system + user)),
    outTok: Number(metadata?.candidatesTokenCount || 0),
  };
}

export function createLiveProvider(): JsonProvider {
  return {
    async complete(stage, blocks) {
      const prompt = loadPrompt(STAGE_PROMPT[stage]);
      const cfg = stageConfig(stage);
      const user = userBlocks(blocks);
      const started = Date.now();
      const inputTokens = estimateTokens(prompt.content + user);
      if (inputTokens > cfg.inputTokenBudget) {
        throw new Error(`input_budget_exceeded:${stage}:${inputTokens}/${cfg.inputTokenBudget}`);
      }
      const run = async () => cfg.provider === "gemini"
        ? completeGemini(stage, prompt.content, user)
        : completeGroq(stage, prompt.content, user);
      const first = await run();
      const coerced = normalizeModelJson(parseJsonObject(first.text));
      const parsed = STAGE_ZOD[stage].safeParse(coerced.value);
      if (!parsed.success) {
        throw new Error(`schema_invalid:${stage}`);
      }
      if (coerced.log.repairs.length) {
        console.log(`v3_stage=${stage} repairs=${coerced.log.repairs.join(",")}`);
      }
      return {
        json: parsed.data,
        model: first.model,
        promptName: prompt.name,
        promptHash: prompt.hash,
        tokensIn: first.inTok,
        tokensOut: first.outTok,
        latencyMs: Date.now() - started,
        costUsd: costUsd(cfg.provider, first.inTok, first.outTok),
        repairs: coerced.log.repairs,
        retried: false,
      };
    },
  };
}

export type FakeScript = Partial<Record<StageName, (blocks: Record<string, unknown>) => unknown>>;

export function createFakeProvider(script: FakeScript = {}, opts: { laxVerifier?: boolean } = {}): JsonProvider {
  return {
    async complete(stage, blocks) {
      const prompt = loadPrompt(STAGE_PROMPT[stage]);
      const started = Date.now();
      const json = script[stage] ? script[stage]!(blocks) : defaultFake(stage, blocks, opts.laxVerifier);
      if (stage === "intake") learnerSpecSchema.parse(json);
      return {
        json,
        model: opts.laxVerifier && stage === "verifier" ? "fake-writer-verifier" : "fake",
        promptName: prompt.name,
        promptHash: prompt.hash,
        tokensIn: estimateTokens(JSON.stringify(blocks)),
        tokensOut: estimateTokens(JSON.stringify(json)),
        latencyMs: Date.now() - started,
        costUsd: 0.001,
        repairs: [],
        retried: false,
      };
    },
  };
}

function originalClaim(index: number, topicHint: string): string {
  const topic = topicHint.replace(/-/g, " ").slice(0, 40) || "the idea";
  const variants = [
    `${topic} names a procedure with explicit inputs and a stated output.`,
    `The result for ${topic} depends on a declared frame or condition.`,
    `A frequent mix-up is dropping that frame and treating ${topic} as a collapse.`,
    `Keep numerals, units and names unchanged when restating ${topic}.`,
    `A short case for ${topic} applies the same inputs in order.`,
    `Authoritative notes for ${topic} list constraints before any example.`,
  ];
  return variants[index % variants.length]!;
}

function defaultFake(stage: StageName, blocks: Record<string, unknown>, laxVerifier = false): unknown {
  if (stage === "intake") {
    const raw = String((blocks.LEARNER_TEXT as { text?: string } | undefined)?.text || "");
    return specFromLearnerText(raw).spec;
  }
  if (stage === "planner") {
    const spec = blocks.LEARNER_SPEC as { topic?: string };
    const topic = spec.topic || "the subject";
    return {
      lessons: [
        {
          id: "L1",
          title: `${topic} definition`,
          objectives: [
            { id: "O1", text: `Define ${topic} in operational terms` },
            { id: "O2", text: `Apply ${topic} to a short worked case` },
          ],
          key_concepts: [topic, "definition", "worked example"],
          prerequisites: [],
          est_minutes: 12,
        },
      ],
    };
  }
  if (stage === "research_queries") {
    const lesson = blocks.LESSON_SPEC as { title?: string; key_concepts?: string[] };
    const focus = lesson.key_concepts?.[0] || lesson.title || "topic";
    return {
      queries: [
        { text: `${focus} definition`, angle: "definition" },
        { text: `${focus} worked example`, angle: "example" },
        { text: `${focus} common misconception`, angle: "misconception" },
        { text: `${focus} authoritative reference`, angle: "reference" },
        { text: `${focus} video explanation`, angle: "video" },
      ],
    };
  }
  if (stage === "extractor") {
    const chunks = (blocks.CHUNKS as Array<{ chunk_ref?: string; source_id?: string; text?: string }> | undefined) || [];
    const usable = chunks.filter((c) => !/ignore previous|buy cheap shoes/i.test(c.text || ""));
    const cards = usable.slice(0, 6).map((c, i) => ({
      id: `E${i + 1}`,
      claim: originalClaim(i, String(c.text || "topic").split(" ").slice(0, 4).join(" ")),
      source_id: c.source_id || "S1",
      chunk_ref: c.chunk_ref || `S1:${i}`,
    }));
    if (!cards.length) {
      return {
        cards: [{
          id: "E1",
          claim: originalClaim(0, "the subject"),
          source_id: "S1",
          chunk_ref: "S1:0",
        }],
      };
    }
    return { cards };
  }
  if (stage === "writer" || stage === "rewriter") {
    const lesson = blocks.LESSON_SPEC as { title?: string; objectives?: Array<{ id: string; text: string }> };
    const cards = (blocks.EVIDENCE_CARDS as Array<{ id: string; claim: string }> | undefined) || [];
    const objectives = lesson.objectives || [{ id: "O1", text: "Define" }, { id: "O2", text: "Apply" }];
    const c1 = cards[0] || { id: "E1", claim: originalClaim(0, lesson.title || "topic") };
    const c2 = cards[1] || cards[0] || c1;
    const sections = [
      {
        heading: "Definition",
        body_markdown: `${c1.claim} State the inputs before the result so the rule stays testable. [${c1.id}]`,
        citations: [c1.id],
        kind: "explanation" as const,
      },
      {
        heading: "Worked case",
        body_markdown: `${c2.claim} Walk the same inputs in order and do not invent extra figures. [${c2.id}]`,
        citations: [c2.id],
        kind: "example" as const,
      },
    ];
    return {
      title: lesson.title || "Lesson",
      objectives_covered: objectives.map((o) => o.id),
      sections,
      takeaways: [{ text: `Keep the operational rule visible when using the idea. [${c1.id}]`, citations: [c1.id] }],
      gaps: [],
    };
  }
  if (stage === "verifier") {
    const draft = blocks.LESSON_DRAFT as { sections?: Array<{ body_markdown?: string }>; title?: string } | undefined;
    const cards = (blocks.EVIDENCE_CARDS as Array<{ id: string; claim: string }> | undefined) || [];
    const body = `${draft?.title || ""}\n${(draft?.sections || []).map((s) => s.body_markdown).join("\n")}`;
    const sentences = body.split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s.length > 8);
    const claims = (sentences.length ? sentences : ["The idea has a named definition."]).slice(0, 12).map((text) => {
      const plantedFalse = /moon is made of cheese|off-topic celebrity|unsupported invention/i.test(text);
      const offTopic = /celebrity gossip|sports score/i.test(text);
      if (!laxVerifier && plantedFalse) {
        return { text, verdict: offTopic ? "OFF_TOPIC" : "UNSUPPORTED", evidence_ids: [] as string[] };
      }
      const hit = cards.find((c) => text.toLowerCase().includes(c.claim.slice(0, 18).toLowerCase())) || cards[0];
      return { text, verdict: "SUPPORTED", evidence_ids: hit ? [hit.id] : [] };
    });
    const bad = claims.filter((c) => c.verdict !== "SUPPORTED");
    return {
      claims,
      scores: {
        accuracy: bad.length ? 2 : 5,
        coverage: 5,
        focus: bad.some((c) => c.verdict === "OFF_TOPIC") ? 2 : 5,
        clarity: 5,
        originality: 5,
      },
      fix_list: bad.map((c) => `Remove or rewrite: ${c.text.slice(0, 80)}`),
    };
  }
  if (stage === "quiz") {
    const objectives = (blocks.OBJECTIVES as Array<{ id: string; text: string }> | undefined) || [{ id: "O1", text: "Define" }];
    const claims = (blocks.SUPPORTED_CLAIMS as Array<{ text?: string; evidence_ids?: string[] }> | undefined) || [];
    return {
      items: objectives.map((obj, i) => {
        const ev = claims[i]?.evidence_ids?.[0] || claims[0]?.evidence_ids?.[0] || "E1";
        return {
          question: `Which statement best matches the operational idea in ${obj.id}?`,
          options: [
            "It is a defined procedure with named conditions.",
            "It is only a motivational slogan.",
            "It has no inputs.",
            "It is decided by majority vote.",
          ],
          correctIndex: 0,
          explanation: "The supported cards describe a defined procedure, not a slogan.",
          objective_id: obj.id,
          evidence_ids: [ev],
        };
      }),
    };
  }
  return {};
}

export function createConfiguredProvider(): JsonProvider {
  return fakeProvidersEnabled() ? createFakeProvider() : createLiveProvider();
}

export function createConfiguredEmbedder(): EmbedFn {
  if (fakeProvidersEnabled() || !readEnv("GEMINI_API_KEY")) return async (texts) => fakeEmbed(texts);
  return async (texts) => {
    const key = readEnv("GEMINI_API_KEY");
    if (!key) throw new Error("GEMINI_API_KEY is not configured.");
    const model = readEnv("EMBEDDING_MODEL", "gemini-embedding-001");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`;
    const payload = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        requests: texts.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] } })),
      }),
    }, 20000);
    const embeddings = (payload.embeddings as Array<{ values?: number[] }> | undefined) || [];
    return embeddings.map((e) => e.values || []);
  };
}
