import { z } from "zod";

export const resourceItemSchema = z.object({
  kind: z.enum(["youtube", "paper"]),
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  url: z.string().url(),
  snippet: z.string().max(800).default(""),
  channelOrAuthors: z.string().max(300).default(""),
  publishedAt: z.string().max(40).optional(),
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type ResourceItem = z.infer<typeof resourceItemSchema>;
export type ScoredResource = ResourceItem & { score: number; levelFit: number };

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "your", "how"]);

export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !STOP.has(term));
}

export function canonicalResourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu")) {
      const id = parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).at(-1);
      return id ? `https://www.youtube.com/watch?v=${id}` : parsed.origin + parsed.pathname;
    }
    parsed.hash = "";
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function levelFitForResource(text: string, targetLevel: number): number {
  const beginner = /beginner|intro(?:duction)?|basics|explained|fundamentals/.test(text);
  const advanced = /advanced|deep dive|rfc\s*\d+|formal specification|research/.test(text);
  if (targetLevel <= 2) return beginner ? 1 : advanced ? 0.2 : 0.6;
  if (targetLevel >= 4) return advanced ? 1 : beginner ? 0.35 : 0.7;
  return beginner || advanced ? 0.7 : 0.8;
}

export function scoreResource(item: ResourceItem, query: string, targetLevel: number): ScoredResource {
  const terms = queryTerms(query);
  const haystack = `${item.title} ${item.snippet} ${item.channelOrAuthors}`.toLowerCase();
  const overlap = terms.length ? terms.filter((term) => haystack.includes(term)).length / terms.length : 0;
  const levelFit = levelFitForResource(haystack, targetLevel);
  const views = Number(item.extra.viewCount ?? 0);
  const citations = Number(item.extra.citationCount ?? 0);
  const popularity = Math.min(1, Math.log10(Math.max(views, citations, 1)) / 6);
  const score = 0.55 * overlap + 0.25 * levelFit + 0.2 * popularity;
  return { ...item, url: canonicalResourceUrl(item.url), score, levelFit };
}

export function dedupeResources(items: ScoredResource[], limit = 5): ScoredResource[] {
  const seen = new Set<string>();
  const ranked = [...items].sort((left, right) => right.score - left.score);
  const kept: ScoredResource[] = [];
  for (const item of ranked) {
    const key = `${item.kind}:${canonicalResourceUrl(item.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
    if (kept.length >= limit) break;
  }
  return kept;
}

export function resourceCacheKey(kind: "youtube" | "paper", query: string, language = "en"): string {
  return `${kind}:v1:${language}:${query.trim().toLowerCase()}`;
}

export async function fetchYoutubeItems(query: string, apiKey: string | undefined, fetcher: typeof fetch = fetch): Promise<ResourceItem[]> {
  if (!apiKey) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({ part: "snippet", type: "video", maxResults: "8", q: query, key: apiKey, safeSearch: "strict", relevanceLanguage: "en" }).toString();
  const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) return [];
  const payload = await response.json() as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string; channelTitle?: string; publishedAt?: string } }> };
  return (payload.items ?? []).flatMap((item) => {
    const id = item.id?.videoId;
    const title = item.snippet?.title;
    if (!id || !title) return [];
    return [{
      kind: "youtube" as const, id, title, url: `https://www.youtube.com/watch?v=${id}`,
      snippet: item.snippet?.description ?? "", channelOrAuthors: item.snippet?.channelTitle ?? "",
      publishedAt: item.snippet?.publishedAt, extra: {},
    }];
  });
}

export async function fetchOpenAlexItems(query: string, fetcher: typeof fetch = fetch): Promise<ResourceItem[]> {
  const url = new URL("https://api.openalex.org/works");
  url.search = new URLSearchParams({ search: query, per_page: "8", mailto: "support@courserocket.app" }).toString();
  const response = await fetcher(url.toString(), { headers: { "User-Agent": "CourseRocket/0.2 (support@courserocket.app)" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) return [];
  const payload = await response.json() as { results?: Array<{ id?: string; display_name?: string; doi?: string; publication_year?: number; cited_by_count?: number; authorships?: Array<{ author?: { display_name?: string } }> }> };
  return (payload.results ?? []).flatMap((item) => {
    const title = item.display_name;
    if (!title) return [];
    const doi = item.doi?.replace(/^https?:\/\/doi.org\//, "");
    const urlValue = doi ? `https://doi.org/${doi}` : item.id;
    if (!urlValue) return [];
    return [{
      kind: "paper" as const, id: item.id ?? urlValue, title, url: urlValue,
      snippet: item.publication_year ? `Published ${item.publication_year}` : "",
      channelOrAuthors: (item.authorships ?? []).map((row) => row.author?.display_name).filter(Boolean).slice(0, 4).join(", "),
      extra: { citationCount: item.cited_by_count ?? 0 },
    }];
  });
}
