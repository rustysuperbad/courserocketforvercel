import { loadV3Goals } from "./loadGoals";
import { specFromLearnerText, topicSimilar } from "../intake";

function constraintMatch(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) {
    const exp = expected.map((c) => c.toLowerCase()).sort();
    const act = actual.map((c) => c.toLowerCase()).sort();
    return exp.every((c) => act.some((a) => a.includes(c.split(" ")[0] || c) || c.includes(a.split(" ")[0] || a)));
  }
  const act = actual.map((c) => c.toLowerCase());
  return expected.every((c) => act.some((a) => a.includes(c.toLowerCase()) || c.toLowerCase().includes(a)));
}

function checkText(label: string, text: string, expected: EvalGoal["expected"]): string[] {
  const { spec } = specFromLearnerText(text);
  const errors: string[] = [];
  if (spec.status !== expected.intakeStatus) {
    errors.push(`${label} status ${spec.status} != ${expected.intakeStatus}`);
  }
  if (expected.intakeStatus === "ok") {
    const variants = [expected.topic, ...(expected.topicVariants || [])];
    if (!variants.some((v) => topicSimilar(v, spec.topic) || spec.topic.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(spec.topic.toLowerCase()))) {
      errors.push(`${label} topic "${spec.topic}" !~ ${variants.join("|")}`);
    }
  }
  if (spec.level !== expected.level) errors.push(`${label} level ${spec.level} != ${expected.level}`);
  if (!constraintMatch(expected.constraints, spec.constraints)) {
    errors.push(`${label} constraints ${JSON.stringify(spec.constraints)} != ${JSON.stringify(expected.constraints)}`);
  }
  return errors;
}

type EvalGoal = ReturnType<typeof loadV3Goals>[number];

export function evaluateV3Goals(): { passed: number; failed: number; errors: string[] } {
  const goals = loadV3Goals();
  const errors: string[] = [];
  for (const goal of goals) {
    errors.push(...checkText(goal.id, goal.text, goal.expected));
    errors.push(...checkText(`${goal.id}.p`, goal.paraphrase, goal.expected));
  }
  return { passed: goals.length * 2 - errors.length, failed: errors.length, errors };
}

const isCli = process.argv[1]?.includes("runEval");
if (isCli) {
  const result = evaluateV3Goals();
  if (result.failed) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(`v3 eval ok: ${result.passed} checks`);
}
