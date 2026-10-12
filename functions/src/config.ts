import { defineSecret, defineString } from "firebase-functions/params";

/** Region shared by every callable and HTTPS endpoint. */
export const REGION = "us-central1";

// Secrets: never read on the client, never logged.
export const supabaseUrl = defineSecret("SUPABASE_URL");
export const supabaseServiceRoleKey = defineSecret("SUPABASE_SERVICE_ROLE_KEY");
export const inngestEventKey = defineSecret("INNGEST_EVENT_KEY");
export const inngestSigningKey = defineSecret("INNGEST_SIGNING_KEY");
export const langfusePublicKey = defineSecret("LANGFUSE_PUBLIC_KEY");
export const langfuseSecretKey = defineSecret("LANGFUSE_SECRET_KEY");
export const sentryDsn = defineSecret("SENTRY_DSN");
export const openAiApiKey = defineSecret("OPENAI_API_KEY");
export const geminiApiKey = defineSecret("GEMINI_API_KEY");
export const youtubeApiKey = defineSecret("YOUTUBE_API_KEY");

// Non-secret parameters with safe defaults.
defineString("LANGFUSE_BASE_URL", { default: "https://cloud.langfuse.com" });
export const dailyUserLimit = defineString("DAILY_COURSE_RUN_LIMIT", { default: "3" });
export const projectDailySpendLimit = defineString("PROJECT_DAILY_SPEND_LIMIT_USD", { default: "25" });
export const embeddingCostPerMillion = defineString("OPENAI_EMBEDDING_COST_PER_MILLION_USD", { default: "0.02" });
export const allowNonCommercialSources = defineString("ALLOW_NONCOMMERCIAL_SOURCES", { default: "false" });
export const adminUids = defineString("ADMIN_FIREBASE_UIDS", { default: "" });

export function numberParam(value: string, fallback: number, minimum = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function booleanParam(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

export function isAdminUid(uid: string): boolean {
  return adminUids.value().split(",").map((item) => item.trim()).filter(Boolean).includes(uid);
}

export const supabaseSecrets = [supabaseUrl, supabaseServiceRoleKey];
