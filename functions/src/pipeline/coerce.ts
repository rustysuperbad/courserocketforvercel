const KEY_ALIASES: Record<string, string> = {
  lesson_title: "title",
  lessonTitle: "title",
  query: "text",
  queries_list: "queries",
  evidence: "cards",
  evidence_cards: "cards",
  body: "body_markdown",
  type: "kind",
  kind_of: "kind",
  covered: "objectives_covered",
  questions: "items",
  quiz_items: "items",
  answer_index: "correctIndex",
  correct_index: "correctIndex",
};

export type CoerceLog = { repairs: string[]; coercion_rate: number };

function stripFence(raw: string): { text: string; repaired: boolean } {
  const trimmed = String(raw || "").trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (match?.[1]) return { text: match[1].trim(), repaired: true };
  return { text: trimmed, repaired: false };
}

function renameKeys(value: unknown, repairs: string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => renameKeys(item, repairs));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const next = KEY_ALIASES[key] || key;
    if (next !== key) repairs.push(`rename:${key}->${next}`);
    out[next] = renameKeys(nested, repairs);
  }
  return out;
}

function coerceScalars(value: unknown, repairs: string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => coerceScalars(item, repairs));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "est_minutes" || key === "correctIndex") && typeof nested === "string" && /^\d+$/.test(nested)) {
      repairs.push(`coerce-number:${key}`);
      out[key] = Number(nested);
      continue;
    }
    if ((key === "accuracy" || key === "coverage" || key === "focus" || key === "clarity" || key === "originality") && typeof nested === "string" && Number.isFinite(Number(nested))) {
      repairs.push(`coerce-number:${key}`);
      out[key] = Number(nested);
      continue;
    }
    out[key] = coerceScalars(nested, repairs);
  }
  return out;
}

export function normalizeModelJson(raw: unknown): { value: unknown; log: CoerceLog } {
  const repairs: string[] = [];
  let current: unknown = raw;
  if (typeof current === "string") {
    const stripped = stripFence(current);
    if (stripped.repaired) repairs.push("unwrap-fence");
    try {
      current = JSON.parse(stripped.text);
      if (stripped.repaired) repairs.push("parse-fenced-json");
    } catch {
      return { value: raw, log: { repairs, coercion_rate: repairs.length ? 1 : 0 } };
    }
  }
  if (current && typeof current === "object" && !Array.isArray(current)) {
    const rec = current as Record<string, unknown>;
    if (rec.json && typeof rec.json === "object") {
      current = rec.json;
      repairs.push("unwrap:json");
    } else if (rec.data && typeof rec.data === "object") {
      current = rec.data;
      repairs.push("unwrap:data");
    } else if (rec.output && typeof rec.output === "object") {
      current = rec.output;
      repairs.push("unwrap:output");
    }
  }
  current = renameKeys(current, repairs);
  current = coerceScalars(current, repairs);
  return { value: current, log: { repairs, coercion_rate: repairs.length ? 1 : 0 } };
}
