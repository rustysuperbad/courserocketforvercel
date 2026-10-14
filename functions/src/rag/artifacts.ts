import type { SupabaseClient } from "@supabase/supabase-js";

export type ArtifactRow = {
  run_id: string;
  owner_uid: string;
  lesson_id: string | null;
  stage: string;
  prompt_name: string | null;
  prompt_hash: string | null;
  model_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  output: unknown;
  gate_results: unknown;
  status: string;
};

/** Never pass raw learner text in `output`. */
export async function saveRagArtifact(client: SupabaseClient, row: ArtifactRow): Promise<void> {
  const { error } = await client.from("rag_run_artifacts").insert({
    run_id: row.run_id,
    owner_uid: row.owner_uid,
    lesson_id: row.lesson_id,
    stage: row.stage,
    prompt_name: row.prompt_name,
    prompt_hash: row.prompt_hash,
    model_id: row.model_id,
    tokens_in: row.tokens_in,
    tokens_out: row.tokens_out,
    latency_ms: row.latency_ms,
    cost_usd: row.cost_usd,
    output: row.output ?? {},
    gate_results: row.gate_results,
    status: row.status,
  });
  if (error) throw new Error("Could not store a pipeline artifact.");
}
