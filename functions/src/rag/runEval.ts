import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectedFailures, shortD1TreatmentFailures } from "./evalAssert";
import { RAG_EVAL_GOALS, ragEvalGoalsFileSchema, type RagEvalGoal } from "./evalGoals";
import { specFromLearnerText, specsEquivalent } from "./intake";
import { FAKE_SOURCE_CHUNKS, NETWORKING_SOURCE_CHUNKS } from "./liveRetrieve";
import { runRagCourse } from "./pipeline";
import { createFakeProvider } from "./providers";

export type EvalRowReport = {
  id: string;
  ok: boolean;
  failures: string[];
  paidStages: string[];
  status: string;
  topic: string;
};

function retrieveFor(goal: RagEvalGoal) {
  if (goal.corpus === "in") return async () => NETWORKING_SOURCE_CHUNKS;
  return async () => [];
}

export async function evaluateGoal(goal: RagEvalGoal): Promise<EvalRowReport> {
  const artifacts: unknown[] = [];
  const result = await runRagCourse(goal.text, {
    provider: createFakeProvider(),
    retrieve: retrieveFor(goal),
    saveArtifact: async (row) => { artifacts.push(row); },
  });
  const failures = expectedFailures(goal, result, artifacts);
  const original = specFromLearnerText(goal.text).spec;
  const paraphrase = specFromLearnerText(goal.paraphrase).spec;
  if (!specsEquivalent(original, paraphrase, goal.expected.topicVariants)) {
    failures.push("paraphrase-spec-mismatch");
  }
  return {
    id: goal.id,
    ok: failures.length === 0,
    failures,
    paidStages: result.paidStages,
    status: result.spec.status,
    topic: result.spec.topic,
  };
}

export async function runRagEval(goals: RagEvalGoal[] = RAG_EVAL_GOALS): Promise<{ ok: boolean; rows: EvalRowReport[] }> {
  ragEvalGoalsFileSchema.parse(goals);
  const rows: EvalRowReport[] = [];
  for (const goal of goals) rows.push(await evaluateGoal(goal));
  return { ok: rows.every((row) => row.ok), rows };
}

const HAND_CHECK = ["g04", "g11", "g07", "g27", "g31"];

async function main() {
  const jsonPath = join(process.cwd(), "eval/rag-eval-goals.json");
  const fromDisk = ragEvalGoalsFileSchema.parse(JSON.parse(readFileSync(jsonPath, "utf8")));
  if (fromDisk.length !== RAG_EVAL_GOALS.length) {
    console.error(`JSON/TS goal count mismatch: ${fromDisk.length} vs ${RAG_EVAL_GOALS.length}`);
    process.exit(1);
  }
  const report = await runRagEval(RAG_EVAL_GOALS);
  const failed = report.rows.filter((row) => !row.ok);
  console.log(`rag-eval ${report.ok ? "PASS" : "FAIL"} ${report.rows.length - failed.length}/${report.rows.length}`);
  for (const id of HAND_CHECK) {
    const row = report.rows.find((item) => item.id === id);
    console.log(`hand-check ${id} ${row?.ok ? "ok" : "FAIL"} status=${row?.status} topic=${JSON.stringify(row?.topic)} paid=${row?.paidStages.join(",") || "none"}`);
  }
  const g07 = RAG_EVAL_GOALS.find((item) => item.id === "g07")!;
  const g07Match = specsEquivalent(
    specFromLearnerText(g07.text).spec,
    specFromLearnerText(g07.paraphrase).spec,
    g07.expected.topicVariants,
  );
  console.log(`hand-check g07-paraphrase ${g07Match ? "ok" : "FAIL"}`);
  const g27 = RAG_EVAL_GOALS.find((item) => item.id === "g27")!;
  const sourced = await runRagCourse(g27.text, { provider: createFakeProvider(), retrieve: async () => FAKE_SOURCE_CHUNKS });
  const d1fail = shortD1TreatmentFailures(sourced);
  console.log(`hand-check g27-d1-with-sources ${d1fail.length ? "FAIL" : "ok"} constraint=${sourced.spec.constraints.join(",")}`);
  if (!g07Match || d1fail.length) process.exit(1);
  if (failed.length) {
    for (const row of failed) console.error(`${row.id}: ${row.failures.join("; ")}`);
    process.exit(1);
  }
}

if (process.argv[1] && /runEval\.(ts|js)$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
