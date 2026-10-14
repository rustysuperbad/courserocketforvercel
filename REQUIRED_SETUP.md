# Required setup (you do this)

Until these are done, v3 runs on **fake providers** only. Paid Groq / Gemini / Tavily / embedding calls stay off. Do not put secrets in `VITE_*`, git, chat, or logs. Rotate anything that was ever pasted into a client env.

Linked stack today: Firebase `courserocket26` (Auth + Firestore, Spark), Supabase project `kxusnfytnjltywalxiom`, Inngest Cloud app `courserocket`. Spark cannot host long Cloud Functions; the durable worker is **Inngest on Supabase Edge** (Cloud Tasks equivalent without Blaze).

---

## 1. New Groq API key (required for live write)

**What:** A **new** Groq key. The previous key was exposed.

**Why:** Intake, planner, query planner, extractor, writer, rewriter, and quiz call `qwen/qwen3.8-27b`. An exposed key can be billed or revoked.

**Steps:** 1) Revoke the old key at [console.groq.com/keys](https://console.groq.com/keys). 2) Create a new key. 3) Store as server secret **`GROQ_API_KEY`**. Optional: **`GROQ_MODEL`**=`qwen/qwen3.8-27b`.

**Billing:** Groq on-demand tokens. Confirm current rates on Groq’s pricing page before live smoke.

---

## 2. Gemini API key + Cloud billing (required for live verify)

**What:** Gemini API key on a Cloud project with **billing enabled**. Default model **`gemini-3.8-flash`**.

**Why:** The verifier is a separate Gemini call. Unpaid Gemini API / AI Studio may use prompts and responses to improve Google products ([Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)). Paid (Cloud billing linked) is not used for product training; Google may still log briefly for abuse monitoring.

**Steps:** 1) [aistudio.google.com/apikey](https://aistudio.google.com/apikey). 2) Link a billing account. 3) Secrets: **`GEMINI_API_KEY`**, **`GEMINI_MODEL`**=`gemini-3.8-flash`. Optional A/B: **`VERIFIER_SAME_AS_WRITER`**=`true` (Groq verifier; not the production path).

**Do not** turn on Grounding with Google Search for this product: Google stores prompts 30 days for search suggestions, and the UI would have to render Search Suggestions HTML.

---

## 3. Web search key (required for live research)

**What:** Tavily Search API key.

**Why:** Discovery must return URLs we then fetch ourselves. Gemini Search grounding is rejected (data retention + suggestion-chip ToS). Brave Search is the fallback if you prefer it.

**Steps:** [app.tavily.com](https://app.tavily.com) → **`TAVILY_API_KEY`**. Optional: **`TAVILY_SEARCH_DEPTH`**=`basic`. Brave instead: **`BRAVE_SEARCH_API_KEY`** and **`SEARCH_PROVIDER`**=`brave`.

**Billing:** Tavily Researcher plan includes 1,000 credits/month free; basic search is 1 credit/request.

---

## 4. Embedding provider (required for live retrieve)

**What:** Gemini embeddings (same `GEMINI_API_KEY`). Config id **`gemini-embedding-001`**.

**Why:** Run-scoped hybrid retrieve needs vectors. No OpenAI. No persistent corpus.

**Steps:** Reuse **`GEMINI_API_KEY`**. Optional override **`EMBEDDING_MODEL`**=`gemini-embedding-001`.

---

## 5. Scholarly + video (optional but used when keys exist)

**What:** OpenAlex (no key) for papers. YouTube Data API for video discovery.

**Why:** Research query angles include papers and videos.

**Steps:** Optional **`YOUTUBE_API_KEY`**. OpenAlex is unauthenticated; send a contact User-Agent only.

---

## 6. Supabase (project already linked)

**What:** This checkout is linked to `kxusnfytnjltywalxiom`. Apply the **new** v3 migration (do not rewrite old SQL).

**Why:** `v3_runs`, artifacts, sources metadata, evidence cards, courses/lessons/quizzes, quota RPCs.

**Steps:**

```sh
npx supabase db push
```

Secrets on Edge: `GROQ_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`. Never set `COURSE_AI_FAKE` in production.

---

## 7. Inngest (durable worker)

**What:** Inngest Cloud app already used as `courserocket`.

**Why:** `startGeneration` must return a job id immediately. Edge request idle timeout is 150s; research+write exceeds that if run inline.

**Steps:** Confirm the Edge `inngest` function URL is the app’s sync endpoint. Secrets **`INNGEST_EVENT_KEY`**, **`INNGEST_SIGNING_KEY`**.

---

## 8. Local fake (no money)

```sh
COURSE_AI_FAKE=1
cd functions && npm test && npm run build
```

## 9. Live smoke (after keys + billing)

```sh
cd functions && npm run eval:v3-live
```

Three topics, capped budget: SQL window functions, Kalman filter, a humanities topic. Never prints keys.

---

## Secret names (server only)

| Name | Why |
| --- | --- |
| `GROQ_API_KEY` | Writer family |
| `GROQ_MODEL` | default `qwen/qwen3.8-27b` |
| `GEMINI_API_KEY` | Verifier + embeddings |
| `GEMINI_MODEL` | default `gemini-3.8-flash` |
| `EMBEDDING_MODEL` | default `gemini-embedding-001` |
| `TAVILY_API_KEY` | Web discovery |
| `BRAVE_SEARCH_API_KEY` | Optional search |
| `SEARCH_PROVIDER` | `tavily` (default) or `brave` |
| `YOUTUBE_API_KEY` | Optional videos |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Jobs + quota |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Worker |
| `COURSE_AI_FAKE` | local only |
| `VERIFIER_SAME_AS_WRITER` | A/B only |
