# CourseRocket API and backend setup

CourseRocket keeps Firebase Authentication and Firestore for the existing product. New learning data uses Supabase Postgres/pgvector. Firebase ID tokens are verified by Cloud Functions and are also accepted by Supabase after Firebase is configured as a third-party provider. Provider secrets and Supabase service-role credentials stay in Cloud Functions or a private local environment; never put them in `VITE_` variables.

## Accounts and keys

| Service | Needed for | Where to set it |
| --- | --- | --- |
| [Firebase](https://console.firebase.google.com/) | Existing sign-in, Firestore, and callable functions | Existing app config; Functions secrets below |
| [Supabase](https://supabase.com/dashboard) | Postgres, pgvector, RLS, learner mastery and source retrieval | Public URL/anon key in local frontend; service-role key only in Functions |
| [Inngest](https://app.inngest.com/) | Durable background jobs and retries | Event key + signing key in Functions secrets |
| [OpenAI](https://platform.openai.com/api-keys) | Existing course writing and embeddings (`text-embedding-3-small`) | `OPENAI_API_KEY` Functions secret |
| [Langfuse](https://cloud.langfuse.com/) | LLM/job traces and cost metadata | Public + secret keys in Functions secrets |
| [Sentry](https://sentry.io/) | Sanitized backend error reporting | DSN in Functions secret |
| [Google Cloud Console](https://console.cloud.google.com/) | YouTube Data API v3, if the existing resource finder is used | `YOUTUBE_API_KEY` Functions secret |
| Gemini API | Existing Google Search grounding for the current content flow | `GEMINI_API_KEY` Functions secret |

Check each provider's current pricing and usage limits before enabling paid calls. The database quota defaults are configurable and do not replace provider-side billing alerts.

## 1. Supabase project and Firebase identity

1. Create a Supabase project and copy its project URL, anon/publishable key, and service-role key. The service-role key bypasses RLS and must never be exposed to the browser.
2. In Supabase Auth, enable **Third-Party Auth → Firebase** and enter Firebase project ID `courserocket03` (or the ID for your deployment). Supabase verifies Firebase's asymmetric ID tokens and can apply RLS policies to them. See [Supabase's Firebase Auth guide](https://supabase.com/docs/guides/auth/third-party/firebase-auth).
3. Apply the SQL in [`supabase/migrations/`](./supabase/migrations/) in timestamp order (or `supabase db push`). `20261008120000_learning_foundation.sql` creates pgvector, tables, indexes, RLS, the cycle guard, the first hybrid retrieval RPC, and quota/spend RPCs. `20261012120000_retrieval_upgrade.sql` adds source kinds, concept tags, content hashes, private-source ownership, link-check columns, and replaces hybrid retrieval with level-fit, concept-boost, and per-source diversity ranking.
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

The endpoint is normally `https://us-central1-courserocket03.cloudfunctions.net/inngestEndpoint` (use the exact URL printed by Firebase for your project). In the Inngest dashboard, add that URL as the app's sync endpoint. The callable `startCourseJob` verifies the Firebase token, reserves an idempotent database run, then sends only the opaque run ID to Inngest. The current worker is a queue/progress/trace skeleton; course writing remains on the existing callable pipeline until the verified-generation worker is connected.

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
- FSRS scheduling logic is implemented and covered by unit tests; the daily review UI/worker connection is still pending.
- Langfuse and Sentry are optional until their credentials are set. Trace metadata excludes learner goal text, prompts, and model content.

`searchLearningSources` embeds the query with OpenAI, calls the hybrid RPC, then applies a second per-source diversity cap in TypeScript. Retrieved chunks always include title, URL, license, and attribution. A miss is returned as `no_approved_sources` or `unavailable`; the UI must not invent a fallback passage.

The job worker writes lessons from retrieved passages when sources exist. Do not mark content verified just because a job run completed; claim-level evidence checks and quiz verification still need to pass before a module can be labelled `ai_verified`.
