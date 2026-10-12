import { z } from "zod";

export const runStatusSchema = z.enum(["queued", "running", "completed", "failed", "blocked"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const jobDomainSchema = z.enum(["general", "networking"]);
export type JobDomain = z.infer<typeof jobDomainSchema>;

export const startJobSchema = z.object({
  goal: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(8).max(128),
  domain: jobDomainSchema.default("general"),
  targetConceptSlug: z.string().trim().min(1).max(160).optional(),
  /** Legacy Firestore course id; accepted and ignored so older clients keep working. */
  courseId: z.string().trim().max(128).optional(),
}).strict();
export type StartJobInput = z.infer<typeof startJobSchema>;

export type ReservationFailure = {
  code: "resource-exhausted" | "invalid-argument" | "internal";
  message: string;
};

/** Maps Postgres reservation exceptions to safe client-facing errors. */
export function reservationFailure(errorMessage: string | undefined): ReservationFailure {
  const message = errorMessage ?? "";
  if (message.includes("user_daily_quota_exceeded") || message.includes("quota_exceeded")) {
    return { code: "resource-exhausted", message: "You have reached today's course-generation limit." };
  }
  if (message.includes("project_spend_limit_exceeded") || message.includes("spend_limit_exceeded")) {
    return { code: "resource-exhausted", message: "Course generation is paused because today's project budget has been reached." };
  }
  if (message.startsWith("invalid_") || message.includes("invalid_")) {
    return { code: "invalid-argument", message: "Check the learning goal and try again." };
  }
  return { code: "internal", message: "Could not reserve a course-generation run." };
}

/**
 * Pessimistic cost reservation per run. Networking courses run a writer and a
 * critic for up to ~20 modules; general courses currently run a single module.
 */
export function estimateRunCostUsd(domain: JobDomain, perModuleUsd = 0.06, expectedModules?: number): number {
  const modules = expectedModules ?? (domain === "networking" ? 12 : 1);
  const estimate = Math.max(1, modules) * Math.max(0, perModuleUsd);
  return Math.round(estimate * 10_000) / 10_000;
}

/** Percent complete for module `index` of `total`, bounded to the 5–93 band reserved for module work. */
export function modulePercent(index: number, total: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return 5;
  const clampedIndex = Math.min(Math.max(index, 0), total);
  return 5 + Math.floor((clampedIndex / total) * 88);
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "blocked";
}

/** Public view of a generation run; omits internal provider details and never includes prompts. */
export function publicRunView(row: {
  id: string; status: string; progress: unknown; course_id: string | null; domain: string;
  actual_cost_usd: number | string; cost_estimate_usd: number | string; error_code: string | null;
  created_at: string; updated_at: string; fallback_used?: boolean | null;
}) {
  const status = runStatusSchema.safeParse(row.status);
  return {
    runId: row.id,
    status: status.success ? status.data : "failed",
    progress: row.progress && typeof row.progress === "object" ? row.progress as Record<string, unknown> : { stage: row.status, percent: 0 },
    courseId: row.course_id,
    domain: row.domain,
    actualCostUsd: Number(row.actual_cost_usd) || 0,
    estimatedCostUsd: Number(row.cost_estimate_usd) || 0,
    errorCode: row.error_code,
    fallbackUsed: Boolean(row.fallback_used),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
