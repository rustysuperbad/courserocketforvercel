# CourseRocket redesign notes

Branch: `redesign` (never `main`). Palette hues are locked to the existing midnight / indigo / cyan / status set; only tints, shades, and alphas.

This chat: **setup + Step 0**. No design code yet. A previous pass already shipped tokens, a scripted hero list, theatre, Cmd+K, and a skippable intro. This brief is stricter; those artifacts are the baseline to art-direct, not the finish.

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

1. **Dala (logic only).** Scale over weight; ultra-light body; floating type on a void; one filled action; signature = generative field. Do **not** copy the triangle-brain, violet/amber, or copy. Our canvas stays midnight `#0a0e1a`, not forced black.
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

## Next chat — Stage 1

Tokens, type, primitives, motion. Fix Syne 400 + tracking, 6px spacing, 24px radius, role-mapped colours, kill template leftovers in `product.css`, stand up Tailwind/shadcn, one motion language. Then landing in Stage 2.
