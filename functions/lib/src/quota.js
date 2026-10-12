"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canReserveProjectSpend = canReserveProjectSpend;
exports.canStartDailyRun = canStartDailyRun;
/** Mirrors the atomic checks enforced by reserve_generation_run in Postgres. */
function canReserveProjectSpend(currentReservedUsd, currentActualUsd, estimateUsd, dailyLimitUsd) {
    return [currentReservedUsd, currentActualUsd, estimateUsd, dailyLimitUsd].every(Number.isFinite) &&
        currentReservedUsd >= 0 && currentActualUsd >= 0 && estimateUsd >= 0 && dailyLimitUsd > 0 &&
        currentReservedUsd + currentActualUsd + estimateUsd <= dailyLimitUsd;
}
/** Mirrors the atomic per-user count check enforced by reserve_generation_run in Postgres. */
function canStartDailyRun(currentRuns, dailyLimit) {
    return Number.isInteger(currentRuns) && Number.isInteger(dailyLimit) && currentRuns >= 0 && dailyLimit > 0 && currentRuns < dailyLimit;
}
