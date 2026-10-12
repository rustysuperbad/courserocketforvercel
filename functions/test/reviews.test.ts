import assert from "node:assert/strict";
import test from "node:test";
import { scheduleReview } from "../src/reviews";

test("FSRS schedules a harder recall sooner than a successful recall", async () => {
  const now = new Date("2026-10-08T12:00:00.000Z");
  const forgotten = await scheduleReview(undefined, "again", now);
  const remembered = await scheduleReview(undefined, "good", now);
  assert.ok(new Date(forgotten.dueAt).getTime() > now.getTime());
  assert.ok(new Date(remembered.dueAt).getTime() > new Date(forgotten.dueAt).getTime());
  assert.equal(remembered.card.due, remembered.dueAt);
});
