"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.traceOperation = traceOperation;
exports.traceWorkflow = traceWorkflow;
exports.flushObservability = flushObservability;
exports.reportWorkflowError = reportWorkflowError;
const Sentry = __importStar(require("@sentry/node"));
const otel_1 = require("@langfuse/otel");
const tracing_1 = require("@langfuse/tracing");
const sdk_node_1 = require("@opentelemetry/sdk-node");
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
const langfuseProcessor = langfuseEnabled ? new otel_1.LangfuseSpanProcessor({ exportMode: "immediate" }) : undefined;
const telemetrySdk = langfuseEnabled
    ? new sdk_node_1.NodeSDK({ spanProcessors: [langfuseProcessor] })
    : undefined;
telemetrySdk?.start();
async function traceOperation(name, metadata, action) {
    if (!langfuseEnabled)
        return action();
    return (0, tracing_1.startActiveObservation)(name, async (span) => {
        const startedAt = Date.now();
        span.update({ metadata });
        try {
            const result = await action();
            span.update({ metadata: { ...metadata, latencyMs: Date.now() - startedAt } });
            return result;
        }
        catch (error) {
            span.update({ level: "ERROR", statusMessage: "Background operation failed", metadata: { ...metadata, latencyMs: Date.now() - startedAt } });
            throw error;
        }
    });
}
function traceWorkflow(runId, action) {
    return traceOperation("courserocket-generation", { runId, provider: "inngest", model: "workflow-skeleton", fallbackUsed: false }, action);
}
async function flushObservability() {
    await langfuseProcessor?.forceFlush();
    await Sentry.flush(1500);
}
function reportWorkflowError(runId) {
    Sentry.captureException(new Error("Background course workflow failed"), {
        tags: { area: "course-generation", runId },
    });
}
