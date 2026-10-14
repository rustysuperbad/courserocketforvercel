# Removal report

Branch: `pipeline-v3` from `main` @ `db65254`.

## Deleted (after v3 tests were green)

Code: `functions/src/rag/`, `functions/src/pipeline.ts`, `providers.ts`, `verifiedLesson.ts`, `ingestion.ts`, `embeddings.ts`, `retrieval.ts`, `chunking.ts`, `catalog.ts`, `seed-networking.ts`, `evalHarness.ts`, `diagnostic.ts`, `onboarding.ts`, `learning.ts`, `masteryLoop.ts`, `trust.ts`, `resources.ts`, `linkCheck.ts`, `networking-concepts.json`, `functions/data/networking-*.json`, old `functions/prompts/*.md` (v3 kept), `functions/eval/rag-*`, `functions/eval/networking-prompts.json`, matching tests.

Frontend: banned ingest/approved-sources string in `src/lib/generateCourse.js`. Thin client now `startGeneration` + `getJob`. UI components not redesigned.

SQL (forward, linked project `kxusnfytnjltywalxiom`): `supabase/migrations/20261014230000_drop_old_pipeline.sql` drops retrieval RPCs, `rag_run_artifacts`, `source_chunks`, `generation_runs`, `concept_prereqs`, `concepts`. Learner `courses` / `modules` rows stay.

Callables for the old launch catalog now return empty or a cutover error so existing pages do not crash.

## Guard

`functions/test/noTopicSeed.test.ts` fails the build if those seeds or the banned ingest copy reappear.

---

# Original inventory (kept for the audit trail)

Branch: `pipeline-v3` from `main` @ `db65254`.

## Supabase case (confirmed)

A remote project **is linked**: `kxusnfytnjltywalxiom` (`supabase/config.toml` `project_id`).

When the new pipeline’s tests are green, old objects will be dropped with a **forward migration**. Applied SQL files will not be rewritten. The user’s note that they have not created a project yet does not match this checkout; we follow the linked case.

## Frontend calls the old pipeline through

| Client | Callable | Notes |
| --- | --- | --- |
| `src/lib/courseAiApi.js` | `generateRagCourse` | Sync RAG generate; will become start+poll |
| `src/lib/courseAiApi.js` | `generateStructuredContent` | Legacy Groq/OpenAI writer |
| `src/lib/courseAiApi.js` | `askCourseTutor`, `searchYouTubeVideos`, `searchAcademicPapers` | Tutor/resources; keep until product says otherwise |
| `src/lib/generateCourse.js` | `requestRagCourse` | Throws the banned “No approved sources…” string |
| `src/lib/coursePipeline.js` | `generateCourseStructure` | Firestore job wrapper around the above |
| `src/lib/learningApi.ts` | `startCourseJob`, `searchLearningSources`, `saveNetworkingBaseline`, `generateNetworkingPath`, `listNetworkingCatalog`, `getNetworkingConceptMap`, diagnostics, mastery | Launch-domain / networking loop |

UI components are not redesigned. Error/status strings that mention ingestion, approved sources, or networking as a product focus will be replaced after v3 tests pass.

## Old generation / RAG (delete after v3 is green)

- `functions/src/rag/` (entire directory)
- `functions/prompts/*.md` (v1 prompts; v3 lives in `functions/prompts/v3/`)
- `functions/eval/rag-eval-goals.json`, `functions/eval/rag-fake-baseline.md`
- `functions/test/rag*.test.ts`, `functions/test/fixtures/rag-wrap/`
- `functions/src/pipeline.ts` (Inngest Path A writer)
- `functions/src/providers.ts`, `functions/src/verifiedLesson.ts`, `functions/src/workflow.ts`
- `functions/src/ingestion.ts`, `functions/src/embeddings.ts`, `functions/src/retrieval.ts`, `functions/src/chunking.ts`
- `functions/src/legacyAi.ts` generate path (after tutor/YouTube/papers split is decided)
- Callables: `generateRagCourse`, `startCourseJob` networking domain, `searchLearningSources`

## Networking product surface (delete after v3 is green)

Seeds / datasets / catalogs:

- `functions/data/networking-concepts.json`
- `functions/data/networking-sources.json`
- `functions/src/networking-concepts.json`
- `functions/src/seed-networking.ts`
- `functions/src/catalog.ts`

Onboarding / diagnostics / “launch domain”:

- `functions/src/onboarding.ts`, `functions/src/diagnostic.ts`, `functions/src/learning.ts`
- `functions/src/evalHarness.ts`
- `src/lib/subnetting.ts` (topic-specific helper)
- Tests: `functions/test/catalog.test.ts`, `onboarding.test.ts`, `diagnostic.test.ts`, `ingestion.test.ts`, `evalHarness.test.ts`, parts of `learning.test.ts`, `masteryLoop.test.ts`, `pipeline.test.ts`

Docs / copy:

- `REQUIRED_SETUP.md`, `API_SETUP.md`, `PIPELINE_AUDIT.md`, `DECISIONS.md` (will be replaced by v3 docs)
- README ingest / networking sections
- `DESIGN_NOTES.md` launch-domain mentions
- `docs/UPGRADE_PLAN.md` networking seed

Banned learner-facing string:

- `src/lib/generateCourse.js`: “No approved sources for this topic yet. Try a networking topic, or ingest sources first.”

## SQL objects to drop (forward migration, linked project)

From applied migrations, generation/retrieval/networking-shaped objects include:

- `sources`, `source_chunks`, `hybrid_search_source_chunks`
- `generation_runs`, `reserve_generation_run`, `finalize_generation_run`
- `rag_run_artifacts`
- `concepts` / prerequisite edges seeded as networking
- related RPCs: `reserve_source_search`, `settle_source_search`

Auth, Firebase, and non-generation user tables stay. Exact DROP list will be written into the forward migration only after v3 tests pass.

## Keep (not generation, not a topic seed)

- Firebase Auth / hosting / Vite app shell
- `functions/src/auth.ts`, `errors.ts`, `env.ts`, `gateway.ts`, `supabase.ts`
- Course reader UI, dashboard, sandbox as a blank runner
- Unrelated uses of “network” (HTTP, `fetch`, CSS)

## Guard after deletion

`functions/test/pipeline/noTopicSeed.test.ts` will fail the build if topic-specific seeds, networking catalogs, or the old “approved sources / ingest first” string reappear.
