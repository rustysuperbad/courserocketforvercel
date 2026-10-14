import { eventType } from "inngest";
import { z } from "zod";

export const v3CourseRequested = eventType("course/v3.requested", {
  schema: z.object({
    jobId: z.string().uuid(),
    ownerUid: z.string().min(1),
    text: z.string().max(8000),
  }),
});
