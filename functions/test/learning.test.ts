import assert from "node:assert/strict";
import test from "node:test";
import { applyAnswer, buildLearningPath, updateMastery, validateConceptDag } from "../src/learning";

const concepts = [
  { id: "bits", title: "Bits and bytes", estimatedMinutes: 20, prerequisiteIds: [] },
  { id: "ip", title: "IP addressing", estimatedMinutes: 30, prerequisiteIds: ["bits"] },
  { id: "subnet", title: "Subnetting", estimatedMinutes: 40, prerequisiteIds: ["ip"] },
  { id: "http", title: "HTTP", estimatedMinutes: 25, prerequisiteIds: ["bits"] },
];

test("validates a prerequisite DAG and rejects cycles", () => {
  assert.equal(validateConceptDag(concepts).length, 4);
  assert.throws(() => validateConceptDag([
    { id: "a", title: "A", prerequisiteIds: ["b"] },
    { id: "b", title: "B", prerequisiteIds: ["a"] },
  ]), /cycle/i);
});

test("returns only the target's prerequisites in topological order", () => {
  const path = buildLearningPath(concepts, "subnet", { bits: { pKnown: 0.9 }, ip: { pKnown: 0.7 } });
  assert.deepEqual(path.map((step) => step.conceptId), ["bits", "ip", "subnet"]);
  assert.deepEqual(path.map((step) => step.action), ["skip", "shorten", "learn"]);
  assert.equal(path[0].estimatedMinutes, 0);
});

test("mastery rises after correct evidence and changes less after an error", () => {
  const prior = 0.3;
  const afterCorrect = updateMastery(prior, true);
  const afterWrong = updateMastery(prior, false);
  assert.ok(afterCorrect > prior);
  assert.ok(afterWrong < afterCorrect);
  assert.deepEqual(applyAnswer({ pKnown: prior, attempts: 0, correctAttempts: 0 }, true), { pKnown: afterCorrect, attempts: 1, correctAttempts: 1 });
});
