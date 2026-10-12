/** Mirrors the atomic checks enforced by reserve_generation_run in Postgres. */
export function canReserveProjectSpend(currentReservedUsd: number, currentActualUsd: number, estimateUsd: number, dailyLimitUsd: number): boolean {
  return [currentReservedUsd, currentActualUsd, estimateUsd, dailyLimitUsd].every(Number.isFinite) &&
    currentReservedUsd >= 0 && currentActualUsd >= 0 && estimateUsd >= 0 && dailyLimitUsd > 0 &&
    currentReservedUsd + currentActualUsd + estimateUsd <= dailyLimitUsd;
}

/** Mirrors the atomic per-user count check enforced by reserve_generation_run in Postgres. */
export function canStartDailyRun(currentRuns: number, dailyLimit: number): boolean {
  return Number.isInteger(currentRuns) && Number.isInteger(dailyLimit) && currentRuns >= 0 && dailyLimit > 0 && currentRuns < dailyLimit;
}
