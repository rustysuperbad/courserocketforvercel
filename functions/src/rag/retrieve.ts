import { GATE_CONFIG } from "./config";
import { jaccard } from "./shingles";

export type RetrievedSourceChunk = {
  chunk_id: string;
  source_id: string;
  text: string;
  title?: string;
  url?: string;
  score: number;
};

export function buildRetrievalQuery(objectives: Array<{ text: string }>, keyConcepts: string[]): string {
  const verbs = objectives.map((item) => item.text).join(" ");
  const concepts = keyConcepts.join(" ");
  return `${concepts} ${verbs}`.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function selectEvidenceChunks(chunks: RetrievedSourceChunk[]): RetrievedSourceChunk[] {
  const ranked = [...chunks].filter((chunk) => chunk.score >= GATE_CONFIG.relevanceFloor).sort((a, b) => b.score - a.score);
  const unique: RetrievedSourceChunk[] = [];
  const perSource = new Map<string, number>();
  for (const chunk of ranked) {
    if (unique.some((kept) => jaccard(kept.text, chunk.text, 5) >= GATE_CONFIG.nearDuplicateJaccard)) continue;
    const used = perSource.get(chunk.source_id) || 0;
    if (used >= GATE_CONFIG.maxChunksPerSource) continue;
    perSource.set(chunk.source_id, used + 1);
    unique.push(chunk);
    if (unique.length >= GATE_CONFIG.retrieveTopK) break;
  }
  return unique;
}
