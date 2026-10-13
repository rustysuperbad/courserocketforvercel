import { auth } from "./firebase";

type CallableError = Error & { code: string };

function backendUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) throw Object.assign(new Error("Supabase is not configured."), { code: "failed-precondition" });
  return `${url.replace(/\/$/, "")}/functions/v1/api`;
}

/**
 * Calls the Supabase Edge API with the current Firebase ID token.
 * Response shape matches the old callable protocol: `{ result }` or `{ error: { status, message } }`.
 */
export async function invokeBackend<T>(name: string, data: unknown = {}, timeoutMs = 30_000): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    const error: CallableError = Object.assign(new Error("Sign in to continue."), { code: "functions/unauthenticated" });
    throw error;
  }
  const token = await user.getIdToken();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(backendUrl(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        "Content-Type": "application/json",
        "x-callable-name": name,
      },
      body: JSON.stringify({ name, data }),
    });
    const payload = await response.json().catch(() => ({})) as { result?: T; error?: { status?: string; message?: string } };
    if (!response.ok || payload.error) {
      const status = payload.error?.status || (response.status === 401 ? "unauthenticated" : "internal");
      const message = payload.error?.message || "Something went wrong. Please try again.";
      const error: CallableError = Object.assign(new Error(message), { code: `functions/${status}` });
      throw error;
    }
    return payload.result as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("The request timed out. Please try again."), { code: "functions/deadline-exceeded" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
