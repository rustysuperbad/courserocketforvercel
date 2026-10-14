import { readEnv } from "../env";

export type StageName =
  | "intake"
  | "planner"
  | "research_queries"
  | "extractor"
  | "writer"
  | "verifier"
  | "rewriter"
  | "quiz";

function envString(name: string, fallback: string): string {
  return readEnv(name, fallback) || fallback;
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

export function fakeProvidersEnabled(): boolean {
  return envBool("COURSE_AI_FAKE", false);
}

export function groqModel(): string {
  return envString("GROQ_MODEL", "qwen/qwen3.8-27b");
}

export function geminiModel(): string {
  return envString("GEMINI_MODEL", "gemini-3.8-flash");
}

export function embeddingModel(): string {
  return envString("EMBEDDING_MODEL", "gemini-embedding-001");
}

export function verifierSameAsWriter(): boolean {
  return envBool("VERIFIER_SAME_AS_WRITER", false);
}

export function searchProvider(): "tavily" | "brave" {
  return envString("SEARCH_PROVIDER", "tavily") === "brave" ? "brave" : "tavily";
}

export type StageModelConfig = {
  provider: "groq" | "gemini";
  model: string;
  mode: "instruct" | "thinking";
  reasoningEffort: string;
  temperature: number;
  topP: number | null;
  maxOutputTokens: number;
  inputTokenBudget: number;
  timeoutMs: number;
};

export function stageConfig(stage: StageName): StageModelConfig {
  if (stage === "planner") {
    return {
      provider: "groq",
      model: groqModel(),
      mode: "thinking",
      reasoningEffort: "default",
      temperature: 1,
      topP: null,
      maxOutputTokens: 4000,
      inputTokenBudget: 4000,
      timeoutMs: 70000,
    };
  }
  if (stage === "verifier" && !verifierSameAsWriter()) {
    return {
      provider: "gemini",
      model: geminiModel(),
      mode: "instruct",
      reasoningEffort: "0",
      temperature: 0,
      topP: null,
      maxOutputTokens: 4000,
      inputTokenBudget: 8000,
      timeoutMs: 45000,
    };
  }
  const output = stage === "writer" || stage === "rewriter" ? 8000 : stage === "extractor" ? 4000 : 2500;
  return {
    provider: "groq",
    model: groqModel(),
    mode: "instruct",
    reasoningEffort: "none",
    temperature: 0.2,
    topP: null,
    maxOutputTokens: output,
    inputTokenBudget: stage === "extractor" ? 8000 : 5000,
    timeoutMs: 70000,
  };
}

export const PIPELINE_CONFIG = {
  groqInputUsdPerMillion: envNumber("GROQ_INPUT_USD_PER_MILLION", 0.8),
  groqOutputUsdPerMillion: envNumber("GROQ_OUTPUT_USD_PER_MILLION", 4),
  geminiInputUsdPerMillion: envNumber("GEMINI_INPUT_USD_PER_MILLION", 0.75),
  geminiOutputUsdPerMillion: envNumber("GEMINI_OUTPUT_USD_PER_MILLION", 3.75),
  embeddingUsdPerMillion: envNumber("EMBEDDING_USD_PER_MILLION", 0.15),
  maxLessons: envNumber("V3_MAX_LESSONS", 3),
  lessonConcurrency: envNumber("V3_LESSON_CONCURRENCY", 2),
  minEvidence: envNumber("MIN_EVIDENCE", 2),
  minSources: envNumber("MIN_SOURCES", 2),
  maxResearchRounds: envNumber("MAX_RESEARCH_ROUNDS", 2),
  extractorTokenBudget: envNumber("EXTRACTOR_TOKEN_BUDGET", 1800),
  maxRewriteLoops: envNumber("MAX_REWRITE_LOOPS", 2),
  retrieveTopK: envNumber("RETRIEVE_TOP_K", 8),
  relevanceFloor: envNumber("RELEVANCE_FLOOR", 0.12),
  embeddingDimensions: envNumber("EMBEDDING_DIMENSIONS", 32),
  fetchTimeoutMs: envNumber("FETCH_TIMEOUT_MS", 8000),
  fetchMaxBytes: envNumber("FETCH_MAX_BYTES", 400_000),
  maxRedirects: envNumber("FETCH_MAX_REDIRECTS", 3),
  perDomainRateMs: envNumber("PER_DOMAIN_RATE_MS", 400),
  runBudgetUsd: envNumber("V3_RUN_BUDGET_USD", 0.4),
  reserveUsd: envNumber("V3_RESERVE_USD", 0.2),
  dailyUserLimit: envNumber("DAILY_COURSE_RUN_LIMIT", 3),
  projectDailySpendUsd: envNumber("PROJECT_DAILY_SPEND_LIMIT_USD", 25),
};

export const GATE_CONFIG = {
  minVerbatimRunWords: 8,
  maxAllowedQuoteWords: 14,
  maxFiveGramOverlapRatio: 0.1,
  minScore: 4,
  minFocusSimilarity: 0.2,
  minWordsPerMinute: 5,
  maxWordsPerMinute: 220,
  leakPhrases: ["you asked", "your request", "as requested", "the prompt", "your goal"],
  fillerPhrases: [
    "in today's fast-paced world",
    "let's dive in",
    "delve",
    "unlock your potential",
    "in conclusion",
    "it's important to note",
  ],
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}
