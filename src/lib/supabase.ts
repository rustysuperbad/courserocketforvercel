import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auth } from "./firebase";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
  public: {
    Tables: {
      concepts: { Row: { id: string; slug: string; domain: string; title: string; description: string; level: number; estimated_minutes: number; objectives: Json; created_at: string }; Insert: Partial<Database["public"]["Tables"]["concepts"]["Row"]> & Pick<Database["public"]["Tables"]["concepts"]["Row"], "slug" | "domain" | "title" | "description">; Update: Partial<Database["public"]["Tables"]["concepts"]["Row"]>; Relationships: [] };
      generation_runs: { Row: { id: string; firebase_uid: string; idempotency_key: string; goal: string; status: "queued" | "running" | "completed" | "failed" | "blocked"; progress: Json; provider: string | null; model: string | null; fallback_used: boolean; input_tokens: number; output_tokens: number; cost_estimate_usd: number; actual_cost_usd: number; latency_ms: number | null; created_at: string; updated_at: string }; Insert: never; Update: never; Relationships: [] };
      learner_mastery: { Row: { firebase_uid: string; concept_id: string; p_known: number; attempts: number; correct_attempts: number; updated_at: string }; Insert: Partial<Database["public"]["Tables"]["learner_mastery"]["Row"]>; Update: Partial<Database["public"]["Tables"]["learner_mastery"]["Row"]>; Relationships: [] };
      review_cards: { Row: { id: string; firebase_uid: string; concept_id: string; fsrs_state: Json; due_at: string; last_reviewed_at: string | null; created_at: string }; Insert: Partial<Database["public"]["Tables"]["review_cards"]["Row"]>; Update: Partial<Database["public"]["Tables"]["review_cards"]["Row"]>; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      hybrid_search_source_chunks: { Args: { p_query: string; p_query_embedding: string | null; p_limit?: number; p_allow_noncommercial?: boolean }; Returns: Array<{ chunk_id: string; source_id: string; chunk_text: string; url: string; title: string; license: string; attribution: string; authority_score: number; level: number; semantic_score: number | null; lexical_score: number; final_score: number }> };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let client: SupabaseClient<Database> | undefined;

/** Supabase accepts the current Firebase ID token after Firebase is configured as a third-party provider. */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient<Database>(url, anonKey, {
      accessToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
