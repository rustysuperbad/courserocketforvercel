export type ApiErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "not-found"
  | "resource-exhausted"
  | "unavailable"
  | "internal"
  | "failed-precondition";

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Drop-in for firebase-functions HttpsError so existing throw sites stay intact. */
export const HttpsError = ApiError;

export function httpStatusFor(code: ApiErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "invalid-argument": return 400;
    case "not-found": return 404;
    case "resource-exhausted": return 429;
    case "unavailable": return 503;
    case "failed-precondition": return 412;
    default: return 500;
  }
}
