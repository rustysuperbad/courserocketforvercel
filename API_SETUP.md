# API contract (`pipeline-v3`)

The browser never talks to Groq, Gemini, or Tavily. It calls the Supabase Edge `api` function with a Firebase ID token. Secrets stay server-side.

## Callables

### `startGeneration`

```
invokeBackend("startGeneration", { text })
→ { jobId, status: "queued" | "running" | "completed" | "needs_clarification" | "blocked" | "failed" }
```

Creates a `v3_runs` row and returns the id immediately (live: Inngest worker). Raw learner text is not stored on the run; only `input_hash` is.

### `getJob`

```
invokeBackend("getJob", { jobId })
→ {
    jobId, status, stage, percent,
    spec, learnerMessage, perLesson,
    course, publishable, costUsd, errorCode
  }
```

When `status` is `completed`, `course.modules` has lessons + quizzes. Users can only read their own rows (RLS).

Thin client: `src/lib/courseJobs.ts` (`startGeneration`, `getJob`, `waitForJob`) and `src/lib/courseAiApi.js` (`requestRagCourse` polls the job so existing pages keep working).

## Learner-facing strings

| Case | Message |
| --- | --- |
| `needs_clarification` | Show `spec.question` |
| Insufficient research / blocked lesson | We couldn't find enough reliable material to teach this well. Try a more specific topic or rephrase it. |
| Provider / queue errors | Something went wrong on our side. Please try again. |

Never mention ingestion, approved sources, or networking as a product focus.

## Needs your input (UI not built in this pass)

- A clarification state that renders `spec.question` and resubmits.
- An ignored-requests note when `spec.ignored_requests` is non-empty.
- Live per-lesson progress from `perLesson` / `stage` (today the existing generate screen still uses its old copy).
- Optional realtime on `v3_runs` instead of polling.

Until those exist, `requestRagCourse` maps the job into the previous module list so Dashboard / generate keep compiling.
