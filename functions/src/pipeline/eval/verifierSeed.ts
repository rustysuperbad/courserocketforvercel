import type { LessonDraft, Verdict } from "../schemas";
import { createFakeProvider } from "../models";

export function plantErrors(lesson: LessonDraft): LessonDraft {
  return {
    ...lesson,
    sections: [
      ...lesson.sections,
      {
        heading: "Planted claims",
        body_markdown: "The moon is made of cheese. Off-topic celebrity gossip wins awards. An unsupported invention appeared in 1492. [E1]",
        citations: ["E1"],
        kind: "explanation",
      },
    ],
  };
}

export async function seededVerifierReport(lesson: LessonDraft, cards: unknown) {
  const strict = createFakeProvider();
  const lax = createFakeProvider({}, { laxVerifier: true });
  const blocks = { LESSON_DRAFT: plantErrors(lesson), EVIDENCE_CARDS: cards };
  const gemini = (await strict.complete("verifier", blocks)).json as Verdict;
  const writer = (await lax.complete("verifier", blocks)).json as Verdict;
  const planted = ["moon is made of cheese", "celebrity gossip", "unsupported invention"];
  const catchRate = (verdict: Verdict) => {
    const hits = planted.filter((p) => verdict.claims.some((c) => c.text.toLowerCase().includes(p) && c.verdict !== "SUPPORTED"));
    return hits.length / planted.length;
  };
  const falseFlag = (verdict: Verdict) => {
    const original = verdict.claims.filter((c) => !planted.some((p) => c.text.toLowerCase().includes(p)));
    if (!original.length) return 0;
    return original.filter((c) => c.verdict !== "SUPPORTED").length / original.length;
  };
  return {
    geminiCatchRate: catchRate(gemini),
    writerCatchRate: catchRate(writer),
    geminiFalseFlagRate: falseFlag(gemini),
    writerFalseFlagRate: falseFlag(writer),
  };
}
