# Required setup (you do this)

Nothing outside this repo is assumed. Until these items are done, the RAG pipeline runs against **fake providers** and local tests only. Paid Groq/Gemini/OpenAI calls stay off.

Do **not** put secrets in `VITE_*` variables, git, chat, or logs. Rotate anything that was ever pasted into a client env or committed.

Current live stack: Firebase project `courserocket26` (Auth + Firestore, Spark), Supabase Edge `api`/`inngest`, Inngest Cloud app `courserocket`. Embeddings are OpenAI `text-embedding-3-small` at **1536 dimensions**, matching `source_chunks.embedding`.

---

## 1. New Groq API key (required)

**What:** Create a **new** Groq key. The previous key was exposed.

**Why:** Writer/planner/extractor/rewriter/quiz/intake all call Groq `qwen/qwen3.8-27b`. An exposed key can be billed or revoked under you.

**Steps:**

1. Revoke the old key at [console.groq.com/keys](https://console.groq.com/keys).
2. Create a new key. Do not paste it into the frontend or `.env` files that Vite loads.
3. Store it as server secret **`GROQ_API_KEY`**.

**Supabase Edge (current production):**

```sh
# Dashboard → Project Settings → Edge Functions → Secrets
# Name: GROQ_API_KEY
# Or CLI (from repo root, after supabase link):
npx supabase secrets set GROQ_API_KEY=YOUR_NEW_GROQ_KEY
```

**Local (untracked only):** `functions/.env.courserocket26` or a gitignored `.env` used by the Edge serve — never `VITE_GROQ_API_KEY`.

Optional override: **`GROQ_MODEL`** (default `qwen/qwen3.8-27b`). Leave unset unless A/B testing.

Qwen on Groq (docs 2026-10-14): instruct = `reasoning_effort: none`; planner thinking = `default`/`medium`; max output 16384; `strict: true` JSON schema is supported. Developer-plan base limits: 30 RPM / 1K RPD / 8K TPM.

---

## 2. Gemini API key + model id (required for live verify)

**What:** Google AI Studio / Gemini API key as **`GEMINI_API_KEY`**, plus **`GEMINI_MODEL`**.

**Why:** The verifier must be a **different model family** from the Groq writer so they do not share blind spots.

**Steps:**

1. Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) on a Cloud project you control.
2. Set secret **`GEMINI_API_KEY`** the same way as Groq (Edge secrets / untracked local env).
3. Set non-secret **`GEMINI_MODEL`**. Recommended default for this rebuild: `gemini-2.5-flash` (structured JSON, thinking can be turned off with `thinkingBudget: 0`). Alternatives on current docs: `gemini-3.8-flash`, `gemini-2.5-pro`. Confirm the id still appears in [Gemini models](https://ai.google.dev/gemini-api/docs/models) before going live.
4. Optional A/B: **`VERIFIER_SAME_AS_WRITER=true`** runs the verifier on Groq Qwen instead of Gemini (eval only).

**Data terms (read this):**

- **Unpaid** Gemini API / free AI Studio: Google **may use prompts and responses to improve products**, including training. Do not send learner PII or private notes on the free tier.
- **Paid** Gemini API (Cloud project with an **active billing account**): Google does **not** use prompts/responses for training. They still log them briefly for abuse/safety. See [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms).
- EEA / UK / Switzerland: paid-style data terms apply even to unpaid quota.
- Do not enable Gemini “Contributor Tier” for CourseRocket (that re-enables training on your data).
- We will **not** use Grounding with Google Search (30-day retention of prompts).

If you stay on the unpaid Gemini tier, treat verifier traffic as **leaving your control for training**. Prefer linking Cloud billing before sending real learner content.

---

## 3. OpenAI embeddings key (required for live retrieval)

**What:** **`OPENAI_API_KEY`** for `text-embedding-3-small` at **1536 dimensions**.

**Why:** `hybrid_search_source_chunks` ranks with `extensions.vector(1536)`. A different size will fail at the RPC.

**Steps:** [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → set `OPENAI_API_KEY` as an Edge/server secret. Optional: `OPENAI_EMBEDDING_COST_PER_MILLION_USD=0.02`.

Do not change `EMBEDDING_DIMENSIONS` without a **new** migration that replaces the vector column.

Fake-provider mode skips this (deterministic fake vectors).

---

## 4. Supabase project, CLI, migrations

**What:** Linked Supabase project with pgvector and the existing learning schema.

**Why:** Sources, chunks, hybrid search, quota RPCs, and the new `rag_run_artifacts` table live here.

**Steps:**

```sh
# Install CLI if needed
npx supabase --version

# Login and link (use your project ref, not a guess)
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF

# Apply existing migrations then the new RAG one (never edit applied files)
npx supabase db push
```

Confirm in the SQL editor:

```sql
select extname from pg_extension where extname = 'vector';
select atttypmod from pg_attribute
  where attrelid = 'public.source_chunks'::regclass and attname = 'embedding';
-- atttypmod should correspond to 1536 for vector(1536)
```

Also set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; bypasses RLS)
- Frontend already uses `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`

Auth: Third-Party Auth → Firebase, project id **`courserocket26`** (API_SETUP.md still says `courserocket03` in places — use the live id).

Local stack (no paid APIs):

```sh
npx supabase start
npx supabase db reset   # applies all migrations including new ones
```

---

## 5. Firebase (Auth + Firestore stay; Functions optional)

**What:** Existing project `courserocket26`.

**Why:** Identity and the Dashboard course documents stay on Firestore.

**Spark vs Blaze** ([Firebase pricing](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)):

- **Spark is enough** for Auth + Firestore + Hosting as used today.
- **Blaze is required** only to **deploy Firebase Cloud Functions**. Cloud Functions are not on Spark.
- This rebuild targets the **existing Supabase Edge + Inngest** path (`scripts/bundle-edge.mjs`). You do **not** have to upgrade to Blaze for RAG to run in production on Edge.
- If you later deploy `firebase deploy --only functions`, upgrade to Blaze first (pay-as-you-go; Functions have a monthly no-cost tier). Secret Manager: 6 active secret versions free.

Emulator (optional, Blaze not required locally):

```sh
npx firebase emulators:start --only auth,functions
```

Use untracked `functions/.env.courserocket26` for emulator secrets. Never commit it.

---

## 6. Inngest (background runs)

**What:** Inngest Cloud app `courserocket` (already used).

**Why:** Durable, resumable RAG runs with retries.

**Secrets:** `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` on Edge.

After deploying Edge `inngest`:

1. Open [app.inngest.com](https://app.inngest.com).
2. Set the sync URL to your Supabase Edge `inngest` function (current pattern: `https://<project-ref>.supabase.co/functions/v1/inngest`).
3. Confirm function id `course-generation-pipeline-v1` (or the RAG successor once registered).

Local: `npx inngest-cli dev` against the Edge serve URL. Fake providers only until keys exist.

---

## 7. Local env map (placeholders only)

Copy `.env.example` → `.env.local` for Vite. Server secrets go in Edge secrets or `functions/.env.courserocket26`.

| Name | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | browser | anon/publishable key |
| `SUPABASE_URL` | server | same URL for Edge/worker |
| `SUPABASE_SERVICE_ROLE_KEY` | server | RLS bypass |
| `GROQ_API_KEY` | server | writer family |
| `GROQ_MODEL` | server, optional | default `qwen/qwen3.8-27b` |
| `GEMINI_API_KEY` | server | verifier |
| `GEMINI_MODEL` | server | recommended `gemini-2.5-flash` |
| `VERIFIER_SAME_AS_WRITER` | server, optional | `true` for A/B eval |
| `OPENAI_API_KEY` | server | embeddings 1536-d |
| `INNGEST_EVENT_KEY` | server | job dispatch |
| `INNGEST_SIGNING_KEY` | server | job auth |
| `DAILY_COURSE_RUN_LIMIT` | server, optional | default `3` |
| `PROJECT_DAILY_SPEND_LIMIT_USD` | server, optional | default `25` |
| `COURSE_AI_FAKE` | local only | `1` = never call paid APIs |

`.env.example` will list placeholders only. Do not commit real values.

---

## 8. Deploy Edge (when you are ready to spend money)

This costs real Groq/Gemini/OpenAI usage. Do not do it until keys and billing are set.

```sh
node scripts/bundle-edge.mjs
npx supabase functions deploy api --no-verify-jwt
npx supabase functions deploy inngest --no-verify-jwt
```

JWT verify is handled inside `gateway.ts` (Firebase ID token). Confirm that flag matches the current production deploy.

---

## 9. Source corpus (or retrieval stays empty)

Hybrid search returns nothing until approved `sources` / `source_chunks` exist.

```sh
cd functions
# Review licenses first. CC BY-SA is stored review_required unless you explicitly approve.
npm run ingest:networking -- --dry-run
# Live ingest needs OPENAI_API_KEY + service role; costs embeddings.
```

Without ingested sources, the RAG pipeline **blocks** the lesson (`insufficient evidence`) instead of writing from model memory. That is intended.

---

## 10. Smoke test (after setup)

Fake / local (no paid calls):

```sh
COURSE_AI_FAKE=1
cd functions && npm test && npm run build
# plus new rag tests once they exist
```

Live (only after keys + billing):

1. Sign in on the deployed app.
2. Generate a short course on a topic you have ingested sources for.
3. Confirm Edge logs show stages `intake → plan → retrieve → compile → write → verify → gates` with **no** raw prompt text.
4. Confirm `rag_run_artifacts` rows exist for your uid and **do not** contain the original prompt.
5. Confirm a second generate with `COURSE_AI_FAKE=1` still never hits Groq/Gemini.

If live verify 404s on the model id, `GEMINI_MODEL` is wrong — pick a current id from Google’s model list.

---

## 11. Quota and billing alerts

- Groq and Gemini: set provider-side spend caps in their consoles.
- CourseRocket: `DAILY_COURSE_RUN_LIMIT` (per Firebase uid, UTC day) and `PROJECT_DAILY_SPEND_LIMIT_USD`.
- Every live provider call must go through reserve/settle. Fake mode must skip reserve of real USD.

---

## What I will not assume

- That `courserocket03` in old docs is live (live Firebase id is `courserocket26`).
- That Cloud Functions are deployed.
- That YouTube / Semantic Scholar keys work (out of RAG scope except existing helpers).
- That the Gemini project is on the paid data-terms tier — **you must confirm**.
