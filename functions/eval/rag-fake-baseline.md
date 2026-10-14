# RAG fake-provider baseline (2026-10-14)

Untested against live Groq/Gemini/OpenAI. `COURSE_AI_FAKE` path only.

| Metric | Fake result |
| --- | --- |
| Eval goals | 38 authored rows, JSON validated with zod |
| Paraphrase LearnerSpec match | status/level/constraints exact; topic via variants or Jaccard |
| In-corpus (networking) | quality path (TCP/DHCP/DNS/HTTP/CIDR/TLS/routing/ARP) |
| Out-of-corpus | blocked + `ingestionRequested` |
| Empty input | code reject, `paidStages: []` |
| Vague / too-broad / harmful | cheap intake only, then stop |
| Prompt leak of injection strings | must not appear in spec or lessons |
| Publishable on canned CDF evidence | yes (1 lesson, 2 quiz items) |
| Seeded-error heuristic catch rate | 3/3 (false, unsupported, off-topic) |
| Seeded-error false flags on clean draft | 0 |
| Gemini vs same-as-writer catch rate | **not run** (needs keys + your review of variants) |

Authored paraphrases live on each row in `functions/eval/rag-eval-goals.json`. `GEMINI_VARIANT_QUEUE` is empty until live variants are reviewed.
