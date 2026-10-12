import * as Sentry from "@sentry/node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startActiveObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

const sentryDsn = process.env.SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 0.05,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((value) => ({
          ...value,
          value: value.type ? `${value.type}: background workflow error` : "background workflow error",
          stacktrace: undefined,
        }));
      }
      return event;
    },
  });
}

const langfuseEnabled = Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
const langfuseProcessor = langfuseEnabled ? new LangfuseSpanProcessor({ exportMode: "immediate" }) : undefined;
const telemetrySdk = langfuseEnabled
  ? new NodeSDK({ spanProcessors: [langfuseProcessor!] })
  : undefined;
telemetrySdk?.start();

export async function traceOperation<T>(name: string, metadata: Record<string, unknown>, action: () => Promise<T>, completionMetadata?: (result: T) => Record<string, unknown>): Promise<T> {
  if (!langfuseEnabled) return action();
  return startActiveObservation(name, async (span) => {
    const startedAt = Date.now();
    span.update({ metadata });
    try {
      const result = await action();
      span.update({ metadata: { ...metadata, ...completionMetadata?.(result), latencyMs: Date.now() - startedAt } });
      return result;
    } catch (error) {
      span.update({ level: "ERROR", statusMessage: "Background operation failed", metadata: { ...metadata, latencyMs: Date.now() - startedAt } });
      throw error;
    }
  });
}

export function traceWorkflow<T>(runId: string, action: () => Promise<T>): Promise<T> {
  return traceOperation("courserocket-generation", { runId, provider: "inngest", model: "workflow-skeleton", inputTokens: 0, outputTokens: 0, costEstimateUsd: 0, fallbackUsed: false }, action);
}

export async function flushObservability(): Promise<void> {
  await langfuseProcessor?.forceFlush();
  await Sentry.flush(1500);
}

export function reportWorkflowError(runId: string): void {
  Sentry.captureException(new Error("Background course workflow failed"), {
    tags: { area: "course-generation", runId },
  });
}
