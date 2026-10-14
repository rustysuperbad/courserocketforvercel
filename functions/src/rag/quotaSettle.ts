export type QuotaStatus = "completed" | "failed" | "blocked";

export type QuotaFinalizer = (
  runId: string,
  status: QuotaStatus,
  latencyMs: number,
  errorCode?: string,
  actualCostUsd?: number,
) => Promise<void>;

export type QuotaWorkResult = {
  spec: { status: string };
  publishable: boolean;
  costUsd: number;
};

/** Always release a reserved run: completed, blocked, or failed. */
export async function settleGenerationQuota(input: {
  quotaRunId: string | null;
  started: number;
  finalize: QuotaFinalizer;
  result?: QuotaWorkResult;
  failed?: boolean;
}): Promise<QuotaStatus | null> {
  if (!input.quotaRunId) return null;
  const latencyMs = Date.now() - input.started;
  if (input.failed || !input.result) {
    await input.finalize(input.quotaRunId, "failed", latencyMs, "rag_failed");
    return "failed";
  }
  const ok = input.result.spec.status === "ok" && input.result.publishable;
  const status: QuotaStatus = ok ? "completed" : "blocked";
  await input.finalize(
    input.quotaRunId,
    status,
    latencyMs,
    ok ? undefined : "rag_unpublishable",
    input.result.costUsd,
  );
  return status;
}
