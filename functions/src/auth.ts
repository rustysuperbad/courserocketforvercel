import { getAuth } from "firebase-admin/auth";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import * as Sentry from "@sentry/node";
import { z } from "zod";

/**
 * Re-verifies the Firebase ID token that the callable SDK already checked, with
 * revocation enabled, and confirms it matches the callable identity.
 */
export async function verifiedUid(request: CallableRequest<unknown>): Promise<string> {
  const callableUid = request.auth?.uid;
  if (!callableUid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const header = request.rawRequest.headers.authorization;
  const authorization = Array.isArray(header) ? header[0] : header;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpsError("unauthenticated", "A Firebase ID token is required.");
  try {
    const decoded = await getAuth().verifyIdToken(token, true);
    if (decoded.uid !== callableUid) throw new Error("token subject mismatch");
    return decoded.uid;
  } catch {
    throw new HttpsError("unauthenticated", "Your sign-in has expired. Please sign in again.");
  }
}

/** Parses callable input with zod and converts failures into a safe invalid-argument error. */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown, message: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpsError("invalid-argument", message);
  return parsed.data;
}

/**
 * Wraps a callable body so unexpected errors are reported (without request
 * payloads) and surfaced to the client as a generic internal error.
 */
export function guarded<TIn, TOut>(area: string, handler: (request: CallableRequest<TIn>) => Promise<TOut>) {
  return async (request: CallableRequest<TIn>): Promise<TOut> => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      Sentry.captureException(error instanceof Error ? new Error(`${area}: ${error.message}`) : new Error(`${area}: unknown error`), { tags: { area } });
      throw new HttpsError("internal", "Something went wrong on our side. Please try again.");
    }
  };
}
