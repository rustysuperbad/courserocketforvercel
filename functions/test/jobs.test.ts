import assert from "node:assert/strict";
import test from "node:test";
import { estimateRunCostUsd, isTerminalStatus, modulePercent, publicRunView, reservationFailure, startJobSchema } from "../src/jobs";

test("start job input accepts the legacy courseId field and rejects unknown keys", () => {
  const ok = startJobSchema.safeParse({ goal: "Learn subnetting", idempotencyKey: "abcdefgh-1234", domain: "networking", targetConceptSlug: "subnetting", courseId: "legacy123" });
  assert.ok(ok.success);
  assert.equal(ok.data.domain, "networking");
  const bad = startJobSchema.safeParse({ goal: "x", idempotencyKey: "short", extra: true });
  assert.equal(bad.success, false);
  assert.equal(startJobSchema.parse({ goal: "Anything", idempotencyKey: "abcdefgh-1234" }).domain, "general");
});

test("quota and spend failures map to resource-exhausted without leaking SQL text", () => {
  assert.equal(reservationFailure("user_daily_quota_exceeded").code, "resource-exhausted");
  assert.equal(reservationFailure("P0001: project_spend_limit_exceeded").code, "resource-exhausted");
  assert.equal(reservationFailure("invalid_goal").code, "invalid-argument");
  const unknown = reservationFailure("connection refused to 10.0.0.1");
  assert.equal(unknown.code, "internal");
  assert.ok(!unknown.message.includes("10.0.0.1"));
});

test("cost reservations scale with module count and never go negative", () => {
  assert.ok(estimateRunCostUsd("networking") > estimateRunCostUsd("general"));
  assert.equal(estimateRunCostUsd("general", -1), 0);
  assert.equal(estimateRunCostUsd("networking", 0.05, 4), 0.2);
});

test("progress percent stays inside the module band", () => {
  assert.equal(modulePercent(0, 10), 5);
  assert.equal(modulePercent(10, 10), 93);
  assert.equal(modulePercent(-4, 10), 5);
  assert.equal(modulePercent(3, 0), 5);
  assert.ok(isTerminalStatus("blocked") && !isTerminalStatus("running"));
});

test("public run view hides provider internals and normalises numbers", () => {
  const view = publicRunView({
    id: "run", status: "running", progress: { stage: "module-1-of-3", percent: 20 }, course_id: null, domain: "networking",
    actual_cost_usd: "0.012345", cost_estimate_usd: 0.5, error_code: null, created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:01:00Z",
  });
  assert.equal(view.actualCostUsd, 0.012345);
  assert.equal(view.status, "running");
  assert.ok(!("provider" in view) && !("model" in view));
});
