import { invokeBackend } from "./backend";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "needs_clarification";

export type GenerationJob = {
  jobId: string;
  status: JobStatus;
  stage: string;
  percent?: number;
  spec?: { status?: string; topic?: string; level?: string; goal?: string; question?: string; ignored_requests?: string[] };
  learnerMessage?: string | null;
  perLesson?: Array<{ id: string; title: string; status: string }>;
  course?: unknown;
  publishable?: boolean;
  summary?: { ready?: number; needs_review?: number; blocked?: number };
  costUsd?: number;
  errorCode?: string | null;
};

export async function startGeneration(text: string): Promise<{ jobId: string; status: JobStatus }> {
  return invokeBackend("startGeneration", { text }, 20000);
}

export async function getJob(jobId: string): Promise<GenerationJob> {
  return invokeBackend("getJob", { jobId }, 15000);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForJob(jobId: string, timeoutMs = 170000): Promise<GenerationJob> {
  const started = Date.now();
  let delay = 800;
  while (Date.now() - started < timeoutMs) {
    const job = await getJob(jobId);
    if (job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "needs_clarification") {
      return job;
    }
    await sleep(delay);
    delay = Math.min(4000, Math.floor(delay * 1.4));
  }
  throw new Error("The course writer timed out. Please try again.");
}
