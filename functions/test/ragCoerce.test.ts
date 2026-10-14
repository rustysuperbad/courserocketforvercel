import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { normalizeStageOutput } from "../src/rag/coerce";
import { STAGE_ZOD } from "../src/rag/jsonSchema";
import { settleGenerationQuota } from "../src/rag/quotaSettle";
import type { StageName } from "../src/rag/config";

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/rag-wrap", name), "utf8"));
}

function accept(stage: StageName, fixture: string, repair: string) {
  const raw = loadFixture(fixture);
  const coerced = normalizeStageOutput(stage, raw);
  assert.equal(coerced.repairs.includes(repair), true, `${fixture} repair`);
  const parsed = STAGE_ZOD[stage].safeParse(coerced.json);
  assert.equal(parsed.success, true, `${fixture} should validate after unwrap`);
}

function reject(stage: StageName, fixture: string) {
  const raw = loadFixture(fixture);
  const coerced = normalizeStageOutput(stage, raw);
  const parsed = STAGE_ZOD[stage].safeParse(coerced.json);
  assert.equal(parsed.success, false, `${fixture} must stay invalid`);
}

test("unwrap repairs from live wrapped outputs then pass zod", () => {
  accept("planner", "planner-syllabus-wrap.json", "unwrap_syllabus");
  accept("extractor", "extractor-bare-array.json", "wrap_cards_array");
  accept("writer", "writer-lesson-wrap.json", "unwrap_lesson");
  accept("quiz", "quiz-quiz-key.json", "unwrap_quiz");
});

test("broken content is rejected, not repaired", () => {
  reject("planner", "planner-string-objectives.json");
  reject("planner", "planner-empty-lessons.json");
  reject("planner", "planner-extra-title.json");
  reject("writer", "writer-empty-takeaways.json");
});

test("coercer does not invent lesson ids or pad objectives", () => {
  const coerced = normalizeStageOutput("planner", {
    lessons: [{ title: "TCP", objectives: ["Explain SYN"], key_concepts: ["SYN"] }],
  });
  assert.deepEqual(coerced.repairs, []);
  const lesson = (coerced.json as { lessons: Array<Record<string, unknown>> }).lessons[0];
  assert.equal(lesson.id, undefined);
  assert.equal(lesson.est_minutes, undefined);
  assert.deepEqual(lesson.objectives, ["Explain SYN"]);
  assert.equal(STAGE_ZOD.planner.safeParse(coerced.json).success, false);
});

test("quota settle releases failed when work throws", async () => {
  const released: string[] = [];
  const status = await settleGenerationQuota({
    quotaRunId: "run-1",
    started: Date.now(),
    failed: true,
    finalize: async (_id, next) => { released.push(next); },
  });
  assert.equal(status, "failed");
  assert.deepEqual(released, ["failed"]);
});

test("quota settle marks unpublishable runs blocked, not left reserved", async () => {
  const released: string[] = [];
  const status = await settleGenerationQuota({
    quotaRunId: "run-2",
    started: Date.now(),
    result: { spec: { status: "ok" }, publishable: false, costUsd: 0.01 },
    finalize: async (_id, next) => { released.push(next); },
  });
  assert.equal(status, "blocked");
  assert.deepEqual(released, ["blocked"]);
});
