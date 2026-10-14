import { GATE_CONFIG, estimateTokens, stageConfig } from "./config";
import { gateFixList, gatesPassed, runCodeGates, type GateResult } from "./gates";
import type { JsonProvider, ProviderResult } from "./providers";
import {
  evidenceCardsSchema,
  learnerSpecSchema,
  lessonSchema,
  quizSchema,
  syllabusSchema,
  verdictSchema,
  type EvidenceCard,
  type LearnerSpec,
  type LessonDraft,
  type LessonStatus,
  type QuizItem,
  type SyllabusLesson,
  type Verdict,
} from "./schemas";
import { specFromLearnerText } from "./intake";
import { hashedShingleSet, jaccard } from "./shingles";
import { redactDeep, redactPii } from "./redact";
import { buildRetrievalQuery, selectEvidenceChunks, type RetrievedSourceChunk } from "./retrieve";

export type RagRetrieve = (query: string, concepts: string[]) => Promise<RetrievedSourceChunk[]>;
export type ArtifactSaver = (row: {
  run_id: string;
  owner_uid: string;
  lesson_id: string | null;
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
  status: string;
}) => Promise<void>;

export type RagDeps = {
  provider: JsonProvider;
  retrieve: RagRetrieve;
  ownerUid?: string;
  runId?: string;
  saveArtifact?: ArtifactSaver;
  reserveUsd?: (estimate: number) => Promise<void>;
  settleUsd?: (actual: number) => Promise<void>;
};

export type RagLessonResult = {
  id: string;
  title: string;
  status: LessonStatus;
  lesson: LessonDraft | null;
  quiz: QuizItem[];
  gaps: string[];
  missingConcepts: string[];
  gateResults: GateResult[];
  verdict: Verdict | null;
};

export type RagCourseResult = {
  runId: string;
  spec: LearnerSpec;
  lessons: RagLessonResult[];
  costUsd: number;
  publishable: boolean;
  summary: { ready: number; needs_review: number; blocked: number };
  paidStages: string[];
  ingestionRequested: boolean;
  coercionRepairs: string[];
  coercionRate: number;
};

async function record(
  deps: RagDeps,
  runId: string,
  owner: string,
  lessonId: string | null,
  stage: string,
  call: ProviderResult | null,
  output: unknown,
  status: string,
  gates: unknown = null,
): Promise<void> {
  if (!deps.saveArtifact) return;
  await deps.saveArtifact({
    run_id: runId,
    owner_uid: owner,
    lesson_id: lessonId,
    stage,
    prompt_name: call?.promptName ?? null,
    prompt_hash: call?.promptHash ?? null,
    model_id: call?.model ?? null,
    tokens_in: call?.tokensIn ?? null,
    tokens_out: call?.tokensOut ?? null,
    latency_ms: call?.latencyMs ?? null,
    cost_usd: call?.costUsd ?? null,
    output: redactDeep(output),
    gate_results: redactDeep(gates),
    status,
  });
}

function sectionFocusScores(lesson: LessonDraft, spec: SyllabusLesson): number[] {
  const targets = [...spec.objectives.map((item) => item.text), ...spec.key_concepts];
  return lesson.sections.map((section) => {
    const blob = `${section.heading} ${section.body_markdown}`;
    const blobNorm = blob.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const hit = spec.key_concepts.some((concept) => blobNorm.includes(concept.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 12)));
    if (hit) return 1;
    return Math.max(0, ...targets.map((target) => jaccard(blob, target, 1)));
  });
}

function supportedClaims(verdict: Verdict): Array<{ text: string; evidence_ids: string[] }> {
  return verdict.claims
    .filter((claim) => claim.verdict === "SUPPORTED")
    .map((claim) => ({ text: claim.text, evidence_ids: claim.evidence_ids }));
}

export async function runRagCourse(rawText: string, deps: RagDeps): Promise<RagCourseResult> {
  const runId = deps.runId || globalThis.crypto.randomUUID();
  const owner = deps.ownerUid || "local";
  const safeText = redactPii(rawText);
  const leakHashes = hashedShingleSet(safeText, 4);
  let spent = 0;
  const paidStages: string[] = [];
  const coercionRepairs: string[] = [];
  let stageCalls = 0;
  const bill = async (cost: number, stage: string, repairs: string[] = []) => {
    spent += cost;
    paidStages.push(stage);
    stageCalls += 1;
    coercionRepairs.push(...repairs);
    if (deps.settleUsd && cost > 0) await deps.settleUsd(cost);
  };
  const emptyMeta = { coercionRepairs: [] as string[], coercionRate: 0 };

  const local = specFromLearnerText(rawText);
  let spec = local.spec;
  if (local.skipModel) {
    await record(deps, runId, owner, null, "intake", null, spec, spec.status);
    return {
      runId,
      spec,
      lessons: [],
      costUsd: 0,
      publishable: false,
      summary: { ready: 0, needs_review: 0, blocked: 0 },
      paidStages,
      ingestionRequested: false,
      ...emptyMeta,
    };
  }

  if (deps.reserveUsd) await deps.reserveUsd(0.12);

  const intakeCall = await deps.provider.complete({
    stage: "intake",
    blocks: { LEARNER_TEXT: { text: safeText.slice(0, 8000) } },
  });
  await bill(intakeCall.costUsd, "intake", intakeCall.repairs);
  spec = learnerSpecSchema.parse(intakeCall.json);
  if (local.spec.status !== "ok") spec = local.spec;
  else {
    if (!spec.ignored_requests.length && local.spec.ignored_requests.length) {
      spec = { ...spec, ignored_requests: local.spec.ignored_requests };
    }
    if (!spec.constraints.length && local.spec.constraints.length) {
      spec = { ...spec, constraints: local.spec.constraints };
    }
  }
  spec = learnerSpecSchema.parse(spec);
  await record(deps, runId, owner, null, "intake", { ...intakeCall, json: spec }, spec, spec.status);
  if (spec.status !== "ok") {
    return {
      runId,
      spec,
      lessons: [],
      costUsd: spent,
      publishable: false,
      summary: { ready: 0, needs_review: 0, blocked: 0 },
      paidStages,
      ingestionRequested: false,
      coercionRepairs,
      coercionRate: stageCalls ? coercionRepairs.length / stageCalls : 0,
    };
  }

  const planCall = await deps.provider.complete({ stage: "planner", blocks: { LEARNER_SPEC: spec } });
  await bill(planCall.costUsd, "planner", planCall.repairs);
  const syllabus = syllabusSchema.parse(planCall.json);
  await record(deps, runId, owner, null, "planner", planCall, { lessonIds: syllabus.lessons.map((item) => item.id) }, "ok");

  const lessons: RagLessonResult[] = [];
  for (const item of syllabus.lessons) {
    try {
      lessons.push(await runLesson(item, spec, leakHashes, deps, runId, owner, bill));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "lesson_failed";
      if (detail.includes("schema_invalid") || detail.includes("input_budget_exceeded")) throw error;
      lessons.push({
        id: item.id,
        title: item.title,
        status: "needs_review",
        lesson: null,
        quiz: [],
        gaps: [detail.slice(0, 240)],
        missingConcepts: [],
        gateResults: [],
        verdict: null,
      });
    }
  }

  const ready = lessons.filter((item) => item.status === "ready").length;
  const needsReview = lessons.filter((item) => item.status === "needs_review").length;
  const blocked = lessons.filter((item) => item.status === "blocked").length;
  const everyObjectiveCovered = syllabus.lessons.every((specLesson) => {
    const produced = lessons.find((item) => item.id === specLesson.id);
    if (!produced?.lesson || produced.status === "blocked") return false;
    return specLesson.objectives.every((objective) => produced.lesson?.objectives_covered.includes(objective.id)
      && produced.quiz.some((quiz) => quiz.objective_id === objective.id));
  });
  const publishable = blocked === 0 && needsReview === 0 && ready === syllabus.lessons.length && everyObjectiveCovered;

  const coercionRate = stageCalls ? coercionRepairs.length / stageCalls : 0;
  await record(deps, runId, owner, null, "assemble", null, {
    ready, needs_review: needsReview, blocked, publishable,
    coercion_rate: coercionRate,
    repairs: coercionRepairs,
  }, publishable ? "ready" : "needs_review");

  return {
    runId,
    spec,
    lessons,
    costUsd: spent,
    publishable,
    summary: { ready, needs_review: needsReview, blocked },
    paidStages,
    ingestionRequested: lessons.some((item) => item.status === "blocked" && item.missingConcepts.length > 0),
    coercionRepairs,
    coercionRate,
  };
}

async function runLesson(
  spec: SyllabusLesson,
  learner: LearnerSpec,
  leakHashes: Set<string>,
  deps: RagDeps,
  runId: string,
  owner: string,
  bill: (cost: number, stage: string, repairs?: string[]) => Promise<void>,
): Promise<RagLessonResult> {
  const query = buildRetrievalQuery(spec.objectives, spec.key_concepts);
  const rawChunks = await deps.retrieve(query, spec.key_concepts);
  const chunks = selectEvidenceChunks(rawChunks);
  const minChunks = GATE_CONFIG.minEvidencePerObjective * spec.objectives.length;
  if (chunks.length < minChunks) {
    await record(deps, runId, owner, spec.id, "retrieve", null, { chunkCount: chunks.length, minChunks }, "blocked");
    return {
      id: spec.id,
      title: spec.title,
      status: "blocked",
      lesson: null,
      quiz: [],
      gaps: [`Need ${minChunks} evidence chunks, retrieved ${chunks.length}.`],
      missingConcepts: spec.key_concepts,
      gateResults: [],
      verdict: null,
    };
  }

  const extractCall = await deps.provider.complete({
    stage: "extractor",
    blocks: { LESSON_SPEC: spec, CHUNKS: chunks.map((chunk) => ({ chunk_id: chunk.chunk_id, source_id: chunk.source_id, text: chunk.text })) },
  });
  await bill(extractCall.costUsd, "extractor", extractCall.repairs);
  const cardsWrap = evidenceCardsSchema.parse(extractCall.json);
  const cardTokens = estimateTokens(JSON.stringify(cardsWrap.cards));
  if (cardTokens > GATE_CONFIG.extractorTokenBudget) {
    throw new Error(`extractor_budget_exceeded:${cardTokens}/${GATE_CONFIG.extractorTokenBudget}`);
  }
  await record(deps, runId, owner, spec.id, "extractor", extractCall, { cardIds: cardsWrap.cards.map((card) => card.id) }, "ok");

  let draftCall = await deps.provider.complete({
    stage: "writer",
    blocks: { LESSON_SPEC: spec, LEVEL: learner.level, EVIDENCE_CARDS: cardsWrap.cards },
  });
  await bill(draftCall.costUsd, "writer", draftCall.repairs);
  let draft = lessonSchema.parse(draftCall.json);
  await record(deps, runId, owner, spec.id, "writer", draftCall, { title: draft.title, gaps: draft.gaps }, "ok");

  let verdict: Verdict | null = null;
  let gates: GateResult[] = [];
  let loops = 0;
  while (true) {
    try {
      const verifyCall = await deps.provider.complete({
        stage: "verifier",
        blocks: { LESSON_DRAFT: draft, LESSON_SPEC: spec, EVIDENCE_CARDS: cardsWrap.cards },
      });
      await bill(verifyCall.costUsd, "verifier", verifyCall.repairs);
      verdict = verdictSchema.parse(verifyCall.json);
      gates = runCodeGates({
        lesson: draft,
        spec,
        cards: cardsWrap.cards,
        sourceTexts: chunks.map((chunk) => ({ chunk_id: chunk.chunk_id, text: chunk.text })),
        leakHashes,
        verdict,
        writerInputTokens: draftCall.tokensIn,
        writerBudget: stageConfig("writer").inputTokenBudget,
        sectionFocus: sectionFocusScores(draft, spec),
      });
      await record(deps, runId, owner, spec.id, "verify", verifyCall, { scores: verdict.scores }, gatesPassed(gates) ? "ok" : "failed", gates);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "verifier_failed";
      return {
        id: spec.id,
        title: spec.title,
        status: "needs_review",
        lesson: draft,
        quiz: [],
        gaps: [...draft.gaps, detail.slice(0, 160)],
        missingConcepts: [],
        gateResults: gates,
        verdict,
      };
    }
    if (gatesPassed(gates)) break;
    if (loops >= GATE_CONFIG.maxRewriteLoops) {
      await record(deps, runId, owner, spec.id, "gates", null, { gates }, "needs_review");
      break;
    }
    try {
      const rewriteCall = await deps.provider.complete({
        stage: "rewriter",
        blocks: {
          LESSON_DRAFT: draft,
          LESSON_SPEC: spec,
          EVIDENCE_CARDS: cardsWrap.cards,
          FIX_LIST: [...(verdict?.fix_list || []), ...gateFixList(gates)],
        },
      });
      await bill(rewriteCall.costUsd, "rewriter", rewriteCall.repairs);
      draft = lessonSchema.parse(rewriteCall.json);
      draftCall = rewriteCall;
      loops += 1;
      await record(deps, runId, owner, spec.id, "rewriter", rewriteCall, { loop: loops }, "ok");
    } catch {
      await record(deps, runId, owner, spec.id, "gates", null, { gates }, "needs_review");
      return {
        id: spec.id,
        title: spec.title,
        status: "needs_review",
        lesson: draft,
        quiz: [],
        gaps: [...draft.gaps, ...gateFixList(gates)],
        missingConcepts: [],
        gateResults: gates,
        verdict,
      };
    }
  }

  if (!verdict) {
    return {
      id: spec.id,
      title: spec.title,
      status: "needs_review",
      lesson: draft,
      quiz: [],
      gaps: [...draft.gaps, "Verifier did not return a verdict."],
      missingConcepts: [],
      gateResults: gates,
      verdict: null,
    };
  }

  const supported = supportedClaims(verdict);
  if (!supported.length) {
    return {
      id: spec.id,
      title: spec.title,
      status: "needs_review",
      lesson: draft,
      quiz: [],
      gaps: ["No SUPPORTED claims for a quiz."],
      missingConcepts: [],
      gateResults: gates,
      verdict,
    };
  }

  let cleanQuiz: QuizItem[] = [];
  try {
    const quizCall = await deps.provider.complete({
      stage: "quiz",
      blocks: { OBJECTIVES: spec.objectives, SUPPORTED_CLAIMS: supported },
    });
    await bill(quizCall.costUsd, "quiz", quizCall.repairs);
    const quiz = quizSchema.parse(quizCall.json);
    const cardIds = new Set(cardsWrap.cards.map((card) => card.id));
    cleanQuiz = quiz.items.filter((item) => item.evidence_ids.every((id) => cardIds.has(id)));
    await record(deps, runId, owner, spec.id, "quiz", quizCall, { count: cleanQuiz.length }, "ready");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "quiz_failed";
    return {
      id: spec.id,
      title: spec.title,
      status: "needs_review",
      lesson: draft,
      quiz: [],
      gaps: [...draft.gaps, detail.slice(0, 160)],
      missingConcepts: [],
      gateResults: gates,
      verdict,
    };
  }
  const cardIds = new Set(cardsWrap.cards.map((card) => card.id));

  const objectiveOk = spec.objectives.every((objective) => draft.objectives_covered.includes(objective.id)
    && cleanQuiz.some((item) => item.objective_id === objective.id));
  const citationsOk = [...draft.sections.flatMap((section) => section.citations), ...draft.takeaways.flatMap((item) => item.citations)]
    .every((id) => cardIds.has(id));

  const status: LessonStatus = gatesPassed(gates) && objectiveOk && citationsOk ? "ready" : "needs_review";
  return {
    id: spec.id,
    title: spec.title,
    status,
    lesson: draft,
    quiz: cleanQuiz,
    gaps: [...draft.gaps, ...(gatesPassed(gates) ? [] : gateFixList(gates))],
    missingConcepts: [],
    gateResults: gates,
    verdict,
  };
}

/** Firestore/module adapter — no UI change. */
export function toLegacyModule(result: RagLessonResult): {
  title: string;
  summary: string;
  lessons: Array<{ heading: string; text: string }>;
  quiz: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }>;
  generationQuality: "generated" | "blocked" | "needs_review";
  gaps: string[];
} {
  if (!result.lesson) {
    return {
      title: result.title,
      summary: result.gaps[0] || "Blocked: not enough evidence.",
      lessons: [],
      quiz: [],
      generationQuality: "blocked",
      gaps: result.gaps,
    };
  }
  return {
    title: result.lesson.title,
    summary: result.lesson.takeaways.map((item) => item.text).join(" "),
    lessons: result.lesson.sections.map((section) => ({ heading: section.heading, text: section.body_markdown })),
    quiz: result.quiz.map((item) => ({
      question: item.question,
      options: item.options,
      correctIndex: item.correctIndex,
      explanation: item.explanation,
    })),
    generationQuality: result.status === "ready" ? "generated" : result.status,
    gaps: result.gaps,
  };
}
