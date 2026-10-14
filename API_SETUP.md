# CourseRocket API and backend setup

CourseRocket keeps Firebase Authentication and Firestore for the existing product. New learning data uses Supabase Postgres/pgvector. Firebase ID tokens are verified by Cloud Functions and are also accepted by Supabase after Firebase is configured as a third-party provider. Provider secrets and Supabase service-role credentials stay in Cloud Functions or a private local environment; never put them in `VITE_` variables.

## Accounts and keys

| Service | Needed for | Where to set it |
| --- | --- | --- |
| [Firebase](https://console.firebase.google.com/) | Existing sign-in, Firestore, and callable functions | Existing app config; Functions secrets below |
| [Supabase](https://supabase.com/dashboard) | Postgres, pgvector, RLS, learner mastery and source retrieval | Public URL/anon key in local frontend; service-role key only in Functions |
| [Inngest](https://app.inngest.com/) | Durable background jobs and retries | Event key + signing key in Functions secrets |
| [OpenAI](https://platform.openai.com/api-keys) | Embeddings (`text-embedding-3-small`, 1536-d) | `OPENAI_API_KEY` server secret |
| [Groq](https://console.groq.com/keys) | RAG writer/planner/extractor/quiz (`qwen/qwen3.8-27b`) | `GROQ_API_KEY` server secret |
| [Langfuse](https://cloud.langfuse.com/) | LLM/job traces and cost metadata | Public + secret keys in Functions secrets |
| [Sentry](https://sentry.io/) | Sanitized backend error reporting | DSN in Functions secret |
| [Google Cloud Console](https://console.cloud.google.com/) | YouTube Data API v3, if the existing resource finder is used | `YOUTUBE_API_KEY` Functions secret |
| Gemini API | RAG verifier (different family from Groq). Default model id `gemini-3.8-flash` via `GEMINI_MODEL` | `GEMINI_API_KEY` server secret |

Check each provider's current pricing and usage limits before enabling paid calls. The database quota defaults are configurable and do not replace provider-side billing alerts.

## 1. Supabase project and Firebase identity

1. Create a Supabase project and copy its project URL, anon/publishable key, and service-role key. The service-role key bypasses RLS and must never be exposed to the browser.
2. In Supabase Auth, enable **Third-Party Auth → Firebase** and enter Firebase project ID `courserocket03` (or the ID for your deployment). Supabase verifies Firebase's asymmetric ID tokens and can apply RLS policies to them. See [Supabase's Firebase Auth guide](https://supabase.com/docs/guides/auth/third-party/firebase-auth).
3. Apply the SQL in [`supabase/migrations/`](./supabase/migrations/) in timestamp order (or `supabase db push`). `20261008120000_learning_foundation.sql` creates pgvector, tables, indexes, RLS, the cycle guard, the first hybrid retrieval RPC, and quota/spend RPCs. Later files add retrieval ranking, learner profiles, the verified-module cache, project submissions, and `learning_outcomes` for pre/post/delayed checks.
4. Put only the URL and anon key in the local frontend environment:

   ```sh
   cp .env.example .env.local
   ```

   Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The typed browser client attaches the signed-in Firebase ID token. The database maps its JWT `sub` claim to the Firebase UID for row ownership.

## 2. Firebase Functions secrets and parameters

From the repository root, set server-only keys when prompted:

```sh
firebase functions:secrets:set SUPABASE_URL
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
firebase functions:secrets:set INNGEST_EVENT_KEY
firebase functions:secrets:set INNGEST_SIGNING_KEY
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set LANGFUSE_PUBLIC_KEY
firebase functions:secrets:set LANGFUSE_SECRET_KEY
firebase functions:secrets:set SENTRY_DSN
```

For the existing callable API, also configure `GEMINI_API_KEY` and `YOUTUBE_API_KEY` if those features are used. Existing provider keys should be rotated if they were ever placed in a `VITE_` variable.

The first deploy prompts for non-secret parameters with safe defaults:

- `LANGFUSE_BASE_URL` — default `https://cloud.langfuse.com`; use the host for your Langfuse region.
- `DAILY_COURSE_RUN_LIMIT` — default 3 runs per Firebase UID per UTC day.
- `PROJECT_DAILY_SPEND_LIMIT_USD` — default $25 for course and embedding requests.
- `OPENAI_EMBEDDING_COST_PER_MILLION_USD` — default estimate `$0.02`; update it when model pricing changes.
- `ALLOW_NONCOMMERCIAL_SOURCES` — default `false`; keep off for a commercial product unless you have approved the relevant source license.

For local Functions emulator use, add these values to an untracked `functions/.env.<firebase-project-id>` file or configure Firebase secrets for the emulator. Never commit that file.

## 3. Inngest endpoint

Deploy the Functions code, then register the HTTPS endpoint in Inngest:

```sh
cd functions
npm install
npm test
npm run lint
cd ..
firebase deploy --only functions
```

The endpoint is normally `https://us-central1-courserocket03.cloudfunctions.net/inngestEndpoint` (use the exact URL printed by Firebase for your project). In the Inngest dashboard, add that URL as the app's sync endpoint. The callable `startCourseJob` verifies the Firebase token, reserves an idempotent database run, then sends only the opaque run ID to Inngest. The worker loads the learner path, retrieves attributed chunks, writes and critiques lessons, and persists modules incrementally.

## 4. Source ingestion and retrieval

The launch graph is in `functions/data/networking-concepts.json`; it can be reviewed before running:

```sh
cd functions
npm run seed:networking
```

The seed command requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the private environment. It validates cycles and writes concepts and prerequisite edges.

Source metadata is reviewed in `functions/data/networking-sources.json`. By default, CC BY-SA sources are stored as `review_required` and not ingested. After deciding how CourseRocket will honor the source attribution and ShareAlike requirements for content derived from those sources, explicitly allow ingestion:

```sh
npm run ingest:networking -- --approve-cc-by-sa
```

OpenStax's default textbook license is CC BY-NC-SA, so it is skipped unless you explicitly use `--allow-noncommercial`; the project-wide `ALLOW_NONCOMMERCIAL_SOURCES` setting must also be enabled for retrieval. IETF RFC entries and other official docs stay link-only until the individual document's rights are reviewed. Wikipedia and MDN pages need page-level attribution and ShareAlike handling. See [OpenStax licensing](https://help.openstax.org/s/article/Licensing-information-of-OpenStax-textbooks), [Wikimedia reuse terms](https://foundation.wikimedia.org/wiki/Terms_of_Use), [MDN attribution and licensing](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license), and the [IETF Trust legal provisions](https://trustee.ietf.org/documents/trust-legal-provisions/).

Ingestion uses the OpenAI embeddings API from the private script environment. Retrieved chunks include title, URL, license, attribution, authority, level, and relevance scores; the callable returns an explicit `retrievalStatus` if there are no approved sources or retrieval fails.

## 5. What is connected today

- Existing Firebase callable content/resource functions remain available.
- `startCourseJob` reserves an idempotent run (with the domain and target concept), enforces the per-user daily limit and the project spend guard, then dispatches to Inngest. `getCourseJobStatus` and `listLearningRuns` return the owner's run records using only the Firebase ID token, so the `/learn` page works without Supabase third-party auth.
- Unexpected callable errors are reported to Sentry (when `SENTRY_DSN` is set) with an area tag and no request payload.
- Supabase schema includes source storage, hybrid vector/full-text retrieval, per-user search/course quotas, and a UTC project-spend limit.
- Source retrieval callable returns attributed chunks.
- Networking concept seed, learner profile, server-graded adaptive diagnostic, and adaptive path endpoints are available. Apply `20261012130000_learner_profiles.sql` after the retrieval migration. Two learners with different known topics receive different topological paths for the same goal.
- FSRS scheduling is implemented, covered by unit tests, and connected to `/learn/review`.
- Langfuse and Sentry are optional until their credentials are set. Trace metadata excludes learner goal text, prompts, and model content.
- `npm run eval:networking` in `functions/` runs a 52-prompt launch-domain harness with mocked providers and writes `functions/eval/output/networking-report.md` (gitignored). It does not prove live OpenAI/Gemini quality.
- Signed-in learners can submit per-lesson feedback, record pre/post/delayed checks, export or delete learning-model data from `/privacy`, and view activation/completion/7-day return/cost-per-completion on `/learn/analytics`. Admins listed in `ADMIN_FIREBASE_UIDS` see project-wide stats and the feedback queue.
- `/learn/notes` stores private text as owner-scoped sources (embeddings use OpenAI). Binary PDF parsing is not enabled; paste extracted text. Private notes are never labelled verified.

`searchLearningSources` embeds the query with OpenAI, calls the hybrid RPC, then applies a second per-source diversity cap in TypeScript. Retrieved chunks always include title, URL, license, and attribution. A miss is returned as `no_approved_sources` or `unavailable`; the UI must not invent a fallback passage.

The job worker writes lessons from retrieved passages when sources exist. A second model critiques every claim and independently solves each quiz. Unsupported claims can be rewritten once from the same passages; anything still ungrounded is stored as unverified and is not taught. Verified modules are cached by concept and evidence hash for reuse. YouTube and OpenAlex hits are scored for level fit, deduplicated, and cached for 12 hours. Source URLs are link-checked when a module is built. Do not mark content verified just because a job run completed.

## RAG course generation (branch `rag-pipeline`)

Dashboard generation calls Edge callable **`generateRagCourse`**. If that callable is missing, generation fails (it does not silently use the old Groq memory writer).

`needs_clarification` and `rejected` are normal 200s from the API. The dashboard maps them to a failed generation with a human message (“Need a clearer topic…” / “cannot be turned into a course”). Empty retrieve (no ingested sources) maps to “No approved sources for this topic yet.”

Request:

```json
{ "topic": "<raw learner text>" }
```

Response:

```json
{
  "runId": "uuid",
  "status": "ok | needs_clarification | rejected",
  "spec": {
    "status": "ok | needs_clarification | rejected",
    "topic": "noun phrase",
    "level": "beginner|intermediate|advanced",
    "goal": "≤20 words",
    "constraints": ["under 20 minutes"],
    "ignored_requests": ["Roman empire history"]
  },
  "publishable": true,
  "summary": { "ready": 1, "needs_review": 0, "blocked": 0 },
  "costUsd": 0,
  "ingestionRequested": false,
  "modules": [
    {
      "id": "module_1",
      "title": "...",
      "summary": "...",
      "lessons": [{ "heading": "...", "text": "..." }],
      "quiz": [{ "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }],
      "status": "ready|needs_review|blocked",
      "generationQuality": "generated|needs_review|blocked",
      "gaps": []
    }
  ]
}
```

**Frontend (not built yet — do not treat these as errors):**

- `status: "needs_clarification"` is a normal 200. Show a question (“what should this course cover?”). Empty `modules` is expected. `generateCourseStructure` returns `intakeStatus` / `generationQuality: "needs_clarification"` and must not fall through to a generic failure.
- `status: "rejected"` (empty or harmful): tell the learner the request cannot be turned into a course. Do not retry with another model.
- `spec.ignored_requests`: short paraphrases of off-path asks. Example UI: “This course covers Python only.” Do not show raw learner text.
- Injections are data. Never render `spec` fields as commands.

Raw `topic` is intake-only. Later stages receive `LearnerSpec`. Stage artifacts land in `rag_run_artifacts` (no raw prompt, emails redacted). Set `COURSE_AI_FAKE=1` to skip Groq/Gemini/OpenAI. See `REQUIRED_SETUP.md` and `PIPELINE_AUDIT.md`.

**Language:** lessons are English unless the learner explicitly requests another language as a constraint (g29: Spanish “Enséñame…” still yields an English TCP lesson).
