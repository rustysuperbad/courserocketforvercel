import { readFileSync, existsSync } from "node:fs";
import { NETWORKING_SOURCE_CHUNKS } from "./liveRetrieve";
import { runRagCourse } from "./pipeline";
import { createLiveProvider } from "./providers";
import { fakeProvidersEnabled } from "./config";
import { redactForLog } from "./redact";
import { settleGenerationQuota } from "./quotaSettle";

const SMOKE_BUDGET_USD = 0.05;
const SMOKE_GOAL = "TCP three-way handshake";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile(".env.courserocket26");
loadEnvFile(".env");

function artifactHasSecrets(blob: string): boolean {
  return /\b(?:gsk_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{16,})\b/.test(blob)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(blob);
}

async function main() {
  if (fakeProvidersEnabled()) {
    console.error("COURSE_AI_FAKE is on. Unset it for a live smoke.");
    process.exit(1);
  }
  const groq = Boolean(process.env.GROQ_API_KEY);
  console.log(`keys groq=${groq} (values not printed)`);
  if (!groq) {
    console.error("Need GROQ_API_KEY in functions/.env.courserocket26");
    process.exit(1);
  }

  const artifacts: unknown[] = [];
  let spent = 0;
  const started = Date.now();
  let quotaReleased: string | null = null;
  const finalize = async (_id: string, status: "completed" | "failed" | "blocked") => {
    quotaReleased = status;
  };

  try {
    const result = await runRagCourse(SMOKE_GOAL, {
      provider: createLiveProvider(),
      retrieve: async () => NETWORKING_SOURCE_CHUNKS,
      ownerUid: "live-smoke",
      saveArtifact: async (row) => { artifacts.push(row); },
      reserveUsd: async () => {
        /* reservation estimate is 0.12; the live cap is actual spend below */
      },
      settleUsd: async (actual) => {
        spent += actual;
        if (spent > SMOKE_BUDGET_USD) throw new Error("smoke_budget_exceeded");
      },
    });
    await settleGenerationQuota({
      quotaRunId: "smoke-quota",
      started,
      finalize,
      result,
    });
    const blob = JSON.stringify(artifacts);
    if (artifactHasSecrets(blob)) {
      console.error("artifacts_contained_secrets_or_emails");
      process.exit(1);
    }
    console.log(JSON.stringify({
      publishable: result.publishable,
      status: result.spec.status,
      topic: result.spec.topic,
      paidStages: result.paidStages,
      costUsd: result.costUsd,
      lessonStatuses: result.lessons.map((item) => item.status),
      title: result.lessons[0]?.title || "",
      quizItems: result.lessons[0]?.quiz.length || 0,
      failedGates: result.lessons.map((item) => item.gateResults.filter((gate) => !gate.passed).map((gate) => gate.name)),
      supportedClaims: result.lessons.map((item) => item.verdict?.claims.filter((claim) => claim.verdict === "SUPPORTED").length || 0),
      coercionRate: result.coercionRate,
      repairs: result.coercionRepairs,
      quotaReserved: true,
      quotaReleased,
      artifactCount: artifacts.length,
    }));
    if (result.spec.status !== "ok") process.exit(1);
  } catch (error) {
    await settleGenerationQuota({
      quotaRunId: "smoke-quota",
      started,
      finalize,
      failed: true,
    });
    const detail = error instanceof Error ? error.message : "live-smoke-failed";
    console.error(redactForLog(detail));
    console.log(JSON.stringify({
      quotaReserved: true,
      quotaReleased,
      costUsd: spent,
    }));
    process.exit(1);
  }
}

main();
