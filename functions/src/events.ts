import { eventType } from "inngest";
import { z } from "zod";

export const courseGenerationRequested = eventType("course/generation.requested", {
  schema: z.object({ runId: z.string().uuid() }),
});
