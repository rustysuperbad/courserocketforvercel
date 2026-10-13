import { z } from "zod";
import { conceptInputSchema, validateConceptDag, type Concept } from "./learning";
import catalogJson from "./networking-concepts.json";

export const diagnosticItemSchema = z.object({
  question: z.string().min(8).max(600),
  options: z.array(z.string().min(1).max(300)).length(4),
  correctAnswer: z.string().min(1).max(300),
  explanation: z.string().min(8).max(800),
  questionType: z.enum(["recall", "explain", "apply"]),
}).superRefine((item, ctx) => {
  if (!item.options.includes(item.correctAnswer)) {
    ctx.addIssue({ code: "custom", message: "Diagnostic correctAnswer must match one of the options.", path: ["correctAnswer"] });
  }
});

export const networkingConceptSchema = conceptInputSchema.extend({
  description: z.string().min(8).max(800),
  level: z.number().int().min(1).max(5),
  objectives: z.array(z.string().min(4).max(240)).min(1).max(8),
  diagnostic: diagnosticItemSchema,
});

export const networkingCatalogSchema = z.array(networkingConceptSchema).min(8).max(300);
export type NetworkingConcept = z.infer<typeof networkingConceptSchema>;
export type PublicDiagnostic = { question: string; options: string[]; questionType: "recall" | "explain" | "apply" };
export type PublicConcept = Omit<NetworkingConcept, "diagnostic"> & { diagnostic: PublicDiagnostic };

export const INTEREST_SUGGESTIONS = [
  "web development",
  "IT support",
  "cybersecurity",
  "cloud computing",
  "gaming and home labs",
  "self-hosting",
] as const;

export function catalogFilePath(_fromDir = ""): string {
  return "networking-concepts.json";
}

export function parseNetworkingCatalog(raw: unknown): NetworkingConcept[] {
  const concepts = networkingCatalogSchema.parse(raw);
  validateConceptDag(concepts.map(toGraphConcept));
  const ids = new Set(concepts.map((concept) => concept.id));
  if (ids.size !== concepts.length) throw new Error("Concept IDs must be unique.");
  return concepts;
}

export function toGraphConcept(concept: NetworkingConcept): Concept {
  return {
    id: concept.id,
    title: concept.title,
    estimatedMinutes: concept.estimatedMinutes,
    prerequisiteIds: concept.prerequisiteIds,
  };
}

export function publicConceptView(concept: NetworkingConcept): PublicConcept {
  return {
    ...concept,
    diagnostic: {
      question: concept.diagnostic.question,
      options: concept.diagnostic.options,
      questionType: concept.diagnostic.questionType,
    },
  };
}

export async function loadNetworkingCatalog(_file = catalogFilePath()): Promise<NetworkingConcept[]> {
  return parseNetworkingCatalog(catalogJson);
}

export function withNetworkingPrefix(slug: string): string {
  const trimmed = slug.trim();
  return trimmed.startsWith("networking-") ? trimmed : `networking-${trimmed}`;
}

export function stripNetworkingPrefix(slug: string): string {
  return slug.replace(/^networking-/, "");
}
