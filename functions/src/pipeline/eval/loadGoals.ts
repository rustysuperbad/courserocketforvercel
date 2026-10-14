import { readFileSync } from "fs";
import { join } from "path";
import { evalGoalFileSchema, type EvalGoal } from "../schemas";

export function loadV3Goals(): EvalGoal[] {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "eval/v3/goals.json"), "utf8"));
  return evalGoalFileSchema.parse(raw);
}
