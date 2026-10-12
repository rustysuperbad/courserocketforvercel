import assert from "node:assert/strict";
import test from "node:test";
import { answersMatch, quizRating, remediationTargetId, scoreNetworkingProject } from "../src/masteryLoop";
import { loadNetworkingCatalog, toGraphConcept } from "../src/catalog";

test("a missed quiz traces back to a weaker prerequisite for remediation", async () => {
  const graph = (await loadNetworkingCatalog()).map(toGraphConcept);
  const target = remediationTargetId("subnetting", graph, {
    subnetting: { pKnown: 0.2 },
    "ip-addresses": { pKnown: 0.15 },
    "digital-data": { pKnown: 0.9 },
  });
  assert.equal(target, "ip-addresses");
  assert.equal(answersMatch("A /24 prefix", "a /24 prefix"), true);
  assert.equal(quizRating(false), "again");
  assert.equal(quizRating(true), "good");
});

test("the networking project rubric requires the main hops of a web request", () => {
  const weak = scoreNetworkingProject("I opened a browser.");
  const strong = scoreNetworkingProject("The client asks DNS for the name, opens a TCP handshake, completes TLS with a certificate, then sends an HTTP request via the default gateway.");
  assert.ok(strong.score > weak.score);
  assert.ok(strong.missed.length === 0);
  assert.ok(weak.passed.length < 2);
});
