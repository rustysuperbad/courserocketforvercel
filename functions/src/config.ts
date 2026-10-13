import { envValue, readEnv } from "./env";

export const REGION = "us-central1";

export const supabaseUrl = envValue("SUPABASE_URL");
export const supabaseServiceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
export const inngestEventKey = envValue("INNGEST_EVENT_KEY");
export const inngestSigningKey = envValue("INNGEST_SIGNING_KEY");
export const langfusePublicKey = envValue("LANGFUSE_PUBLIC_KEY");
export const langfuseSecretKey = envValue("LANGFUSE_SECRET_KEY");
export const sentryDsn = envValue("SENTRY_DSN");
export const openAiApiKey = envValue("OPENAI_API_KEY");
export const groqApiKey = envValue("GROQ_API_KEY");
export const geminiApiKey = envValue("GEMINI_API_KEY");
export const youtubeApiKey = envValue("YOUTUBE_API_KEY");

export const dailyUserLimit = envValue("DAILY_COURSE_RUN_LIMIT", "3");
export const projectDailySpendLimit = envValue("PROJECT_DAILY_SPEND_LIMIT_USD", "25");
export const embeddingCostPerMillion = envValue("OPENAI_EMBEDDING_COST_PER_MILLION_USD", "0.02");
export const allowNonCommercialSources = envValue("ALLOW_NONCOMMERCIAL_SOURCES", "false");
export const adminUids = envValue("ADMIN_FIREBASE_UIDS", "");
export const firebaseProjectId = envValue("FIREBASE_PROJECT_ID", "courserocket26");

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

export function requireSecret(name: string): string {
  const value = readEnv(name);
  if (!value || value === "disabled") throw new Error(`${name} is not configured.`);
  return value;
}
