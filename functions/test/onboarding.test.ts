import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticChoiceSchema, learnerProfileSchema } from "../src/onboarding";

test("learner profile input requires a goal and accepts known topics without leaking extra keys", () => {
  const parsed = learnerProfileSchema.parse({
    goal: "Understand how a web request travels",
    targetConceptSlug: "packet-journey",
    knownConceptSlugs: ["digital-data", "dns"],
    interests: ["web development"],
  });
  assert.equal(parsed.targetConceptSlug, "packet-journey");
  assert.equal(learnerProfileSchema.safeParse({ goal: "x", extra: true }).success, false);
  assert.equal(learnerProfileSchema.parse({ goal: "Learn HTTP" }).knownConceptSlugs.length, 0);
});

test("diagnostic choices require a selected answer string, not a client-supplied isCorrect flag", () => {
  const ok = diagnosticChoiceSchema.safeParse({ conceptSlug: "subnetting", selectedAnswer: "The first 24 bits are the network prefix" });
  assert.equal(ok.success, true);
  assert.equal(diagnosticChoiceSchema.safeParse({ conceptSlug: "subnetting", isCorrect: true }).success, false);
});
