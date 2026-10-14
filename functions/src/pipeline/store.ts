import { serviceClient } from "../server";
import type { JobRecord, JobStore } from "./jobs";

export function createSupabaseJobStore(): JobStore {
  const db = () => serviceClient();
  return {
    async create(row) {
      const { error } = await db().from("v3_runs").insert({
        id: row.id,
        firebase_uid: row.owner_uid,
        status: row.status,
        stage: row.stage,
        percent: row.percent,
        input_hash: row.input_hash,
        learner_message: row.learner_message,
        spec: row.spec,
        course: row.course,
        per_lesson: row.per_lesson,
        publishable: row.publishable,
        cost_usd: row.cost_usd,
        error_code: row.error_code,
      });
      if (error) throw new Error("v3_run_insert_failed");
      return row;
    },
    async get(id, owner) {
      const { data, error } = await db().from("v3_runs")
        .select("id,firebase_uid,status,stage,percent,input_hash,learner_message,spec,course,per_lesson,publishable,cost_usd,error_code,created_at,updated_at")
        .eq("id", id).eq("firebase_uid", owner).maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        owner_uid: data.firebase_uid,
        status: data.status,
        stage: data.stage,
        percent: data.percent,
        input_hash: data.input_hash,
        learner_message: data.learner_message,
        spec: data.spec,
        course: data.course,
        per_lesson: data.per_lesson,
        publishable: data.publishable,
        cost_usd: Number(data.cost_usd) || 0,
        error_code: data.error_code,
        created_at: data.created_at,
        updated_at: data.updated_at,
      } as JobRecord;
    },
    async update(id, patch) {
      const mapped: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.status) mapped.status = patch.status;
      if (patch.stage) mapped.stage = patch.stage;
      if (patch.percent != null) mapped.percent = patch.percent;
      if (patch.learner_message !== undefined) mapped.learner_message = patch.learner_message;
      if (patch.spec !== undefined) mapped.spec = patch.spec;
      if (patch.course !== undefined) mapped.course = patch.course;
      if (patch.per_lesson !== undefined) mapped.per_lesson = patch.per_lesson;
      if (patch.publishable != null) mapped.publishable = patch.publishable;
      if (patch.cost_usd != null) mapped.cost_usd = patch.cost_usd;
      if (patch.error_code !== undefined) mapped.error_code = patch.error_code;
      const { error } = await db().from("v3_runs").update(mapped).eq("id", id);
      if (error) throw new Error("v3_run_update_failed");
    },
  };
}
