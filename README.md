# CourseRocket

CourseRocket turns a learner's goal into a guided course with modules, lessons, practice, and related resources. The product is being extended around three ideas: start from what a learner already knows, order lessons by prerequisite, and ground teaching in attributable learning sources.

## Current application

- React and Vite frontend with Firebase Authentication and Firestore.
- Firebase callable functions keep OpenAI, Gemini, YouTube, OpenAlex, and Semantic Scholar requests on the server.
- Existing course creation remains available while the new learning pipeline is built alongside it.
- New backend foundations use strict TypeScript, Supabase Postgres with pgvector, Firebase-token-backed RLS, Inngest jobs, Langfuse traces, and Sentry error reporting.

See [API_SETUP.md](./API_SETUP.md) for service configuration and the upgrade plan.

## Run the existing frontend

```sh
npm install
cp .env.example .env.local
npm run dev
```

The current Firebase app configuration is in `src/lib/firebase.js`. Supabase-backed screens stay inactive until the two browser-safe Supabase variables are set and Firebase is configured as a Supabase third-party auth provider.

## Functions

```sh
cd functions
npm install
npm test
npm run lint
npm run build
```

Deploy after configuring Firebase secrets and parameters:

```sh
firebase deploy --only functions
```

## Learning data

- Apply the schema in `supabase/migrations/` to the Supabase project.
- `functions/data/networking-concepts.json` is the reviewed launch-domain concept graph.
- `npm run seed:networking` validates and seeds that graph.
- `npm run ingest:networking -- --approve-cc-by-sa` ingests approved share-alike text only after you have accepted the attribution and share-alike requirements. Non-commercial sources are skipped unless `--allow-noncommercial` is also passed.

The app must label generated, verified, and human-reviewed content distinctly. A retrieval miss or unverified claim is not a finished lesson.
