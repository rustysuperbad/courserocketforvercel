# Pipeline audit (Step 0)

Branch: `rag-pipeline` (from `main` @ `afcc55e`). Dated 2026-10-14.

Baseline before any RAG code: root vitest **7/7**, `functions/` **48/48**, `functions` `tsc` green.

## What exists

Two generation paths, plus a third unused Firebase callable surface.

### Path A — Dashboard / Firestore (live product)

```
Dashboard / Course
  → src/lib/coursePipeline.js (Firestore lease + drafts)
  → src/lib/generateCourse.js (outline + per-module enrich)
  → src/lib/courseWriterPipeline.js (CURRICULUM_SYSTEM / MODULE_SYSTEM)
  → src/lib/courseAiApi.js → invokeBackend("generateStructuredContent")
  → Supabase Edge POST /functions/v1/api
  → functions/src/gateway.ts → CALLABLES.generateStructuredContent
  → functions/src/legacyAi.ts → Groq chat/completions
  → Firestore courses/{id}
```

- Writer: Groq `GROQ_MODEL` default `qwen/qwen3.8-27b` (`reasoning_effort: none`, `temperature: 0.2`, `max_completion_tokens` 6k/10k, `json_schema` then `json_object` fallback). Fallbacks: `openai/gpt-oss-20b`, `openai/gpt-oss-120b`.
- `evidenceQuery` is sent from the client and **ignored** (`legacyAi.generateStructuredContent` writes with empty evidence/sources).
- Quality is client-only (`lessonContentQuality.js`, `lessonMeetsSimpleBar`). Failed writes pad with template lessons/quizzes. Raw learner text is interpolated into fallbacks.
- No hybrid retrieval, no Gemini critic, no quota reserve/settle.

### Path B — `/learn` verified job (not used by Dashboard)

```
learningApi.startCourseJob
  → CALLABLES.startCourseJob
  → RPC reserve_generation_run
  → Inngest course/generation.requested
  → workflow.processCourseGeneration
  → retrieveForGeneration (OpenAI embed + hybrid_search_source_chunks)
  → createVerifiedLessonProvider (OpenAI write + Gemini critique)
  → persist modules / lesson_claims / quiz_items
  → record_generation_usage / finalize_generation_run
```

- Writer: OpenAI Responses API, `OPENAI_MODEL` default `gpt-4.1-mini`.
- Critic: Gemini `generateContent`, `GEMINI_MODEL` default **`gemini-2.0-flash` in `workflow.ts`** vs **`gemini-3.5-flash` in `.env.example` / `legacyAi.geminiModelList`**.
- Rewrite: `generateVerifiedLesson` supports **one** rewrite **if** `provider.rewrite` exists. `createVerifiedLessonProvider` does **not** implement `rewrite`, so production never rewrites.
- Empty evidence → `evidence-missing`. Course is `blocked` only if **every** step lacks evidence. Unverified claims/quizzes are still persisted (`verified: false`). Soft-fail, not fail-closed.

### Path C — unused Firebase `onCall`

`functions/index.js` still exports `generateStructuredContent` (OpenAI + Gemini Google Search grounding + Firestore `courseApiUsage`). Current UI uses Edge only (`invokeBackend`).

There is **no** `courseJobs.ts`. Job types live in `functions/src/jobs.ts`.

## Retrieval and storage already in place

| Piece | Status |
| --- | --- |
| `sources` / `source_chunks` | Applied. `embedding extensions.vector(1536)` + `search_vector` tsvector |
| `hybrid_search_source_chunks` | Applied (8-arg form in `20261012120000_retrieval_upgrade.sql`) |
| Embeddings | OpenAI `text-embedding-3-small`, **1536 dims — matches the column** |
| Quota RPCs | `reserve_generation_run`, `finalize_generation_run`, `record_generation_usage`, `reserve_source_search`, `settle_source_search` (service_role only) |
| RLS | On; owner via `current_firebase_uid()`. Module/claim writes have no authenticated insert policies (service_role only) |
| Observability | `observability.ts` is a **no-op stub** (no Langfuse/Sentry on Edge) |

Applied migrations (do not edit):

1. `20261008120000_learning_foundation.sql`
2. `20261012120000_retrieval_upgrade.sql`
3. `20261012130000_learner_profiles.sql`
4. `20261012140000_verified_cache.sql`
5. `20261012150000_practice_loop.sql`
6. `20261012160000_trust_outcomes.sql`

## Conflicts with this RAG design

| Target | Today |
| --- | --- |
| Intake → `LearnerSpec`; raw text dies | No intake type. Raw `goal` stored on `generation_runs.goal` and `courses.goal`. Client Path A keeps the full dashboard string. |
| Hashed 4-word shingles of raw text, in-memory only | Client n-gram leak fingerprints exist; they are not hashed, and fallback lessons still paste the prompt. |
| Planner syllabus from spec | Networking: seeded DAG. General: **one** step titled with the raw goal. |
| Retrieve from objectives/key_concepts only | Path B retrieves; Path A does not. Query can still contain user wording. |
| Evidence cards, hard token budget | Writer sees raw chunk **text** (`toPromptChunk`). |
| Groq writer / Gemini verifier | Path A: Groq only. Path B: OpenAI writer + Gemini critic. Dual writers. |
| Code decides pass/fail from verdicts/scores | Critic returns `{ supported: boolean }`; code filters paragraphs but still ships unverified claims/quizzes. |
| Rewrite ×2, then `needs_review` | At most one rewrite, and only in tests (no live `rewrite`). |
| Quiz from SUPPORTED claims only | All quiz items persisted. |
| Assemble fail-closed | Partial success → `completed` + `ai_generated` draft. |
| One config file for models/modes/budgets | Hardcoded in `legacyAi.ts`, `providers.ts`, `workflow.ts`. |
| Versioned prompt files | Prompts inline in `courseWriterPipeline.js` and `verifiedLesson.buildLessonPrompts()`. |
| Fake providers for tests/local | Mocks in tests only; no production fake suite. `COURSE_AI_FAKE` does not exist. |
| Every paid call reserved | Path B job reserve exists. Path A Groq/YouTube/papers: **none**. Embeddings inside retrieval are not separately reserved. |

## Duplicate legacy logic

- Client writer: `generateCourse.js` + `courseWriterPipeline.js` + `courseAiApi.js`
- Edge Groq writer: `legacyAi.ts`
- Verified OpenAI+Gemini writer: `providers.ts` + `verifiedLesson.ts` + `pipeline.ts` + `workflow.ts`
- Unused Firebase writer: `functions/index.js`

Dashboard never calls Path B. `/learn` never calls Path A.

## Bugs and security risks

1. **Prompt leak (live):** Path A fallback interpolates the full learner prompt (`This module covers X inside {raw topic}`). Client leak gates are incomplete.
2. **Ungrounded write (live):** Groq writes from model memory; `evidenceQuery` discarded.
3. **Quota hole (live):** Edge Groq/tutor/YouTube/papers skip `reserve_generation_run`.
4. **CORS `*`** on the Edge gateway.
5. **Model-id drift:** Gemini defaults disagree (`gemini-2.0-flash` vs `gemini-3.5-flash`).
6. **Raw learner text in DB:** `generation_runs.goal`, `courses.goal`.
7. **Private notes** stored as `sources` with embeddings (owner-scoped; still sent to OpenAI for embed).
8. **`GROQ_API_KEY` was previously exposed** — must be rotated (see `REQUIRED_SETUP.md`).
9. **Rewrite never runs in production** despite docs (`API_SETUP.md` claims rewrite-once).
10. **Authenticated clients can execute `hybrid_search_source_chunks`** (granted to `authenticated`). Filters exist; still a wider surface than service_role-only.

## Files this rebuild will change

Prefer editing existing modules; add `functions/src/rag/` only where contracts are new.

| File | Role |
| --- | --- |
| `functions/src/rag/config.ts` | Single stage config (models, modes, budgets, gates) |
| `functions/src/rag/schemas.ts` | Zod contracts for every stage |
| `functions/src/rag/prompts.ts` | Versioned registry over `functions/prompts/*.md` |
| `functions/src/rag/providers.ts` | Groq + Gemini + fake; strip reasoning |
| `functions/src/rag/gates.ts` | Pure-code gates |
| `functions/src/rag/pipeline.ts` | Intake → assemble |
| `functions/src/rag/shingles.ts` | In-memory hashed shingles |
| `functions/src/rag/artifacts.ts` | Persist stage artifacts (no raw learner text) |
| `supabase/migrations/20261014120000_rag_run_artifacts.sql` | **New** artifacts table + RLS |
| `functions/src/callables.ts` / `gateway.ts` | New callable; keep Path A until adapter is live |
| `src/lib/courseAiApi.js` | Point generation at the RAG callable |
| `src/lib/courseWriterPipeline.js` / `generateCourse.js` | Adapter to existing Firestore module shape; no UI change |
| `functions/src/legacyAi.ts` | Deprecate Groq writer once RAG replaces it |
| `functions/src/providers.ts` / `verifiedLesson.ts` / `workflow.ts` | Reuse retrieval + quota; do not dual-write forever |
| `API_SETUP.md`, `.env.example` | Endpoints, placeholders only |
| Tests under `functions/test/rag*.test.ts` | Stage, gate, fake-provider integration, eval |

Will **not** change: UI (`src/pages`, `src/components`, CSS), `.env` files, applied migrations.

## Test coverage vs gaps (today)

Covered: DAG/mastery, retrieval ranking, quota math, ingestion fail-closed, verified-lesson mock rewrite×1, eval harness **52 networking prompts with mocks**.

Missing: Groq/Gemini client unit tests, Path A writer, rewrite×2, SUPPORTED-only quiz, fail-closed assemble, hashed leak gate, evidence-card token budget, fake-provider full RAG run, seeded-error verifier catch-rate.

## Provider docs used for this rebuild (2026-10-14)

**Groq `qwen/qwen3.8-27b`** ([model page](https://console.groq.com/docs/model/qwen/qwen3.8-27b), [reasoning](https://console.groq.com/docs/reasoning), [structured outputs](https://console.groq.com/docs/structured-outputs), [rate limits](https://console.groq.com/docs/rate-limits)):

- Instruct: `reasoning_effort: "none"` (model default). Thinking: `"default"` / `"low"` / `"medium"` / `"high"`.
- Context 131,072; max output 16,384. Use `max_completion_tokens` (not `max_tokens`).
- JSON schema: model supports **`strict: true`**. Always set `reasoning_format: "hidden"` (or strip `message.reasoning`) so thinking text never lands in stored JSON.
- Docs also list instruct sampling `temperature=0.7, top_p=0.80` and thinking `temperature=1.0, top_p=0.95`. We still put values in config; do not set both unless the stage config says so.
- Developer-plan base limits for this model: 30 RPM, 1K RPD, 8K TPM, 200K TPD. 429 → honour `retry-after`.
- Pricing (model page): input $0.80 / 1M, output $4.00 / 1M.

**Gemini API** ([generateContent](https://ai.google.dev/api/generate-content), [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [terms](https://ai.google.dev/gemini-api/terms)):

- REST: `POST https://generativelanguage.googleapis.com/v1beta/models/{id}:generateContent` with `x-goog-api-key`.
- JSON: `generationConfig.responseMimeType = "application/json"` + `responseSchema`.
- 2.5 Flash thinking off: `thinkingConfig.thinkingBudget = 0`. Newer 3.x models use `thinkingLevel` (do not mix).
- Current docs list many ids (`gemini-2.5-flash`, `gemini-3.8-flash`, …). Default in our config is **`gemini-2.5-flash`** until you set `GEMINI_MODEL`.
- **Data terms:** unpaid Gemini API / free AI Studio may use prompts and responses to improve Google products. **Paid** Gemini API (Cloud project with active billing) does **not** use prompts/responses for training; they are still logged briefly for abuse monitoring. EEA/UK/CH get paid-style data terms even on unpaid quota. Contributor Tier reverts to unpaid data use. We will not send Grounding-with-Google-Search (30-day retention of prompts).

## Runtime note

Production today is Vite/Vercel + Firebase Auth/Firestore (Spark) + **Supabase Edge** `api`/`inngest`, not Firebase Cloud Functions. `functions/src` is bundled by `scripts/bundle-edge.mjs` into `supabase/functions/*/handler.js`. Blaze is required only if we deploy Cloud Functions; Edge + Inngest Cloud can run the RAG worker without it.
