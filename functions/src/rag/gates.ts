import { GATE_CONFIG } from "./config";
import { jaccard, sharedHashedCount, verbatimRuns, wordShingles } from "./shingles";
import type { EvidenceCard, LessonDraft, SyllabusLesson, Verdict } from "./schemas";

export type GateResult = {
  name: string;
  passed: boolean;
  detail: string;
};

export type GateInput = {
  lesson: LessonDraft;
  spec: SyllabusLesson;
  cards: EvidenceCard[];
  sourceTexts: Array<{ chunk_id: string; text: string }>;
  leakHashes: Set<string>;
  verdict: Verdict;
  writerInputTokens: number;
  writerBudget: number;
  sectionFocus?: number[];
};

function lessonPlainText(lesson: LessonDraft): string {
  const takeaways = lesson.takeaways.map((item) => item.text).join(" ");
  return `${lesson.title}\n${lesson.sections.map((section) => `${section.heading}\n${section.body_markdown}`).join("\n")}\n${takeaways}`;
}

function citationIds(lesson: LessonDraft): string[] {
  return [
    ...lesson.sections.flatMap((section) => section.citations),
    ...lesson.takeaways.flatMap((item) => item.citations),
  ];
}

export function runCodeGates(input: GateInput): GateResult[] {
  const text = lessonPlainText(input.lesson);
  const results: GateResult[] = [];

  const copyHits: string[] = [];
  for (const source of input.sourceTexts) {
    const runs = verbatimRuns(text, source.text, GATE_CONFIG.minVerbatimRunWords)
      .filter((run) => run.split(" ").length > GATE_CONFIG.maxAllowedQuoteWords || !/\[[E0-9]+\]/.test(text));
    const allowedQuote = input.lesson.sections.some((section) => {
      const quoted = section.body_markdown.match(/"([^"]{1,80})"/);
      return quoted?.[1] && quoted[1].split(/\s+/).length <= GATE_CONFIG.maxAllowedQuoteWords && section.body_markdown.includes(quoted[1]);
    });
    if (runs.length && !allowedQuote) copyHits.push(`${source.chunk_id}:${runs[0]}`);
    const overlap = jaccard(text, source.text, 5);
    if (overlap >= GATE_CONFIG.maxFiveGramOverlapRatio) copyHits.push(`${source.chunk_id}:overlap=${overlap.toFixed(2)}`);
  }
  results.push({
    name: "source_copying",
    passed: copyHits.length === 0,
    detail: copyHits[0] || "no 8-word run or 5-gram overlap over 10%",
  });

  const leakHits = sharedHashedCount(text, 4, input.leakHashes);
  const leakPhrase = GATE_CONFIG.leakPhrases.find((phrase) => text.toLowerCase().includes(phrase));
  results.push({
    name: "prompt_leakage",
    passed: leakHits === 0 && !leakPhrase,
    detail: leakPhrase ? `phrase:${leakPhrase}` : leakHits ? `${leakHits} hashed 4-grams` : "clean",
  });

  const cardIds = new Set(input.cards.map((card) => card.id));
  const supportedIds = new Set(
    input.verdict.claims.filter((claim) => claim.verdict === "SUPPORTED").flatMap((claim) => claim.evidence_ids),
  );
  const allCitations = citationIds(input.lesson);
  const unresolved = allCitations.filter((id) => !cardIds.has(id));
  const unexplained = input.lesson.sections.filter((section) => section.kind === "explanation" && section.citations.length < 1);
  const unsupportedCite = allCitations.filter((id) => supportedIds.size > 0 && !supportedIds.has(id) && cardIds.has(id));
  results.push({
    name: "citations",
    passed: unresolved.length === 0 && unexplained.length === 0,
    detail: unresolved[0] ? `unresolved:${unresolved[0]}` : unexplained.length ? "explanation missing citation" : unsupportedCite.length ? `unsupported-cite:${unsupportedCite[0]}` : "resolved",
  });

  const bad = input.verdict.claims.filter((claim) => claim.verdict !== "SUPPORTED");
  const scores = Object.values(input.verdict.scores);
  const scoresOk = scores.every((score) => score >= GATE_CONFIG.minScore);
  results.push({
    name: "grounding",
    passed: bad.length === 0 && scoresOk,
    detail: bad[0] ? `${bad[0].verdict}` : scoresOk ? "all scores ≥ 4" : "score below 4",
  });

  const weakFocus = (input.sectionFocus || []).filter((score) => score < GATE_CONFIG.minFocusSimilarity);
  results.push({
    name: "focus",
    passed: weakFocus.length === 0,
    detail: weakFocus.length ? `${weakFocus.length} sections below floor` : "on-objective",
  });

  const filler = GATE_CONFIG.fillerPhrases.find((phrase) => text.toLowerCase().includes(phrase));
  results.push({
    name: "filler",
    passed: !filler,
    detail: filler || "no banned filler",
  });

  const words = wordShingles(text, 1).length;
  const min = Math.max(40, input.spec.est_minutes * GATE_CONFIG.minWordsPerMinute);
  const max = Math.max(min + 40, input.spec.est_minutes * GATE_CONFIG.maxWordsPerMinute);
  results.push({
    name: "length",
    passed: words >= min && words <= max,
    detail: `${words} words for ${input.spec.est_minutes} min`,
  });

  results.push({
    name: "budget",
    passed: input.writerInputTokens <= input.writerBudget,
    detail: `${input.writerInputTokens}/${input.writerBudget} tokens`,
  });

  return results;
}

export function gatesPassed(results: GateResult[]): boolean {
  return results.every((result) => result.passed);
}

export function gateFixList(results: GateResult[]): string[] {
  return results.filter((result) => !result.passed).map((result) => `${result.name}: ${result.detail}`);
}
