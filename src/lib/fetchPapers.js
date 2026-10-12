import { searchAcademicPapers } from "./courseAiApi";

export async function fetchPapers(query, limit = 1, signal) {
  const papers = await searchAcademicPapers({ query, signal });
  return Array.isArray(papers) ? papers.slice(0, Math.max(0, Number(limit) || 0)) : [];
}
