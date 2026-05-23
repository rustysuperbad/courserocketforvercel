const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

const FIELDS =
  "items(id/videoId,snippet/title,snippet/channelTitle," +
  "snippet/thumbnails/medium,snippet/description)";

const cache = new Map();

/** Default catalogue language — recommendations use this unless user explicitly overrides on the course doc. */
const DEFAULT_LANG = "en";

/** Map common aliases → ISO 639-1 codes accepted by relevanceLanguage (2 letters). */
const LANG_ALIASES = Object.freeze({
  english: "en",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  hindi: "hi",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  russian: "ru",
  arabic: "ar",
  dutch: "nl",
  polish: "pl",
  turkish: "tr",
  vietnamese: "vi",
  thai: "th",
  indonesian: "id",
  bengali: "bn",
  tamil: "ta",
  telugu: "te",
  malayalam: "ml",
  marathi: "mr",
  urdu: "ur",
});

/**
 * @param {string | undefined | null} raw
 * @returns {string} Two-letter lowercase code for YouTube relevanceLanguage; default `en`.
 */
export function normalizeYouTubePreferredLanguage(raw) {
  if (raw == null) return DEFAULT_LANG;
  const s = String(raw).trim();
  if (!s) return DEFAULT_LANG;
  const lower = s.toLowerCase();
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(lower)) return lower.slice(0, 2).toLowerCase();
  const alias = LANG_ALIASES[lower.replace(/\s+/g, " ")];
  return alias || DEFAULT_LANG;
}

// ─── Non‑English scripts (reject for English‑only catalogue) ───────────────────

function hasStrongNonEnglishScriptSignal(blob) {
  if (!blob || blob.length < 2) return false;
  const t = blob.slice(0, 1200);

  const scriptPatterns = [
    /[\u0C00-\u0C7F]/g,
    /[\u0D00-\u0D7F]/g,
    /[\u0900-\u097F]/g,
    /[\u0980-\u09FF]/g,
    /[\u0A80-\u0AFF]/g,
    /[\u0A00-\u0A7F]/g,
    /[\u0B80-\u0BFF]/g,
    /[\u0780-\u07BF]/g,
    /[\u0E00-\u0E7F]/g,
    /[\u1000-\u109F]/g,
    /[\u0590-\u05FF]/g,
    /[\u0600-\u06FF]/g,
    /[\u0530-\u058F]/g,
    /[\u10A0-\u10FF]/g,
    /[\u1200-\u137F]/g,
  ];

  for (const re of scriptPatterns) {
    const m = t.match(re);
    if (m && m.length >= 2) return true;
  }

  const euroExt = /[\u0400-\u04FF]/g;
  const cyr = t.match(euroExt);
  if (cyr && cyr.length >= 4) return true;

  const east = t.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g);
  if (east && east.length >= 2) return true;

  return false;
}

/** Obvious Latin text claiming another language outright (meta / tags). */
const NON_ENGLISH_TAG_RE = [
  /\b(hindi\s+tutorial|in\s+hindi|learn\s+hindi|telugu\b|tamil\b|tamizh\b)/i,
  /\b(spanish\s+tutorial|espa[nñ]ol|tutorial\s+en\s+espa)/i,
  /\b(fran[cç]ais|pour\s+débutants|cours\s+fran)/i,
  /\b(portugu[eê]s\b|tutorial\s+em\s+portugu)/i,
  /\b(russian\s+tutorial|на\s+русском|учим\s+)/i,
  /\b(arabic\s+tutorial|بالعربي|بالعربية)/i,
  /\b(deutsch\b|tutorial\s+auf\s+deutsch)/i,
  /\b(thai\b|ภาษาไทย|สอน\b)/,
  /\b(vietnamese\b|tiếng\s+việt)/i,
  /\bindonesian\b|bahasa\b/i,
  /\b(full\s+course\s+in\s+[a-z]+)\b/i,
];

/** Heuristic: share of ASCII A–Za–z versus other Unicode letters on the blob. */
function asciiLetterDensity(parts) {
  const [title = "", chan = "", desc = ""] = parts;
  const blob = `${title}\n${title}\n${chan}\n${chan}\n${desc}`;
  let ascii = 0;
  let otherLetter = 0;
  const len = blob.length || 1;
  for (let i = 0; i < len; i++) {
    const c = blob[i];
    const code = c.charCodeAt(0);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) ascii++;
    else if (code >= 128 && /\p{L}/u.test(c)) otherLetter++;
  }
  const rawDiacritic = [...blob].filter((ch) =>
    /\p{Mn}/u.test(ch) || /[À-ÖØ-öø-ÿ]/.test(ch)
  ).length;
  const diacFrac = blob.length ? rawDiacritic / blob.length : 0;
  const frac = ascii / (ascii + otherLetter + 1);
  return { frac, diacFrac, ascii, otherLetter, len };
}

/**
 * Aggressive gate: default English catalogue should never drift into other languages without an explicit preference.
 */
function passesStrictEnglishMetadata(v) {
  const title = String(v.title || "").trim();
  const channel = String(v.channel || "");
  const description = String(v.description || "");
  if (!title) return false;
  const combined = `${title}\n${description}\n${channel}`;

  if (NON_ENGLISH_TAG_RE.some((re) => re.test(combined))) return false;

  const { frac, diacFrac } = asciiLetterDensity([title, channel, description]);
  if (frac < 0.74) return false;
  if (diacFrac > 0.09 && frac < 0.88) return false;

  if (hasStrongNonEnglishScriptSignal(combined)) return false;

  const wordish = [...title.slice(0, 120).matchAll(/[a-zÀ-ÖØ-öø-ÿ'-]{4,}/gi)];
  let englishFlavor = 0;
  const commonEn =
    /\b(and|with|your|the|for|course|lesson|learn|explain|tutorial|guide|introduction|coding|building|getting|started|python|javascript|systems|engineering|biology|statistics|probability|economics)\b/i;
  if (commonEn.test(combined)) englishFlavor++;

  const emojiCount = [...combined.matchAll(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu)].length;
  if (emojiCount >= 6) englishFlavor--;

  const vocabHits = wordish.filter((x) =>
    /\b(and|course|lesson|explain|tutorial|chapter|introduction|concept|fundamentals)\b/i.test(x[0])
  ).length;
  if (vocabHits > 2) englishFlavor++;

  const effective = frac >= 0.84 || (frac >= 0.74 && englishFlavor >= 1);
  if (!effective) return false;

  const titleLetters = [...title.matchAll(/[\p{L}]/gu)];
  const latinTitle =
    titleLetters.length === 0 ||
    titleLetters.every((m) =>
      /\p{Script=Latin}/u.test(m[0]) ||
      /\p{Script=Inherited}/u.test(m[0]) ||
      /\p{Script=Common}/u.test(m[0])
    );
  if (!latinTitle && title.replace(/\s+/g, "").length >= 12) return false;

  return true;
}

/** @type {(v: { title?: string; channel?: string; description?: string }, preferred: string) => boolean} */
function passesLanguageGate(v, preferred) {
  const title = v.title || "";
  const channel = v.channel || "";
  const description = v.description || "";
  const blob = `${title}\n${description}\n${channel}`;
  const target = preferred || DEFAULT_LANG;

  if (target !== DEFAULT_LANG) {
    return !hasStrongNonEnglishScriptSignal(blob);
  }
  return passesStrictEnglishMetadata(v);
}

// ─── Quality ranking (preference for educational, sane metadata) ───────────────

const CLICKBAIT_RE =
  /\b(you\s+won'?t\s+believe|must\s+watch|#\s*(short|shorts)|#\s*vlog|vine\s|meme|crazy\s+trick|caught\s|shocking)\b/i;
const LOW_EFFORT_RE =
  /\b(subscribe\s+like\s+hit\s+notification|pls\s+sub|giveaway|free\s+money|bitcoin\s+prediction)\b/i;
const SHORTS_MARKER = /\b#short(?:s|\b)|\([^)]*\bshort\b[^)]*\)/i;

/** @param {{title?: string;channel?:string;description?:string}} v */
function educationalToneScore(v) {
  let s = 0;
  const t = `${v.title || ""}\n${v.description || ""}`.toLowerCase();
  if (/\btutorial\b|\bcourse\b|\blesson\b|\blecture\b|\bexplained\b|\bintroduction\b|\bfundamentals\b|\bcrash\s+course\b/.test(t)) {
    s += 3;
  }
  if (/\bexam\b|\bexam\s+prep\b|\binterview\b|\bconcept\b|\bworkflow\b|\bhands[- ]on\b/.test(t)) s += 1;
  if (SHORTS_MARKER.test(v.title || "")) s -= 4;
  if (CLICKBAIT_RE.test(t)) s -= 4;
  if (LOW_EFFORT_RE.test(t)) s -= 5;
  if (/^[^a-z]{0,3}[A-Z0-9\s:]{28,}$/.test((v.title || "").trim())) s -= 2;
  const { frac } = asciiLetterDensity([v.title || "", v.channel || "", v.description || ""]);
  s += frac * 3;
  if ((v.channel || "").length >= 55) s -= 0.25;
  return s;
}

function stripForDedupe(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function sortCandidatesEducational(candidates, originalOrder, preferredIsEnglish) {
  const ix = new Map(originalOrder.map((id, i) => [id, i]));
  return [...candidates].sort((a, b) => {
    const ed = educationalToneScore(b) - educationalToneScore(a);
    if (preferredIsEnglish && Math.abs(ed) < 0.01) {
      const da =
        asciiLetterDensity([a.title || "", a.channel || "", a.description || ""]).frac -
        asciiLetterDensity([b.title || "", b.channel || "", b.description || ""]).frac;
      if (da !== 0) return da > 0 ? -1 : 1;
    } else if (Math.abs(ed) > 1e-6) {
      return ed;
    }
    return (ix.get(a.videoId) ?? 999) - (ix.get(b.videoId) ?? 999);
  });
}

/**
 * Rank + filter raw search items into a capped pool (up to poolCap strips).
 */
function rankVideoPool(rawItems, poolCap, preferred) {
  const cap = Math.min(Math.max(poolCap, 4), 32);
  const preferredIsEnglish = !preferred || preferred === DEFAULT_LANG;

  const enriched = rawItems
    .filter((it) => it?.id?.videoId)
    .map((item, idx) => ({
      _order: idx,
      videoId: item.id.videoId,
      title: item.snippet?.title || "",
      channel: item.snippet?.channelTitle || "",
      thumbnail: item.snippet?.thumbnails?.medium?.url || "",
      description: item.snippet?.description
        ? item.snippet.description.slice(0, 220).replace(/\s+/g, " ")
        : "",
    }));

  let filtered = enriched.filter((v) => passesLanguageGate(v, preferred));
  filtered = sortCandidatesEducational(filtered, enriched.map((e) => e.videoId), preferredIsEnglish);

  const strip = ({ videoId, title, channel, thumbnail, description }) => ({
    videoId,
    title,
    channel,
    thumbnail,
    description,
  });

  const out = [];
  const seenTitle = new Set();
  const seenIds = new Set();

  const walk = (list) => {
    for (const v of list) {
      const key = stripForDedupe(v.title);
      if (!v.videoId || seenIds.has(v.videoId)) continue;
      if (key && seenTitle.has(key)) continue;
      seenIds.add(v.videoId);
      if (key) seenTitle.add(key);
      out.push(strip(v));
      if (out.length >= cap) break;
    }
  };

  walk(filtered);
  if (!preferredIsEnglish && out.length < cap) {
    walk(
      [...enriched]
        .sort((a, b) => a._order - b._order)
        .filter((v) => !seenIds.has(v.videoId))
        .filter((v) => passesLanguageGate(v, preferred))
    );
  }

  return out.slice(0, cap);
}

async function runSearch(apiKey, q, opts) {
  const {
    relevanceLang,
    maxResultsFetch,
    regionCode,
    signal,
    videoCaption,
    order,
  } = opts;

  const u = new URL(SEARCH_URL);
  const p = u.searchParams;
  p.set("part", "snippet");
  p.set("type", "video");
  p.set("safeSearch", "moderate");
  p.set("videoDuration", "medium");
  p.set("relevanceLanguage", relevanceLang);
  p.set("regionCode", regionCode);
  p.set("maxResults", String(maxResultsFetch));
  p.set("fields", FIELDS);
  p.set("q", q);
  p.set("order", order || "relevance");
  p.set("key", apiKey);
  if (videoCaption) p.set("videoCaption", videoCaption);

  const res = await fetch(u.toString(), { signal });
  if (!res.ok) throw new Error("YouTube HTTP " + res.status);
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * @param {string} query
 * @param {number} maxResults Desired count after filtering (cap 5).
 * @param {AbortSignal} [signal]
 * @param {{ preferredLanguage?: string }} [opts]
 * @returns {Promise<Array<{ videoId, title, channel, thumbnail, description }>>}
 */
export async function fetchYouTubeVideos(query, maxResults = 1, signal, opts = {}) {
  const key = import.meta.env.VITE_YOUTUBE_API_KEY;
  if (!key) return [];

  const n = Math.min(Math.max(maxResults, 1), 5);
  const relevanceLang = normalizeYouTubePreferredLanguage(opts.preferredLanguage);
  const regionExplicit = String(opts.regionCode || "").trim().toUpperCase();
  const regionCode = regionExplicit.length === 2 ? regionExplicit : relevanceLang === "en" ? "US" : "US";
  const cacheKey = `${query}|${n}|${relevanceLang}|v4`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const maxResultsFetch = Math.min(47, Math.max(16, n * 9));
  /** Pool sized for merges across retries (always filtered + ranked afterwards). */
  const poolFloor = Math.max(18, n * 7);

  const attempt = async (q, overrides = {}) =>
    rankVideoPool(
      await runSearch(key, q, {
        relevanceLang,
        maxResultsFetch,
        regionCode: overrides.regionCode || regionCode,
        signal,
        videoCaption: overrides.videoCaption || "",
        order: overrides.order || "relevance",
      }),
      poolFloor,
      relevanceLang
    );

  const mergeUniquePreferScore = (cands, cap) => {
    const seen = new Set();
    const pool = [];
    for (const c of cands) {
      if (!c?.videoId || seen.has(c.videoId)) continue;
      seen.add(c.videoId);
      pool.push(c);
    }
    const orderIds = pool.map((c) => c.videoId);
    return sortCandidatesEducational(pool, orderIds, relevanceLang === DEFAULT_LANG).slice(0, cap);
  };

  let merged = [];

  try {
    const base = query.trim();

    merged = mergeUniquePreferScore(await attempt(base), poolFloor);

    if (relevanceLang === DEFAULT_LANG && merged.length < n) {
      merged = mergeUniquePreferScore([...merged, ...(await attempt(`${base} English tutorial lecture explained`))], poolFloor);
    }

    if (relevanceLang === DEFAULT_LANG && merged.length < n) {
      merged = mergeUniquePreferScore(
        [...merged, ...(await attempt(base, { videoCaption: "closedCaption", order: "relevance" }))],
        poolFloor
      );
    }

    if (relevanceLang === DEFAULT_LANG && merged.length < n) {
      merged = mergeUniquePreferScore(
        [...merged, ...(await attempt(base, { order: "rating" }))],
        poolFloor
      );
    }

    const picked = mergeUniquePreferScore(merged, n);
    cache.set(cacheKey, picked);
    return picked;
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("403")) {
      console.warn("[YouTube] 403 — quota likely exhausted.");
    }
    cache.set(cacheKey, []);
    return [];
  }
}
