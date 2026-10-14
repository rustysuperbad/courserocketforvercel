# Required setup (you do this)

## Production go-live (this order)

Do not merge `rag-pipeline` into `main` until step 6 passes. The live site still runs the old Groq memory writer until Edge is redeployed with `generateRagCourse`.

1. **Commit** the RAG work on `rag-pipeline` (uncommitted files are not on GitHub).
2. **Push the branch only:** `git push -u origin rag-pipeline`. No PR yet.
3. **Secrets on Supabase Edge** (Dashboard → Edge Functions → Secrets). Names only: `GROQ_API_KEY`, `GEMINI_API_KEY` (optional), `GEMINI_MODEL=gemini-3.8-flash`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Do **not** set `COURSE_AI_FAKE` in production. Leave `VERIFIER_SAME_AS_WRITER` unset (Groq verifier). **OpenAI is not required for generate.**
4. **Migration:** `npx supabase db push` so `rag_run_artifacts` exists.
5. **Launch retrieve is in-repo lexical** (`NETWORKING_SOURCE_CHUNKS`). Do **not** run `ingest:networking` unless you later add an embeddings provider. Generate on TCP/DHCP/DNS/HTTP/CIDR/TLS/routing/ARP works without OpenAI.
6. **Deploy Edge, then the app:**
   ```sh
   node scripts/bundle-edge.mjs
   npx supabase functions deploy api --no-verify-jwt
   npx supabase functions deploy inngest --no-verify-jwt
   ```
   Merge `rag-pipeline` → `main` only after that deploy, so Vercel and Edge ship together.
7. **Smoke on the website:** sign in, generate `TCP three-way handshake`. You should see RAG stages, not a 2-lesson memory dump. A vague “make a course” should fail with “Need a clearer topic,” not hang.

Gemini: unpaid AI Studio may train on prompts. Link Cloud billing before sending real learner text.

---

# Required setup (you do this)

Nothing outside this repo is assumed. Until these items are done, the RAG pipeline runs against **fake providers** and local tests only. Paid Groq calls stay off until Edge secrets are set. OpenAI is not part of generate.

Do **not** put secrets in `VITE_*` variables, git, chat, or logs. Rotate anything that was ever pasted into a client env or committed.

Current live stack: Firebase project `courserocket26` (Auth + Firestore, Spark), Supabase Edge `api`/`inngest`, Inngest Cloud app `courserocket`. Course generate retrieves the in-repo networking corpus with lexical scoring. OpenAI embeddings are unused for RAG generate.

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

Qwen on Groq (docs 2026-10-14): instruct = `reasoning_effort: none`; planner thinking = `default`/`medium`; max output 16384; every RAG stage sends `response_format.json_schema` with `strict: true`. Developer-plan base limits: 30 RPM / 1K RPD / 8K TPM.

---

## 2. Gemini API key + model id (required for live verify)

**What:** Google AI Studio / Gemini API key as **`GEMINI_API_KEY`**, plus **`GEMINI_MODEL`**.

**Why:** The verifier must be a **different model family** from the Groq writer so they do not share blind spots.

**Steps:**

1. Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) on a Cloud project you control.
2. Set secret **`GEMINI_API_KEY`** the same way as Groq (Edge secrets / untracked local env).
3. Set non-secret **`GEMINI_MODEL`**. Default is `gemini-3.8-flash` (`thinkingBudget: 0`). Confirm the id still appears in [Gemini models](https://ai.google.dev/gemini-api/docs/models) before going live.
4. Production default: verifier runs on Groq Qwen (`VERIFIER_SAME_AS_WRITER` defaults **true**) because Gemini 3.8-flash currently 404s or hangs past 20s. Set **`VERIFIER_SAME_AS_WRITER=false`** to try Gemini first; if it 404s/times out, the stage still falls back to Groq.

**Data terms (read this):**

- **Unpaid** Gemini API / free AI Studio: Google **may use prompts and responses to improve products**, including training. Do not send learner PII or private notes on the free tier.
- **Paid** Gemini API (Cloud project with an **active billing account**): Google does **not** use prompts/responses for training. They still log them briefly for abuse/safety. See [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms).
- EEA / UK / Switzerland: paid-style data terms apply even to unpaid quota.
- Do not enable Gemini “Contributor Tier” for CourseRocket (that re-enables training on your data).
- We will **not** use Grounding with Google Search (30-day retention of prompts).

If you stay on the unpaid Gemini tier, treat verifier traffic as **leaving your control for training**. Prefer linking Cloud billing before sending real learner content.

---

## 3. OpenAI embeddings key (not required for generate)

**What:** Optional. Private-notes ingest still uses OpenAI if you turn that feature on later.

**Why:** RAG generate uses Groq plus the in-repo networking corpus. `hybrid_search_source_chunks` already accepts a null embedding and falls back to lexical FTS.

Skip `OPENAI_API_KEY` until you want vector ingest. Do not block launch on it.

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
| `GEMINI_API_KEY` | server, optional | Gemini verifier when `VERIFIER_SAME_AS_WRITER=false` |
| `GEMINI_MODEL` | server | default `gemini-3.8-flash` |
| `VERIFIER_SAME_AS_WRITER` | server, optional | default `true` (Groq verifier). `false` tries Gemini first |
| `OPENAI_API_KEY` | skip | not used for generate |
| `INNGEST_EVENT_KEY` | server | job dispatch |
| `INNGEST_SIGNING_KEY` | server | job auth |
| `DAILY_COURSE_RUN_LIMIT` | server, optional | default `3` |
| `PROJECT_DAILY_SPEND_LIMIT_USD` | server, optional | default `25` |
| `COURSE_AI_FAKE` | local only | `1` = never call paid APIs |

`.env.example` will list placeholders only. Do not commit real values.

---

## 8. Deploy Edge (when you are ready to spend money)

This costs real Groq usage. Do not do it until `GROQ_API_KEY` is set.

```sh
node scripts/bundle-edge.mjs
npx supabase functions deploy api --no-verify-jwt
npx supabase functions deploy inngest --no-verify-jwt
```

JWT verify is handled inside `gateway.ts` (Firebase ID token). Confirm that flag matches the current production deploy.

---

## 9. Source corpus

Generate uses the in-repo networking corpus (TCP, DHCP, DNS, HTTP caching, CIDR, TLS, routing, ARP). Other topics still block with insufficient evidence.

`npm run ingest:networking` is optional and still needs an embeddings provider; skip it for launch.

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
2. Generate `TCP three-way handshake`. You should get lessons and at least one quiz.
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
