# Decisions (`rag-pipeline`)

One line of reasoning each. Ask the user only for destructive actions, real spend, or facts only they have.

- 2026-10-14: Branch `rag-pipeline` from `main` @ `afcc55e`; uncommitted reader/quiz WIP left in stash `wip-reader-quiz-not-rag` so this work does not touch UI or `main`.
- 2026-10-14: Keep production on Supabase Edge + Inngest; do not require Firebase Blaze unless Cloud Functions are deployed later.
- 2026-10-14: Writer family is Groq `qwen/qwen3.8-27b`; planner uses `reasoning_effort: default` (thinking); other Groq stages use `none` (instruct). Strip `reasoning` / thought parts before parse/store.
- 2026-10-14: Verifier default `gemini-2.5-flash` via `GEMINI_MODEL` (different family). `VERIFIER_SAME_AS_WRITER` is eval-only.
- 2026-10-14: Groq JSON uses `response_format.json_schema` with `strict: true` (supported on this model as of 2026-10-14 docs); Zod still validates.
- 2026-10-14: Do not send `temperature` and `top_p` together unless a stage config explicitly sets both; stage defaults live in `functions/src/rag/config.ts` only.
- 2026-10-14: Embeddings stay OpenAI `text-embedding-3-small` @ 1536 to match `source_chunks.embedding`; changing size needs a new migration.
- 2026-10-14: New artifacts table via a new migration only; never edit applied SQL.
- 2026-10-14: Dashboard Firestore module shape stays; RAG output is adapted in `generateCourse.js` so UI does not change.
- 2026-10-14: Path A Groq `generateStructuredContent` is deprecated only after the RAG path produces the same module contract under fake providers.
- 2026-10-14: Gemini unpaid tier may train on prompts — live learner content should wait until billing is on; local work uses fake providers.
- 2026-10-14: Eval set of 25+ goals is authored in-repo first (including adversarial); Gemini-generated variants wait for your review and a live key.
