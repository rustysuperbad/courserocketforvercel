/** Runtime env for Cloud Functions, Supabase Edge, and local scripts. */

export function readEnv(name: string, fallback = ""): string {
  const deno = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno;
  const fromDeno = deno?.env.get(name);
  const fromProcess = typeof process !== "undefined" ? process.env[name] : undefined;
  const value = fromDeno ?? fromProcess ?? fallback;
  return String(value ?? "").trim();
}

export function envValue(name: string, fallback = "") {
  return { value: () => readEnv(name, fallback) };
}
