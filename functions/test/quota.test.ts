import assert from "node:assert/strict";
import test from "node:test";
import { canReserveProjectSpend, canStartDailyRun } from "../src/quota";

test("daily project budget includes reserved and settled spend", () => {
  assert.equal(canReserveProjectSpend(3, 4, 2, 10), true);
  assert.equal(canReserveProjectSpend(3, 4, 3.01, 10), false);
  assert.equal(canReserveProjectSpend(0, 0, -1, 10), false);
});

test("per-user course limit allows exactly the configured number of runs", () => {
  assert.equal(canStartDailyRun(2, 3), true);
  assert.equal(canStartDailyRun(3, 3), false);
  assert.equal(canStartDailyRun(-1, 3), false);
});
