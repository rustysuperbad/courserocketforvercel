# v3 eval results (fake providers)

Date: 2026-10-14. **Not tested against Groq, Gemini, Tavily, or live fetch.**

## Intake harness

`npm run eval:v3` → **64/64 checks** (32 goals × original + paraphrase). Exit 0.

## Fake pipeline

`npm test` in `functions/` → 17 tests, all pass, including:

- publishable lesson + quiz per objective on an arbitrary topic
- noise stripped, duplicates collapsed
- injected page instructions ignored
- thin evidence widens to a second research round
- SSRF blocked for loopback and link-local
- quota released on failure
- no raw learner text / banned ingest copy in artifacts
- seeded verifier: Gemini-stand-in catch rate ≥ same-as-writer
- no-topic-seed guard

## Live smoke

Not run. Requires the keys in REQUIRED_SETUP.md. Command: `cd functions && npm run eval:v3-live`.
