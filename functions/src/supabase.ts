import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type RunRow = {
  id: string;
  firebase_uid: string;
  goal: string;
  status: string;
  cost_estimate_usd: number;
  actual_cost_usd: number;
};

let cached: SupabaseClient | undefined;

export function getServiceSupabase(url: string, serviceKey: string): SupabaseClient {
  if (!url || !serviceKey) throw new Error("Supabase service credentials are not configured.");
  if (!cached) cached = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
