const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Sync SHA-256 for Node tests and Deno Edge (no `node:crypto`). */
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(String(text || ""));
  const bitLen = bytes.length * 8;
  const paddedLen = (bytes.length + 1 + 8 + 63) & ~63;
  const pad = new Uint8Array(paddedLen);
  pad.set(bytes);
  pad[bytes.length] = 0x80;
  const view = new DataView(pad.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j += 1) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j += 1) {
      const w15 = w[j - 15] ?? 0;
      const w2 = w[j - 2] ?? 0;
      const s0 = rotr(7, w15) ^ rotr(18, w15) ^ (w15 >>> 3);
      const s1 = rotr(17, w2) ^ rotr(19, w2) ^ (w2 >>> 10);
      w[j] = ((w[j - 16] ?? 0) + s0 + (w[j - 7] ?? 0) + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let j = 0; j < 64; j += 1) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (SHA256_K[j] ?? 0) + (w[j] ?? 0)) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => n.toString(16).padStart(8, "0")).join("");
}

export function stripZeroWidth(text: string): string {
  return String(text || "").replace(/[\u200B-\u200D\uFEFF]/g, "");
}

export function normalizeWhitespace(text: string): string {
  return stripZeroWidth(text).replace(/\s+/g, " ").trim();
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
