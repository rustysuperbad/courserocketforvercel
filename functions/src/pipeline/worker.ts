import { z } from "zod";
import { readEnv } from "../env";
import { inngest } from "../inngestClient";
import { v3CourseRequested } from "./events";
import { createMemoryJobStore, processV3Job } from "./jobs";
import { createSupabaseJobStore } from "./store";

const jobIdSchema = z.string().uuid();

export const processV3CourseGeneration = inngest.createFunction(
  {
    id: "course-generation-pipeline-v3",
    retries: 2,
    idempotency: "event.data.jobId",
    triggers: v3CourseRequested,
  },
  async ({ event }) => {
    const jobId = jobIdSchema.parse(event.data.jobId);
    const owner = String(event.data.ownerUid || "");
    const text = String(event.data.text || "");
    const store = readEnv("SUPABASE_URL") ? createSupabaseJobStore() : createMemoryJobStore();
    await processV3Job(jobId, text, owner, store);
    return { jobId };
  },
);

