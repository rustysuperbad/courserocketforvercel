import assert from "node:assert/strict";
import test from "node:test";
import { analogyContextFrom, buildVerifiedModule, evidenceHash, inferNetworkingTarget } from "../src/pipeline";
import { claimsHaveCitationsAndVerdicts, type EvidenceChunk, type GeneratedLesson, type LessonProvider } from "../src/verifiedLesson";
import { generateVerifiedLesson } from "../src/verifiedLesson";

const chunkId = "123e4567-e89b-42d3-a456-426614174000";
const chunk: EvidenceChunk = { id: chunkId, title: "Subnet", url: "https://example.test/subnet", license: "CC BY-SA 4.0", attribution: "Example", text: "A /24 prefix means the first 24 bits identify the network." };

const draft: GeneratedLesson = {
  title: "Subnet masks",
  sections: [{ heading: "Prefixes", paragraphs: [{ text: "A /24 prefix keeps the first 24 bits as the network.", claimIds: ["c1"] }] }],
  claims: [{ id: "c1", text: "A /24 prefix means the first 24 bits identify the network.", sourceChunkIds: [chunkId] }],
  quizItems: ["recall", "explain", "apply"].map((questionType, index) => ({
    id: `q${index + 1}`, question: `Subnet question ${index + 1}?`, options: ["A", "B", "C", "D"], correctAnswer: "A",
    explanation: "From the passage.", conceptSlug: "networking-subnetting", questionType: questionType as "recall" | "explain" | "apply", sourceChunkIds: [chunkId],
  })),
};

function passingProvider(): LessonProvider {
  return {
    generate: async () => draft,
    critique: async () => ({
      claims: [{ id: "c1", supported: true, reason: "Supported." }],
      quizItems: draft.quizItems.map((item) => ({ id: item.id, solvedAnswer: item.correctAnswer, supportedBySources: true, reason: "Solved." })),
    }),
  };
}

test("integration: mocked providers produce cited, verified modules and reuse the cache", async () => {
  const cache = new Map<string, Awaited<ReturnType<typeof generateVerifiedLesson>>>();
  const retrieveCalls = { count: 0 };
  const writeCalls = { count: 0 };
  const retrieve = async () => { retrieveCalls.count += 1; return { chunks: [chunk], inputTokens: 12, costUsd: 0.0001 }; };
  const writeLesson = async (input: { goal: string; analogyContext?: string; chunks: EvidenceChunk[] }) => {
    writeCalls.count += 1;
    assert.ok(input.analogyContext?.includes("web development"));
    const lesson = await generateVerifiedLesson(input, passingProvider());
    return { lesson, usage: { inputTokens: 100, outputTokens: 40, costUsd: 0.01 } };
  };
  const first = await buildVerifiedModule({
    step: { conceptId: "subnetting", title: "Subnet masks", action: "learn", pKnown: 0.2, estimatedMinutes: 40 },
    concept: { id: "concept-1", slug: "networking-subnetting", title: "Subnetting", estimated_minutes: 40, level: 3 },
    goal: "Trace a web request", domain: "networking", ownerUid: "user-1",
    analogyContext: analogyContextFrom({ interests: ["web development"], known_topics: ["bits"] }, ""),
    retrieve, writeLesson,
    lookupCache: async (conceptId, hash) => cache.get(`${conceptId}:${hash}`) ?? null,
    storeCache: async (conceptId, hash, lesson) => { cache.set(`${conceptId}:${hash}`, lesson); },
    findResources: async () => [{ kind: "youtube", id: "abc", title: "Subnetting for beginners", url: "https://www.youtube.com/watch?v=abc", snippet: "intro to subnet masks", channelOrAuthors: "Example", extra: { viewCount: 1000 } }],
    checkLinks: async (urls) => Object.fromEntries(urls.map((url) => [url, url.includes("broken") ? "broken" : "ok"])),
  });
  assert.equal(first.status, "ai_verified");
  assert.equal(first.cacheHit, undefined);
  assert.ok(first.lesson && claimsHaveCitationsAndVerdicts(first.lesson.claims));
  assert.ok(first.lesson.claims.every((claim) => claim.verified));
  assert.equal(first.resources[0]?.kind, "youtube");
  assert.equal(first.linkStatus["https://example.test/subnet"], "ok");
  const second = await buildVerifiedModule({
    step: { conceptId: "subnetting", title: "Subnet masks", action: "learn", pKnown: 0.2, estimatedMinutes: 40 },
    concept: { id: "concept-1", slug: "networking-subnetting", title: "Subnetting", estimated_minutes: 40, level: 3 },
    goal: "Trace a web request", domain: "networking", ownerUid: "user-2",
    analogyContext: "none", retrieve, writeLesson,
    lookupCache: async (conceptId, hash) => cache.get(`${conceptId}:${hash}`) ?? null,
    storeCache: async (conceptId, hash, lesson) => { cache.set(`${conceptId}:${hash}`, lesson); },
  });
  assert.equal(second.status, "cached");
  assert.equal(second.cacheHit, true);
  assert.equal(writeCalls.count, 1);
  assert.equal(retrieveCalls.count, 2);
  assert.equal(evidenceHash([chunk]).length, 64);
});

test("missing evidence does not invent a verified lesson", async () => {
  const result = await buildVerifiedModule({
    step: { conceptId: "x", title: "X", action: "learn", pKnown: 0.1, estimatedMinutes: 10 },
    goal: "X", domain: "general", ownerUid: "u", analogyContext: "",
    retrieve: async () => ({ chunks: [], inputTokens: 3, costUsd: 0 }),
    writeLesson: async () => { throw new Error("should not write"); },
  });
  assert.equal(result.status, "evidence-missing");
  assert.equal(result.lesson?.contentStatus, "ai_generated");
  assert.equal(result.lesson?.sections.length, 0);
});

test("target inference prefers an explicit networking slug", () => {
  const concepts = [
    { id: "1", slug: "networking-dns", title: "DNS", estimated_minutes: 20, level: 2 },
    { id: "2", slug: "networking-packet-journey", title: "Trace a web request", estimated_minutes: 45, level: 4 },
  ];
  assert.equal(inferNetworkingTarget("anything", concepts, "packet-journey").slug, "networking-packet-journey");
});
