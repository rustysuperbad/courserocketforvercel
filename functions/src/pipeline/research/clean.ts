const DROP_TAGS = /<(script|style|nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi;
const COOKIE = /cookie|consent|subscribe to our newsletter|advertisement|leave a comment/gi;

export function stripBoilerplateHtml(html: string): string {
  let text = String(html || "");
  text = text.replace(DROP_TAGS, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|article)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(COOKIE, " ");
  text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function isUsablePage(text: string): boolean {
  if (!text || text.length < 80) return false;
  if (/please\s+subscribe|paywall|sign in to continue/i.test(text) && text.length < 400) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters / text.length > 0.4;
}

export function chunkText(text: string, size = 700, overlap = 80): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return chunks;
}

export function nearDuplicate(a: string, b: string): boolean {
  const left = a.slice(0, 280).toLowerCase();
  const right = b.slice(0, 280).toLowerCase();
  if (left === right) return true;
  const aw = new Set(left.split(/\W+/).filter(Boolean));
  const bw = right.split(/\W+/).filter(Boolean);
  let hits = 0;
  for (const w of bw) if (aw.has(w)) hits += 1;
  return bw.length > 0 && hits / bw.length > 0.86;
}
