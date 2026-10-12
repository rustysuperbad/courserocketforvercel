import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLaunchDomain, loadEvalPrompts } from "../src/evalHarness";
import { analyticsFromRows, analyticsFromRunRows, conceptMapFromCatalog, flashcardsFromChunks, notesToPrivateSource, relatedConceptIds } from "../src/trust";

test("the launch eval has at least 50 prompts and reports citation, quiz, and source coverage", async () => {
  const prompts = await loadEvalPrompts();
  assert.ok(prompts.length >= 50);
  const result = await evaluateLaunchDomain();
  assert.equal(result.rows.length, prompts.length);
  assert.equal(result.summary.citationPass, result.rows.length);
  assert.equal(result.summary.quizPass, result.rows.length);
  assert.ok(result.summary.catalogHits === result.rows.length);
  assert.ok(result.summary.sourceHits >= 40);
  assert.ok(result.summary.estimatedCourseUsd > 0);
});

test("analytics and private notes helpers stay well-formed", () => {
  const stats = analyticsFromRows({ firstRunAt: ["a"], completedAt: ["b"], returned7d: 1, users: 4, completed: 2, costCompleted: 1.4 });
  assert.equal(stats.costPerCompletionUsd, 0.7);
  const packed = notesToPrivateSource("uid", "My notes", `${"Subnet masks split a prefix from host bits. ".repeat(20)}`);
  assert.ok(packed.chunks.length >= 1);
  assert.equal(packed.source.owner_uid, "uid");
  assert.match(packed.source.url, /^private:\/\//);
  const cards = flashcardsFromChunks(packed.chunks);
  assert.ok(cards.length >= 1);
  assert.ok(cards[0]?.prompt.includes("?"));
  const related = relatedConceptIds("I already know subnetting and DNS resolvers.", [{ id: "subnetting", title: "Subnetting" }, { id: "ethernet", title: "Ethernet" }]);
  assert.deepEqual(related, ["subnetting"]);
  const map = conceptMapFromCatalog([{ id: "ip", title: "IP", prerequisiteIds: [] }, { id: "subnetting", title: "Subnetting", prerequisiteIds: ["ip"] }], ["subnetting"]);
  assert.equal(map.edges.length, 1);
  assert.equal(map.nodes.find((node) => node.id === "subnetting")?.related, true);
  const personal = analyticsFromRunRows([
    { firebase_uid: "a", status: "completed", actual_cost_usd: 0.4, created_at: "2026-01-01T00:00:00.000Z" },
    { firebase_uid: "a", status: "queued", actual_cost_usd: 0, created_at: "2026-01-10T00:00:00.000Z" },
  ]);
  assert.equal(personal.activation, 1);
  assert.equal(personal.sevenDayReturn, 1);
});
