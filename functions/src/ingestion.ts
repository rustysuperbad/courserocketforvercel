import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const sourceSchema = z.object({
  key: z.string().min(1), title: z.string().min(1), publisher: z.string().min(1), url: z.string().url(),
  license: z.string().min(1), attribution: z.string().min(1), authorityScore: z.number().min(0).max(1),
  level: z.number().int().min(1).max(5), commercialAllowed: z.boolean(), sourceKind: z.enum(["wikipedia", "mdn", "openstax", "rfc", "link-only"]), shareAlike: z.boolean(),
});
type Source = z.infer<typeof sourceSchema>;

export function splitIntoChunks(text: string, maxCharacters = 1100, overlap = 160): string[] {
  const paragraphs = text.replace(/\r/g, "").split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      if (current) chunks.push(current);
      current = "";
      for (let start = 0; start < paragraph.length; start += maxCharacters - overlap) {
        chunks.push(paragraph.slice(start, start + maxCharacters).trim());
      }
      continue;
    }
    if (current.length && current.length + paragraph.length + 2 > maxCharacters) {
      chunks.push(current);
      const tail = current.slice(-overlap).trim();
      current = tail ? `${tail}\n\n${paragraph}` : paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((chunk) => chunk.length >= 60);
}

export function licenseDecision(source: Source, flags: { approveShareAlike: boolean; allowNonCommercial: boolean }): { ingest: boolean; status: "approved" | "review_required" | "blocked" } {
  if (source.sourceKind === "link-only" || source.sourceKind === "rfc") return { ingest: false, status: "review_required" };
  if (!source.commercialAllowed) return flags.allowNonCommercial ? { ingest: true, status: "approved" } : { ingest: false, status: "blocked" };
  if (source.shareAlike && !flags.approveShareAlike) return { ingest: false, status: "review_required" };
  return { ingest: true, status: "approved" };
}

function stripHtml(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  return main.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|section|article|div)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function fetchSourceText(source: Source): Promise<string> {
  const headers = { "User-Agent": "CourseRocket/0.1 (educational source ingestion; contact: support@courserocket.app)" };
  if (source.sourceKind === "wikipedia") {
    const pageTitle = new URL(source.url).pathname.split("/").filter(Boolean).at(-1);
    if (!pageTitle) throw new Error("Wikipedia source has no article title.");
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(decodeURIComponent(pageTitle))}`, { headers });
    if (!response.ok) throw new Error(`Wikipedia returned ${response.status}.`);
    const result = await response.json() as { extract?: string; content_urls?: { desktop?: { page?: string } } };
    if (!result.extract?.trim()) throw new Error("Wikipedia did not return article text.");
    return `Source: ${result.content_urls?.desktop?.page ?? source.url}\n\n${result.extract}`;
  }
  if (source.sourceKind === "mdn") {
    const response = await fetch(source.url, { headers });
    if (!response.ok) throw new Error(`MDN returned ${response.status}.`);
    return stripHtml(await response.text());
  }
  if (source.sourceKind === "openstax") {
    const response = await fetch(source.url, { headers });
    if (!response.ok) throw new Error(`OpenStax returned ${response.status}.`);
    return stripHtml(await response.text());
  }
  throw new Error("This source is configured as link-only until its document license is reviewed.");
}

export async function ingestNetworkingSources(): Promise<void> {
  const currentDir = __dirname;
  const candidates = JSON.parse(await readFile(path.join(currentDir, "../data/networking-sources.json"), "utf8")) as unknown;
  const sources = z.array(sourceSchema).parse(candidates);
  const approveShareAlike = process.argv.includes("--approve-cc-by-sa");
  const allowNonCommercial = process.argv.includes("--allow-noncommercial");
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !serviceKey || !apiKey) throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY in the local environment.");

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const openai = new OpenAI({ apiKey });
  for (const source of sources) {
    const decision = licenseDecision(source, { approveShareAlike, allowNonCommercial });
    const { data: stored, error: sourceError } = await supabase.from("sources").upsert({
      url: source.url, title: source.title, publisher: source.publisher, license: source.license,
      attribution: source.attribution, authority_score: source.authorityScore, level: source.level,
      commercial_allowed: source.commercialAllowed, license_review_status: decision.status,
    }, { onConflict: "url" }).select("id").single();
    if (sourceError || !stored) throw new Error(`Could not save source metadata for ${source.key}.`);
    if (!decision.ingest) {
      console.info(`Skipped ${source.key}: license status ${decision.status}.`);
      continue;
    }
    const text = await fetchSourceText(source);
    const chunks = splitIntoChunks(text);
    if (!chunks.length) throw new Error(`No useful text chunks were extracted from ${source.key}.`);
    const records = [];
    for (let offset = 0; offset < chunks.length; offset += 50) {
      const batch = chunks.slice(offset, offset + 50);
      const embeddingResponse = await openai.embeddings.create({ model: "text-embedding-3-small", input: batch, dimensions: 1536 });
      for (let index = 0; index < batch.length; index += 1) {
        const chunkText = batch[index];
        if (!chunkText) throw new Error("Chunk batch contained an empty item.");
        const embedding = embeddingResponse.data[index]?.embedding;
        if (!embedding) throw new Error("OpenAI returned an incomplete embedding batch.");
        const contentHash = crypto.createHash("sha256").update(chunkText).digest("hex");
        records.push({
          source_id: stored.id,
          chunk_index: offset + index,
          chunk_text: chunkText,
          content_hash: contentHash,
          embedding: `[${embedding.join(",")}]`,
        });
      }
    }
    const { error: chunkError } = await supabase.from("source_chunks").upsert(records, { onConflict: "source_id,chunk_index" });
    if (chunkError) throw new Error(`Could not save chunks for ${source.key}.`);
    await supabase.from("sources").update({ fetched_at: new Date().toISOString() }).eq("id", stored.id);
    console.info(`Ingested ${source.key}: ${records.length} attributed chunks (${source.license}).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  ingestNetworkingSources().catch((error) => {
    console.error("Networking source ingestion failed.", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
