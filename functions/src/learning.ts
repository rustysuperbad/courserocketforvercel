import { z } from "zod";

export const conceptInputSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(180),
  estimatedMinutes: z.number().int().positive().max(600).default(20),
  prerequisiteIds: z.array(z.string().min(1).max(120)).default([]),
});

export const networkingConceptsSchema = z.array(conceptInputSchema).min(1).max(300);
export type Concept = z.infer<typeof conceptInputSchema>;
export type Mastery = { pKnown: number; attempts?: number; correctAttempts?: number };
export type LearningStep = { conceptId: string; title: string; action: "learn" | "shorten" | "skip"; pKnown: number; estimatedMinutes: number };

export function validateConceptDag(input: unknown): Concept[] {
  const concepts = networkingConceptsSchema.parse(input);
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  if (byId.size !== concepts.length) throw new Error("Concept IDs must be unique.");
  for (const concept of concepts) {
    for (const prerequisiteId of concept.prerequisiteIds) {
      if (!byId.has(prerequisiteId)) throw new Error(`Unknown prerequisite '${prerequisiteId}' for '${concept.id}'.`);
      if (prerequisiteId === concept.id) throw new Error(`Concept '${concept.id}' cannot require itself.`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Prerequisite graph contains a cycle at '${id}'.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisiteId of byId.get(id)?.prerequisiteIds ?? []) visit(prerequisiteId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const concept of concepts) visit(concept.id);
  return concepts;
}

export function buildLearningPath(
  rawConcepts: unknown,
  targetConceptId: string,
  mastery: Record<string, Mastery | undefined>,
): LearningStep[] {
  const concepts = validateConceptDag(rawConcepts);
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  if (!byId.has(targetConceptId)) throw new Error(`Unknown learning goal '${targetConceptId}'.`);
  const required = new Set<string>();
  const include = (id: string): void => {
    if (required.has(id)) return;
    required.add(id);
    for (const prerequisiteId of byId.get(id)?.prerequisiteIds ?? []) include(prerequisiteId);
  };
  include(targetConceptId);

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of required) {
    indegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const id of required) {
    for (const prerequisiteId of byId.get(id)!.prerequisiteIds) {
      if (!required.has(prerequisiteId)) continue;
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
      dependents.get(prerequisiteId)!.push(id);
    }
  }
  const queue = [...required].filter((id) => indegree.get(id) === 0).sort();
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const next of dependents.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (ordered.length !== required.size) throw new Error("Unable to order the prerequisite graph.");

  return ordered.map((id) => {
    const concept = byId.get(id)!;
    const pKnown = Math.max(0, Math.min(1, mastery[id]?.pKnown ?? 0.1));
    const action = pKnown >= 0.85 ? "skip" : pKnown >= 0.65 ? "shorten" : "learn";
    const estimatedMinutes = action === "skip" ? 0 : Math.max(5, Math.ceil(concept.estimatedMinutes * (action === "shorten" ? 0.5 : 1)));
    return { conceptId: id, title: concept.title, action, pKnown, estimatedMinutes };
  });
}

export function updateMastery(
  prior: number,
  isCorrect: boolean,
  parameters: { guess?: number; slip?: number; learn?: number } = {},
): number {
  const pKnown = Math.max(0, Math.min(1, prior));
  const guess = Math.max(0.001, Math.min(0.49, parameters.guess ?? 0.2));
  const slip = Math.max(0.001, Math.min(0.49, parameters.slip ?? 0.1));
  const learn = Math.max(0, Math.min(0.99, parameters.learn ?? 0.12));
  const likelihoodKnown = isCorrect ? 1 - slip : slip;
  const likelihoodUnknown = isCorrect ? guess : 1 - guess;
  const denominator = pKnown * likelihoodKnown + (1 - pKnown) * likelihoodUnknown;
  const posterior = denominator === 0 ? pKnown : (pKnown * likelihoodKnown) / denominator;
  return Math.max(0, Math.min(1, posterior + (1 - posterior) * learn));
}

export function applyAnswer(prior: Mastery | undefined, isCorrect: boolean): Mastery {
  const previous = prior ?? { pKnown: 0.1, attempts: 0, correctAttempts: 0 };
  return {
    pKnown: updateMastery(previous.pKnown, isCorrect),
    attempts: (previous.attempts ?? 0) + 1,
    correctAttempts: (previous.correctAttempts ?? 0) + Number(isCorrect),
  };
}
