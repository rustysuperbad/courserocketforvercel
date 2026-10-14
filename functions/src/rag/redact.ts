/** Emails and other identifiers stripped before hashing, logging, or model I/O. */
export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ZERO_WIDTH_RE = /[\u200b\u200c\u200d\u2060\ufeff]/g;

export function stripZeroWidth(text: string): string {
  return String(text || "").replace(ZERO_WIDTH_RE, "");
}

export function redactPii(text: string): string {
  return String(text || "").replace(EMAIL_RE, "[redacted-email]");
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactPii(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactDeep(nested)]));
  }
  return value;
}

export function redactForLog(line: string): string {
  return redactPii(line);
}

export function isBlankLearnerText(text: string): boolean {
  return stripZeroWidth(text).replace(/[\s\u00a0]/g, "").length === 0;
}
