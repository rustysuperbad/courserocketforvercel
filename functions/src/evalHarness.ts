import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadNetworkingCatalog } from "./catalog";
import { loadSourceCatalog } from "./ingestion";
import { estimateRunCostUsd } from "./jobs";
import { claimsHaveCitationsAndVerdicts, generateVerifiedLesson, type EvidenceChunk, type GeneratedLesson } from "./verifiedLesson";

const promptSchema = z.object({
  id: z.string(),
  goal: z.string(),
  conceptSlug: z.string(),
  query: z.string(),
});

export type EvalPrompt = z.infer<typeof promptSchema>;
export type PromptEval = {
  id: string;
  goal: string;
  conceptSlug: string;
  catalogCoverage: boolean;
  sourceCoverage: boolean;
  citationCoverage: boolean;
  quizKeyCorrectness: boolean;
  sourceUrlsValid: boolean;
  estimatedCostUsd: number;
  issues: string[];
};

export async function loadEvalPrompts(file = path.join(__dirname, "../eval/networking-prompts.json")): Promise<EvalPrompt[]> {
  return z.array(promptSchema).min(50).parse(JSON.parse(await readFile(file, "utf8")));
}

function mockLesson(chunk: EvidenceChunk, slug: string): GeneratedLesson {
  return {
    title: slug,
    sections: [{ heading: "From sources", paragraphs: [{ text: chunk.text.slice(0, 180), claimIds: ["c1"] }] }],
    claims: [{ id: "c1", text: chunk.text.slice(0, 120) || "Source-backed claim text.", sourceChunkIds: [chunk.id] }],
    quizItems: ["recall", "explain", "apply"].map((questionType, index) => ({
      id: `q${index + 1}`, question: `${slug} check ${index + 1}?`, options: ["A", "B", "C", "D"], correctAnswer: "A",
      explanation: "Grounded in the retrieved passage.", conceptSlug: slug, questionType: questionType as "recall" | "explain" | "apply", sourceChunkIds: [chunk.id],
    })),
  };
}

export type EvalSummary = {
  prompts: number;
  catalogHits: number;
  sourceHits: number;
  citationPass: number;
  quizPass: number;
  estimatedCourseUsd: number;
};

export async function evaluateLaunchDomain(): Promise<{ rows: PromptEval[]; summary: EvalSummary }> {
  const prompts = await loadEvalPrompts();
  const catalog = await loadNetworkingCatalog();
  const sources = await loadSourceCatalog();
  const chunk: EvidenceChunk = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    title: "Eval source", url: "https://en.wikipedia.org/wiki/Computer_network",
    license: "CC BY-SA 4.0", attribution: "Wikipedia contributors",
    text: "A computer network allows independent devices to exchange data using addresses, links, and protocols.",
  };
  const rows: PromptEval[] = [];
  for (const prompt of prompts) {
    const issues: string[] = [];
    const inCatalog = catalog.some((concept) => concept.id === prompt.conceptSlug);
    const tagged = sources.some((source) => source.conceptTags.includes(`networking-${prompt.conceptSlug}`));
    const lesson = await generateVerifiedLesson({ goal: prompt.goal, targetLevel: "beginner", chunks: [chunk] }, {
      generate: async () => mockLesson(chunk, prompt.conceptSlug),
      critique: async () => ({
        claims: [{ id: "c1", supported: true, reason: "Supported by the eval passage." }],
        quizItems: ["q1", "q2", "q3"].map((id) => ({ id, solvedAnswer: "A", supportedBySources: true, reason: "Solved." })),
      }),
    });
    const citationCoverage = claimsHaveCitationsAndVerdicts(lesson.claims) && lesson.claims.every((claim) => claim.verified);
    const quizKeyCorrectness = lesson.quizItems.length >= 3 && lesson.quizItems.every((item) => item.verified && item.options.includes(item.correctAnswer));
    const sourceUrlsValid = /^https:\/\//.test(chunk.url);
    if (!inCatalog) issues.push("Concept is missing from the launch DAG.");
    if (!tagged) issues.push("No ingested source is tagged for this concept.");
    if (!citationCoverage) issues.push("A claim lacked a citation or verification result.");
    if (!quizKeyCorrectness) issues.push("A quiz key failed independent checking.");
    if (!sourceUrlsValid) issues.push("Source URL is not https.");
    rows.push({
      id: prompt.id, goal: prompt.goal, conceptSlug: prompt.conceptSlug,
      catalogCoverage: inCatalog, sourceCoverage: tagged, citationCoverage, quizKeyCorrectness, sourceUrlsValid,
      estimatedCostUsd: estimateRunCostUsd("networking", 0.06, 1),
      issues,
    });
  }
  const summary = {
    prompts: rows.length,
    catalogHits: rows.filter((row) => row.catalogCoverage).length,
    sourceHits: rows.filter((row) => row.sourceCoverage).length,
    citationPass: rows.filter((row) => row.citationCoverage).length,
    quizPass: rows.filter((row) => row.quizKeyCorrectness).length,
    estimatedCourseUsd: estimateRunCostUsd("networking"),
  };
  return { rows, summary };
}

export function renderEvalReport(result: Awaited<ReturnType<typeof evaluateLaunchDomain>>): string {
  const lines = [
    "# Networking launch eval",
    "",
    `Prompts: ${result.summary.prompts}`,
    `Catalog coverage: ${result.summary.catalogHits}/${result.summary.prompts}`,
    `Tagged sources: ${result.summary.sourceHits}/${result.summary.prompts}`,
    `Citation + verification: ${result.summary.citationPass}/${result.summary.prompts}`,
    `Quiz keys: ${result.summary.quizPass}/${result.summary.prompts}`,
    `Estimated cost per networking course: $${result.summary.estimatedCourseUsd.toFixed(2)} (not a live provider bill)`,
    "",
    "This report used mocked providers. It does not prove live OpenAI/Gemini quality.",
    "",
    "| id | concept | catalog | sources | citations | quiz | issues |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...result.rows.map((row) => `| ${row.id} | ${row.conceptSlug} | ${row.catalogCoverage} | ${row.sourceCoverage} | ${row.citationCoverage} | ${row.quizKeyCorrectness} | ${row.issues.join("; ") || ""} |`),
  ];
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  evaluateLaunchDomain().then(async (result) => {
    const report = renderEvalReport(result);
    const outDir = path.join(__dirname, "../eval/output");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "networking-report.md"), report);
    console.info(report.split("\n").slice(0, 8).join("\n"));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Eval failed.");
    process.exitCode = 1;
  });
}
