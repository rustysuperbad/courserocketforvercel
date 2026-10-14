import { GATE_CONFIG } from "./config";
import type { EvidenceCard, LessonDraft, SyllabusLesson, Verdict } from "./schemas";
import { fiveGramOverlapRatio, hashedShingles, longestSharedRun, wordTokens } from "./text";

export type GateResult = { name: string; passed: boolean; detail: string };

export type GateInput = {
  lesson: LessonDraft;
  spec: SyllabusLesson;
  cards: EvidenceCard[];
  sourceTexts: Array<{ chunk_ref: string; text: string }>;
  leakHashes: Set<string>;
  verdict: Verdict;
  writerInputTokens: number;
  writerBudget: number;
  sectionFocus?: number[];
};

function lessonText(lesson: LessonDraft): string {
  return [
    lesson.title,
    ...lesson.sections.map((s) => `${s.heading}\n${s.body_markdown}`),
    ...lesson.takeaways.map((t) => t.text),
  ].join("\n");
}

function allCitations(lesson: LessonDraft): string[] {
  return [
    ...lesson.sections.flatMap((s) => s.citations),
    ...lesson.takeaways.flatMap((t) => t.citations),
  ];
}

function markedShortQuote(text: string): boolean {
  const quoted = text.match(/"([^"]{1,90})"/);
  if (!quoted?.[1]) return false;
  return wordTokens(quoted[1]).length <= GATE_CONFIG.maxAllowedQuoteWords;
}

export function runCodeGates(input: GateInput): GateResult[] {
  const text = lessonText(input.lesson);
  const results: GateResult[] = [];

  const copyHits: string[] = [];
  for (const source of input.sourceTexts) {
    const run = longestSharedRun(text, source.text);
    const quoteOk = run <= GATE_CONFIG.maxAllowedQuoteWords && markedShortQuote(text);
    if (run >= GATE_CONFIG.minVerbatimRunWords && !quoteOk) {
      copyHits.push(`${source.chunk_ref}:run=${run}`);
    }
    const overlap = fiveGramOverlapRatio(text, source.text);
    if (overlap >= GATE_CONFIG.maxFiveGramOverlapRatio) {
      copyHits.push(`${source.chunk_ref}:shingles=${overlap.toFixed(2)}`);
    }
  }
  results.push({
    name: "copying",
    passed: copyHits.length === 0,
    detail: copyHits[0] || "clean",
  });

  const draftHashes = hashedShingles(text, 4);
  let leakHits = 0;
  for (const h of draftHashes) if (input.leakHashes.has(h)) leakHits += 1;
  const leakPhrase = GATE_CONFIG.leakPhrases.find((p) => text.toLowerCase().includes(p));
  results.push({
    name: "prompt_leakage",
    passed: leakHits === 0 && !leakPhrase,
    detail: leakPhrase ? `phrase:${leakPhrase}` : leakHits ? `${leakHits} shingles` : "clean",
  });

  const cardIds = new Set(input.cards.map((c) => c.id));
  const cites = allCitations(input.lesson);
  const unresolved = cites.filter((id) => !cardIds.has(id));
  const unexplained = input.lesson.sections.filter((s) => s.kind === "explanation" && s.citations.length < 1);
  results.push({
    name: "citations",
    passed: unresolved.length === 0 && unexplained.length === 0,
    detail: unresolved[0] ? `unresolved:${unresolved[0]}` : unexplained.length ? "uncited explanation" : "resolved",
  });

  const bad = input.verdict.claims.filter((c) => c.verdict !== "SUPPORTED");
  const low = Object.entries(input.verdict.scores).filter(([, v]) => v < GATE_CONFIG.minScore);
  results.push({
    name: "grounding",
    passed: bad.length === 0 && low.length === 0,
    detail: bad[0] ? `${bad[0].verdict}` : low[0] ? `score:${low[0][0]}=${low[0][1]}` : "pass",
  });

  const focusFail = (input.sectionFocus || []).some((v) => v < GATE_CONFIG.minFocusSimilarity);
  results.push({
    name: "focus",
    passed: !focusFail,
    detail: focusFail ? "section below objective floor" : "ok",
  });

  const filler = GATE_CONFIG.fillerPhrases.find((p) => text.toLowerCase().includes(p));
  results.push({
    name: "filler",
    passed: !filler,
    detail: filler || "none",
  });

  const words = wordTokens(text).length;
  const minW = input.spec.est_minutes * GATE_CONFIG.minWordsPerMinute;
  const maxW = input.spec.est_minutes * GATE_CONFIG.maxWordsPerMinute;
  const lengthOk = words >= Math.min(40, minW) && words <= maxW;
  const budgetOk = input.writerInputTokens <= input.writerBudget;
  results.push({
    name: "length",
    passed: lengthOk && budgetOk,
    detail: budgetOk ? `${words} words` : `writer input ${input.writerInputTokens}/${input.writerBudget}`,
  });

  return results;
}

export function gatesPassed(results: GateResult[]): boolean {
  return results.every((r) => r.passed);
}

export function gateFixList(results: GateResult[]): string[] {
  return results.filter((r) => !r.passed).map((r) => `Fix ${r.name}: ${r.detail}`);
}

export function codePassFromVerdict(verdict: Verdict): boolean {
  const bad = verdict.claims.some((c) => c.verdict !== "SUPPORTED");
  const low = Object.values(verdict.scores).some((v) => v < GATE_CONFIG.minScore);
  return !bad && !low;
}
