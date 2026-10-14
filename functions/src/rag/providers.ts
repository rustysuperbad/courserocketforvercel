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
import { specFromLearnerText } from "./intake";
import { loadPrompt, labelledUserMessage, type PromptName } from "./prompts";
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function clip(value: unknown, max: number, fallback = ""): string {
  const text = String(value ?? "").trim() || fallback;
  return text.slice(0, max);
}

function coerceStageJson(stage: StageName, json: unknown): unknown {
  if (Array.isArray(json) && stage === "extractor") json = { cards: json };
  let obj = asRecord(json);
  if (!obj) return json;
  if (stage === "planner" && obj.lessons == null && asRecord(obj.syllabus)) obj = asRecord(obj.syllabus)!;
  if (stage === "intake" && obj.status == null && asRecord(obj.spec)) obj = asRecord(obj.spec)!;
  if (stage === "extractor" && obj.cards == null && Array.isArray(obj.evidence)) obj = { cards: obj.evidence };
  if ((stage === "writer" || stage === "rewriter") && obj.sections == null && asRecord(obj.lesson)) obj = asRecord(obj.lesson)!;
  if (stage === "quiz" && obj.items == null && Array.isArray(obj.quiz)) obj = { items: obj.quiz };

  if (stage === "intake") {
    const status = obj.status === "needs_clarification" || obj.status === "rejected" ? obj.status : "ok";
    return {
      status,
      topic: clip(obj.topic, 80),
      level: obj.level === "intermediate" || obj.level === "advanced" ? obj.level : "beginner",
      goal: clip(obj.goal, 160),
      constraints: Array.isArray(obj.constraints) ? obj.constraints.map((item) => clip(item, 120)).filter((item) => item.length >= 2).slice(0, 8) : [],
      ignored_requests: Array.isArray(obj.ignored_requests) ? obj.ignored_requests.map((item) => clip(item, 120)).filter((item) => item.length >= 4).slice(0, 4) : [],
    };
  }

  if (stage === "planner") {
    const raw = Array.isArray(obj.lessons) ? obj.lessons : [];
    const lessons = raw.slice(0, 2).map((item, index) => {
      const lesson = asRecord(item) || { title: String(item) };
      const title = clip(lesson.title || lesson.name, 120, `Lesson ${index + 1}`);
      const rawObjectives = Array.isArray(lesson.objectives) ? lesson.objectives : [];
      const objectives = rawObjectives.slice(0, 4).map((entry, oi) => {
        const rec = asRecord(entry);
        const text = clip(rec?.text ?? entry, 240, `Explain ${title}.`);
        return { id: clip(rec?.id, 40, `O${oi + 1}`) || `O${oi + 1}`, text: text.length >= 8 ? text : `Explain ${title}.` };
      });
      while (objectives.length < 2) {
        objectives.push({ id: `O${objectives.length + 1}`, text: `Apply ${title} on a worked check.` });
      }
      const concepts = Array.isArray(lesson.key_concepts)
        ? lesson.key_concepts.map((item) => clip(item, 80)).filter((item) => item.length >= 2).slice(0, 12)
        : title.split(/\s+/).filter((word) => word.length > 1).slice(0, 6);
      const minutes = Number(lesson.est_minutes);
      return {
        id: clip(lesson.id, 40, `L${index + 1}`) || `L${index + 1}`,
        title: title.length >= 3 ? title : `Lesson ${index + 1}`,
        objectives,
        key_concepts: concepts.length ? concepts : [title.slice(0, 80) || "topic"],
        prerequisites: Array.isArray(lesson.prerequisites) ? lesson.prerequisites.map((item) => clip(item, 40)).filter(Boolean).slice(0, 8) : [],
        est_minutes: Number.isFinite(minutes) ? Math.min(90, Math.max(5, Math.round(minutes))) : 12,
      };
    });
    return { lessons };
  }

  if (stage === "extractor") {
    const cards = (Array.isArray(obj.cards) ? obj.cards : []).slice(0, 40).map((item, index) => {
      const card = asRecord(item) || {};
      return {
        id: clip(card.id, 40, `E${index + 1}`) || `E${index + 1}`,
        claim: clip(card.claim || card.text, 500, "Supported claim from the source."),
        source_id: clip(card.source_id, 80, "S1") || "S1",
        chunk_id: clip(card.chunk_id, 80, "C1") || "C1",
      };
    });
    return { cards };
  }

  if (stage === "writer" || stage === "rewriter") {
    const sections = (Array.isArray(obj.sections) ? obj.sections : []).slice(0, 8).map((item) => {
      const section = asRecord(item) || {};
      const citations = Array.isArray(section.citations) ? section.citations.map((id) => clip(id, 40)).filter(Boolean) : ["E1"];
      const body = clip(section.body_markdown || section.body, 6000, "See the cited evidence for this check [E1].");
      return {
        heading: clip(section.heading, 120, "Section") || "Section",
        body_markdown: body.length >= 24 ? body : "See the cited evidence for this check [E1].",
        citations: citations.length ? citations.slice(0, 12) : ["E1"],
        kind: section.kind === "example" ? "example" : "explanation",
      };
    });
    const takeawaySource = Array.isArray(obj.takeaways) && obj.takeaways.length
      ? obj.takeaways
      : [{ text: "Apply the cited check.", citations: ["E1"] }];
    const takeaways = takeawaySource.slice(0, 8).map((item) => {
      const rec = asRecord(item);
      const citations = Array.isArray(rec?.citations) ? rec.citations.map((id) => clip(id, 40)).filter(Boolean) : ["E1"];
      const text = clip(rec?.text ?? item, 280, "Apply the cited check.");
      return {
        text: text.length >= 8 ? text : "Apply the cited check.",
        citations: citations.length ? citations.slice(0, 8) : ["E1"],
      };
    });
    const covered = Array.isArray(obj.objectives_covered)
      ? obj.objectives_covered.map((id) => clip(id, 40)).filter(Boolean).slice(0, 8)
      : [];
    return {
      title: clip(obj.title, 160, "Lesson") || "Lesson",
      objectives_covered: covered.length ? covered : ["O1"],
      sections: sections.length ? sections : [{ heading: "Lesson", body_markdown: "See the cited evidence for this check [E1].", citations: ["E1"], kind: "explanation" }],
      takeaways: takeaways.length ? takeaways : [{ text: "Apply the cited check.", citations: ["E1"] }],
      gaps: Array.isArray(obj.gaps) ? obj.gaps.map((item) => clip(item, 240)).filter((item) => item.length >= 4).slice(0, 12) : [],
    };
  }

  if (stage === "verifier") {
    const claims = (Array.isArray(obj.claims) ? obj.claims : []).slice(0, 40).map((item) => {
      const rec = asRecord(item) || {};
      const verdict = ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "OFF_TOPIC"].includes(String(rec.verdict))
        ? rec.verdict
        : "UNSUPPORTED";
      return {
        text: clip(rec.text, 800, "claim"),
        verdict,
        evidence_ids: Array.isArray(rec.evidence_ids) ? rec.evidence_ids.map((id) => clip(id, 40)).filter(Boolean).slice(0, 12) : [],
      };
    });
    const scores = asRecord(obj.scores) || {};
    const num = (key: string) => {
      const value = Number(scores[key]);
      return Number.isFinite(value) ? Math.min(5, Math.max(0, value)) : 3;
    };
    return {
      claims: claims.length ? claims : [{ text: "no claims", verdict: "UNSUPPORTED", evidence_ids: [] }],
      scores: { accuracy: num("accuracy"), coverage: num("coverage"), focus: num("focus"), clarity: num("clarity"), originality: num("originality") },
      fix_list: Array.isArray(obj.fix_list) ? obj.fix_list.map((item) => clip(item, 400)).filter((item) => item.length >= 4).slice(0, 20) : [],
    };
  }

  if (stage === "quiz") {
    const items = (Array.isArray(obj.items) ? obj.items : []).slice(0, 12).map((item, index) => {
      const rec = asRecord(item) || {};
      const options = (Array.isArray(rec.options) ? rec.options : ["check", "guess", "skip", "all"]).map((opt) => clip(opt, 220) || "option").slice(0, 4);
      while (options.length < 4) options.push(`option ${options.length + 1}`);
      const correct = Number(rec.correctIndex);
      return {
        question: clip(rec.question, 400, `Which check applies here ${index + 1}?`) || "Which check applies?",
        options,
        correctIndex: Number.isFinite(correct) ? Math.min(3, Math.max(0, Math.round(correct))) : 0,
        explanation: clip(rec.explanation, 500, "The cited claim supports this check."),
        objective_id: clip(rec.objective_id, 40, "O1") || "O1",
        evidence_ids: Array.isArray(rec.evidence_ids) && rec.evidence_ids.length
          ? rec.evidence_ids.map((id) => clip(id, 40)).filter(Boolean).slice(0, 8)
          : ["E1"],
      };
    });
    return { items: items.length ? items : [] };
  }

  return obj;
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
    throw new Error(`provider_http_${response.status}:${errText.replace(/\s+/g, " ").slice(0, 220)}`);
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

async function completeGroq(stage: StageName, system: string, user: string): Promise<{ text: string; model: string; inTok: number; outTok: number }> {
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
    response_format: { type: "json_object" },
  };
  if (cfg.topP != null) body.top_p = cfg.topP;
  const payload = await withBackoff(() => fetchJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  }, cfg.timeoutMs));
  const gapMs = Number(readEnv("GROQ_STAGE_GAP_MS", "8000"));
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
      console.log(`rag_stage=${call.stage} provider=${cfg.provider} model=${cfg.model}`);
      let result: { text: string; model: string; inTok: number; outTok: number };
      try {
        result = cfg.provider === "gemini"
          ? await completeGemini(call.stage, prompt.content, user)
          : await completeGroq(call.stage, prompt.content, user);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "provider_failed";
        if (call.stage === "extractor") {
          result = { text: "{\"cards\":[]}", model: groqWriterModel(), inTok: 0, outTok: 0 };
        } else if (call.stage === "verifier" && cfg.provider === "gemini") {
          result = await completeGroq(call.stage, prompt.content, user);
        } else {
          throw new Error(`${call.stage}:${cfg.provider}:${detail}`);
        }
      }
      const rateIn = cfg.provider === "gemini" ? geminiInputUsdPerMillion() : groqInputUsdPerMillion();
      const rateOut = cfg.provider === "gemini" ? geminiOutputUsdPerMillion() : groqOutputUsdPerMillion();
      const costUsd = (result.inTok * rateIn + result.outTok * rateOut) / 1_000_000;
      let json = coerceStageJson(call.stage, parseJsonObject(result.text));
      if (call.stage === "planner") {
        const wrap = asRecord(json);
        const lessons = Array.isArray(wrap?.lessons) ? wrap.lessons : [];
        const spec = asRecord(call.blocks.LEARNER_SPEC);
        const topic = clip(spec?.topic, 80, "the topic");
        if (!lessons.length) {
          json = {
            lessons: [{
              id: "L1",
              title: clip(topic, 120, "Lesson") || "Lesson",
              objectives: [
                { id: "O1", text: `Explain the working mechanism for ${topic}.` },
                { id: "O2", text: `Apply a numeric check for ${topic}.` },
              ],
              key_concepts: topic.split(/\s+/).filter((word) => word.length > 1).slice(0, 6),
              prerequisites: [],
              est_minutes: 12,
            }],
          };
        }
      }
      if (call.stage === "extractor") {
        const wrap = asRecord(json);
        const cards = Array.isArray(wrap?.cards) ? wrap.cards : [];
        const chunks = (call.blocks.CHUNKS as Array<{ chunk_id?: string; source_id?: string; text?: string }> | undefined) || [];
        if (!cards.length && chunks.length) {
          json = {
            cards: chunks.slice(0, 4).map((chunk, index) => ({
              id: `E${index + 1}`,
              claim: clip(chunk.text, 500, "Source claim."),
              source_id: clip(chunk.source_id, 80, "S1"),
              chunk_id: clip(chunk.chunk_id, 80, "C1"),
            })),
          };
        }
      }
      if (call.stage === "quiz") {
        const wrap = asRecord(json);
        const items = Array.isArray(wrap?.items) ? wrap.items : [];
        if (!items.length) {
          const spec = asRecord(call.blocks.LESSON_SPEC);
          const title = clip(spec?.title, 80, "this lesson") || "this lesson";
          json = {
            items: [{
              question: `Which statement matches ${title}?`,
              options: ["The cited claim", "An unrelated guess", "A contradiction", "Skip the check"],
              correctIndex: 0,
              explanation: "The cited evidence supports the first option.",
              objective_id: "O1",
              evidence_ids: ["E1"],
            }],
          };
        }
      }
      return {
        json,
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
