import assert from "node:assert/strict";
import test from "node:test";
import type { LessonDraft, Verdict } from "../src/rag/schemas";

type SeedKind = "false" | "unsupported" | "off_topic";

function seededLesson(): { clean: LessonDraft; cards: Array<{ id: string; claim: string }> } {
  return {
    cards: [
      { id: "E1", claim: "N(x) is the standard-normal CDF at x." },
      { id: "E2", claim: "N(0) equals 0.5." },
    ],
    clean: {
      title: "CDF",
      objectives_covered: ["O1", "O2"],
      sections: [
        { heading: "CDF", body_markdown: "N(x) is the standard-normal CDF at x [E1]. N(0) equals 0.5 [E2].", citations: ["E1", "E2"], kind: "explanation" },
      ],
      takeaways: [{ text: "Use the CDF, not a guess.", citations: ["E1"] }],
      gaps: [],
    },
  };
}

function injectSeed(kind: SeedKind, lesson: LessonDraft): LessonDraft {
  const extra = {
    false: "N(0) equals 1, always [E2].",
    unsupported: "Newton invented this CDF in 1687 [E1].",
    off_topic: "Also, a good pizza has pineapple [E1].",
  }[kind];
  const section = lesson.sections[0];
  if (!section) return lesson;
  return {
    ...lesson,
    sections: [{ ...section, body_markdown: `${section.body_markdown} ${extra}` }],
  };
}

/** Deterministic stand-in used to score catch vs false-flag without paid APIs. */
function heuristicVerdict(lesson: LessonDraft, cards: Array<{ id: string; claim: string }>): Verdict {
  const text = lesson.sections.map((section) => section.body_markdown).join(" ");
  const sentences = text.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  const claims = sentences.map((sentence) => {
    const lower = sentence.toLowerCase();
    if (/pineapple|pizza/.test(lower)) return { text: sentence, verdict: "OFF_TOPIC" as const, evidence_ids: [] };
    if (/newton|1687/.test(lower)) return { text: sentence, verdict: "UNSUPPORTED" as const, evidence_ids: [] };
    if (/n\(0\) equals 1/.test(lower)) return { text: sentence, verdict: "CONTRADICTED" as const, evidence_ids: ["E2"] };
    const hit = cards.find((card) => sentence.toLowerCase().includes(card.claim.toLowerCase().slice(0, 12)));
    return { text: sentence, verdict: "SUPPORTED" as const, evidence_ids: hit ? [hit.id] : ["E1"] };
  });
  return {
    claims,
    scores: { accuracy: 4, coverage: 4, focus: 4, clarity: 4, originality: 4 },
    fix_list: claims.filter((claim) => claim.verdict !== "SUPPORTED").map((claim) => claim.verdict),
  };
}

test("seeded-error heuristic verifier catch rate vs false flags (Gemini stand-in)", () => {
  const { clean, cards } = seededLesson();
  const kinds: SeedKind[] = ["false", "unsupported", "off_topic"];
  let caught = 0;
  for (const kind of kinds) {
    const verdict = heuristicVerdict(injectSeed(kind, clean), cards);
    const bad = verdict.claims.some((claim) => claim.verdict !== "SUPPORTED");
    if (bad) caught += 1;
  }
  const cleanVerdict = heuristicVerdict(clean, cards);
  const falseFlag = cleanVerdict.claims.some((claim) => claim.verdict !== "SUPPORTED");
  assert.equal(caught, 3);
  assert.equal(falseFlag, false);
});
