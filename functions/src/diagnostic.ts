import { applyAnswer, buildLearningPath, type Concept, type Mastery } from "./learning";
import type { NetworkingConcept } from "./catalog";

export const DIAGNOSTIC_QUESTION_LIMIT = 8;

export function normalizeChoice(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function gradeDiagnosticChoice(concept: NetworkingConcept, selectedAnswer: string): boolean {
  return normalizeChoice(selectedAnswer) === normalizeChoice(concept.diagnostic.correctAnswer);
}

/** Immediate prerequisite with the lowest mastery; used when a question is missed. */
export function weakestPrerequisite(concepts: Concept[], conceptId: string, mastery: Record<string, Mastery | undefined>): string | null {
  const concept = concepts.find((item) => item.id === conceptId);
  if (!concept?.prerequisiteIds.length) return null;
  let weakest: string | null = null;
  let lowest = Number.POSITIVE_INFINITY;
  for (const prerequisiteId of concept.prerequisiteIds) {
    const pKnown = mastery[prerequisiteId]?.pKnown ?? 0.1;
    if (pKnown < lowest) {
      lowest = pKnown;
      weakest = prerequisiteId;
    }
  }
  return weakest;
}

/**
 * Next concept to probe: the earliest path step that is not skipped and not
 * already asked. A missed answer can pin the next item to a weaker prerequisite.
 */
export function nextDiagnosticConceptId(
  concepts: Concept[],
  targetConceptId: string,
  mastery: Record<string, Mastery | undefined>,
  asked: ReadonlySet<string>,
  preferId?: string | null,
): string | null {
  if (asked.size >= DIAGNOSTIC_QUESTION_LIMIT) return null;
  if (preferId && !asked.has(preferId) && concepts.some((concept) => concept.id === preferId)) return preferId;
  const path = buildLearningPath(concepts, targetConceptId, mastery);
  for (const step of path) {
    if (asked.has(step.conceptId) || step.action === "skip") continue;
    return step.conceptId;
  }
  return null;
}

export type DiagnosticUpdate = {
  mastery: Record<string, Mastery>;
  asked: string[];
  preferNextId: string | null;
  isCorrect: boolean;
};

/**
 * BKT update for the answered concept. A miss also applies a weaker unknown
 * update to the weakest prerequisite so the next question can fill the gap.
 */
export function applyDiagnosticResult(
  concepts: Concept[],
  conceptId: string,
  isCorrect: boolean,
  mastery: Record<string, Mastery | undefined>,
  asked: readonly string[],
): DiagnosticUpdate {
  const nextMastery: Record<string, Mastery> = {};
  for (const [id, value] of Object.entries(mastery)) {
    if (value) nextMastery[id] = value;
  }
  nextMastery[conceptId] = applyAnswer(mastery[conceptId], isCorrect);
  let preferNextId: string | null = null;
  if (!isCorrect) {
    const gap = weakestPrerequisite(concepts, conceptId, nextMastery);
    if (gap && gap !== conceptId) {
      nextMastery[gap] = applyAnswer(nextMastery[gap] ?? mastery[gap], false);
      preferNextId = gap;
    }
  }
  const askedSet = new Set(asked);
  askedSet.add(conceptId);
  return { mastery: nextMastery, asked: [...askedSet], preferNextId, isCorrect };
}

export function masteryRowsFromKnownTopics(knownIds: readonly string[]): Record<string, Mastery> {
  return Object.fromEntries(knownIds.map((id) => [id, { pKnown: 0.7, attempts: 0, correctAttempts: 0 }]));
}
