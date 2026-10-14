import { fakeProvidersEnabled } from "./config";
import type { RetrievedSourceChunk } from "./retrieve";
import { retrieveForGeneration } from "../server";

export const FAKE_SOURCE_CHUNKS: RetrievedSourceChunk[] = [
  { chunk_id: "C1", source_id: "S1", text: "N(x) denotes the standard normal CDF. N(0) equals 0.5.", score: 0.91, title: "Normal tables", url: "https://example.test/cdf" },
  { chunk_id: "C2", source_id: "S1", text: "The standard normal density φ(x) is not the cumulative probability N(x).", score: 0.84, title: "Normal tables", url: "https://example.test/cdf" },
  { chunk_id: "C3", source_id: "S2", text: "In the Black–Scholes call, N(d1) weights the spot under the risk-neutral measure.", score: 0.73, title: "Call price", url: "https://example.test/call" },
  { chunk_id: "C4", source_id: "S2", text: "Replacing N(d1) with φ(d1) produces a number that is not a probability.", score: 0.71, title: "Call price", url: "https://example.test/call" },
];

export async function liveOrFakeRetrieve(query: string, concepts: string[], ownerUid: string): Promise<RetrievedSourceChunk[]> {
  if (fakeProvidersEnabled()) return FAKE_SOURCE_CHUNKS;
  const result = await retrieveForGeneration(query, { conceptSlug: concepts[0], ownerUid });
  return result.chunks.map((chunk, index) => ({
    chunk_id: chunk.id,
    source_id: chunk.url || chunk.id,
    text: chunk.text,
    title: chunk.title,
    url: chunk.url,
    score: 0.8 - index * 0.02,
  }));
}
