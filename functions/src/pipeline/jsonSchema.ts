import type { StageName } from "./config";
import {
  evidenceCardsSchema,
  learnerSpecSchema,
  lessonSchema,
  queryPlanSchema,
  quizSchema,
  syllabusSchema,
  verdictSchema,
} from "./schemas";
import type { z } from "zod";

type JsonSchema = Record<string, unknown>;

function obj(properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema {
  return { type: "object", additionalProperties: false, properties, required };
}
function str(maxLength: number, minLength = 0): JsonSchema {
  const out: JsonSchema = { type: "string", maxLength };
  if (minLength > 0) out.minLength = minLength;
  return out;
}
function arr(items: JsonSchema, minItems: number, maxItems: number): JsonSchema {
  return { type: "array", items, minItems, maxItems };
}

const objective = obj({ id: str(40, 1), text: str(240, 8) });
const syllabusLesson = obj({
  id: str(40, 1),
  title: str(120, 3),
  objectives: arr(objective, 2, 4),
  key_concepts: arr(str(80, 2), 1, 12),
  prerequisites: arr(str(40, 1), 0, 8),
  est_minutes: { type: "integer", minimum: 5, maximum: 90 },
});
const query = obj({
  text: str(200, 4),
  angle: { type: "string", enum: ["definition", "example", "misconception", "reference", "video"] },
});
const card = obj({
  id: str(40, 1),
  claim: str(500, 8),
  source_id: str(80, 1),
  chunk_ref: str(80, 1),
  quote: str(120),
  conflicts_with: str(40),
}, ["id", "claim", "source_id", "chunk_ref"]);
const section = obj({
  heading: str(120, 2),
  body_markdown: str(6000, 24),
  citations: arr(str(40, 1), 1, 12),
  kind: { type: "string", enum: ["explanation", "example"] },
});
const takeaway = obj({
  text: str(280, 8),
  citations: arr(str(40, 1), 1, 8),
});
const claim = obj({
  text: str(800, 4),
  verdict: { type: "string", enum: ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "OFF_TOPIC"] },
  evidence_ids: arr(str(40, 1), 0, 12),
});
const quizItem = obj({
  question: str(400, 8),
  options: arr(str(220, 1), 4, 4),
  correctIndex: { type: "integer", minimum: 0, maximum: 3 },
  explanation: str(500, 8),
  objective_id: str(40, 1),
  evidence_ids: arr(str(40, 1), 1, 8),
});

export const STAGE_JSON_SCHEMA: Record<StageName, JsonSchema> = {
  intake: obj({
    status: { type: "string", enum: ["ok", "needs_clarification", "rejected"] },
    topic: str(80),
    level: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
    goal: str(160),
    constraints: arr(str(120, 2), 0, 8),
    ignored_requests: arr(str(120, 4), 0, 4),
    question: str(200),
  }),
  planner: obj({ lessons: arr(syllabusLesson, 1, 6) }),
  research_queries: obj({ queries: arr(query, 3, 6) }),
  extractor: obj({ cards: arr(card, 1, 40) }),
  writer: obj({
    title: str(160, 3),
    objectives_covered: arr(str(40, 1), 1, 8),
    sections: arr(section, 1, 8),
    takeaways: arr(takeaway, 1, 8),
    gaps: arr(str(240, 4), 0, 12),
  }),
  verifier: obj({
    claims: arr(claim, 1, 40),
    scores: obj({
      accuracy: { type: "number", minimum: 0, maximum: 5 },
      coverage: { type: "number", minimum: 0, maximum: 5 },
      focus: { type: "number", minimum: 0, maximum: 5 },
      clarity: { type: "number", minimum: 0, maximum: 5 },
      originality: { type: "number", minimum: 0, maximum: 5 },
    }),
    fix_list: arr(str(400, 4), 0, 20),
  }),
  rewriter: obj({
    title: str(160, 3),
    objectives_covered: arr(str(40, 1), 1, 8),
    sections: arr(section, 1, 8),
    takeaways: arr(takeaway, 1, 8),
    gaps: arr(str(240, 4), 0, 12),
  }),
  quiz: obj({ items: arr(quizItem, 1, 12) }),
};

export const STAGE_ZOD: Record<StageName, z.ZodTypeAny> = {
  intake: learnerSpecSchema,
  planner: syllabusSchema,
  research_queries: queryPlanSchema,
  extractor: evidenceCardsSchema,
  writer: lessonSchema,
  verifier: verdictSchema,
  rewriter: lessonSchema,
  quiz: quizSchema,
};

export function groqResponseFormat(stage: StageName) {
  return {
    type: "json_schema",
    json_schema: {
      name: `v3_${stage}`,
      strict: true,
      schema: STAGE_JSON_SCHEMA[stage],
    },
  };
}
