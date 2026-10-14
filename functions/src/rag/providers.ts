import { readEnv } from "../env";
import {
  estimateTokens,
  fakeProvidersEnabled,
  geminiInputUsdPerMillion,
  geminiOutputUsdPerMillion,
  groqInputUsdPerMillion,
  groqOutputUsdPerMillion,
  stageConfig,
  type StageName,
} from "./config";
import { loadPrompt, labelledUserMessage, type PromptName } from "./prompts";

export type StageCall = {
  stage: StageName;
  blocks: Record<string, unknown>;
};

export type ProviderResult = {
  json: unknown;
  model: string;
  promptName: PromptName;
  promptHash: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
};

export type JsonProvider = {
  complete(call: StageCall): Promise<ProviderResult>;
};

const STAGE_PROMPT: Record<StageName, PromptName> = {
  intake: "intake",
  planner: "planner",
  extractor: "extractor",
  writer: "writer",
  verifier: "verifier",
  rewriter: "rewriter",
  quiz: "quiz",
};

export function stripReasoningText(text: string): string {
  let out = String(text || "");
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  return out.trim();
}

export function parseJsonObject(text: string): unknown {
  const cleaned = stripReasoningText(text);
  const start = cleaned.search(/[{[]/);
  if (start < 0) throw new Error("Provider returned no JSON.");
  return JSON.parse(cleaned.slice(start));
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") || "2");
    const error = new Error("rate_limited") as Error & { retryAfterMs: number };
    error.retryAfterMs = Math.max(500, retryAfter * 1000);
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`provider_http_${response.status}`);
  }
  return await response.json() as Record<string, unknown>;
}

async function withBackoff<T>(action: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await action();
    } catch (error) {
      last = error;
      const retryAfterMs = typeof error === "object" && error && "retryAfterMs" in error
        ? Number((error as { retryAfterMs?: number }).retryAfterMs)
        : 400 * (2 ** i);
      if (i === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    }
  }
  throw last instanceof Error ? last : new Error("provider_failed");
}

function groqContent(payload: Record<string, unknown>): string {
  const choice = (Array.isArray(payload.choices) ? payload.choices[0] : undefined) as
    | { message?: { content?: unknown; reasoning?: unknown } }
    | undefined;
  const message = choice?.message;
  if (message && typeof message === "object") {
    const { reasoning: _ignored, content } = message;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => typeof part === "string" ? part : String((part as { text?: string }).text || "")).join("\n");
    }
  }
  return "";
}

function geminiText(payload: Record<string, unknown>): string {
  const candidate = (Array.isArray(payload.candidates) ? payload.candidates[0] : undefined) as
    | { content?: { parts?: Array<{ text?: string; thought?: boolean }> } }
    | undefined;
  const parts = candidate?.content?.parts || [];
  return parts
    .filter((part) => !part?.thought)
    .map((part) => part?.text || "")
    .join("\n");
}

async function completeGroq(stage: StageName, system: string, user: string): Promise<{ text: string; model: string; inTok: number; outTok: number }> {
  const key = readEnv("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY is not configured.");
  const cfg = stageConfig(stage);
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: cfg.temperature,
    max_completion_tokens: cfg.maxOutputTokens,
    reasoning_effort: cfg.reasoningEffort,
    reasoning_format: "hidden",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  };
  if (cfg.topP != null) body.top_p = cfg.topP;
  const payload = await withBackoff(() => fetchJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  }, cfg.timeoutMs));
  const usage = payload.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    text: groqContent(payload),
    model: cfg.model,
    inTok: Number(usage?.prompt_tokens || estimateTokens(system + user)),
    outTok: Number(usage?.completion_tokens || 0),
  };
}

async function completeGemini(stage: StageName, system: string, user: string): Promise<{ text: string; model: string; inTok: number; outTok: number }> {
  const key = readEnv("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");
  const cfg = stageConfig(stage);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    temperature: cfg.temperature,
    maxOutputTokens: cfg.maxOutputTokens,
    thinkingConfig: { thinkingBudget: Number(cfg.reasoningEffort) || 0 },
  };
  if (cfg.topP != null) generationConfig.topP = cfg.topP;
  const payload = await withBackoff(() => fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig,
    }),
  }, cfg.timeoutMs));
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
    async complete(call) {
      const prompt = loadPrompt(STAGE_PROMPT[call.stage]);
      const cfg = stageConfig(call.stage);
      const user = labelledUserMessage(call.blocks);
      const started = Date.now();
      const inputTokens = estimateTokens(prompt.content + user);
      if (inputTokens > cfg.inputTokenBudget) {
        throw new Error(`input_budget_exceeded:${call.stage}:${inputTokens}/${cfg.inputTokenBudget}`);
      }
      const result = cfg.provider === "gemini"
        ? await completeGemini(call.stage, prompt.content, user)
        : await completeGroq(call.stage, prompt.content, user);
      const rateIn = cfg.provider === "gemini" ? geminiInputUsdPerMillion() : groqInputUsdPerMillion();
      const rateOut = cfg.provider === "gemini" ? geminiOutputUsdPerMillion() : groqOutputUsdPerMillion();
      const costUsd = (result.inTok * rateIn + result.outTok * rateOut) / 1_000_000;
      return {
        json: parseJsonObject(result.text),
        model: result.model,
        promptName: prompt.name,
        promptHash: prompt.hash,
        tokensIn: result.inTok,
        tokensOut: result.outTok,
        latencyMs: Date.now() - started,
        costUsd,
      };
    },
  };
}

export type FakeScript = Partial<Record<StageName, (blocks: Record<string, unknown>) => unknown>>;

export function createFakeProvider(script: FakeScript = {}): JsonProvider {
  return {
    async complete(call) {
      const prompt = loadPrompt(STAGE_PROMPT[call.stage]);
      const started = Date.now();
      const json = script[call.stage] ? script[call.stage]!(call.blocks) : defaultFake(call.stage, call.blocks);
      return {
        json,
        model: "fake",
        promptName: prompt.name,
        promptHash: prompt.hash,
        tokensIn: estimateTokens(JSON.stringify(call.blocks)),
        tokensOut: estimateTokens(JSON.stringify(json)),
        latencyMs: Date.now() - started,
        costUsd: 0,
      };
    },
  };
}

function defaultFake(stage: StageName, blocks: Record<string, unknown>): unknown {
  if (stage === "intake") {
    return { topic: "option pricing", level: "beginner", goal: "Compute a European call from named inputs.", constraints: [] };
  }
  if (stage === "planner") {
    return {
      lessons: [
        {
          id: "L1",
          title: "Cumulative normal of d1",
          objectives: [
            { id: "O1", text: "Calculate N(d1) for a given d1." },
            { id: "O2", text: "Distinguish the CDF from the density." },
          ],
          key_concepts: ["N(d1)", "standard normal CDF"],
          prerequisites: [],
          est_minutes: 12,
        },
      ],
    };
  }
  if (stage === "extractor") {
    return {
      cards: [
        { id: "E1", claim: "N(x) is the standard-normal CDF at x.", source_id: "S1", chunk_id: "C1" },
        { id: "E2", claim: "N(0) equals 0.5.", source_id: "S1", chunk_id: "C1" },
        { id: "E3", claim: "The density φ(x) is not the same function as N(x).", source_id: "S1", chunk_id: "C2" },
      ],
    };
  }
  if (stage === "writer" || stage === "rewriter") {
    return {
      title: "Cumulative normal of d1",
      objectives_covered: ["O1", "O2"],
      sections: [
        {
          heading: "The CDF is the check",
          body_markdown: "N(x) is the standard-normal CDF at x [E1]. At zero it equals 0.5, which is the numeric check [E2].",
          citations: ["E1", "E2"],
          kind: "explanation",
        },
        {
          heading: "Do not use the density",
          body_markdown: "The density φ(x) is a different function from the standard normal CDF N(x) [E3]. Using φ in place of N silently returns the wrong probability.",
          citations: ["E3"],
          kind: "explanation",
        },
      ],
      takeaways: [{ text: "Compute N(d1), not φ(d1).", citations: ["E1", "E3"] }],
      gaps: [],
    };
  }
  if (stage === "verifier") {
    return {
      claims: [
        { text: "N(x) is the standard-normal CDF at x.", verdict: "SUPPORTED", evidence_ids: ["E1"] },
        { text: "N(0) equals 0.5.", verdict: "SUPPORTED", evidence_ids: ["E2"] },
        { text: "The density is not the CDF.", verdict: "SUPPORTED", evidence_ids: ["E3"] },
      ],
      scores: { accuracy: 5, coverage: 5, focus: 5, clarity: 5, originality: 4 },
      fix_list: [],
    };
  }
  if (stage === "quiz") {
    return {
      items: [
        {
          question: "What is N(0) for the standard-normal CDF?",
          options: ["0.5", "1", "0", "φ(0)"],
          correctIndex: 0,
          explanation: "The CDF at the mean is one half.",
          objective_id: "O1",
          evidence_ids: ["E2"],
        },
        {
          question: "Which swap silently breaks a call price that needs N(d1)?",
          options: ["Using φ(d1) in place of N(d1)", "Evaluating N at d1", "Writing the inputs first", "Checking N(0)=0.5"],
          correctIndex: 0,
          explanation: "The density is not the cumulative probability.",
          objective_id: "O2",
          evidence_ids: ["E3"],
        },
      ],
    };
  }
  return {};
}

export function createConfiguredProvider(script?: FakeScript): JsonProvider {
  if (fakeProvidersEnabled() || script) return createFakeProvider(script);
  return createLiveProvider();
}
