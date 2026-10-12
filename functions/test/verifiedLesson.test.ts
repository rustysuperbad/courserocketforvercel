import assert from "node:assert/strict";
import test from "node:test";
import { claimsHaveCitationsAndVerdicts, generateVerifiedLesson, type EvidenceChunk, type GeneratedLesson, type LessonCritic, type LessonProvider } from "../src/verifiedLesson";

const chunkId = "123e4567-e89b-42d3-a456-426614174000";
const chunk: EvidenceChunk = { id: chunkId, title: "RFC example", url: "https://example.test/source", license: "Public", attribution: "Example source", text: "Routers forward packets based on destination network information." };
const draft: GeneratedLesson = {
  title: "How routers forward packets",
  sections: [{ heading: "Forwarding", paragraphs: [{ text: "A router forwards a packet toward its destination network.", claimIds: ["c1"] }] }],
  claims: [{ id: "c1", text: "Routers use destination network information when forwarding packets.", sourceChunkIds: [chunkId] }],
  quizItems: ["recall", "explain", "apply"].map((questionType, index) => ({
    id: `q${index + 1}`, question: `Question about routing ${index + 1}?`, options: ["A", "B", "C", "D"], correctAnswer: "A",
    explanation: "The source explains this answer.", conceptSlug: "routing", questionType: questionType as "recall" | "explain" | "apply", sourceChunkIds: [chunkId],
  })),
};

function mockProvider(critic: LessonCritic, generated: unknown = draft): LessonProvider {
  return { generate: async () => generated, critique: async () => critic };
}

test("content is ai_verified only when every claim and quiz passes its evidence check", async () => {
  const critic: LessonCritic = {
    claims: [{ id: "c1", supported: true, reason: "Supported by the passage." }],
    quizItems: draft.quizItems.map((item) => ({ id: item.id, solvedAnswer: item.correctAnswer, supportedBySources: true, reason: "Solved from source." })),
  };
  const result = await generateVerifiedLesson({ goal: "Learn routing", targetLevel: "beginner", chunks: [chunk] }, mockProvider(critic));
  assert.equal(result.contentStatus, "ai_verified");
  assert.ok(result.claims.every((claim) => claim.verified && claim.sourceChunkIds.length > 0));
  assert.ok(result.quizItems.every((item) => item.verified));
  assert.equal(claimsHaveCitationsAndVerdicts(result.claims), true);
});

test("unsupported claims and incorrect quiz keys remain visibly unverified and are not taught", async () => {
  const critic: LessonCritic = {
    claims: [{ id: "c1", supported: false, reason: "Not found." }],
    quizItems: draft.quizItems.map((item) => ({ id: item.id, solvedAnswer: "B", supportedBySources: true, reason: "The key appears wrong." })),
  };
  const result = await generateVerifiedLesson({ goal: "Learn routing", targetLevel: "beginner", chunks: [chunk] }, mockProvider(critic));
  assert.equal(result.contentStatus, "ai_generated");
  assert.equal(result.sections.length, 0);
  assert.ok(result.quizItems.every((item) => !item.verified));
  assert.ok(result.verificationIssues.length > 0);
});

test("rewrite pass can recover an unsupported claim using only cited chunks", async () => {
  let critiques = 0;
  const unsupportedDraft: GeneratedLesson = {
    ...draft,
    claims: [{ id: "c1", text: "Routers guess the next hop using folklore.", sourceChunkIds: [chunkId] }],
  };
  const provider: LessonProvider = {
    generate: async () => unsupportedDraft,
    critique: async ({ draft: current }) => {
      critiques += 1;
      const supported = current.claims[0]?.text.includes("destination network");
      return {
        claims: [{ id: "c1", supported, reason: supported ? "Supported." : "Not found." }],
        quizItems: draft.quizItems.map((item) => ({ id: item.id, solvedAnswer: item.correctAnswer, supportedBySources: true, reason: "Solved." })),
      };
    },
    rewrite: async () => ({ claims: [{ id: "c1", text: "Routers use destination network information when forwarding packets.", sourceChunkIds: [chunkId] }] }),
  };
  const result = await generateVerifiedLesson({ goal: "Learn routing", targetLevel: "beginner", chunks: [chunk] }, provider);
  assert.equal(critiques, 2);
  assert.equal(result.contentStatus, "ai_verified");
  assert.equal(claimsHaveCitationsAndVerdicts(result.claims), true);
});

test("no source means no made-up fallback lesson", async () => {
  let called = false;
  const provider: LessonProvider = { generate: async () => { called = true; return draft; }, critique: async () => ({}) };
  const result = await generateVerifiedLesson({ goal: "Learn routing", targetLevel: "beginner", chunks: [] }, provider);
  assert.equal(called, false);
  assert.equal(result.contentStatus, "ai_generated");
  assert.equal(result.sections.length, 0);
});
