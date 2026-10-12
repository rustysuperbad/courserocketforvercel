# CourseRocket upgrade: architecture summary and plan

Written before the October 2026 upgrade work started; updated as phases land.

## Architecture found in the repository

**Frontend (`src/`)** — React 19 + Vite, JavaScript/JSX with two TypeScript helpers.
Firebase Authentication (Google + email) and Firestore hold the legacy product.
The whole legacy course generator runs *in the browser*: `lib/coursePipeline.js`
claims a Firestore lease on a course document, `lib/generateCourse.js` and
`lib/courseWriterPipeline.js` call Firebase callables for the outline, module text,
videos and papers, and write incremental drafts to Firestore. `pages/Course.jsx`
renders modules, lessons, two-item quizzes, videos, papers and a tutor chat.

**Functions (`functions/`)** — two layers:

- `functions/index.js` (CommonJS, legacy): `generateStructuredContent` (OpenAI
  Responses API with Gemini Google-Search grounding), `askCourseTutor`,
  `searchYouTubeVideos`, `searchAcademicPapers` (OpenAlex + Semantic Scholar),
  Firestore-based daily quotas and a 12-hour Firestore API cache.
- `functions/src/*.ts` (strict TypeScript): `index.ts` re-exports the legacy
  callables and adds `startCourseJob` (atomic run reservation + Inngest event),
  `inngestEndpoint` with a `course-generation-pipeline-v1` worker (path →
  retrieval → OpenAI writer → Gemini critic → persist modules/claims/quiz),
  `searchLearningSources` (hybrid pgvector + tsvector), `saveNetworkingBaseline`,
  `submitDiagnosticAnswer` (Bayesian knowledge tracing in SQL),
  `generateNetworkingPath`. Pure modules: `learning.ts` (DAG validation,
  topological path, BKT), `verifiedLesson.ts`, `reviews.ts` (ts-fsrs),
  `ingestion.ts`, `seed-networking.ts`, `observability.ts` (Langfuse OTel +
  Sentry), `quota.ts`.

**Database (`supabase/migrations/20261008120000_learning_foundation.sql`)** —
pgvector, every requested table, RLS keyed on the Firebase JWT `sub`, a
prerequisite cycle trigger, hybrid retrieval RPC and reservation/settlement RPCs
for per-user quotas and the project spend guard.

### Defects found before changing anything

| Problem | Effect |
| --- | --- |
| `functions/src/providers.ts` had a brace mismatch in the JSON schema literal | `npm run build` failed, so nothing in `functions/src` could deploy |
| `tsconfig.json` used `rootDir: "."`, emitting `lib/src/index.js` while `package.json#main` is `lib/index.js` | Firebase would load a non-existent entry point |
| Compiled `functions/lib/**` was committed and not ignored | Frontend `eslint .` reported 120+ errors in build output |
| `startCourseJob` ignored `domain` and `targetConceptSlug` when reserving the run | Networking jobs always ran as `general` |
| `src/lib/courseJobs.ts` sent `courseId` to a `.strict()` schema | Every job start was rejected as invalid-argument |
| `src/lib/groqChat.js` and root `.env` still carried a browser-side Groq key | Dead code, and a reminder of the stale README the task mentions |
| No UI used any of the new backend endpoints | Phase 1 acceptance could not be demonstrated |

## Plan

Each phase ends with `npm test`, `npm run lint`, `npm run build` (both packages)
and a commit. Existing legacy flows stay in place; the new learner-model flow is
mounted beside them under `/learn`.

1. **Foundations** — committed as `Phase 1: repair functions build and packaging, typed job APIs, /learn job console`.
2. **Ingestion and retrieval** — larger reviewed networking source list with
   full-article Wikipedia extraction, per-source license decisions, concept tags,
   idempotent re-ingestion, a shared `retrieval.ts` with level-fit scoring and
   per-source diversity, plus a second migration. `/learn` can query attributed chunks.
3. **Prerequisite graph and diagnostic** — enriched concept JSON (descriptions,
   levels, objectives, diagnostic items), learner profile (goal, known topics,
   interests), server-graded adaptive diagnostic with prerequisite propagation,
   onboarding UI, and tests showing two learners get different paths.
4. **Verified lesson pipeline** — extract the worker into an injectable
   `pipeline.ts` with an integration test using mocked providers, add the
   verified-module cache, claim rewrite support, analogy personalization from the
   learner profile, resource scoring/deduplication/caching, link checking, and a
   course viewer that shows citations and honest content status.
5. **Practice and mastery loop** — server-graded quiz attempts that update
   mastery, trace back through the prerequisite graph for remediation, schedule
   FSRS reviews; review queue UI; final project with rubric and AI feedback;
   Pyodide sandbox, subnetting trainer and protocol-ordering exercise.
6. **Evaluation and trust** — 50+ prompt eval harness with a report, per-lesson
   feedback and review queue, export/delete flows and privacy placeholder,
   pre/post/delayed outcome tracking and an analytics summary.
7. **Learner uploads (optional)** — private sources from notes/PDF text, used in
   retrieval, with flashcards and a concept map.

Nothing in this environment can reach Supabase, Inngest, OpenAI, Gemini,
YouTube, Langfuse or Sentry; the final report lists exactly what was and was not
exercised against real services.
