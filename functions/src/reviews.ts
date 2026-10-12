import type { Card, Grade } from "ts-fsrs" with { "resolution-mode": "import" };

export type ReviewRating = "again" | "hard" | "good" | "easy";
export type SerializedCard = Omit<Card, "due" | "last_review"> & { due: string; last_review?: string };

function restoreCard(raw: unknown, now: Date, createEmpty: (date: Date) => Card): Card {
  if (!raw || typeof raw !== "object") return createEmpty(now);
  const value = raw as Record<string, unknown>;
  const numberOr = (key: string, fallback: number) => typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : fallback;
  const due = typeof value.due === "string" || typeof value.due === "number" ? new Date(value.due) : now;
  const lastReview = typeof value.last_review === "string" || typeof value.last_review === "number" ? new Date(value.last_review) : undefined;
  if (!Number.isFinite(due.getTime()) || (lastReview && !Number.isFinite(lastReview.getTime()))) return createEmpty(now);
  return {
    due,
    last_review: lastReview,
    stability: numberOr("stability", 0),
    difficulty: numberOr("difficulty", 0),
    elapsed_days: numberOr("elapsed_days", 0),
    scheduled_days: numberOr("scheduled_days", 0),
    learning_steps: numberOr("learning_steps", 0),
    reps: numberOr("reps", 0),
    lapses: numberOr("lapses", 0),
    state: numberOr("state", 0) as Card["state"],
  };
}

export async function scheduleReview(rawCard: unknown, rating: ReviewRating, now = new Date()): Promise<{ card: SerializedCard; dueAt: string }> {
  const { createEmptyCard, fsrs, Rating } = await import("ts-fsrs");
  const ratings = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };
  const card = restoreCard(rawCard, now, createEmptyCard);
  const next = fsrs({ enable_fuzz: false }).next(card, now, ratings[rating] as Grade).card;
  const { due, last_review, ...cardState } = next;
  const serialized: SerializedCard = {
    ...cardState,
    due: due.toISOString(),
    ...(last_review ? { last_review: last_review.toISOString() } : {}),
  };
  return { card: serialized, dueAt: serialized.due };
}
