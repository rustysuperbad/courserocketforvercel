/** Pure helpers for learner-model screens; no Firebase side effects so they are unit-testable. */

export type ContentStatus = "ai_generated" | "ai_verified" | "human_reviewed";

/** Human-readable message for callable failures without exposing internals. */
export function describeCallableError(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = error instanceof Error ? error.message : "";
  if (code.endsWith("resource-exhausted")) return message || "You have reached today's limit.";
  if (code.endsWith("unauthenticated")) return "Please sign in again to continue.";
  if (code.endsWith("failed-precondition")) return message || "This feature is not set up yet.";
  if (code.endsWith("unavailable")) return message || "The service is temporarily unavailable.";
  if (code.endsWith("not-found")) return message || "That item could not be found.";
  if (code.endsWith("invalid-argument")) return message || "Please check your input.";
  return message || "Something went wrong. Please try again.";
}

export function idempotencyScope(uid: string, goal: string, domain: string, targetConceptSlug?: string): string {
  return `cr_job_key_${uid}:${domain}:${targetConceptSlug ?? ""}:${goal.trim().toLowerCase()}`;
}

/** Content status copy shown next to every lesson; never calls unverified content complete. */
export function contentStatusCopy(status: ContentStatus): { label: string; tone: "generated" | "verified" | "reviewed"; detail: string } {
  switch (status) {
    case "ai_verified":
      return { label: "AI verified", tone: "verified", detail: "Every claim was checked against cited sources and the quiz key was independently solved by a second model." };
    case "human_reviewed":
      return { label: "Human reviewed", tone: "reviewed", detail: "A reviewer confirmed this lesson." };
    default:
      return { label: "AI generated", tone: "generated", detail: "Written by AI. Not every claim passed verification; check important facts." };
  }
}

export function clampPercent(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}
