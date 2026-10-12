export type LinkStatus = "ok" | "broken" | "redirected" | "unchecked";
export type LinkFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function checkUrl(url: string, fetcher: LinkFetcher = fetch, timeoutMs = 8000): Promise<Exclude<LinkStatus, "unchecked">> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "broken"; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "broken";
  try {
    const head = await fetcher(parsed.toString(), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (head.status >= 300 && head.status < 400) return "redirected";
    if (head.status >= 200 && head.status < 300) return "ok";
    if (head.status === 405 || head.status === 501) {
      const get = await fetcher(parsed.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      if (get.status >= 300 && get.status < 400) return "redirected";
      if (get.status >= 200 && get.status < 300) return "ok";
      return "broken";
    }
    return "broken";
  } catch {
    return "broken";
  }
}

export async function checkUrls(urls: string[], fetcher: LinkFetcher = fetch): Promise<Record<string, Exclude<LinkStatus, "unchecked">>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const entries = await Promise.all(unique.map(async (url) => [url, await checkUrl(url, fetcher)] as const));
  return Object.fromEntries(entries);
}
