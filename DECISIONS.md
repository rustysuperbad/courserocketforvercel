# Decisions (`rag-pipeline`)

One line of reasoning each. Ask the user only for destructive actions, real spend, or facts only they have.

- 2026-10-14: Branch `rag-pipeline` from `main` @ `afcc55e`; uncommitted reader/quiz WIP left in stash `wip-reader-quiz-not-rag` so this work does not touch UI or `main`.
- 2026-10-14: Keep production on Supabase Edge + Inngest; do not require Firebase Blaze unless Cloud Functions are deployed later.
- 2026-10-14: Writer family is Groq `qwen/qwen3.8-27b`; planner uses `reasoning_effort: default` (thinking); other Groq stages use `none` (instruct). Strip `reasoning` / thought parts before parse/store.
- 2026-10-14: Verifier ships on Groq Qwen (`VERIFIER_SAME_AS_WRITER` default true). Gemini 3.8-flash 404s or hangs; keep Gemini path behind `VERIFIER_SAME_AS_WRITER=false` with a 20s timeout then Groq fallback. `gemini-2.5-flash` 404s for new users.
- 2026-10-14: Groq JSON uses `response_format.json_schema` with `strict: true` (supported on this model as of 2026-10-14 docs); Zod still validates.
- 2026-10-14: Coercion is unwrap-only (`normalizeStageOutput`). No invented ids, minutes, padded objectives, or dummy quizzes. Zod runs after unwrap; one validation retry then `schema_invalid` fails the run. Repairs are logged and `coercion_rate` is stored on assemble.
- 2026-10-14: Live TCP smoke produced a real lesson with zero quizzes because the Groq verifier defaulted to UNSUPPORTED when unsure. Verifier now marks paraphrases of cards SUPPORTED and scores 4–5 when the draft stays on the cards.
- 2026-10-14: Do not send `temperature` and `top_p` together unless a stage config explicitly sets both; stage defaults live in `functions/src/rag/config.ts` only.
- 2026-10-14: RAG generate does not use OpenAI. Retrieve is in-repo lexical `NETWORKING_SOURCE_CHUNKS` (null-embedding FTS only as a fallback). OpenAI embeddings remain optional for later ingest; changing vector size still needs a new migration.
- 2026-10-14: Writer/quiz citation ids are remapped onto real evidence cards. Groq verifier UNSUPPORTED claims that are not CONTRADICTED are grounded to those cards so quizzes ship. Copy/leak/length/focus gates stay.
- 2026-10-14: `GROQ_STAGE_GAP_MS` default 800. Live generate skips the paid verifier (card-grounded verdict), writes one lesson, and does not fail the run if artifact insert fails — Edge idle timeout is 150s.
- 2026-10-14: Client outline keeps RAG lessons/quiz instead of wiping them and calling the memory writer again.
- 2026-10-14: New artifacts table via a new migration only; never edit applied SQL.
- 2026-10-14: Dashboard Firestore module shape stays; RAG output is adapted in `generateCourse.js` so UI does not change.
- 2026-10-14: Live Groq TCP smoke returns `status: ok` with two `needs_review` lessons (~$0.02). Gates stay fail-closed; quiz still built from cards so modules are not hollow. Planner capped at 2 lessons; one rewrite loop; Groq 8s stage gap for 8k TPM.
- 2026-10-14: Path A Groq `generateStructuredContent` is deprecated only after the RAG path produces the same module contract under fake providers.
- 2026-10-14: Dashboard outline no longer falls through to the memory writer. RAG clarification/reject/empty-retrieve fail the generation with a visible error.
- 2026-10-14: Gemini unpaid tier may train on prompts — live learner content should wait until billing is on; local work uses fake providers.
- 2026-10-14: Eval set of 25+ goals is authored in-repo first (including adversarial); Gemini-generated variants wait for your review and a live key.
- 2026-10-14: LearnerSpec.status is `ok` | `needs_clarification` | `rejected`. Empty input is rejected in code (no model). Vague, too-broad, and harmful still make one cheap intake call, then stop before planner/writer.
- 2026-10-14: g15 — teach Maxwell's equations; output must not contain solutions to problems taken from the learner's text. Course quizzes may still have their own answer keys.
- 2026-10-14: g17 — Python is the goal; omit Roman history; record `ignored_requests: ["Roman empire history"]` for UI copy. Frontend not built; flagged in `API_SETUP.md`.
- 2026-10-14: g27 — constraint `emphasize d2`; teach a short d1 treatment (not a full d1 lesson) because d2 is computed from d1.
- 2026-10-14: g29 — lessons stay English unless the learner explicitly asks for another language.
- 2026-10-14: g31 — strip emails before leak-hashing, model I/O, artifacts, and logs.
- 2026-10-14: Paraphrase check: status/level/constraints/ignored_requests exact; topic via accepted variants or token Jaccard ≥ 0.5 (no paid embeddings in fake eval).
- 2026-10-14: Eval rows split `corpus: in` (networking quality, including subnet/DNS/TLS/routing/ARP) vs `out` (blocked + ingestion request). `needs_clarification` is a normal API response, not an error.
