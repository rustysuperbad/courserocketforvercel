# CourseRocket redesign notes

Branch: `redesign` (never `main`). Palette hues are locked to the existing midnight / indigo / cyan / status set; only tints, shades, and alphas.

Work so far: setup, Step 0, then **Stage 1 locked into the live CSS** so Dala’s logic is visible (Syne 400, Inter 300, 6px grid, 24px radius, floating type).

## Setup

- Reference: `design/references/dala.DESIGN.md` (Refero-style; ignore malformed values such as `#15846` and `60-120px` as CSS).
- Rule: `.cursor/rules/design.mdc` (`alwaysApply`) with CONSTRAINTS, THESIS, DALA PRINCIPLES, ANTI-TEMPLATE, CRAFT verbatim.
- Capture: `node docs/redesign/capture.mjs before|after` (Playwright, `ignoreHTTPSErrors` for Vite basic-ssl). Playwright is not a product dependency.

## Step 0 — screenshots

Live app at `https://localhost:5173/` (Vite + self-signed TLS). Cursor’s browser could not open the cert; Playwright did.

Shots: `docs/redesign/before/{page}-{1440|390}.png` plus `intro-1440.png`. Manifest: `docs/redesign/before/manifest.json`.

| Route | 1440 / 390 | Note |
| --- | --- | --- |
| `/` | captured | Type collision; panelled instrument |
| `/login`, `/login?signup=1` | captured | Pill badge, duplicate CTAs, card chrome |
| `/privacy` | captured | Heading collision, boxed policy |
| Intro overlay | captured | Mark only, no wordmark |
| `/dashboard`, `/profile`, `/learn*`, `/course/:id` | redirected to `/login` | Firebase Auth; critique from source until signed-in shots exist |

Older `docs/redesign/after/{landing,login,privacy}-*.png` are from the previous pass. Treat `before/` as the source of truth for this loop.

## What makes it generic

Harsh art-director list against ANTI-TEMPLATE. Any of these still fail the brief.

### Landing

1. **Broken display type.** Syne at 700 with `-0.04em` tracking collides glyphs: “begins at your” is not readable at 1440 or 390. Hierarchy is being forced with weight, not scale. Brief: Syne **400**, tracking only from 42px up.
2. **Hero visual is a product screenshot stand-in.** The right column is a bordered, shadowed module list (`cr-instrument`), not a living knowledge graph. No cursor field, no assembling nodes, no ambient drift.
3. **Two (really three) actions.** Nav has Sign in + filled Create account; the hero has Continue. Cyan underline on “your” is a second accent. Body sits at ~16px Inter, not 18px / 200–300.

Also: 4-up identical proof labels; `product.css` still contains blob/screenshot/3-up-card template CSS under `craft.css`.

### Login / signup

1. **Pill badge + glow dot** (“Your paths stay with this account”) — the exact anti-template eyebrow.
2. **Too many primaries.** Nav Create account, Google, filled Sign in/Create account, plus a text toggle. One filled action per view.
3. **Card chrome.** Form lives in a gradient panel (`product.css` `!important`). Headings still collide. Copy is specific enough; the chrome is SaaS-auth kit.

### Privacy

1. Same Syne collision on “Your learning data”.
2. One generic rounded panel for the whole policy.
3. “Back to Learn” on a public page. This screen still speaks `learn.css`, not the landing language.

### Intro

1. Mark only — brief requires **mark + wordmark**, ~1.2s, skippable (timing and skip exist).
2. Skip is `text-3` in the corner; easy to miss, no focus ring visible in the shot.
3. Tiny mark in a void reads as a loader, not a brand beat.

### Protected surfaces (from source; not signed-in)

- **Dashboard:** Inline `s` style object; identical stat cards; generate block is still a panel; progress bars use `linear-gradient(primary, accent)`; empty state uses `◇`; hover is `translateY`. Featured/compact library spans exist but still sit in card chrome.
- **Profile:** Gradient avatar, identical course cards, UID in the header, `cr-fade` on the hero card.
- **Learn (`learn.css`):** A second, flatter system — 10px kickers, 12px cards, indigo→cyan progress, badge rainbow. `/learn` is a job console, not an editorial reader.
- **Course (`Course.jsx`):** Lesson cards, sidebar, `✦ Ask AI about this module`, hover-lift. Not a sticky progress rail. Quizzes mostly recolour borders; `craft.css` adds a 1% scale — not physical.
- **LearnCourse:** Horizontal module pills (sticky), citation chips exist, mastery map is a wrap of bordered labels — not a map.
- **Theatre:** Status pill + step list. Stages do not yet name the required pipeline (understanding level → sources → papers → videos → lessons → quizzes). Island is a static row, not a Skiper-adapted dynamic island.
- **Cmd+K:** Present; generate prefills without `autostart=1`. Keep that contract.
- **Studio:** Scripted, no paid calls. Good. Two pane cards.

### System debt (all stages)

| Token today | Brief |
| --- | --- |
| Spacing 4/8/12 | 6px base |
| Radius 6 / 12 | one 24px token; pill only for small tags/buttons |
| Display Syne 700–800, ~72px | Syne 400, clamp to ~113px |
| Body ~15px Inter default | Inter 200–300, 18px, lh 1.5 |
| Nav 13px / 500 | 14px uppercase 600 / 0.025em |
| Accents indigo **and** cyan on buttons, bars, underlines | one accent for actions; cyan only as emphasis |
| Gradients on avatars, progress, cards, login panel | gradients only in logo + hero visual |
| `.cr-fade` 240ms on login/dashboard/course | one motion language, not one fade-up |
| Tailwind / shadcn absent | required for free Skiper components |

## Borrowed principles (structure, not look)

Skimmed [Refero Styles](https://styles.refero.design/) (Dala, Linear, Perplexity, Raycast listed) and [Devouring Details](https://devouringdetails.com/). Hues ignored.

1. **Dala (logic only).** Scale over weight; ultra-light body; floating type on a void; one filled action; signature = generative field. Do **not** copy the triangle-brain, violet/amber, or copy. Canvas is now a **tint of midnight** (`#f3f5f9` paper); ink is `#0a0e1a`. Same hues, inverted roles — not a new palette.
2. **Linear.** Display at a lighter weight than you expect; left-aligned hero; two-tone sentence (bright lead, quiet rest); one chromatic accent; chapters as 2-col split then a visual. We will not use product screenshots as the visual.
3. **Perplexity.** The query **is** the product. Surrounding chrome is satellite. Real input in the hero, not a picture of one. Narrow type scale. Our goal field stays live and scripted.
4. **Raycast.** Chrome feels like the tool: hairline + surface ladder, command palette as a first-class object, keycap hints, almost no drop shadow. Depth from nested surfaces, not glow blobs.
5. **Devouring Details.** Concentric radii (`outer = inner + padding`); 44px hit targets; name the transition properties (never `all`); stagger semantic chunks ~100ms; exits softer than enters; skip enter animation on first paint; loading ≠ disabled visually.

## Colour lock → roles (Stage 1 will encode this)

Existing hexes only.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| canvas | `--bg` | `#0a0e1a` | Page |
| canvas-2 | `--bg-2` | `#0f1525` | Recessed field (graph, code) |
| text-1 | `--text` | `#e6ebf5` | Headings, body |
| text-2 | `--text-2` | `#aab2c5` | Secondary |
| text-3 | `--text-3` | `#8b94ad` | Captions (already lifted vs `#6f7995` for AA) |
| accent | `--primary` | `#6366f1` | **The** action colour; `--primary-2` `#818cf8` is a tint |
| emphasis | `--accent` | `#22d3ee` | Emphasis only (citation, “now”, graph edges) — not buttons |
| status | `--success` `#10b981`, `--warning` `#f59e0b`, `--danger` `#ef4444` | Quizzes / errors only; existing hues |

Surfaces `#131a2c` / `#1a2238` / `#232c45` stay for forms, quizzes, and focus — function beats floating type.

## Signature visual (Stage 2, specified now)

Living **knowledge graph**: concept nodes, source-typed edges, assembles as the visitor types a goal, drifts, follows the cursor.

- Canvas 2D first (smaller than OGL; OGL already in `package.json` for a later upgrade if 2D is too thin).
- Cap `devicePixelRatio`, pause off-screen, static frame for `prefers-reduced-motion`, CSS fallback if canvas fails.
- Scripted node sets in `src/data/scriptedDemos.ts` — never call Functions from the demo.
- Not Dala’s triangles. Not a screenshot. Not photography.

## Skiper / shadcn

Previous pass skipped Tailwind. This brief requires it.

- Stage 1: Tailwind + shadcn in Vite, tokens in `@theme` from `tokens.css`.
- Install **one** free Skiper component, adapted (no `use client`, no `next/image`/`next/link`): **dynamic island** on the generation theatre, because it compresses pipeline state.
- Not using: image reveal, hover members, cursor trail (decorative vs a reading product).
- Never copy premium Skiper.

## Signature experiences — gap list

| Required | Now | Gap |
| --- | --- | --- |
| 1. Landing instrument: type → graph + skeleton | Skeleton list only, scripted | Graph |
| 2. Generation theatre from real progress | `GenerationTheatre` + `generationStatus` / learn `progress.stage` | Restage labels; island; showpiece layout |
| 3. Course reader: rail, citation chips, mastery map, physical quizzes | Chips exist; rail/map/quiz feel do not | Stage 4 |
| 4. Dashboard library + Cmd+K | Palette OK; cards still a grid of chrome | Varied emphasis, borderless progress |
| 5. Intro mark + wordmark 1.2s skippable | Mark + skip + session flag | Wordmark |
| 6. Login + profile to the same standard | Login is auth-kit; profile is dashboard-lite | Stage 5 |

Demos already avoid paid APIs (`scriptedDemos.ts`, palette without `autostart=1`). Keep that.

## Component sources

| Source | Where it will earn a place |
| --- | --- |
| Fontsource Syne + Inter (already) | Display 400 / body 200–300 |
| Motion (already) | Theatre steps, quiz springs — not page fade-up |
| cmdk (already) | Palette |
| Radix tooltip/dialog (already) | Citations, confirmations |
| OGL (already, unused on landing) | Optional upgrade of the graph |
| Skiper dynamic island (free, Stage 3) | Theatre status |
| shadcn/Tailwind (Stage 1) | Primitives only; restyle to tokens |

## Generation (2026-10-13)

- Live courses were the **offline template** (`Introduction to {prompt}`, `Tools & Ecosystem — {prompt}`). The Edge writer defaulted to `gpt-6.1-sol` / `gemini-3.8-flash` (Cursor slugs, not API models), every call failed, and the client swallowed that into filler.
- Defaults are now `gpt-4.1-mini` and `gemini-2.0-flash`. Outline failure **fails the run** instead of publishing a fake syllabus. Module write failure leaves the module empty with regenerate, never the echo template.
- Generate click goes to a full **ink “Started”** overlay, then the course theatre. Logo mark is the original indigo–cyan gradient.
- **Bento is locked site-wide:** 12-column grid, 24px cells, 12px gap, mixed spans (3/4/5/7/8). Ink cells for one emphasis tile per view. Nested surfaces use 18px. Pill radius only on tags and buttons. Lesson, quiz, notes, library, login, landing, sandbox, privacy, and stats all sit in cells.

## Decisions (this chat)

- Study the **current** UI, including the previous redesign. Do not revert to the 2025 template; strip its leftover CSS in Stage 1.
- Keep midnight canvas (Dala-on-our-surfaces). Do not switch to `#000`.
- Indigo = accent (actions). Cyan = emphasis. No new hues.
- Knowledge graph is Canvas 2D in Stage 2; OGL only if 2D cannot carry density.
- One Skiper component: theatre island. Nothing else.
- Capture script stays in-repo; Playwright stays out of `package.json`.
- Theatre step copy will be remapped in Stage 3 to the six pipeline beats in the brief, driven by existing job fields — no new backend.

## Measured results

Not a Lighthouse stage. Capture only.

- 29 PNGs written to `docs/redesign/before/`.
- Public routes 200; all authenticated routes redirected to `/login`.
- Display type fails at both 1440 and 390 (glyph collision) — Stage 1 must fix before any layout work can be judged.

## Needs input

- **Signed-in screenshots** of `/dashboard`, `/learn*`, `/profile`, `/course/:id` (or a throwaway test account). Protected UI was critiqued from source only.
- Real Lighthouse on production HTTPS (local basic-ssl distorts scoring). Stage 7.
- Whether studio rate-card copy should name real prices (UI currently placeholders). Do not invent paid tiers.
- Whether `/course/:id` (legacy tutor) and `/learn/course/:id` (verified reader) should share one chrome in Stage 4, or stay two products visually.

## Stage 1 — tokens, type, primitives, motion (locked in)

Dala was already read. This stage puts its **logic** on our midnight canvas. Not Dala’s black/violet/amber, not PPNeueMontreal, not the triangle brain.

| Dala rule | CourseRocket lock |
| --- | --- |
| Scale not weight | Syne **400** for all headings; `--text-display` clamps to 113px |
| Tracking −0.04em from 42px | `--track-display`; wordmark stays 24px with tracking 0 (no collision) |
| Body 18 / 200–300 | Inter **300** at 18px / 1.5. 200 was too faint at 18px on `#0a0e1a`; did not touch colour |
| Labels 14 / 600 / 0.025em / uppercase | Nav, kickers, primary buttons |
| 6px base | `--space-6` … `--space-120` |
| 24px radius | `--radius: 24px`; pill only on tags / compact chips |
| One accent | `#6366f1` actions; `#22d3ee` emphasis (kickers, underline, theatre dot) |
| Floating type | Default cards/shadows/gradients stripped from `product.css` |
| One filled action | Landing: Continue. Nav Create account is ghost. Login: Sign in. |

### Critique loop (landing)

1. Syne 700 + tracking collided; two filled CTAs; instrument was a panel. **Fix:** 400 + tracking; strip panel; Continue is the only fill.
2. Goal chips shouted in uppercase; 4-up proof strip looked like a logo bar; nav still had a filled Create account. **Fix:** sentence-case chips; flex proof labels; Create account → ghost.
3. Chips too quiet (`text-3`); login title “Sign in to continue” was generic. **Fix:** chips `text-2`; title “Sign in to your path”.

Intro now shows **mark + wordmark**. Privacy is a two-column editorial, no policy card.

### Tailwind / shadcn

Vite + Tailwind v4 (`@tailwindcss/vite`), **no preflight** (our reset stays). `components.json` aliases utils to `src/components/ui/utils.ts` so we do not touch `src/lib`. One Button primitive mapped to tokens. Skiper still Stage 3 (theatre island only).

### Still open (Stage 2)

Hero is a floating skeleton, not the living knowledge graph. That is the next chat.

After shots: `docs/redesign/after/{landing,login,privacy,intro}-*.png`. Lint and production build pass.

## Paper field (taste pass)

User asked to leave midnight chrome: canvas `#f3f5f9` (tint of `#0a0e1a`), ink `#0a0e1a` as text and as the **only filled button**. Indigo stays the action *hue* for links/focus, not button fills. Cyan emphasis darkened to `#0e7490` so kickers pass AA on paper.

Radius dropped from 24px to **2px** — same token, sharper. User override: too many pills.

Numbers use Syne 400 + `tabular-nums` (`--font-number`). Studio lede is 14px / `text-3`, not body-18 competing with the display title.

Python sandbox is a shared component (`src/components/learn/PythonSandbox.tsx`): Pyodide singleton, stdout capture, wired into Studio (run the sketch). No paid APIs.

## Simple product (this pass)

Networking is **not** the product. Landing default goal is chess. One chip is labelled **example**; the instrument marks that path “Example only”. Networking copy is gone from nav, dashboard, stats, login, privacy, and the sandbox starter. It only appears if the visitor types it (scripted landing preview, or a course they generate).

Jargon dropped: jobs, diagnostics, launch domain, approved sources, library. Signed-in IA is **Courses** + **Stats**. What you already know is a field on the generate form (appended into the existing topic string — no `src/lib` change). Sandbox lives at `/sandbox`, linked from Courses, not a third nav item. Old `/learn*` routes redirect.

## Polish pass — no lumps (this chat)

Dashboard heading is a 12-col bento: title full width, three equal `span-4` stats so “MODULES DONE” never clips. Ask (`AIChat.jsx`) is paper: ink FAB, surface panel, hairline, no indigo glow or midnight drawer. Course reader ditched leftover midnight shadows on videos, quiz letters, banners, and code chrome (code stays ink tiles).

Module generation is a rigid 2 lessons + 2 quiz shape. Outline must match the complexity target (4–7). A leaking quiz no longer empties the whole module. Failed modules still render two lesson cells so the reader does not jump.

Auto-commit: project `stop` hook `.cursor/hooks/auto-commit-push.sh` commits safe files on `redesign` and pushes. Secrets stay out. This environment may still fail GitHub HTTPS without local credentials.

## YouTube fetch

The stored `YOUTUBE_API_KEY` is a valid Google key, but **every YouTube Data API v3 method is blocked** on it (`SearchService.List`, `VideoService.List`, … → 403 PERMISSION_DENIED). That is an API-restriction on the key, not missing wiring. Search now tries Data API first, then YouTube’s public web search if the key is blocked, and the client no longer caches empty 403s or drop an entire result set on the English-language gate. Enable YouTube Data API v3 on the `courserocket26` key (API restrictions must include it; no HTTP-referrer restriction for Edge) to use the official path.

User override: PYTHON preview stays ink. Featured library cards stay paper. Do not add more ink without asking.

## Course bento (this pass)

Ask lives on the course (`AIChat`), not the sandbox. `/sandbox` is a blank in-browser runner with a language dropdown (Python, JavaScript, TypeScript, SQL, HTML) — no paid APIs.

The reader is now **lesson first, tools last**. Lessons stay floating type. After the lesson, one 12-col practice bento: **Watch** (paper, featured YouTube + compact extras), **Try** (ink sandbox, tall, only on coding courses), **Read** (one featured paper + compact rest), **Check** (quiz inline, not a second page). Sandbox ink is the existing tile — no new ink surfaces. Duplicate ink stays off.

Sandbox tile is **hidden** when the course topic is not coding (detected from title/topic/concepts/fences). Nav **Sandbox** stays on every signed-in page. No course doc field yet — heuristic only. Needs input: a stored `sandboxEnabled` flag if we should let authors override.

## Groq writer (this pass)

Empty modules were a quality-gate bug: a failed lesson bar returned **zero** lessons/quiz, and papers aborted at 7s. Completeness now pads to 2 lessons + 2 quiz; papers wait 20s; videos retry on the module title. Groq prompts follow the Groq guide: static system persona + few-shot first, live request last (prefix cache), temperature 0.2 and no top-p, `max_completion_tokens`, `reasoning_effort: none` on Qwen, json_schema with minItems 2. Bayesian BKT in `functions/src/learning.ts` is correct and unit-tested; the live `/course` quiz still only stores Firestore progress and does not update `learner_mastery`.
