# Decisions (`pipeline-v3`)

- 2026-10-14: Greenfield under `functions/src/pipeline/` and `functions/prompts/v3/`. Old RAG is inventoried in `REMOVAL_REPORT.md` and is deleted only after v3 tests pass.
- 2026-10-14: Durable worker is **Inngest on Supabase Edge**, not Firebase Cloud Tasks. Spark cannot host long Cloud Functions; Edge idle timeout is 150s so generate must not run inline in `api`.
- 2026-10-14: Linked Supabase project `kxusnfytnjltywalxiom` exists → **forward** drop migration later, never rewrite applied SQL.
- 2026-10-14: Writer family is Groq `qwen/qwen3.8-27b`. Planner `reasoning_effort: default` (thinking). Other Groq stages `none` (instruct). `reasoning_format: hidden`. Structured output `json_schema` + `strict: true` (supported on this model per Groq docs 2026-10-14). Zod after a tiny unwrap-only coercer.
- 2026-10-14: Verifier is Gemini `gemini-3.8-flash` via `generateContent` + `responseMimeType: application/json`. `VERIFIER_SAME_AS_WRITER` is A/B only.
- 2026-10-14: **Do not** use Gemini Grounding with Google Search. Unpaid Gemini may train on prompts; Search grounding stores prompts 30 days and requires Search Suggestions UI. Discovery is Tavily (Brave optional). We fetch pages ourselves so the writer never sees search-synthesized prose.
- 2026-10-14: Papers via OpenAlex (no key). Videos via YouTube Data API when `YOUTUBE_API_KEY` is set; transcripts are best-effort and never required.
- 2026-10-14: Embeddings via Gemini `gemini-embedding-001` (same key). Run-scoped only; page text is dropped when the lesson ends.
- 2026-10-14: Fake providers synthesize topic-agnostic fixture pages from the query string so any subject can be tested without a seed library.
- 2026-10-14: `startGeneration` returns a job id immediately. The thin client polls `getJob`. `requestRagCourse` in `courseAiApi.js` becomes a compatibility wrapper around that poll so UI components stay untouched.
- 2026-10-14: Insufficient research learner copy: “We couldn't find enough reliable material to teach this well. Try a more specific topic or rephrase it.”
- 2026-10-14: Max 2 rewrite loops. Publish only `ready` lessons. Prerequisite-blocked lessons stop the run with that same insufficient-research message.
- 2026-10-14: Groq structured output uses `response_format.json_schema` with `strict: true` and `reasoning_format: hidden`. Planner `reasoning_effort: default`; other Groq stages `none`.
- 2026-10-14: Gemini verifier sends both `responseSchema` and `responseJsonSchema` with `responseMimeType: application/json`.
- 2026-10-14: robots.txt is not fetched in fake tests. Live fetch is https-only with SSRF, size, time, and redirect caps. Full robots parsing is a follow-up before crawling aggressive sites.
- 2026-10-14: After v3 tests passed, old RAG/ingest/networking seeds were deleted. Linked Supabase uses forward drop `20261014230000_drop_old_pipeline.sql`.
