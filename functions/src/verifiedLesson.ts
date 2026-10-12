import { z } from "zod";

export type EvidenceChunk = { id: string; text: string; title: string; url: string; license: string; attribution: string };

const claimSchema = z.object({ id: z.string().min(1).max(40), text: z.string().min(8).max(1400), sourceChunkIds: z.array(z.string().uuid()).min(1) });
const paragraphSchema = z.object({ text: z.string().min(4).max(2200), claimIds: z.array(z.string().min(1)).min(1) });
const questionSchema = z.object({
  id: z.string().min(1).max(40), question: z.string().min(8).max(600), options: z.array(z.string().min(1).max(300)).length(4),
  correctAnswer: z.string().min(1).max(300), explanation: z.string().min(8).max(1200), conceptSlug: z.string().min(1).max(160),
  questionType: z.enum(["recall", "explain", "apply"]), sourceChunkIds: z.array(z.string().uuid()).min(1),
});

export const generatedLessonSchema = z.object({
  title: z.string().min(3).max(180),
  sections: z.array(z.object({ heading: z.string().min(2).max(180), paragraphs: z.array(paragraphSchema).min(1).max(12) })).min(1).max(12),
  claims: z.array(claimSchema).min(1).max(50),
  quizItems: z.array(questionSchema).min(3).max(12),
});

export const critiqueSchema = z.object({
  claims: z.array(z.object({ id: z.string(), supported: z.boolean(), reason: z.string().max(500) })),
  quizItems: z.array(z.object({ id: z.string(), solvedAnswer: z.string().max(300), supportedBySources: z.boolean(), reason: z.string().max(500) })),
});

export type GeneratedLesson = z.infer<typeof generatedLessonSchema>;
export type LessonCritic = {
  claims: Array<{ id: string; supported: boolean; reason: string }>;
  quizItems: Array<{ id: string; solvedAnswer: string; supportedBySources: boolean; reason: string }>;
};
export type LessonProvider = {
  generate(input: { goal: string; targetLevel: string; analogyContext?: string; chunks: EvidenceChunk[] }): Promise<unknown>;
  critique(input: { draft: GeneratedLesson; chunks: EvidenceChunk[] }): Promise<unknown>;
};

export type VerifiedLessonResult = {
  title: string;
  sections: Array<{ heading: string; paragraphs: Array<{ text: string; claimIds: string[] }> }>;
  claims: Array<{ id: string; text: string; sourceChunkIds: string[]; verified: boolean; verificationStatus: "supported" | "unsupported" }>;
  quizItems: Array<GeneratedLesson["quizItems"][number] & { verified: boolean }>;
  contentStatus: "ai_generated" | "ai_verified";
  verificationIssues: string[];
};

export async function generateVerifiedLesson(
  input: { goal: string; targetLevel: string; analogyContext?: string; chunks: EvidenceChunk[] },
  provider: LessonProvider,
): Promise<VerifiedLessonResult> {
  const chunkIds = new Set(input.chunks.map((chunk) => chunk.id));
  if (!input.chunks.length) return {
    title: input.goal,
    sections: [],
    claims: [],
    quizItems: [],
    contentStatus: "ai_generated",
    verificationIssues: ["No approved evidence was retrieved; no lesson content was generated."],
  };

  const draft = generatedLessonSchema.parse(await provider.generate(input));
  const critic = critiqueSchema.parse(await provider.critique({ draft, chunks: input.chunks }));
  const claimsById = new Map(draft.claims.map((claim) => [claim.id, claim]));
  const criticClaims = new Map(critic.claims.map((item) => [item.id, item]));
  const checkedClaims = draft.claims.map((claim) => {
    const citationValid = claim.sourceChunkIds.every((id) => chunkIds.has(id));
    const review = criticClaims.get(claim.id);
    const verified = citationValid && review?.supported === true;
    return { ...claim, verified, verificationStatus: verified ? "supported" as const : "unsupported" as const };
  });
  const supportedClaimIds = new Set(checkedClaims.filter((claim) => claim.verified).map((claim) => claim.id));
  const sections = draft.sections.map((section) => ({
    heading: section.heading,
    paragraphs: section.paragraphs.filter((paragraph) => paragraph.claimIds.every((id) => supportedClaimIds.has(id))),
  })).filter((section) => section.paragraphs.length > 0);

  const criticQuestions = new Map(critic.quizItems.map((item) => [item.id, item]));
  const quizItems = draft.quizItems.map((item) => {
    const citationValid = item.sourceChunkIds.length > 0 && item.sourceChunkIds.every((id) => chunkIds.has(id));
    const review = criticQuestions.get(item.id);
    const answerIsValid = item.options.includes(item.correctAnswer);
    const independentlySolved = review?.solvedAnswer.trim().toLocaleLowerCase() === item.correctAnswer.trim().toLocaleLowerCase();
    const verified = Boolean(citationValid && answerIsValid && review?.supportedBySources && independentlySolved);
    return { ...item, verified };
  });

  const verificationIssues: string[] = [];
  if (checkedClaims.some((claim) => !claim.verified)) verificationIssues.push("Unsupported or uncited claims were removed from the lesson.");
  if (quizItems.some((item) => !item.verified)) verificationIssues.push("Quiz items that failed independent answer or evidence checks were marked unverified.");
  if (!sections.length) verificationIssues.push("No lesson paragraph passed claim-level evidence verification.");
  const contentStatus = verificationIssues.length === 0 ? "ai_verified" : "ai_generated";
  return {
    title: draft.title,
    sections,
    claims: checkedClaims,
    quizItems,
    contentStatus,
    verificationIssues,
  };
}

export function buildLessonPrompts() {
  return {
    writer: [
      "Teach only from the supplied source passages; do not use outside knowledge for factual assertions.",
      "Create structured sections with short paragraphs. Every factual paragraph must cite one or more claim IDs.",
      "Every claim and every quiz item must cite at least one supplied source chunk ID. Use exact chunk IDs.",
      "Write at least three quiz items and include recall, explain, and apply question types.",
      "The correct answer must be one of the four exact option strings. Keep explanations traceable to evidence.",
      "If the sources do not support a fact, omit it instead of guessing.",
    ].join("\n"),
    critic: [
      "Independently verify each claim against only the supplied source passages.",
      "Independently solve each quiz item from the source passages; do not trust the proposed answer key.",
      "For every claim report whether it is supported. For every quiz item return your solved answer and whether the sources support the question.",
      "Return only the requested JSON and do not fill evidence gaps with outside knowledge.",
    ].join("\n"),
  };
}
