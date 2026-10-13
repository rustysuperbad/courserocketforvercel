import { createHash } from "node:crypto";

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

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
