import type { StageName } from "./config";
import {
  evidenceCardsSchema,
  learnerSpecSchema,
  lessonSchema,
  quizSchema,
  syllabusSchema,
  verdictSchema,
} from "./schemas";
import type { ZodType } from "zod";

type JsonSchema = Record<string, unknown>;

function obj(properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema {
  return { type: "object", additionalProperties: false, properties, required };
}

function str(minLength: number, maxLength: number): JsonSchema {
  return { type: "string", minLength, maxLength };
}

function arr(items: JsonSchema, minItems: number, maxItems: number): JsonSchema {
  return { type: "array", items, minItems, maxItems };
}

const objective = obj({
  id: str(1, 40),
  text: str(8, 240),
});

const syllabusLesson = obj({
  id: str(1, 40),
  title: str(3, 120),
  objectives: arr(objective, 2, 4),
  key_concepts: arr(str(2, 80), 1, 12),
  prerequisites: arr(str(1, 40), 0, 8),
  est_minutes: { type: "integer", minimum: 5, maximum: 90 },
});

const evidenceCard = obj({
  id: str(1, 40),
  claim: str(8, 500),
  source_id: str(1, 80),
  chunk_id: str(1, 80),
});

const lessonSection = obj({
  heading: str(2, 120),
  body_markdown: str(24, 6000),
  citations: arr(str(1, 40), 1, 12),
  kind: { type: "string", enum: ["explanation", "example"] },
});

const takeaway = obj({
  text: str(8, 280),
  citations: arr(str(1, 40), 1, 8),
});

const lesson = obj({
  title: str(3, 160),
  objectives_covered: arr(str(1, 40), 1, 8),
  sections: arr(lessonSection, 1, 8),
  takeaways: arr(takeaway, 1, 8),
  gaps: arr(str(4, 240), 0, 12),
});

const claim = obj({
  text: str(4, 800),
  verdict: { type: "string", enum: ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "OFF_TOPIC"] },
  evidence_ids: arr(str(1, 40), 0, 12),
});

export const STAGE_JSON_SCHEMA: Record<StageName, JsonSchema> = {
  intake: obj({
    status: { type: "string", enum: ["ok", "needs_clarification", "rejected"] },
    topic: { type: "string", maxLength: 80 },
    level: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
    goal: { type: "string", maxLength: 160 },
    constraints: arr(str(2, 120), 0, 8),
    ignored_requests: arr(str(4, 120), 0, 4),
  }),
  planner: obj({
    lessons: arr(syllabusLesson, 1, 2),
  }),
  extractor: obj({
    cards: arr(evidenceCard, 1, 40),
  }),
  writer: lesson,
  rewriter: lesson,
  verifier: obj({
    claims: arr(claim, 1, 40),
    scores: obj({
      accuracy: { type: "number", minimum: 0, maximum: 5 },
      coverage: { type: "number", minimum: 0, maximum: 5 },
      focus: { type: "number", minimum: 0, maximum: 5 },
      clarity: { type: "number", minimum: 0, maximum: 5 },
      originality: { type: "number", minimum: 0, maximum: 5 },
    }),
    fix_list: arr(str(4, 400), 0, 20),
  }),
  quiz: obj({
    items: arr(obj({
      question: str(8, 400),
      options: arr(str(1, 220), 4, 4),
      correctIndex: { type: "integer", minimum: 0, maximum: 3 },
      explanation: str(8, 500),
      objective_id: str(1, 40),
      evidence_ids: arr(str(1, 40), 1, 8),
    }), 1, 12),
  }),
};

export const STAGE_ZOD: Record<StageName, ZodType> = {
  intake: learnerSpecSchema,
  planner: syllabusSchema,
  extractor: evidenceCardsSchema,
  writer: lessonSchema,
  rewriter: lessonSchema,
  verifier: verdictSchema,
  quiz: quizSchema,
};

export function groqResponseFormat(stage: StageName): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: `rag_${stage}`,
      strict: true,
      schema: STAGE_JSON_SCHEMA[stage],
    },
  };
}
