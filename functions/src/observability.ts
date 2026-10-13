/** Tracing is optional. Node-only Sentry/Langfuse SDKs are not loaded on Edge. */

export async function traceOperation<T>(
  _name: string,
  _metadata: Record<string, unknown>,
  action: () => Promise<T>,
  _completionMetadata?: (result: T) => Record<string, unknown>,
): Promise<T> {
  return action();
}

export function traceWorkflow<T>(_runId: string, action: () => Promise<T>): Promise<T> {
  return action();
}

export async function flushObservability(): Promise<void> {
  return;
}

export function reportWorkflowError(runId: string): void {
  console.error("Background course workflow failed", runId);
}
