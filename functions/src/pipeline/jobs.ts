import { Inngest } from "inngest";
import { z } from "zod";
import { readEnv } from "../env";
import { HttpsError } from "../errors";
import { fakeProvidersEnabled } from "./config";
import { LEARNER_MESSAGES } from "./intake";
import { runCourse, toJobView, type CourseResult } from "./run";
import { sha256 } from "./text";
import { v3CourseRequested } from "./events";

export const startGenerationSchema = z.object({
  text: z.string().max(8000),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
}).strict();

export type JobStatus = "queued" | "running" | "completed" | "failed" | "blocked" | "needs_clarification";

export type JobRecord = {
  id: string;
  owner_uid: string;
  status: JobStatus;
  stage: string;
  percent: number;
  input_hash: string;
  learner_message: string | null;
  spec: unknown;
  course: unknown;
  per_lesson: unknown;
  publishable: boolean;
  cost_usd: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type JobStore = {
  create(row: JobRecord): Promise<JobRecord>;
  get(id: string, owner: string): Promise<JobRecord | null>;
  update(id: string, patch: Partial<JobRecord>): Promise<void>;
};

const memory = new Map<string, JobRecord>();

export function createMemoryJobStore(): JobStore {
  return {
    async create(row) {
      memory.set(row.id, row);
      return row;
    },
    async get(id, owner) {
      const row = memory.get(id);
      if (!row || row.owner_uid !== owner) return null;
      return row;
    },
    async update(id, patch) {
      const row = memory.get(id);
      if (!row) return;
      memory.set(id, { ...row, ...patch, updated_at: new Date().toISOString() });
    },
  };
}

export function publicJob(row: JobRecord) {
  return {
    jobId: row.id,
    status: row.status,
    stage: row.stage,
    percent: row.percent,
    spec: row.spec,
    learnerMessage: row.learner_message,
    perLesson: row.per_lesson,
    course: row.course,
    publishable: row.publishable,
    costUsd: row.cost_usd,
    errorCode: row.error_code,
  };
}

export async function processV3Job(jobId: string, text: string, owner: string, store: JobStore, deps: Parameters<typeof runCourse>[1] = {}): Promise<CourseResult> {
  const existing = await store.get(jobId, owner);
  if (!existing) {
    const now = new Date().toISOString();
    await store.create({
      id: jobId,
      owner_uid: owner,
      status: "queued",
      stage: "queued",
      percent: 0,
      input_hash: sha256(text).slice(0, 24),
      learner_message: null,
      spec: null,
      course: null,
      per_lesson: [],
      publishable: false,
      cost_usd: 0,
      error_code: null,
      created_at: now,
      updated_at: now,
    });
  }
  await store.update(jobId, { status: "running", stage: "intake", percent: 1 });
  try {
    const result = await runCourse(text, {
      ...deps,
      runId: jobId,
      ownerUid: owner,
      onProgress: async (event) => {
        await store.update(jobId, { stage: event.stage, percent: event.percent, status: "running" });
      },
    });
    const status: JobStatus = result.spec.status === "needs_clarification"
      ? "needs_clarification"
      : result.spec.status === "rejected"
        ? "blocked"
        : result.publishable
          ? "completed"
          : result.learnerMessage
            ? "blocked"
            : "completed";
    await store.update(jobId, {
      status,
      stage: "done",
      percent: 100,
      spec: result.spec,
      course: result.course,
      per_lesson: result.lessons.map((l) => ({ id: l.id, title: l.title, status: l.status })),
      publishable: result.publishable,
      cost_usd: result.costUsd,
      learner_message: result.learnerMessage,
      error_code: null,
    });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "failed";
    const learner = /quota|provider|GROQ|GEMINI|search_provider/i.test(detail)
      ? LEARNER_MESSAGES.provider
      : LEARNER_MESSAGES.provider;
    await store.update(jobId, {
      status: "failed",
      stage: "failed",
      percent: 0,
      learner_message: learner,
      error_code: "provider_error",
    });
    throw error;
  }
}

export async function startGenerationJob(text: string, owner: string, store: JobStore): Promise<{ jobId: string; status: JobStatus }> {
  const id = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();
  await store.create({
    id,
    owner_uid: owner,
    status: "queued",
    stage: "queued",
    percent: 0,
    input_hash: sha256(text).slice(0, 24),
    learner_message: null,
    spec: null,
    course: null,
    per_lesson: [],
    publishable: false,
    cost_usd: 0,
    error_code: null,
    created_at: now,
    updated_at: now,
  });
  if (fakeProvidersEnabled()) {
    await processV3Job(id, text, owner, store);
    const row = await store.get(id, owner);
    return { jobId: id, status: row?.status || "queued" };
  }
  try {
    const client = new Inngest({ id: "courserocket", eventKey: readEnv("INNGEST_EVENT_KEY") });
    await client.send(v3CourseRequested.create({ jobId: id, ownerUid: owner, text }));
  } catch {
    throw new HttpsError("unavailable", LEARNER_MESSAGES.provider);
  }
  return { jobId: id, status: "queued" };
}

void toJobView;
