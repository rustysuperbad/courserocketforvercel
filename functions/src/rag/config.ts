/**
 * Single source of truth for RAG stage models, sampling, token budgets, and
 * code-gate thresholds. Do not hardcode these values in callers.
 */
import { readEnv } from "../env";

export type ReasoningMode = "instruct" | "thinking";
export type StageName =
  | "intake"
  | "planner"
  | "extractor"
  | "writer"
  | "verifier"
  | "rewriter"
  | "quiz";

export type StageModelConfig = {
  provider: "groq" | "gemini";
  model: string;
  mode: ReasoningMode;
  /** Groq: none | default | low | medium | high. Gemini 2.5: thinkingBudget. */
  reasoningEffort: string;
  temperature: number;
  topP: number | null;
  maxOutputTokens: number;
  inputTokenBudget: number;
  timeoutMs: number;
};

function envString(name: string, fallback: string): string {
  const value = readEnv(name, fallback);
  return value || fallback;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(readEnv(name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback = false): boolean {
  const raw = readEnv(name, fallback ? "true" : "false").toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

export function groqWriterModel(): string {
  return envString("GROQ_MODEL", "qwen/qwen3.8-27b");
}

export function geminiVerifierModel(): string {
  return envString("GEMINI_MODEL", "gemini-3.8-flash");
}

export function verifierSameAsWriter(): boolean {
  return envBool("VERIFIER_SAME_AS_WRITER", true);
}

export function fakeProvidersEnabled(): boolean {
  return envBool("COURSE_AI_FAKE", false);
}

export function groqInputUsdPerMillion(): number {
  return envNumber("GROQ_INPUT_USD_PER_MILLION", 0.8);
}

export function groqOutputUsdPerMillion(): number {
  return envNumber("GROQ_OUTPUT_USD_PER_MILLION", 4);
}

export function geminiInputUsdPerMillion(): number {
  return envNumber("GEMINI_INPUT_USD_PER_MILLION", 0.75);
}

export function geminiOutputUsdPerMillion(): number {
  return envNumber("GEMINI_OUTPUT_USD_PER_MILLION", 3.75);
}

function groqInstruct(maxOutputTokens: number, inputTokenBudget: number, timeoutMs: number): StageModelConfig {
  return {
    provider: "groq",
    model: groqWriterModel(),
    mode: "instruct",
    reasoningEffort: "none",
    temperature: 0.2,
    topP: null,
    maxOutputTokens,
    inputTokenBudget,
    timeoutMs,
  };
}

function groqThinking(maxOutputTokens: number, inputTokenBudget: number, timeoutMs: number): StageModelConfig {
  return {
    provider: "groq",
    model: groqWriterModel(),
    mode: "thinking",
    reasoningEffort: "default",
    temperature: 1,
    topP: null,
    maxOutputTokens,
    inputTokenBudget,
    timeoutMs,
  };
}

export function stageConfig(stage: StageName): StageModelConfig {
  if (stage === "planner") return groqThinking(4000, 4000, 70000);
  if (stage === "intake") return groqInstruct(1200, 2500, 45000);
  if (stage === "extractor") return groqInstruct(4000, 8000, 70000);
  if (stage === "writer" || stage === "rewriter") return groqInstruct(8000, 6000, 90000);
  if (stage === "quiz") return groqInstruct(3000, 4000, 60000);
  if (verifierSameAsWriter()) return groqInstruct(4000, 7000, 80000);
  return {
    provider: "gemini",
    model: geminiVerifierModel(),
    mode: "instruct",
    reasoningEffort: "0",
    temperature: 0,
    topP: null,
    maxOutputTokens: 4000,
    inputTokenBudget: 8000,
    timeoutMs: 20000,
  };
}

export const GATE_CONFIG = {
  minVerbatimRunWords: 8,
  maxAllowedQuoteWords: 14,
  maxFiveGramOverlapRatio: 0.1,
  minScore: 4,
  minFocusSimilarity: 0.2,
  minWordsPerMinute: 5,
  maxWordsPerMinute: 220,
  minEvidencePerObjective: envNumber("MIN_EVIDENCE_PER_OBJECTIVE", 2),
  retrieveTopK: envNumber("RAG_RETRIEVE_TOP_K", 8),
  retrieveCandidatePool: envNumber("RAG_RETRIEVE_CANDIDATE_POOL", 24),
  maxChunksPerSource: envNumber("RAG_MAX_CHUNKS_PER_SOURCE", 2),
  relevanceFloor: envNumber("RAG_RELEVANCE_FLOOR", 0.12),
  nearDuplicateJaccard: 0.86,
  extractorTokenBudget: envNumber("RAG_EXTRACTOR_TOKEN_BUDGET", 1800),
  maxRewriteLoops: 0,
  skipPaidVerifier: envBool("RAG_SKIP_VERIFIER", true),
  fillerPhrases: [
    "in today's fast-paced world",
    "let's dive in",
    "lets dive in",
    "delve",
    "unlock your potential",
    "in conclusion",
    "it's important to note",
    "it is important to note",
    "without further ado",
    "at the end of the day",
    "game-changer",
    "game changer",
  ],
  leakPhrases: [
    "you asked",
    "your request",
    "as requested",
    "the prompt",
    "your goal",
    "the learner asked",
    "the user wants",
  ],
} as const;

export function estimateTokens(text: string): number {
  return Math.ceil(String(text || "").length / 4);
}
