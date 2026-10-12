import { z } from "zod";
import type { EvidenceChunk } from "./verifiedLesson";

export const retrievalQuerySchema = z.object({
  query: z.string().trim().min(2).max(500),
  limit: z.number().int().min(1).max(20).default(8),
  targetLevel: z.number().int().min(1).max(5).default(1),
  conceptSlugs: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
}).strict();
export type RetrievalQuery = z.infer<typeof retrievalQuerySchema>;

export type RetrievedChunk = {
  id: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  url: string;
  title: string;
  publisher: string;
  license: string;
  attribution: string;
  authorityScore: number;
  level: number;
  conceptTags: string[];
  isPrivate: boolean;
  semanticScore: number | null;
  lexicalScore: number;
  levelFit: number;
  conceptBoost: number;
  score: number;
};

export type HybridSearchParams = {
  p_query: string;
  p_query_embedding: string | null;
  p_limit: number;
  p_allow_noncommercial: boolean;
  p_target_level: number;
  p_concept_slugs: string[] | null;
  p_owner_uid: string | null;
  p_candidate_pool: number;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** Linear penalty for source-level mismatch; a 4-level gap scores 0. */
export function levelFitScore(sourceLevel: number, targetLevel: number): number {
  const source = Number.isFinite(sourceLevel) ? sourceLevel : 1;
  const target = Number.isFinite(targetLevel) ? targetLevel : 1;
  return Math.max(0, 1 - Math.abs(source - target) / 4);
}

/**
 * Recency-independent blend used when ranking already-scored candidates in
 * memory. Weights match the SQL RPC so unit tests can assert the same policy.
 */
export function blendedRetrievalScore(input: {
  semanticRank: number;
  lexicalRank: number;
  authorityScore: number;
  levelFit: number;
  conceptBoost: number;
}): number {
  const semantic = 0.30 * (60 / (60 + Math.max(1, input.semanticRank)));
  const lexical = 0.25 * (60 / (60 + Math.max(1, input.lexicalRank)));
  return semantic + lexical + 0.20 * input.authorityScore + 0.15 * input.levelFit + 0.10 * input.conceptBoost;
}

/** Keep the highest-scoring chunks while capping how many come from one source. */
export function diversifyBySource<T extends { sourceId: string; score: number }>(chunks: T[], maxPerSource = 2): T[] {
  const cap = Number.isInteger(maxPerSource) && maxPerSource > 0 ? maxPerSource : 2;
  const counts = new Map<string, number>();
  const kept: T[] = [];
  const ordered = [...chunks].sort((left, right) => right.score - left.score);
  for (const chunk of ordered) {
    const used = counts.get(chunk.sourceId) ?? 0;
    if (used >= cap) continue;
    counts.set(chunk.sourceId, used + 1);
    kept.push(chunk);
  }
  return kept;
}

export function mapHybridRow(row: Record<string, unknown>): RetrievedChunk {
  const semanticRaw = row.semantic_score;
  return {
    id: asString(row.chunk_id ?? row.id),
    sourceId: asString(row.source_id),
    chunkIndex: Math.max(0, Math.floor(asNumber(row.chunk_index))),
    text: asString(row.chunk_text),
    url: asString(row.url),
    title: asString(row.title),
    publisher: asString(row.publisher),
    license: asString(row.license),
    attribution: asString(row.attribution),
    authorityScore: asNumber(row.authority_score),
    level: Math.max(1, Math.min(5, Math.round(asNumber(row.level, 1)))),
    conceptTags: asStringArray(row.concept_tags),
    isPrivate: row.is_private === true,
    semanticScore: semanticRaw === null || semanticRaw === undefined ? null : asNumber(semanticRaw),
    lexicalScore: asNumber(row.lexical_score),
    levelFit: asNumber(row.level_fit, 1),
    conceptBoost: asNumber(row.concept_boost),
    score: asNumber(row.final_score),
  };
}

export function toEvidenceChunks(chunks: RetrievedChunk[]): EvidenceChunk[] {
  return chunks.map((chunk) => ({
    id: chunk.id,
    text: chunk.text,
    title: chunk.title,
    url: chunk.url,
    license: chunk.license,
    attribution: chunk.attribution,
  }));
}

export function toPublicChunks(chunks: RetrievedChunk[]) {
  return chunks.map((chunk, index) => ({
    id: chunk.id,
    citation: index + 1,
    text: chunk.text,
    source: {
      id: chunk.sourceId,
      title: chunk.title,
      url: chunk.url,
      publisher: chunk.publisher,
      license: chunk.license,
      attribution: chunk.attribution,
    },
    authorityScore: chunk.authorityScore,
    level: chunk.level,
    score: chunk.score,
    conceptTags: chunk.conceptTags,
    isPrivate: chunk.isPrivate,
  }));
}

export function hybridSearchParams(input: {
  query: string;
  embedding: number[] | null;
  limit?: number;
  allowNonCommercial?: boolean;
  targetLevel?: number;
  conceptSlugs?: string[] | null;
  ownerUid?: string | null;
  candidatePool?: number;
}): HybridSearchParams {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  return {
    p_query: input.query,
    p_query_embedding: input.embedding ? `[${input.embedding.join(",")}]` : null,
    // Over-fetch so the TypeScript diversity pass still has candidates if SQL
    // is an older 4-argument deployment without source caps.
    p_limit: Math.min(limit * 3, 40),
    p_allow_noncommercial: Boolean(input.allowNonCommercial),
    p_target_level: Math.max(1, Math.min(5, input.targetLevel ?? 1)),
    p_concept_slugs: input.conceptSlugs?.length ? input.conceptSlugs : null,
    p_owner_uid: input.ownerUid ?? null,
    p_candidate_pool: Math.min(Math.max(input.candidatePool ?? 60, 10), 400),
  };
}

export function rankRetrievedChunks(rows: unknown, limit: number, maxPerSource = 2): RetrievedChunk[] {
  const list = Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
  return diversifyBySource(list.map(mapHybridRow), maxPerSource).slice(0, Math.min(Math.max(limit, 1), 20));
}
