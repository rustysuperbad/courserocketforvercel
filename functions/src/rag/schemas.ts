import { z } from "zod";

export const levelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export const specStatusSchema = z.enum(["ok", "needs_clarification", "rejected"]);

export const learnerSpecSchema = z.object({
  status: specStatusSchema,
  topic: z.string().trim().max(80),
  level: levelSchema,
  goal: z.string().trim().max(160),
  constraints: z.array(z.string().trim().min(2).max(120)).max(8),
  ignored_requests: z.array(z.string().trim().min(4).max(120)).max(4).default([]),
}).strict().superRefine((spec, ctx) => {
  if (spec.status !== "ok") return;
  if (spec.topic.length < 2) ctx.addIssue({ code: "custom", message: "ok spec needs a topic", path: ["topic"] });
  if (spec.goal.split(/\s+/).filter(Boolean).length > 20) {
    ctx.addIssue({ code: "custom", message: "goal exceeds 20 words", path: ["goal"] });
  }
});
export type LearnerSpec = z.infer<typeof learnerSpecSchema>;

export const objectiveSchema = z.object({
  id: z.string().trim().min(1).max(40),
  text: z.string().trim().min(8).max(240),
}).strict();

export const syllabusLessonSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: z.string().trim().min(3).max(120),
  objectives: z.array(objectiveSchema).min(2).max(4),
  key_concepts: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
  prerequisites: z.array(z.string().trim().min(1).max(40)).max(8),
  est_minutes: z.number().int().min(5).max(90),
}).strict();

export const syllabusSchema = z.object({
  lessons: z.array(syllabusLessonSchema).min(1).max(12),
}).strict();
export type Syllabus = z.infer<typeof syllabusSchema>;
export type SyllabusLesson = z.infer<typeof syllabusLessonSchema>;

export const evidenceCardSchema = z.object({
  id: z.string().trim().min(1).max(40),
  claim: z.string().trim().min(8).max(500),
  source_id: z.string().trim().min(1).max(80),
  chunk_id: z.string().trim().min(1).max(80),
  quote: z.string().trim().max(120).optional(),
  conflicts_with: z.string().trim().max(40).optional(),
}).strict();

export const evidenceCardsSchema = z.object({
  cards: z.array(evidenceCardSchema).max(40),
}).strict();
export type EvidenceCard = z.infer<typeof evidenceCardSchema>;

export const lessonSectionSchema = z.object({
  heading: z.string().trim().min(2).max(120),
  body_markdown: z.string().trim().min(24).max(6000),
  citations: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  kind: z.enum(["explanation", "example"]),
}).strict();

export const lessonSchema = z.object({
  title: z.string().trim().min(3).max(160),
  objectives_covered: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  sections: z.array(lessonSectionSchema).min(1).max(8),
  takeaways: z.array(z.object({
    text: z.string().trim().min(8).max(280),
    citations: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  }).strict()).min(1).max(8),
  gaps: z.array(z.string().trim().min(4).max(240)).max(12),
}).strict();
export type LessonDraft = z.infer<typeof lessonSchema>;

export const claimVerdictSchema = z.enum(["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "OFF_TOPIC"]);

export const verdictSchema = z.object({
  claims: z.array(z.object({
    text: z.string().trim().min(4).max(800),
    verdict: claimVerdictSchema,
    evidence_ids: z.array(z.string().trim().min(1).max(40)).max(12),
  }).strict()).min(1).max(40),
  scores: z.object({
    accuracy: z.number().min(0).max(5),
    coverage: z.number().min(0).max(5),
    focus: z.number().min(0).max(5),
    clarity: z.number().min(0).max(5),
    originality: z.number().min(0).max(5),
  }).strict(),
  fix_list: z.array(z.string().trim().min(4).max(400)).max(20),
}).strict();
export type Verdict = z.infer<typeof verdictSchema>;

export const quizItemSchema = z.object({
  question: z.string().trim().min(8).max(400),
  options: z.array(z.string().trim().min(1).max(220)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(8).max(500),
  objective_id: z.string().trim().min(1).max(40),
  evidence_ids: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
}).strict();

export const quizSchema = z.object({
  items: z.array(quizItemSchema).min(1).max(12),
}).strict();
export type QuizItem = z.infer<typeof quizItemSchema>;

export const lessonStatusSchema = z.enum(["ready", "needs_review", "blocked"]);
export type LessonStatus = z.infer<typeof lessonStatusSchema>;
