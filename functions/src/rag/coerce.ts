import type { StageName } from "./config";

export type CoerceResult = {
  json: unknown;
  repairs: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Unwrap-only repairs. Does not invent ids, minutes, objectives, sections,
 * or pad/truncate arrays to satisfy min/max counts.
 */
export function normalizeStageOutput(stage: StageName, json: unknown): CoerceResult {
  const repairs: string[] = [];
  let value: unknown = json;

  if (stage === "extractor" && Array.isArray(value)) {
    repairs.push("wrap_cards_array");
    value = { cards: value };
  }

  const obj = asRecord(value);
  if (!obj) return { json: value, repairs };

  if (stage === "intake" && obj.status == null && asRecord(obj.spec)) {
    repairs.push("unwrap_spec");
    value = obj.spec;
  } else if (stage === "planner" && obj.lessons == null && asRecord(obj.syllabus)) {
    repairs.push("unwrap_syllabus");
    value = obj.syllabus;
  } else if (stage === "extractor" && obj.cards == null && Array.isArray(obj.evidence)) {
    repairs.push("unwrap_evidence");
    value = { cards: obj.evidence };
  } else if ((stage === "writer" || stage === "rewriter") && obj.sections == null && asRecord(obj.lesson)) {
    repairs.push("unwrap_lesson");
    value = obj.lesson;
  } else if (stage === "quiz" && obj.items == null && Array.isArray(obj.quiz)) {
    repairs.push("unwrap_quiz");
    value = { items: obj.quiz };
  }

  return { json: value, repairs };
}

export function formatZodIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
    .slice(0, 800);
}
