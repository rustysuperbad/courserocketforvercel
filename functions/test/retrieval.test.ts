import assert from "node:assert/strict";
import test from "node:test";
import {
  blendedRetrievalScore, diversifyBySource, hybridSearchParams, levelFitScore, mapHybridRow, rankRetrievedChunks,
  retrievalQuerySchema, toEvidenceChunks, toPublicChunks,
} from "../src/retrieval";

test("level-fit scoring prefers a matching beginner source over an RFC-level source", () => {
  assert.equal(levelFitScore(1, 1), 1);
  assert.equal(levelFitScore(5, 1), 0);
  assert.ok(levelFitScore(2, 1) > levelFitScore(4, 1));
});

test("blended score rewards authority, concept match, and level fit", () => {
  const beginnerWiki = blendedRetrievalScore({ semanticRank: 2, lexicalRank: 2, authorityScore: 0.62, levelFit: 1, conceptBoost: 1 });
  const advancedRfc = blendedRetrievalScore({ semanticRank: 1, lexicalRank: 1, authorityScore: 0.98, levelFit: 0, conceptBoost: 0 });
  assert.ok(beginnerWiki > advancedRfc);
});

test("diversity keeps at most two chunks per source and prefers higher scores", () => {
  const chunks = [
    { sourceId: "a", score: 0.9, id: "a1" },
    { sourceId: "a", score: 0.8, id: "a2" },
    { sourceId: "a", score: 0.7, id: "a3" },
    { sourceId: "b", score: 0.6, id: "b1" },
  ];
  assert.deepEqual(diversifyBySource(chunks, 2).map((chunk) => chunk.id), ["a1", "a2", "b1"]);
});

test("hybrid search params over-fetch and clamp level", () => {
  const params = hybridSearchParams({ query: "subnet mask", embedding: [0.1, 0.2], limit: 8, targetLevel: 9, conceptSlugs: ["networking-subnetting"] });
  assert.equal(params.p_limit, 24);
  assert.equal(params.p_target_level, 5);
  assert.deepEqual(params.p_concept_slugs, ["networking-subnetting"]);
  assert.ok(params.p_query_embedding?.startsWith("[0.1,"));
});

test("rankRetrievedChunks maps RPC rows, diversifies, and preserves attribution", () => {
  const rows = [
    { chunk_id: "c1", source_id: "s1", chunk_index: 0, chunk_text: "A subnet mask separates the network prefix from the host identifier.", url: "https://example.test/subnets", title: "Subnet", publisher: "Wikipedia contributors", license: "CC BY-SA 4.0", attribution: "Wikipedia contributors, Subnet.", authority_score: 0.62, level: 3, concept_tags: ["networking-subnetting"], is_private: false, semantic_score: 0.8, lexical_score: 0.5, level_fit: 0.5, concept_boost: 1, final_score: 0.9 },
    { chunk_id: "c2", source_id: "s1", chunk_index: 1, chunk_text: "CIDR notation writes the prefix length after a slash.", url: "https://example.test/subnets", title: "Subnet", publisher: "Wikipedia contributors", license: "CC BY-SA 4.0", attribution: "Wikipedia contributors, Subnet.", authority_score: 0.62, level: 3, concept_tags: ["networking-subnetting"], final_score: 0.7 },
    { chunk_id: "c3", source_id: "s1", chunk_index: 2, chunk_text: "Third extra paragraph from the same article should be dropped by diversity.", url: "https://example.test/subnets", title: "Subnet", publisher: "Wikipedia contributors", license: "CC BY-SA 4.0", attribution: "Wikipedia contributors, Subnet.", authority_score: 0.62, level: 3, final_score: 0.65 },
    { chunk_id: "c4", source_id: "s2", chunk_text: "IPv4 addresses are 32-bit identifiers.", url: "https://example.test/ipv4", title: "IPv4", publisher: "Wikipedia contributors", license: "CC BY-SA 4.0", attribution: "Wikipedia contributors, IPv4.", authority_score: 0.62, level: 2, final_score: 0.4 },
  ];
  const ranked = rankRetrievedChunks(rows, 8);
  assert.deepEqual(ranked.map((chunk) => chunk.id), ["c1", "c2", "c4"]);
  assert.equal(ranked[0]?.attribution.includes("Wikipedia"), true);
  assert.equal(ranked[0]?.license, "CC BY-SA 4.0");
  const publicChunks = toPublicChunks(ranked);
  assert.equal(publicChunks[0]?.citation, 1);
  assert.equal(publicChunks[0]?.source.url, "https://example.test/subnets");
  const evidence = toEvidenceChunks(ranked);
  assert.equal(evidence[0]?.id, "c1");
});

test("mapHybridRow treats missing semantic score as null and ignores junk tags", () => {
  const mapped = mapHybridRow({ chunk_id: "x", source_id: "s", chunk_text: "text", concept_tags: ["ok", 3, ""], is_private: false });
  assert.equal(mapped.semanticScore, null);
  assert.deepEqual(mapped.conceptTags, ["ok"]);
});

test("retrieval query schema rejects empty topics", () => {
  assert.equal(retrievalQuerySchema.safeParse({ query: "a" }).success, false);
  assert.equal(retrievalQuerySchema.parse({ query: "subnetting", targetLevel: 2 }).limit, 8);
});
