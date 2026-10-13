import { z } from "zod";
import { firebaseProjectId } from "./config";
import { ApiError, HttpsError } from "./errors";

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; fetchedAt: number } | undefined;

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function firebaseJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 60 * 60 * 1000) return jwksCache.keys;
  const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!response.ok) throw new Error("Could not load Firebase signing keys.");
  const body = await response.json() as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

export async function uidFromAuthHeader(authorization: string | null | undefined): Promise<string> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const projectId = firebaseProjectId.value();
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpsError("unauthenticated", "Your sign-in has expired. Please sign in again.");
  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0]!))) as { kid?: string; alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]!))) as { sub?: string; iss?: string; aud?: string; exp?: number };
    const key = (await firebaseJwks()).find((item) => item.kid === header.kid);
    if (!key || header.alg !== "RS256") throw new Error("unknown signing key");
    const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = fromBase64Url(parts[2]!);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer, data);
    const issuer = `https://securetoken.google.com/${projectId}`;
    if (!ok || payload.iss !== issuer || payload.aud !== projectId || !payload.sub || (payload.exp ?? 0) * 1000 < Date.now()) {
      throw new Error("invalid token");
    }
    return payload.sub;
  } catch {
    throw new HttpsError("unauthenticated", "Your sign-in has expired. Please sign in again.");
  }
}

export function parseInput<T>(schema: z.ZodType<T>, data: unknown, message: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpsError("invalid-argument", message);
  return parsed.data;
}

export function guarded<TIn, TOut>(area: string, handler: (data: TIn, uid: string) => Promise<TOut>) {
  return async (data: TIn, uid: string): Promise<TOut> => {
    try {
      return await handler(data, uid);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error(`${area}:`, error instanceof Error ? error.message : "unknown error");
      throw new HttpsError("internal", "Something went wrong on our side. Please try again.");
    }
  };
}
