# RAG fake-provider baseline (2026-10-14)

Untested against live Groq/Gemini/OpenAI. `COURSE_AI_FAKE` path only.

| Metric | Fake result |
| --- | --- |
| Eval goals | 27 (25+ required), tags: clean/messy/typos/injection/tangent/vague/constraint/level/echo/meta/abuse/prior |
| Prompt leak of injection strings | 0 / 26 non-empty goals |
| Blocked when retrieve=[] | yes (no memory write) |
| Publishable on canned CDF evidence | yes (1 lesson, 2 quiz items) |
| Seeded-error heuristic catch rate | 3/3 (false, unsupported, off-topic) |
| Seeded-error false flags on clean draft | 0 |
| Gemini vs same-as-writer catch rate | **not run** (needs keys + your review of variants) |

Gemini-generated paraphrases sit in `GEMINI_VARIANT_QUEUE` with status `needs_review`.
