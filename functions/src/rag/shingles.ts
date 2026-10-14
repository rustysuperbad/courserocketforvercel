import { createHash } from "node:crypto";

function normalizeWords(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export function wordShingles(text: string, size: number): string[] {
  const words = normalizeWords(text);
  if (words.length < size) return [];
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i++) {
    out.push(words.slice(i, i + size).join(" "));
  }
  return out;
}

export function hashShingle(shingle: string): string {
  return createHash("sha256").update(shingle).digest("hex");
}

/** In-memory only. Never persist the raw learner text. */
export function hashedShingleSet(text: string, size: number): Set<string> {
  return new Set(wordShingles(text, size).map(hashShingle));
}

export function sharedHashedCount(text: string, size: number, hashed: Set<string>): number {
  if (!hashed.size) return 0;
  let hits = 0;
  for (const shingle of wordShingles(text, size)) {
    if (hashed.has(hashShingle(shingle))) hits += 1;
  }
  return hits;
}

export function verbatimRuns(haystack: string, needle: string, minWords: number): string[] {
  const hayWords = normalizeWords(haystack);
  const needleWords = normalizeWords(needle);
  if (needleWords.length < minWords || hayWords.length < minWords) return [];
  const hay = ` ${hayWords.join(" ")} `;
  const found: string[] = [];
  for (let len = needleWords.length; len >= minWords; len--) {
    for (let i = 0; i + len <= needleWords.length; i++) {
      const run = needleWords.slice(i, i + len).join(" ");
      if (hay.includes(` ${run} `)) found.push(run);
    }
  }
  return found;
}

export function jaccard(a: string, b: string, size = 5): number {
  const left = new Set(wordShingles(a, size));
  const right = new Set(wordShingles(b, size));
  if (!left.size && !right.size) return 1;
  let inter = 0;
  for (const item of left) if (right.has(item)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 0 : inter / union;
}
