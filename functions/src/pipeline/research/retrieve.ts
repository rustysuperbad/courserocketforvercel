import { PIPELINE_CONFIG } from "../config";
import { cosine, wordTokens } from "../text";
import type { FetchedPage } from "./discover";

export type EmbeddedChunk = {
  chunk_ref: string;
  source_id: string;
  text: string;
  vector: number[];
};

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export function fakeEmbed(texts: string[]): number[][] {
  const dim = PIPELINE_CONFIG.embeddingDimensions;
  return texts.map((text) => {
    const v = Array.from({ length: dim }, () => 0);
    for (const tok of wordTokens(text)) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i += 1) h = Math.imul(h ^ tok.charCodeAt(i), 16777619);
      const idx = Math.abs(h) % dim;
      v[idx] = (v[idx] || 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((s, n) => s + n * n, 0)) || 1;
    return v.map((n) => n / norm);
  });
}

export async function embedChunks(pages: FetchedPage[], embed: EmbedFn): Promise<EmbeddedChunk[]> {
  const raw = pages.flatMap((page) => page.chunks.map((c) => ({ ...c, source_id: page.source_id })));
  if (!raw.length) return [];
  const vectors = await embed(raw.map((c) => c.text));
  return raw.map((c, i) => ({ chunk_ref: c.chunk_ref, source_id: c.source_id, text: c.text, vector: vectors[i] || [] }));
}

function lexical(query: string, text: string): number {
  const q = new Set(wordTokens(query));
  const t = wordTokens(text);
  if (!q.size || !t.length) return 0;
  let hits = 0;
  for (const w of t) if (q.has(w)) hits += 1;
  return hits / t.length;
}

export function rankForObjective(
  objectiveText: string,
  objectiveVec: number[],
  chunks: EmbeddedChunk[],
): EmbeddedChunk[] {
  const scored = chunks.map((chunk) => {
    const v = cosine(objectiveVec, chunk.vector);
    const l = lexical(objectiveText, chunk.text);
    const score = 0.6 * v + 0.4 * l;
    return { chunk, score };
  }).filter((row) => row.score >= PIPELINE_CONFIG.relevanceFloor);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, PIPELINE_CONFIG.retrieveTopK).map((row) => row.chunk);
}
