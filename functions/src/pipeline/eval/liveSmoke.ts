import { PIPELINE_CONFIG } from "../config";
import { fakeProvidersEnabled } from "../config";
import { createConfiguredProvider } from "../models";
import { createLiveSearch } from "../research/discover";
import { fetchPublicHttps } from "../research/ssrf";
import { runCourse } from "../run";

const TOPICS = [
  "SQL window functions RANK and SUM",
  "Kalman filter for a 1D tracker",
  "Petrarchan sonnet structure",
];

function metric(result: Awaited<ReturnType<typeof runCourse>>) {
  const claims = result.lessons.flatMap((l) => l.verdict?.claims || []);
  const supported = claims.filter((c) => c.verdict === "SUPPORTED").length;
  const off = claims.filter((c) => c.verdict === "OFF_TOPIC").length;
  const leak = result.lessons.flatMap((l) => l.gateResults.filter((g) => g.name === "prompt_leakage" && !g.passed)).length;
  const cited = result.lessons.every((l) => l.gateResults.filter((g) => g.name === "citations").every((g) => g.passed));
  const obj = result.lessons.every((l) => (l.quiz?.length || 0) >= 2);
  return {
    topic: result.spec.topic,
    publishable: result.publishable,
    groundedRatio: claims.length ? supported / claims.length : 0,
    offTopicRate: claims.length ? off / claims.length : 0,
    promptLeakRate: leak,
    citationCoverage: cited,
    objectiveCoverage: obj,
    researchRounds: result.lessons.map((l) => l.researchRounds),
    costUsd: result.costUsd,
  };
}

async function main() {
  if (fakeProvidersEnabled()) {
    console.log("live smoke skipped: COURSE_AI_FAKE is set");
    return;
  }
  const cap = PIPELINE_CONFIG.runBudgetUsd;
  const started = Date.now();
  for (const topic of TOPICS) {
    const result = await runCourse(topic, {
      provider: createConfiguredProvider(),
      search: createLiveSearch(),
      fetch: async (url) => {
        const page = await fetchPublicHttps(url, {
          timeoutMs: PIPELINE_CONFIG.fetchTimeoutMs,
          maxBytes: PIPELINE_CONFIG.fetchMaxBytes,
          maxRedirects: PIPELINE_CONFIG.maxRedirects,
        });
        return { url: page.url, body: page.body, status: page.status };
      },
    });
    if (result.costUsd > cap) throw new Error("smoke_budget_exceeded");
    console.log(JSON.stringify({ ...metric(result), ms: Date.now() - started }));
  }
}

if (process.argv[1]?.endsWith("liveSmoke.ts")) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "smoke_failed";
    console.error(message.replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]").replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]").replace(/tvly-[A-Za-z0-9_-]+/g, "[redacted]"));
    process.exit(1);
  });
}
