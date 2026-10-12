import assert from "node:assert/strict";
import test from "node:test";
import { loadNetworkingCatalog, parseNetworkingCatalog, publicConceptView, toGraphConcept } from "../src/catalog";
import { buildLearningPath } from "../src/learning";

test("the launch catalog is a valid DAG with a diagnostic whose answer is one of the options", async () => {
  const catalog = await loadNetworkingCatalog();
  assert.ok(catalog.length >= 20);
  assert.ok(catalog.every((concept) => concept.diagnostic.options.includes(concept.diagnostic.correctAnswer)));
  assert.ok(catalog.every((concept) => concept.prerequisiteIds.every((id) => catalog.some((candidate) => candidate.id === id))));
  const packet = catalog.find((concept) => concept.id === "packet-journey");
  assert.ok(packet);
  assert.ok(packet.prerequisiteIds.length > 0);
  const leaked = publicConceptView(packet);
  assert.equal("correctAnswer" in leaked.diagnostic, false);
});

test("two learners with different knowledge get different paths for the same goal", async () => {
  const catalog = await loadNetworkingCatalog();
  const graph = catalog.map(toGraphConcept);
  const beginner = buildLearningPath(graph, "packet-journey", {});
  const experiencedMastery = Object.fromEntries(
    ["digital-data", "computer-basics", "network-purpose", "network-types", "topologies", "layering", "encapsulation", "ethernet", "mac-addresses", "ip-addresses"]
      .map((id) => [id, { pKnown: 0.92 }]),
  );
  const experienced = buildLearningPath(graph, "packet-journey", experiencedMastery);
  assert.equal(beginner.at(-1)?.conceptId, "packet-journey");
  assert.equal(experienced.at(-1)?.conceptId, "packet-journey");
  assert.ok(beginner.filter((step) => step.action === "learn").length > experienced.filter((step) => step.action === "learn").length);
  assert.ok(experienced.some((step) => step.action === "skip"));
  assert.notDeepEqual(beginner.map((step) => `${step.conceptId}:${step.action}`), experienced.map((step) => `${step.conceptId}:${step.action}`));
  assert.ok(beginner.reduce((sum, step) => sum + step.estimatedMinutes, 0) > experienced.reduce((sum, step) => sum + step.estimatedMinutes, 0));
});

test("invalid diagnostic keys are rejected", () => {
  assert.throws(() => parseNetworkingCatalog([{
    id: "a", title: "A", estimatedMinutes: 10, prerequisiteIds: [], description: "Not enough detail is actually here.", level: 1,
    objectives: ["Know A"], diagnostic: { question: "Is this valid?", options: ["Yes", "No", "Maybe", "Skip"], correctAnswer: "Not listed", explanation: "The key is not an option.", questionType: "recall" },
  }]));
});
