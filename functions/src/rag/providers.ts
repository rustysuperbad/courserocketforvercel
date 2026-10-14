import { readEnv } from "../env";
import {
  estimateTokens,
  fakeProvidersEnabled,
  geminiInputUsdPerMillion,
  geminiOutputUsdPerMillion,
  groqInputUsdPerMillion,
  groqOutputUsdPerMillion,
  groqWriterModel,
  stageConfig,
  type StageName,
} from "./config";
import { formatZodIssues, normalizeStageOutput } from "./coerce";
import { specFromLearnerText } from "./intake";
import { groqResponseFormat, STAGE_JSON_SCHEMA, STAGE_ZOD } from "./jsonSchema";
import { loadPrompt, labelledUserMessage, type PromptName } from "./prompts";
import { redactForLog } from "./redact";
import type { EvidenceCard, LearnerSpec, SyllabusLesson } from "./schemas";

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
  repairs: string[];
  retried: boolean;
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
    const errText = await response.text().catch(() => "");
    const recovered = recoverFailedGeneration(errText);
    if (recovered) return { choices: [{ message: { content: recovered } }] };
    throw new Error(`provider_http_${response.status}:${redactForLog(errText).replace(/\s+/g, " ").slice(0, 220)}`);
  }
  return await response.json() as Record<string, unknown>;
}

function recoverFailedGeneration(errText: string): string | null {
  try {
    const payload = JSON.parse(errText) as { error?: { failed_generation?: string } };
    return payload.error?.failed_generation || null;
  } catch {
    return null;
  }
}

function isAbortOrTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(message);
}

async function withBackoff<T>(action: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await action();
    } catch (error) {
      last = error;
      if (isAbortOrTimeout(error)) break;
      const limited = typeof error === "object" && error && "retryAfterMs" in error;
      const retryAfterMs = limited
        ? Math.max(12000, Number((error as { retryAfterMs?: number }).retryAfterMs) || 12000)
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

const GROQ_REASONING = new Set(["none", "default", "minimal", "low", "medium", "high", "xhigh", "max"]);

type ModelText = { text: string; model: string; inTok: number; outTok: number };

async function completeGroq(stage: StageName, system: string, user: string): Promise<ModelText> {
  const key = readEnv("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY is not configured.");
  const cfg = stageConfig(stage);
  const thinking = cfg.provider === "groq" && cfg.mode === "thinking";
  const effort = thinking && GROQ_REASONING.has(cfg.reasoningEffort) && cfg.reasoningEffort !== "none"
    ? cfg.reasoningEffort
    : thinking ? "default" : "none";
  const body: Record<string, unknown> = {
    model: groqWriterModel(),
    temperature: thinking ? 1 : (cfg.provider === "groq" ? cfg.temperature : 0.2),
    max_completion_tokens: cfg.maxOutputTokens,
    reasoning_effort: effort,
    reasoning_format: "hidden",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: groqResponseFormat(stage),
  };
  if (cfg.topP != null) body.top_p = cfg.topP;
  const payload = await withBackoff(() => fetchJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  }, cfg.timeoutMs));
  const gapMs = Number(readEnv("GROQ_STAGE_GAP_MS", "800"));
  if (Number.isFinite(gapMs) && gapMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  const usage = payload.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    text: groqContent(payload),
    model: groqWriterModel(),
    inTok: Number(usage?.prompt_tokens || estimateTokens(system + user)),
    outTok: Number(usage?.completion_tokens || 0),
  };
}

async function completeGemini(stage: StageName, system: string, user: string): Promise<ModelText> {
  const key = readEnv("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");
  const cfg = stageConfig(stage);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseJsonSchema: STAGE_JSON_SCHEMA[stage],
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

function stageCost(provider: "groq" | "gemini", result: ModelText): number {
  const rateIn = provider === "gemini" ? geminiInputUsdPerMillion() : groqInputUsdPerMillion();
  const rateOut = provider === "gemini" ? geminiOutputUsdPerMillion() : groqOutputUsdPerMillion();
  return (result.inTok * rateIn + result.outTok * rateOut) / 1_000_000;
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
      console.log(`rag_stage=${call.stage} provider=${cfg.provider} model=${cfg.model}`);

      const runModel = async (message: string): Promise<ModelText> => {
        try {
          return cfg.provider === "gemini"
            ? await completeGemini(call.stage, prompt.content, message)
            : await completeGroq(call.stage, prompt.content, message);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "provider_failed";
          if (call.stage === "verifier" && cfg.provider === "gemini") {
            return completeGroq(call.stage, prompt.content, message);
          }
          throw new Error(`${call.stage}:${cfg.provider}:${redactForLog(detail)}`);
        }
      };

      const parseValidated = (text: string) => {
        const coerced = normalizeStageOutput(call.stage, parseJsonObject(text));
        const parsed = STAGE_ZOD[call.stage].safeParse(coerced.json);
        return { coerced, parsed };
      };

      const first = await runModel(user);
      let tokensIn = first.inTok;
      let tokensOut = first.outTok;
      let costUsd = stageCost(cfg.provider, first);
      let model = first.model;
      const firstParsed = parseValidated(first.text);
      let repairs = firstParsed.coerced.repairs;
      let retried = false;
      let json = firstParsed.coerced.json;

      if (!firstParsed.parsed.success) {
        retried = true;
        const retryUser = `${user}\n\nVALIDATION_ERROR:\n${formatZodIssues(firstParsed.parsed.error)}\nReturn JSON that matches the schema. Do not wrap it.`;
        const second = await runModel(retryUser);
        tokensIn += second.inTok;
        tokensOut += second.outTok;
        costUsd += stageCost(cfg.provider, second);
        model = second.model;
        const secondParsed = parseValidated(second.text);
        repairs = [...repairs, "validation_retry", ...secondParsed.coerced.repairs];
        if (!secondParsed.parsed.success) {
          throw new Error(`schema_invalid:${call.stage}:${formatZodIssues(secondParsed.parsed.error)}`);
        }
        json = secondParsed.parsed.data;
      } else {
        json = firstParsed.parsed.data;
      }

      if (repairs.length) {
        console.log(`rag_stage=${call.stage} repairs=${repairs.join(",")}`);
      }

      return {
        json,
        model,
        promptName: prompt.name,
        promptHash: prompt.hash,
        tokensIn,
        tokensOut,
        latencyMs: Date.now() - started,
        costUsd,
        repairs,
        retried,
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
        repairs: [],
        retried: false,
      };
    },
  };
}

function defaultFake(stage: StageName, blocks: Record<string, unknown>): unknown {
  if (stage === "intake") {
    const raw = String((blocks.LEARNER_TEXT as { text?: string } | undefined)?.text || "");
    return specFromLearnerText(raw).spec;
  }
  if (stage === "planner") {
    const spec = blocks.LEARNER_SPEC as LearnerSpec;
    const topic = spec.topic || "the subject";
    const head = topic.split(/\s+/).filter(Boolean)[0] || "topic";
    const focusD2 = spec.constraints.some((item) => /d2/i.test(item));
    return {
      lessons: [
        {
          id: "L1",
          title: `${head} working check`.slice(0, 120),
          objectives: [
            { id: "O1", text: focusD2 ? "Explain how d1 is used to obtain d2." : `Explain the working mechanism for ${head}.` },
            { id: "O2", text: `Apply a numeric check for ${head}.` },
          ],
          key_concepts: topic.split(/\s+/).filter((word) => word.length > 1).slice(0, 6),
          prerequisites: focusD2 ? ["d1"] : [],
          est_minutes: spec.constraints.some((item) => /20 minutes/i.test(item)) ? 18 : 12,
        },
      ],
    };
  }
  if (stage === "extractor") {
    const chunks = (blocks.CHUNKS as Array<{ chunk_id: string; source_id: string; text: string }> | undefined) || [];
    return {
      cards: chunks.slice(0, 4).map((chunk, index) => ({
        id: `E${index + 1}`,
        claim: chunk.text.replace(/\s+/g, " ").trim().slice(0, 220),
        source_id: chunk.source_id,
        chunk_id: chunk.chunk_id,
      })),
    };
  }
  if (stage === "writer" || stage === "rewriter") {
    const spec = blocks.LESSON_SPEC as SyllabusLesson;
    const cards = (blocks.EVIDENCE_CARDS as EvidenceCard[] | undefined) || [];
    const sections = spec.objectives.map((objective, index) => {
      const card = cards[index] || cards[0];
      const id = card?.id || "E1";
      const d1note = index === 0 && (spec.prerequisites.includes("d1") || /d2/i.test(objective.text))
        ? " d2 is obtained from d1; omitting d1 would leave d2 undefined."
        : "";
      const body = `${objective.text} using only the cited evidence [${id}].${d1note} Write the expected check first, compute it on paper, then compare the two numbers. Repeat until they match, and keep the working beside the claim so you can see which quantity is supposed to move when the input changes.`;
      return { heading: objective.text.slice(0, 80), body_markdown: body, citations: [id], kind: "explanation" as const };
    });
    return {
      title: spec.title,
      objectives_covered: spec.objectives.map((item) => item.id),
      sections,
      takeaways: [{ text: `You can run a check for ${spec.title}.`, citations: [cards[0]?.id || "E1"] }],
      gaps: [],
    };
  }
  if (stage === "verifier") {
    const draft = blocks.LESSON_DRAFT as { sections?: Array<{ body_markdown: string; citations: string[] }> };
    const claims = (draft.sections || []).map((section) => ({
      text: section.body_markdown.slice(0, 180),
      verdict: "SUPPORTED" as const,
      evidence_ids: section.citations,
    }));
    return {
      claims: claims.length ? claims : [{ text: "supported", verdict: "SUPPORTED", evidence_ids: ["E1"] }],
      scores: { accuracy: 5, coverage: 5, focus: 5, clarity: 5, originality: 4 },
      fix_list: [],
    };
  }
  if (stage === "quiz") {
    const objectives = (blocks.OBJECTIVES as Array<{ id: string; text: string }>) || [];
    const supported = (blocks.SUPPORTED_CLAIMS as Array<{ text: string; evidence_ids: string[] }>) || [];
    return {
      items: objectives.map((objective, index) => {
        const claim = supported[index] || supported[0];
        return {
          question: `Which check shows you applied ${objective.text}?`,
          options: [claim?.text.slice(0, 80) || "the computed check", "the heading looks familiar", "you skipped the numbers", "all of the above"],
          correctIndex: 0,
          explanation: "The working check comes from the supported claim.",
          objective_id: objective.id,
          evidence_ids: claim?.evidence_ids?.length ? claim.evidence_ids : ["E1"],
        };
      }),
    };
  }
  return {};
}

export function createConfiguredProvider(script?: FakeScript): JsonProvider {
  if (fakeProvidersEnabled() || script) return createFakeProvider(script);
  return createLiveProvider();
}
