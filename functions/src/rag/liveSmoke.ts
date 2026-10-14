import { readFileSync, existsSync } from "node:fs";
import { NETWORKING_SOURCE_CHUNKS } from "./liveRetrieve";
import { runRagCourse } from "./pipeline";
import { createLiveProvider } from "./providers";
import { fakeProvidersEnabled } from "./config";

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

async function main() {
  if (fakeProvidersEnabled()) {
    console.error("COURSE_AI_FAKE is on. Unset it for a live smoke.");
    process.exit(1);
  }
  const groq = Boolean(process.env.GROQ_API_KEY);
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  console.log(`keys groq=${groq} gemini=${gemini} (values not printed)`);
  if (!groq) {
    console.error("Need GROQ_API_KEY in functions/.env.courserocket26");
    process.exit(1);
  }
  const result = await runRagCourse("TCP three-way handshake", {
    provider: createLiveProvider(),
    retrieve: async () => NETWORKING_SOURCE_CHUNKS,
    ownerUid: "live-smoke",
  });
  console.log(JSON.stringify({
    publishable: result.publishable,
    status: result.spec.status,
    topic: result.spec.topic,
    paidStages: result.paidStages,
    costUsd: result.costUsd,
    lessonStatuses: result.lessons.map((item) => item.status),
    title: result.lessons[0]?.title || "",
    quizItems: result.lessons[0]?.quiz.length || 0,
  }));
  if (result.spec.status !== "ok") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "live-smoke-failed");
  process.exit(1);
});
