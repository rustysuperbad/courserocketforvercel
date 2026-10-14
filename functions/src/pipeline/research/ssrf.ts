const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata"]);

function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const nums = m.slice(1).map((n) => Number(n));
  if (nums.some((n) => n > 255)) return null;
  return nums;
}

export function isBlockedIp(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "0.0.0.0" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const ip = ipv4Octets(h);
  if (!ip) return false;
  const a = ip[0] ?? 0;
  const b = ip[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function assertPublicHttps(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("ssrf_blocked:invalid_url");
  }
  if (parsed.protocol !== "https:") throw new Error("ssrf_blocked:https_only");
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("ssrf_blocked:private_host");
  }
  if (isBlockedIp(host)) throw new Error("ssrf_blocked:private_ip");
  return parsed;
}

export type FetchResult = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

export async function fetchPublicHttps(
  rawUrl: string,
  opts: { timeoutMs: number; maxBytes: number; maxRedirects: number; fetchImpl?: typeof fetch } = {
    timeoutMs: 8000,
    maxBytes: 400_000,
    maxRedirects: 3,
  },
): Promise<FetchResult> {
  let current = assertPublicHttps(rawUrl);
  const fetchImpl = opts.fetchImpl || fetch;
  for (let hops = 0; hops <= opts.maxRedirects; hops += 1) {
    const response = await fetchImpl(current.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { "User-Agent": "CourseRocketResearch/3.0" },
    });
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      const next = new URL(location, current);
      current = assertPublicHttps(next.toString());
      continue;
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > opts.maxBytes) throw new Error("fetch_too_large");
    const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return { url: current.toString(), status: response.status, headers, body };
  }
  throw new Error("ssrf_blocked:too_many_redirects");
}
