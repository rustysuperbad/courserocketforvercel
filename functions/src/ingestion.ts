import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const sourceSchema = z.object({
  key: z.string().min(1), title: z.string().min(1), publisher: z.string().min(1), url: z.string().url(),
  license: z.string().min(1), attribution: z.string().min(1), authorityScore: z.number().min(0).max(1),
  level: z.number().int().min(1).max(5), commercialAllowed: z.boolean(),
  sourceKind: z.enum(["wikipedia", "mdn", "openstax", "rfc", "link-only"]), shareAlike: z.boolean(),
  conceptTags: z.array(z.string().min(1).max(160)).max(20).default([]),
});
export type Source = z.infer<typeof sourceSchema>;

export type IngestionFlags = {
  approveShareAlike: boolean;
  allowNonCommercial: boolean;
  /** RFC text is reproduced verbatim with attribution under the IETF Trust Legal Provisions; opt in after review. */
  approveRfc: boolean;
  only?: Set<string>;
  dryRun: boolean;
  maxChunksPerSource: number;
};

export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, openAiEmbedder, type Embedder } from "./embeddings";
export { contentHash, splitIntoChunks } from "./chunking";
import { contentHash, splitIntoChunks } from "./chunking";
import { openAiEmbedder, type Embedder } from "./embeddings";

export function parseFlags(argv: readonly string[]): IngestionFlags {
  const only = argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
  const maxChunks = Number(argv.find((arg) => arg.startsWith("--max-chunks="))?.slice("--max-chunks=".length));
  return {
    approveShareAlike: argv.includes("--approve-cc-by-sa"),
    allowNonCommercial: argv.includes("--allow-noncommercial"),
    approveRfc: argv.includes("--approve-rfc"),
    ...(only ? { only: new Set(only.split(",").map((item) => item.trim()).filter(Boolean)) } : {}),
    dryRun: argv.includes("--dry-run"),
    maxChunksPerSource: Number.isInteger(maxChunks) && maxChunks > 0 ? maxChunks : 400,
  };
}

export function licenseDecision(source: Source, flags: Pick<IngestionFlags, "approveShareAlike" | "allowNonCommercial"> & Partial<Pick<IngestionFlags, "approveRfc">>): { ingest: boolean; status: "approved" | "review_required" | "blocked" } {
  if (source.sourceKind === "link-only") return { ingest: false, status: "review_required" };
  if (source.sourceKind === "rfc") return flags.approveRfc ? { ingest: true, status: "approved" } : { ingest: false, status: "review_required" };
  if (!source.commercialAllowed) return flags.allowNonCommercial ? { ingest: true, status: "approved" } : { ingest: false, status: "blocked" };
  if (source.shareAlike && !flags.approveShareAlike) return { ingest: false, status: "review_required" };
  return { ingest: true, status: "approved" };
}

const WIKIPEDIA_TAIL_SECTIONS = /^(see also|references|external links|further reading|notes|bibliography|sources|citations|footnotes)$/i;

/** Drops navigation-style tail sections and heading markers from a MediaWiki plaintext extract. */
export function cleanWikipediaExtract(extract: string): string {
  const lines = extract.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const rawLine of lines) {
    const headingMatch = rawLine.match(/^(={2,6})\s*(.+?)\s*\1\s*$/);
    if (headingMatch) {
      const heading = headingMatch[2] ?? "";
      skipping = headingMatch[1]?.length === 2 && WIKIPEDIA_TAIL_SECTIONS.test(heading.trim());
      if (!skipping) kept.push("", `${heading.trim()}.`, "");
      continue;
    }
    if (!skipping) kept.push(rawLine);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Removes page headers/footers and form feeds from RFC plain text, keeping the body prose. */
export function cleanRfcText(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (line.includes("\f")) continue;
    if (/^\s*RFC\s+\d+\s{2,}.+\s{2,}\w+\s+\d{4}\s*$/.test(line)) continue;
    if (/^\s*\S.*\s{2,}\[Page\s+\d+\]\s*$/.test(line)) continue;
    kept.push(line);
  }
  const body = kept.join("\n");
  const start = body.search(/\n\s*(Abstract|1\.\s+Introduction|INTRODUCTION)\s*\n/i);
  return (start > 0 ? body.slice(start) : body).replace(/\n{3,}/g, "\n\n").trim();
}

export function stripHtml(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html;
  return main.replace(/<(script|style|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|section|article|div|pre|table|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}


export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const USER_AGENT = "CourseRocket/0.2 (educational source ingestion; contact: support@courserocket.app)";

export async function fetchSourceText(source: Source, fetcher: Fetcher = fetch): Promise<string> {
  const headers = { "User-Agent": USER_AGENT, Accept: "text/html,application/json,text/plain" };
  if (source.sourceKind === "wikipedia") {
    const pageTitle = new URL(source.url).pathname.split("/").filter(Boolean).at(-1);
    if (!pageTitle) throw new Error("Wikipedia source has no article title.");
    const api = new URL("https://en.wikipedia.org/w/api.php");
    api.search = new URLSearchParams({ action: "query", prop: "extracts", explaintext: "1", redirects: "1", format: "json", formatversion: "2", titles: decodeURIComponent(pageTitle) }).toString();
    const response = await fetcher(api.toString(), { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Wikipedia returned ${response.status}.`);
    const result = await response.json() as { query?: { pages?: Array<{ title?: string; extract?: string; missing?: boolean }> } };
    const page = result.query?.pages?.[0];
    if (!page || page.missing || !page.extract?.trim()) throw new Error("Wikipedia did not return article text.");
    return cleanWikipediaExtract(page.extract);
  }
  if (source.sourceKind === "rfc") {
    const number = source.url.match(/rfc(\d+)/i)?.[1];
    if (!number) throw new Error("RFC source URL has no RFC number.");
    const response = await fetcher(`https://www.rfc-editor.org/rfc/rfc${number}.txt`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`RFC Editor returned ${response.status}.`);
    return cleanRfcText(await response.text());
  }
  if (source.sourceKind === "mdn" || source.sourceKind === "openstax") {
    const response = await fetcher(source.url, { headers, signal: AbortSignal.timeout(30_000), redirect: "follow" });
    if (!response.ok) throw new Error(`${source.publisher} returned ${response.status}.`);
    return stripHtml(await response.text());
  }
  throw new Error("This source is configured as link-only until its document license is reviewed.");
}

export type IngestionPlanItem = { source: Source; decision: ReturnType<typeof licenseDecision> };

export function planIngestion(sources: Source[], flags: IngestionFlags): IngestionPlanItem[] {
  return sources
    .filter((source) => !flags.only || flags.only.has(source.key))
    .map((source) => ({ source, decision: licenseDecision(source, flags) }));
}


export type IngestionResult = { key: string; status: "skipped" | "unchanged" | "ingested" | "dry-run" | "failed"; chunks: number; detail?: string };

/**
 * Idempotent per-source ingestion: stores license metadata for every source,
 * re-fetches text, skips embedding when the content hash is unchanged, and
 * otherwise replaces that source's chunks atomically enough for retrieval
 * (delete + insert under the same source id).
 */
export async function ingestSource(
  item: IngestionPlanItem,
  deps: { supabase: SupabaseClient | null; embed: Embedder | null; fetcher?: Fetcher; flags: IngestionFlags; log?: (message: string) => void },
): Promise<IngestionResult> {
  const { source, decision } = item;
  const log = deps.log ?? (() => {});
  const supabase = deps.supabase;
  let storedId: string | null = null;
  if (supabase && !deps.flags.dryRun) {
    const { data: stored, error: sourceError } = await supabase.from("sources").upsert({
      url: source.url, title: source.title, publisher: source.publisher, license: source.license,
      attribution: source.attribution, authority_score: source.authorityScore, level: source.level,
      commercial_allowed: source.commercialAllowed, license_review_status: decision.status,
      source_kind: source.sourceKind, concept_tags: source.conceptTags,
    }, { onConflict: "url" }).select("id, content_hash, chunk_count").single();
    if (sourceError || !stored) return { key: source.key, status: "failed", chunks: 0, detail: "Could not save source metadata." };
    storedId = stored.id;
    if (!decision.ingest) {
      log(`Skipped ${source.key}: license status ${decision.status}.`);
      return { key: source.key, status: "skipped", chunks: 0, detail: decision.status };
    }
    const text = await fetchSourceText(source, deps.fetcher);
    const hash = contentHash(text);
    const chunks = splitIntoChunks(text).slice(0, deps.flags.maxChunksPerSource);
    if (!chunks.length) return { key: source.key, status: "failed", chunks: 0, detail: "No useful text chunks were extracted." };
    if (stored.content_hash === hash && stored.chunk_count === chunks.length) {
      await supabase.from("sources").update({ fetched_at: new Date().toISOString() }).eq("id", storedId);
      log(`Unchanged ${source.key}: ${chunks.length} chunks already stored.`);
      return { key: source.key, status: "unchanged", chunks: chunks.length };
    }
    if (!deps.embed) return { key: source.key, status: "failed", chunks: 0, detail: "Embedding provider is not configured." };
    const records: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < chunks.length; offset += 50) {
      const batch = chunks.slice(offset, offset + 50);
      const vectors = await deps.embed(batch);
      batch.forEach((chunkText, index) => {
        const vector = vectors[index];
        if (!vector) throw new Error("Embedding batch returned fewer vectors than inputs.");
        records.push({ source_id: storedId, chunk_index: offset + index, chunk_text: chunkText, content_hash: contentHash(chunkText), embedding: `[${vector.join(",")}]` });
      });
    }
    const { error: deleteError } = await supabase.from("source_chunks").delete().eq("source_id", storedId);
    if (deleteError) return { key: source.key, status: "failed", chunks: 0, detail: "Could not clear stale chunks." };
    const { error: chunkError } = await supabase.from("source_chunks").insert(records);
    if (chunkError) return { key: source.key, status: "failed", chunks: 0, detail: "Could not save chunks." };
    await supabase.from("sources").update({ fetched_at: new Date().toISOString(), content_hash: hash, chunk_count: records.length, link_status: "ok", link_checked_at: new Date().toISOString() }).eq("id", storedId);
    log(`Ingested ${source.key}: ${records.length} attributed chunks (${source.license}).`);
    return { key: source.key, status: "ingested", chunks: records.length };
  }

  // Dry run: fetch and chunk only; no database writes, no embeddings, no cost.
  if (!decision.ingest) return { key: source.key, status: "skipped", chunks: 0, detail: decision.status };
  const text = await fetchSourceText(source, deps.fetcher);
  const chunks = splitIntoChunks(text).slice(0, deps.flags.maxChunksPerSource);
  log(`Dry run ${source.key}: ${chunks.length} chunks, ${text.length} characters.`);
  return { key: source.key, status: "dry-run", chunks: chunks.length };
}

export async function loadSourceCatalog(file = path.join(__dirname, "../data/networking-sources.json")): Promise<Source[]> {
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  const sources = z.array(sourceSchema).parse(raw);
  const keys = new Set<string>();
  for (const source of sources) {
    if (keys.has(source.key)) throw new Error(`Duplicate source key '${source.key}'.`);
    keys.add(source.key);
  }
  return sources;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ingestNetworkingSources(argv = process.argv.slice(2)): Promise<IngestionResult[]> {
  const flags = parseFlags(argv);
  const sources = await loadSourceCatalog();
  const plan = planIngestion(sources, flags);
  let supabase: SupabaseClient | null = null;
  let embed: Embedder | null = null;
  if (!flags.dryRun) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!supabaseUrl || !serviceKey || !apiKey) throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY in the local environment (or pass --dry-run).");
    supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    embed = openAiEmbedder(new OpenAI({ apiKey }));
  }
  const results: IngestionResult[] = [];
  for (const item of plan) {
    try {
      results.push(await ingestSource(item, { supabase, embed, flags, log: (message) => console.info(message) }));
    } catch (error) {
      results.push({ key: item.source.key, status: "failed", chunks: 0, detail: error instanceof Error ? error.message : "Unknown error" });
      console.error(`Failed ${item.source.key}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
    if (item.decision.ingest) await sleep(1000); // polite rate limit for public APIs
  }
  const summary = results.reduce<Record<string, number>>((acc, result) => ({ ...acc, [result.status]: (acc[result.status] ?? 0) + 1 }), {});
  console.info(`Ingestion summary: ${JSON.stringify(summary)}`);
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  ingestNetworkingSources().then((results) => {
    if (results.some((result) => result.status === "failed")) process.exitCode = 1;
  }).catch((error) => {
    console.error("Networking source ingestion failed.", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
