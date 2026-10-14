import { PIPELINE_CONFIG, estimateTokens, fakeProvidersEnabled, stageConfig } from "./config";
import { gateFixList, gatesPassed, runCodeGates, type GateResult } from "./gates";
import { LEARNER_MESSAGES, mergeModelSpec, preprocessLearnerText, specFromLearnerText } from "./intake";
import { createConfiguredEmbedder, createConfiguredProvider, type JsonProvider, type ProviderResult } from "./models";
import { MemoryQuota, type QuotaLedger } from "./quota";
import {
  createFakeFetch,
  createFakeSearch,
  createLiveSearch,
  screenAndFetch,
  type FetchedPage,
  type SearchProvider,
} from "./research/discover";
import { fetchPublicHttps } from "./research/ssrf";
import { embedChunks, fakeEmbed, rankForObjective, type EmbedFn, type EmbeddedChunk } from "./research/retrieve";
import type { EvidenceCard, LearnerSpec, LessonDraft, QuizItem, Syllabus, SyllabusLesson, Verdict } from "./schemas";
import { containsRawLearner, cosine, redactSecrets } from "./text";

export const INSUFFICIENT_MESSAGE = LEARNER_MESSAGES.insufficient;
export const PROVIDER_MESSAGE = LEARNER_MESSAGES.provider;

export type ProgressEvent = {
  stage: string;
  percent: number;
  lessonId?: string;
  note?: string;
};

export type ArtifactRow = {
  stage: string;
  prompt_name: string | null;
  prompt_hash: string | null;
  model_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  output: unknown;
  gate_results: unknown;
};

export type PipelineDeps = {
  provider?: JsonProvider;
  search?: SearchProvider;
  fetch?: (url: string) => Promise<{ url: string; body: string; status: number }>;
  embed?: EmbedFn;
  quota?: QuotaLedger;
  now?: () => Date;
  onProgress?: (event: ProgressEvent) => Promise<void> | void;
  saveArtifact?: (row: ArtifactRow) => Promise<void>;
  ownerUid?: string;
  runId?: string;
};

export type LessonResult = {
  id: string;
  title: string;
  status: "ready" | "needs_review" | "blocked";
  lesson: LessonDraft | null;
  quiz: QuizItem[];
  gaps: string[];
  gateResults: GateResult[];
  verdict: Verdict | null;
  sources: Array<{ url: string; title: string; tier: number; access_date: string }>;
  cards: EvidenceCard[];
  researchRounds: number;
};

export type CourseResult = {
  runId: string;
  spec: LearnerSpec;
  learnerMessage: string | null;
  lessons: LessonResult[];
  costUsd: number;
  publishable: boolean;
  summary: { ready: number; needs_review: number; blocked: number };
  coercionRepairs: string[];
  artifacts: ArtifactRow[];
  course: PublicCourse | null;
};

export type PublicCourse = {
  title: string;
  goal: string;
  level: string;
  modules: Array<{
    id: string;
    title: string;
    summary: string;
    lessons: Array<{ heading: string; text: string }>;
    quiz: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }>;
    concepts: string[];
    youtubeQueries: string[];
    paperTopics: string[];
    generationQuality: string;
    gaps: string[];
    status: string;
  }>;
};

async function liveFetch(url: string): Promise<{ url: string; body: string; status: number }> {
  const page = await fetchPublicHttps(url, {
    timeoutMs: PIPELINE_CONFIG.fetchTimeoutMs,
    maxBytes: PIPELINE_CONFIG.fetchMaxBytes,
    maxRedirects: PIPELINE_CONFIG.maxRedirects,
  });
  return { url: page.url, body: page.body, status: page.status };
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() || `run_${Date.now()}`;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function assertNoLeak(payload: unknown, raw: string, where: string) {
  const dumped = redactSecrets(JSON.stringify(payload));
  if (raw && containsRawLearner(dumped, raw)) {
    throw new Error(`raw_learner_leak:${where}`);
  }
}

export async function runCourse(text: string, deps: PipelineDeps = {}): Promise<CourseResult> {
  const runId = deps.runId || newId();
  const provider = deps.provider || createConfiguredProvider();
  const search = deps.search || (fakeProvidersEnabled() ? createFakeSearch() : createLiveSearch());
  const fetchFn = deps.fetch || (fakeProvidersEnabled() ? createFakeFetch() : liveFetch);
  const embed = deps.embed || createConfiguredEmbedder();
  const quota = deps.quota || new MemoryQuota();
  const artifacts: ArtifactRow[] = [];
  const repairs: string[] = [];
  let costUsd = 0;
  const pre = preprocessLearnerText(text);
  const leakBase = specFromLearnerText(text);
  const leakHashes = leakBase.leakHashes;

  const save = async (row: ArtifactRow) => {
    assertNoLeak(row, pre.text, row.stage);
    artifacts.push(row);
    await deps.saveArtifact?.(row);
  };

  const progress = async (stage: string, percent: number, lessonId?: string, note?: string) => {
    await deps.onProgress?.({ stage, percent, lessonId, note });
  };

  const call = async (stage: Parameters<JsonProvider["complete"]>[0], blocks: Record<string, unknown>) => {
    await quota.reserve(PIPELINE_CONFIG.reserveUsd);
    try {
      const result: ProviderResult = await provider.complete(stage, blocks);
      costUsd += result.costUsd;
      repairs.push(...result.repairs);
      await quota.settle(result.costUsd);
      await save({
        stage,
        prompt_name: result.promptName,
        prompt_hash: result.promptHash,
        model_id: result.model,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        latency_ms: result.latencyMs,
        cost_usd: result.costUsd,
        output: result.json,
        gate_results: null,
      });
      return result;
    } catch (error) {
      await quota.release();
      throw error;
    }
  };

  await progress("intake", 4);
  let spec: LearnerSpec;
  if (leakBase.skippedModel) {
    spec = leakBase.spec;
    await save({
      stage: "intake",
      prompt_name: null,
      prompt_hash: null,
      model_id: null,
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: 0,
      cost_usd: 0,
      output: spec,
      gate_results: null,
    });
  } else {
    const modeled = await call("intake", { LEARNER_TEXT: { text: pre.text } });
    spec = mergeModelSpec(text, modeled.json).spec;
  }

  if (spec.status === "needs_clarification") {
    return done(runId, spec, spec.question || LEARNER_MESSAGES.clarification, [], costUsd, repairs, artifacts);
  }
  if (spec.status === "rejected") {
    return done(runId, spec, spec.question || LEARNER_MESSAGES.rejected, [], costUsd, repairs, artifacts);
  }

  await progress("plan", 12);
  const planned = await call("planner", { LEARNER_SPEC: spec });
  const syllabus = planned.json as Syllabus;
  const lessons = syllabus.lessons.slice(0, PIPELINE_CONFIG.maxLessons);

  const blockedPrereq = new Set<string>();
  const lessonResults: LessonResult[] = [];

  for (const lesson of lessons) {
    if (lesson.prerequisites.some((id) => blockedPrereq.has(id))) {
      const blocked: LessonResult = {
        id: lesson.id,
        title: lesson.title,
        status: "blocked",
        lesson: null,
        quiz: [],
        gaps: ["prerequisite_blocked"],
        gateResults: [],
        verdict: null,
        sources: [],
        cards: [],
        researchRounds: 0,
      };
      lessonResults.push(blocked);
      return {
        ...done(runId, spec, INSUFFICIENT_MESSAGE, [...lessonResults], costUsd, repairs, artifacts),
      };
    }
    const built = await buildLesson(lesson, spec, {
      call, search, fetchFn, embed, leakHashes, now: deps.now, save, progress,
    });
    lessonResults.push(built);
    if (built.status === "blocked") blockedPrereq.add(lesson.id);
  }

  const ready = lessonResults.filter((l) => l.status === "ready");
  const allObjectives = lessons.flatMap((l) => l.objectives.map((o) => o.id));
  const covered = new Set(ready.flatMap((l) => (l.lesson?.objectives_covered || [])));
  const quized = new Set(ready.flatMap((l) => l.quiz.map((q) => q.objective_id)));
  const complete = allObjectives.every((id) => covered.has(id) && quized.has(id));
  const publishable = complete && ready.length === lessons.length;

  const course = publishable ? toPublicCourse(spec, ready) : (ready.length ? toPublicCourse(spec, ready) : null);
  const learnerMessage = publishable ? null : (ready.length ? null : INSUFFICIENT_MESSAGE);

  await progress("assemble", 100);
  return {
    runId,
    spec,
    learnerMessage,
    lessons: lessonResults,
    costUsd,
    publishable,
    summary: {
      ready: lessonResults.filter((l) => l.status === "ready").length,
      needs_review: lessonResults.filter((l) => l.status === "needs_review").length,
      blocked: lessonResults.filter((l) => l.status === "blocked").length,
    },
    coercionRepairs: repairs,
    artifacts,
    course,
  };
}

function done(
  runId: string,
  spec: LearnerSpec,
  learnerMessage: string | null,
  lessons: LessonResult[],
  costUsd: number,
  repairs: string[],
  artifacts: ArtifactRow[],
): CourseResult {
  return {
    runId,
    spec,
    learnerMessage,
    lessons,
    costUsd,
    publishable: false,
    summary: {
      ready: lessons.filter((l) => l.status === "ready").length,
      needs_review: lessons.filter((l) => l.status === "needs_review").length,
      blocked: lessons.filter((l) => l.status === "blocked").length,
    },
    coercionRepairs: repairs,
    artifacts,
    course: null,
  };
}

async function buildLesson(
  lesson: SyllabusLesson,
  spec: LearnerSpec,
  ctx: {
    call: (stage: Parameters<JsonProvider["complete"]>[0], blocks: Record<string, unknown>) => Promise<ProviderResult>;
    search: SearchProvider;
    fetchFn: (url: string) => Promise<{ url: string; body: string; status: number }>;
    embed: EmbedFn;
    leakHashes: Set<string>;
    now?: () => Date;
    save: (row: ArtifactRow) => Promise<void>;
    progress: (stage: string, percent: number, lessonId?: string, note?: string) => Promise<void>;
  },
): Promise<LessonResult> {
  await ctx.progress("research", 30, lesson.id);
  const accessDate = (ctx.now?.() || new Date()).toISOString().slice(0, 10);
  let pages: FetchedPage[] = [];
  let rounds = 0;
  let lastChunks: EmbeddedChunk[] = [];
  const needles = [...lesson.key_concepts, ...lesson.objectives.map((o) => o.text)];

  while (rounds < PIPELINE_CONFIG.maxResearchRounds) {
    rounds += 1;
    const planned = await ctx.call("research_queries", {
      LESSON_SPEC: { title: lesson.title, objectives: lesson.objectives, key_concepts: lesson.key_concepts },
      ROUND: rounds,
    });
    const queries = (planned.json as { queries: Array<{ text: string; angle: string }> }).queries;
    const hits = [];
    for (const q of queries) {
      if (q.angle === "reference") hits.push(...await ctx.search.papers(q.text));
      else if (q.angle === "video") hits.push(...await ctx.search.videos(q.text));
      else hits.push(...await ctx.search.web(q.text));
    }
    const fetched = await screenAndFetch(hits, needles, ctx.fetchFn, accessDate);
    pages = mergePages(pages, fetched);
    lastChunks = await embedChunks(pages, ctx.embed);
    if (sufficient(lesson, lastChunks, pages)) break;
  }

  const meta = pages.map((p) => ({ url: p.url, title: p.title, tier: p.tier, access_date: p.access_date }));
  if (!sufficient(lesson, lastChunks, pages)) {
    pages.forEach((p) => { p.text = ""; });
    return {
      id: lesson.id, title: lesson.title, status: "blocked", lesson: null, quiz: [],
      gaps: ["insufficient_evidence"], gateResults: [], verdict: null, sources: meta, cards: [], researchRounds: rounds,
    };
  }

  await ctx.progress("compile", 45, lesson.id);
  const top: EmbeddedChunk[] = [];
  for (const obj of lesson.objectives) {
    const [vec] = await ctx.embed([obj.text]);
    top.push(...rankForObjective(obj.text, vec || [], lastChunks));
  }
  const unique = dedupeChunks(top);
  const extractorInput = unique.map((c) => ({ chunk_ref: c.chunk_ref, source_id: c.source_id, text: c.text }));
  const extractorTokens = estimateTokens(JSON.stringify(extractorInput));
  if (extractorTokens > PIPELINE_CONFIG.extractorTokenBudget) {
    throw new Error("extractor_token_budget_exceeded");
  }
  const extracted = await ctx.call("extractor", { LESSON_SPEC: lesson, CHUNKS: extractorInput });
  const cards = (extracted.json as { cards: EvidenceCard[] }).cards;

  await ctx.progress("write", 60, lesson.id);
  const writerBudget = stageConfig("writer").inputTokenBudget;
  const writerBlocks = {
    LESSON_SPEC: lesson,
    LEVEL: spec.level,
    EVIDENCE_CARDS: cards,
  };
  const writerTokens = estimateTokens(JSON.stringify(writerBlocks));
  let draft = (await ctx.call("writer", writerBlocks)).json as LessonDraft;

  let verdict: Verdict | null = null;
  let gates: GateResult[] = [];
  let loops = 0;
  const sourceTexts = unique.map((c) => ({ chunk_ref: c.chunk_ref, text: c.text }));

  while (loops <= PIPELINE_CONFIG.maxRewriteLoops) {
    await ctx.progress("verify", 72, lesson.id);
    verdict = (await ctx.call("verifier", { LESSON_DRAFT: draft, EVIDENCE_CARDS: cards })).json as Verdict;
    const sectionFocus = await focusScores(draft, lesson, ctx.embed);
    gates = runCodeGates({
      lesson: draft,
      spec: lesson,
      cards,
      sourceTexts,
      leakHashes: ctx.leakHashes,
      verdict,
      writerInputTokens: writerTokens,
      writerBudget,
      sectionFocus,
    });
    await ctx.save({
      stage: "gates",
      prompt_name: null,
      prompt_hash: null,
      model_id: null,
      tokens_in: null,
      tokens_out: null,
      latency_ms: null,
      cost_usd: null,
      output: { loop: loops },
      gate_results: gates,
    });
    if (gatesPassed(gates)) break;
    if (loops === PIPELINE_CONFIG.maxRewriteLoops) break;
    loops += 1;
    await ctx.progress("rewrite", 80, lesson.id);
    const fixes = [...(verdict.fix_list || []), ...gateFixList(gates)];
    draft = (await ctx.call("rewriter", {
      DRAFT: draft,
      LESSON_SPEC: lesson,
      EVIDENCE_CARDS: cards,
      FIX_LIST: fixes,
    })).json as LessonDraft;
  }

  pages.forEach((p) => { p.text = ""; });

  if (!gatesPassed(gates) || !verdict) {
    return {
      id: lesson.id, title: lesson.title, status: "blocked", lesson: draft, quiz: [],
      gaps: draft.gaps || ["failed_gates"], gateResults: gates, verdict, sources: meta, cards, researchRounds: rounds,
    };
  }

  await ctx.progress("quiz", 88, lesson.id);
  const supported = verdict.claims.filter((c) => c.verdict === "SUPPORTED");
  const quizJson = (await ctx.call("quiz", {
    OBJECTIVES: lesson.objectives,
    SUPPORTED_CLAIMS: supported,
  })).json as { items: QuizItem[] };
  const quiz = quizJson.items;
  const missingObj = lesson.objectives.filter((o) => !quiz.some((q) => q.objective_id === o.id));
  const status = missingObj.length ? "needs_review" : "ready";
  return {
    id: lesson.id,
    title: lesson.title,
    status,
    lesson: draft,
    quiz,
    gaps: draft.gaps || [],
    gateResults: gates,
    verdict,
    sources: meta,
    cards,
    researchRounds: rounds,
  };
}

function sufficient(lesson: SyllabusLesson, chunks: EmbeddedChunk[], pages: FetchedPage[]): boolean {
  if (pages.length < PIPELINE_CONFIG.minSources) return false;
  for (const obj of lesson.objectives) {
    const hits = chunks.filter((c) => lexicalContains(c.text, obj.text) || lexicalContains(c.text, lesson.key_concepts.join(" ")));
    const sources = new Set(hits.map((c) => c.source_id));
    if (hits.length < PIPELINE_CONFIG.minEvidence || sources.size < PIPELINE_CONFIG.minSources) return false;
  }
  return true;
}

function lexicalContains(text: string, other: string): boolean {
  const needles = other.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const hay = text.toLowerCase();
  return needles.some((n) => hay.includes(n));
}

function mergePages(a: FetchedPage[], b: FetchedPage[]): FetchedPage[] {
  const out = [...a];
  for (const page of b) {
    if (!out.some((p) => p.url === page.url || p.source_id === page.source_id)) out.push(page);
  }
  return out;
}

function dedupeChunks(chunks: EmbeddedChunk[]): EmbeddedChunk[] {
  const seen = new Set<string>();
  const out: EmbeddedChunk[] = [];
  for (const c of chunks) {
    if (seen.has(c.chunk_ref)) continue;
    seen.add(c.chunk_ref);
    out.push(c);
  }
  return out;
}

async function focusScores(draft: LessonDraft, lesson: SyllabusLesson, embed: EmbedFn): Promise<number[]> {
  const objText = lesson.objectives.map((o) => o.text).join(" ");
  const texts = [objText, ...draft.sections.map((s) => s.body_markdown)];
  const vecs = await embed(texts);
  const base = vecs[0] || [];
  return vecs.slice(1).map((v) => cosine(base, v || []));
}

export function toPublicCourse(spec: LearnerSpec, lessons: LessonResult[]): PublicCourse {
  return {
    title: spec.topic,
    goal: spec.goal,
    level: spec.level,
    modules: lessons.filter((l) => l.lesson).map((l, i) => ({
      id: l.id || `module_${i + 1}`,
      title: l.title,
      summary: l.lesson!.takeaways.map((t) => t.text).join(" "),
      lessons: l.lesson!.sections.map((s) => ({ heading: s.heading, text: s.body_markdown })),
      quiz: l.quiz.map((q) => ({
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      })),
      concepts: l.lesson!.objectives_covered,
      youtubeQueries: [l.title],
      paperTopics: [l.title],
      generationQuality: l.status === "ready" ? "generated" : l.status,
      gaps: l.gaps,
      status: l.status,
    })),
  };
}

export function toJobView(result: CourseResult, status: string, stage: string) {
  return {
    jobId: result.runId,
    status,
    stage,
    spec: result.spec,
    learnerMessage: result.learnerMessage,
    perLesson: result.lessons.map((l) => ({ id: l.id, title: l.title, status: l.status })),
    course: result.course,
    publishable: result.publishable,
    summary: result.summary,
    costUsd: result.costUsd,
  };
}

void mapPool;
void fakeEmbed;
