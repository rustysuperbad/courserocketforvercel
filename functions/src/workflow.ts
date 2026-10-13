import { Inngest } from "inngest";
import { readEnv } from "./env";
import { z } from "zod";
import { geminiApiKey, openAiApiKey } from "./config";
import { flushObservability, reportWorkflowError, traceWorkflow } from "./observability";
import { createVerifiedLessonProvider } from "./providers";
import { generateVerifiedLesson } from "./verifiedLesson";
import { analogyContextFrom, buildVerifiedModule, loadCoursePath, persistLessonModule, type GenerationRun } from "./pipeline";
import { checkUrls } from "./linkCheck";
import { courseGenerationRequested } from "./events";
import { ensureCourse, findResourcesForModule, finalizeRun, lessonFromCache, persistProgress, retrieveForGeneration, serviceClient, storeVerifiedCache } from "./server";

const inngest = new Inngest({
  id: "courserocket",
  signingKey: readEnv("INNGEST_SIGNING_KEY"),
});
const runIdSchema = z.string().uuid();

export const processCourseGeneration = inngest.createFunction(
  {
    id: "course-generation-pipeline-v1",
    retries: 3,
    idempotency: "event.data.runId",
    triggers: courseGenerationRequested,
    onFailure: async ({ event, step: failureStep }) => {
      const originalEvent = (event.data as { event?: { data?: { runId?: unknown } } }).event;
      const parsedRunId = runIdSchema.safeParse(originalEvent?.data?.runId);
      if (!parsedRunId.success) return;
      reportWorkflowError(parsedRunId.data);
      await failureStep.run("mark-course-run-failed", async () => finalizeRun(parsedRunId.data, "failed", 0, "workflow_failed"));
      await flushObservability();
    },
  },
  async ({ event, step }) => {
    const runId = runIdSchema.parse(event.data.runId);
    const startedAt = Date.now();
    const { data: run, error: runError } = await serviceClient().from("generation_runs")
      .select("id,firebase_uid,goal,domain,target_concept_slug,course_id")
      .eq("id", runId).single();
    if (runError || !run) throw new Error("Generation run could not be loaded.");
    const snapshot = run as GenerationRun;
    try {
      return await traceWorkflow(runId, async () => {
        await step.run("mark-run-running", async () => {
          await persistProgress(runId, "accepted", 3);
          return { accepted: true };
        });
        const coursePath = await loadCoursePath(serviceClient(), snapshot);
        const courseId = await step.run("ensure-course-record", () => ensureCourse(snapshot, coursePath.totalMinutes));
        const masteredTitles = coursePath.steps.filter((item) => item.action === "skip").map((item) => item.title).slice(0, 8).join(", ");
        const { data: profile } = await serviceClient().from("learner_profiles").select("known_topics, interests").eq("firebase_uid", snapshot.firebase_uid).maybeSingle();
        const analogy = analogyContextFrom(profile, masteredTitles);
        let verifiedCount = 0;
        let evidenceMissingCount = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;

        for (let position = 0; position < coursePath.steps.length; position += 1) {
          const item = coursePath.steps[position]!;
          const concept = coursePath.conceptById.get(item.conceptId);
          const percent = 5 + Math.floor((position / Math.max(coursePath.steps.length, 1)) * 88);
          await persistProgress(runId, `module-${position + 1}-of-${coursePath.steps.length}`, percent);
          const result = await step.run(`build-module-${position + 1}`, async () => {
            const built = await buildVerifiedModule({
              step: item, concept, goal: snapshot.goal, domain: snapshot.domain, ownerUid: snapshot.firebase_uid, analogyContext: analogy,
              retrieve: retrieveForGeneration,
              writeLesson: async (input) => {
                const model = readEnv("OPENAI_MODEL", "gpt-6.1-sol");
                const criticModel = readEnv("GEMINI_MODEL", "gemini-3.8-flash");
                const lessonWriter = createVerifiedLessonProvider({ openAiKey: openAiApiKey.value(), geminiKey: geminiApiKey.value(), openAiModel: model, geminiModel: criticModel });
                const lesson = await generateVerifiedLesson(input, lessonWriter.provider);
                return { lesson, usage: lessonWriter.usage };
              },
              findResources: findResourcesForModule,
              lookupCache: lessonFromCache,
              storeCache: storeVerifiedCache,
              checkLinks: (urls) => checkUrls(urls),
            });
            if (item.action === "skip") {
              const { error } = await serviceClient().from("modules").upsert({
                course_id: courseId, concept_id: concept?.id ?? null, position, title: item.title,
                summary: "Skipped based on your current mastery estimate.",
                body: { learningStatus: "skipped_mastered", pKnown: item.pKnown }, content_status: "ai_generated",
              }, { onConflict: "course_id,position" });
              if (error) throw new Error("Could not save the mastered concept step.");
              return built;
            }
            if (built.lesson) {
              await persistLessonModule(serviceClient(), {
                courseId, position, step: item, concept, lesson: built.lesson, sources: built.sources, resources: built.resources, linkStatus: built.linkStatus,
              });
            }
            for (const [url, status] of Object.entries(built.linkStatus)) {
              await serviceClient().from("sources").update({ link_status: status, link_checked_at: new Date().toISOString() }).eq("url", url);
            }
            const model = readEnv("OPENAI_MODEL", "gpt-6.1-sol");
            const criticModel = readEnv("GEMINI_MODEL", "gemini-3.8-flash");
            const { error: usageError } = await serviceClient().rpc("record_generation_usage", {
              p_run_id: runId, p_usage_key: `module-${position}`,
              p_provider: built.cacheHit ? "cache" : "openai+google-gemini",
              p_model: built.cacheHit ? "verified-module-cache" : `${model}+${criticModel}`,
              p_input_tokens: built.inputTokens, p_output_tokens: built.outputTokens, p_cost_usd: built.costUsd,
              p_latency_ms: Date.now() - startedAt,
            });
            if (usageError) throw new Error("Could not save generation usage metadata.");
            return built;
          });
          totalInputTokens += result.inputTokens;
          totalOutputTokens += result.outputTokens;
          totalCostUsd += result.costUsd;
          if (result.status === "evidence-missing") evidenceMissingCount += 1;
          if (result.status === "ai_verified" || result.status === "cached") verifiedCount += 1;
        }

        const allReviewed = verifiedCount + coursePath.steps.filter((item) => item.action === "skip").length === coursePath.steps.length && evidenceMissingCount === 0;
        const courseStatus = allReviewed ? "ready" : "draft";
        const courseContentStatus = allReviewed ? "ai_verified" : "ai_generated";
        await step.run("finish-course-record", async () => {
          const { error } = await serviceClient().from("courses").update({ status: courseStatus, content_status: courseContentStatus, estimated_minutes: coursePath.totalMinutes, updated_at: new Date().toISOString() }).eq("id", courseId);
          if (error) throw new Error("Could not finish the course record.");
          const resultStatus = evidenceMissingCount === coursePath.steps.length ? "blocked" : "completed";
          await persistProgress(runId, resultStatus === "blocked" ? "evidence-unavailable" : "course-ready", 100,
            resultStatus === "blocked" ? "No approved evidence was available; no lesson was marked complete." : allReviewed ? "Every generated module passed claim and quiz verification." : "Course saved with modules that still need evidence review.");
          await finalizeRun(runId, resultStatus, Date.now() - startedAt, resultStatus === "blocked" ? "evidence_unavailable" : undefined);
          return { status: resultStatus, contentStatus: courseContentStatus };
        });
        return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd, verifiedCount, moduleCount: coursePath.steps.length };
      });
    } finally {
      await flushObservability();
    }
  },
);

export { inngest };
