import { createHash } from "crypto";

export function stripZeroWidth(text: string): string {
  return String(text || "").replace(/[\u200B-\u200D\uFEFF]/g, "");
}

export function normalizeWhitespace(text: string): string {
  return stripZeroWidth(text).replace(/\s+/g, " ").trim();
}

export function sha256(text: string): string {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

export function wordTokens(text: string): string[] {
  return normalizeWhitespace(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}

export function ngrams(text: string, n: number): string[] {
  const words = wordTokens(text);
  if (words.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - n; i += 1) out.push(words.slice(i, i + n).join(" "));
  return out;
}

export function hashedShingles(text: string, n: number): Set<string> {
  return new Set(ngrams(text, n).map((gram) => sha256(gram)));
}

export function sharedHashedShingles(a: Set<string>, b: Set<string>): number {
  let hits = 0;
  for (const value of a) if (b.has(value)) hits += 1;
  return hits;
}

export function longestSharedRun(a: string, b: string): number {
  const left = wordTokens(a);
  const right = new Set(ngrams(b, 8).length ? ngrams(b, 8) : []);
  if (!left.length) return 0;
  const rightWords = wordTokens(b);
  let best = 0;
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < rightWords.length; j += 1) {
      let k = 0;
      while (i + k < left.length && j + k < rightWords.length && left[i + k] === rightWords[j + k]) k += 1;
      if (k > best) best = k;
    }
  }
  void right;
  return best;
}

export function fiveGramOverlapRatio(draft: string, source: string): number {
  const left = new Set(ngrams(draft, 5));
  const right = new Set(ngrams(source, 5));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const gram of left) if (right.has(gram)) hits += 1;
  return hits / left.size;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    left += av * av;
    right += bv * bv;
  }
  if (!left || !right) return 0;
  return dot / (Math.sqrt(left) * Math.sqrt(right));
}

export function redactSecrets(text: string): string {
  return String(text || "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/gsk_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/AIza[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/tvly-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/BSA[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

export function containsRawLearner(haystack: string, learner: string): boolean {
  const raw = normalizeWhitespace(learner);
  if (raw.length < 12) return false;
  return normalizeWhitespace(haystack).includes(raw);
}
