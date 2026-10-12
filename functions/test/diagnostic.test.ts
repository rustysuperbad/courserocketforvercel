import assert from "node:assert/strict";
import test from "node:test";
import { applyDiagnosticResult, DIAGNOSTIC_QUESTION_LIMIT, gradeDiagnosticChoice, nextDiagnosticConceptId, weakestPrerequisite } from "../src/diagnostic";
import { loadNetworkingCatalog, toGraphConcept } from "../src/catalog";
import { buildLearningPath } from "../src/learning";

test("a missed diagnostic updates the concept and points at a weaker prerequisite", async () => {
  const catalog = await loadNetworkingCatalog();
  const graph = catalog.map(toGraphConcept);
  const subnet = catalog.find((concept) => concept.id === "subnetting")!;
  assert.equal(gradeDiagnosticChoice(subnet, subnet.diagnostic.correctAnswer), true);
  assert.equal(gradeDiagnosticChoice(subnet, "wrong"), false);
  const prior = { "subnetting": { pKnown: 0.5, attempts: 0, correctAttempts: 0 }, "ip-addresses": { pKnown: 0.8, attempts: 0, correctAttempts: 0 }, "digital-data": { pKnown: 0.9, attempts: 0, correctAttempts: 0 } };
  const missed = applyDiagnosticResult(graph, "subnetting", false, prior, []);
  assert.equal(missed.isCorrect, false);
  assert.ok((missed.mastery.subnetting?.pKnown ?? 1) < 0.5);
  assert.ok((missed.mastery["ip-addresses"]?.pKnown ?? 1) < 0.8 || (missed.mastery["digital-data"]?.pKnown ?? 1) < 0.9);
  assert.ok(missed.preferNextId === "ip-addresses" || missed.preferNextId === "digital-data");
  const nextId = nextDiagnosticConceptId(graph, "packet-journey", missed.mastery, new Set(missed.asked), missed.preferNextId);
  assert.equal(nextId, missed.preferNextId);
});

test("the diagnostic walks the path in prerequisite order and stops after the question limit", async () => {
  const catalog = await loadNetworkingCatalog();
  const graph = catalog.map(toGraphConcept);
  const first = nextDiagnosticConceptId(graph, "packet-journey", {}, new Set());
  assert.equal(first, "digital-data");
  const skipped = nextDiagnosticConceptId(graph, "packet-journey", { "digital-data": { pKnown: 0.9 } }, new Set(["digital-data"]));
  assert.ok(skipped && skipped !== "digital-data");
  const asked = new Set(Array.from({ length: DIAGNOSTIC_QUESTION_LIMIT }, (_, index) => `asked-${index}`));
  assert.equal(nextDiagnosticConceptId(graph, "packet-journey", {}, asked), null);
  assert.equal(weakestPrerequisite(graph, "digital-data", {}), null);
  const path = buildLearningPath(graph, "http", {});
  assert.ok(path.map((step) => step.conceptId).includes("dns"));
});
