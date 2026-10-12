# CourseRocket redesign notes

Work lives on the `redesign` branch. Colour hues are locked to the existing midnight / indigo / cyan system; only tints, shades, and alpha.

## Step 0 — what felt generic

Studied `Landing`, `Login`, `Dashboard`, `Course`, `Profile`, and `/learn*` at 1440 and 390 (live screenshots in `docs/redesign/`).

| Flaw | Where it shows |
| --- | --- |
| Centred-adjacent hero: pill eyebrow with glowing dot, gradient headline, two-action form, fake product screenshot | Landing |
| Identical 16px-radius cards, icon-in-square, same hover lift | Steps, features, dashboard tiles |
| Soft indigo/cyan radial blobs and “✦ / SAMPLE / LIVE” tropes | Body background, preview float |
| Hover = opacity or translateY(-3px) only | Cards, chips, nav |
| Same `fadeIn 240ms` on every page | `.cr-fade` |
| “Welcome to”, “Unlock”-adjacent CTA copy | Login eyebrow, final CTA |
| Dashboard tiles are one rectangle repeated | CourseGridCard |
| Learn screens are a second, flatter design language | `learn.css` vs `product.css` |

## Borrowed principles (structure, not colour)

From Refero DESIGN.md files for Linear, Raycast, Superhuman, Perplexity, OpenAI, Cursor. Hues were ignored.

1. **Linear — 8/12/24/96 spacing, three radii (6 / 12 / pill), tight display tracking.** A learning instrument needs a countable rhythm so modules and jobs feel like one system, not a kit.
2. **Raycast — hairline + inset highlight (“keyboard key”), almost no drop shadow.** Depth should come from nested surfaces, which matches watching a pipeline work.
3. **Superhuman — dense, keyboard-first chrome; one confident type size for body.** Cmd+K and compact course lists should feel faster than a marketing page.
4. **Perplexity — the query is the hero; surrounding UI is satellite.** The goal field (and later the sandbox prompt) is the product, not a screenshot.
5. **OpenAI — editorial type, quiet section gaps, cards as paper not glass.** Lessons are read, not “consumed”.
6. **Cursor — authority from tracking and weight restraint, not bold-everywhere.** Syne stays display-only; Inter does the work at 400–600.

## Skiper / Devouring Details

Used as behaviour references, then rebuilt against our tokens (Vite, no `use client`, no Next Image).

| Idea | Place | Why it earns it |
| --- | --- | --- |
| Dynamic island (free pattern) | Generation theatre status pill | Compresses pipeline state into one glance |
| Vercel-style tooltip | Citation chips, mastery nodes | Sources must explain themselves without a modal |
| Concentric radii, 44px hit targets, delay on exit | Buttons, nested cards, island | Prevents pasted-in widget feel |
| Image cursor trail / members hover | **Not used** | Decorative; fights a reading product |
| Drag-and-scroll collections | **Not used** | Keyboard library + command palette are enough |

**Tailwind / shadcn:** not installed. The app already ships Radix, cmdk, Motion, Sonner, Vaul, Lucide. A second utility system would fight `product.css` preflight and duplicate the spacing language. Original components sit on CSS tokens instead.

## Motion language

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | Entrances, drawers |
| `--ease-in-out` | cubic-bezier(0.65, 0, 0.35, 1) | Colour, borders |
| `--dur-1` | 120ms | Hover/focus |
| `--dur-2` | 200ms | Panels |
| `--dur-3` | 420ms | Theatre steps |
| Spring | stiffness 380, damping 32 | Quiz correct/incorrect |

`prefers-reduced-motion`: no springs, no intro, theatre snaps to the current step.

## Colour lock + AA

Existing hues kept. `--text-3` lightened `#6f7995` → `#8b94ad` (~3.8:1 → ~5.2:1 on `#0a0e1a`) for caption text. Primary buttons keep white on `#6366f1`. No new hues.

## Libraries (one line each)

- **Motion** — springs for quiz feedback and theatre steps.
- **cmdk** — command palette (already a dependency).
- **Radix Tooltip/Dialog** — accessible citations and confirmations.
- **Sonner** — quiet toasts for copy/export, not generation.
- **Vaul** — mobile module drawer on the course reader.
- **Lucide** — one icon set, 1.5px stroke, no emoji decoration.
- **GSAP** — not used; scroll storytelling was not needed.

## Decisions

- Landing demo is 100% scripted (`src/data/scriptedDemos.ts`). Typing a goal never calls Functions.
- Command palette “Generate…” only navigates to `/dashboard?topic=` without `autostart=1`, so it cannot fire a paid run.
- Studio sandbox (`/learn/studio`) is a local pair-programmer on cached replies. Oversized briefs show a rate card; no checkout.
- Dashboard generating cards open the theatre inline from existing `generationStatus` / `generationMessage` fields — no new API.
- Learn job theatre maps `progress.stage` from `generation_runs`.
- Brand intro is an overlay after first paint, once per session, skippable, not in the LCP image path.

## Critique loop (selected)

Landing pass 1: still a pill badge. Removed. Pass 2: three equal feature cards. Replaced with a 12-column editorial split. Pass 3: cyan gradient on the word “real”. Replaced with a hairline rule and Syne at one weight.

Dashboard pass 1: identical cards. Featured generating tile spans two columns; compact finished tiles sit in a denser grid. Pass 2: “Welcome back”. Replaced with the library count. Pass 3: generate panel still looked like a marketing CTA. Flattened to a terminal row.

Course reader pass 1: sources as a numbered list. Citation chips expand in place. Pass 2: quizzes only changed border colour. Added spring scale. Pass 3: no mastery overview. Added a compact map from claim verification.

## Measured results

After screenshots: `docs/redesign/after/{landing,login,privacy}-{1440,390}.png`.

Protected routes (`/dashboard`, `/learn*`, `/profile`, `/course/:id`) require Firebase Auth; they were restyled in code and not captured signed-in.

Production build: route-level splitting in place; landing no longer loads WebGL Scanner. Self-signed local HTTPS blocked a clean Lighthouse run here — **Needs your input** for 95+ scores on a real host.

Landing critique after screenshots:
1. Nav still said “Get started ↗” — removed the arrow, shortened to Create account.
2. Login used green ticks — replaced with numbered kickers.
3. Instrument letters L/Q/P/V are labels, not decoration; kept.

## Needs your input

- Real Lighthouse on production HTTPS (local basic-ssl distorts scoring).
- Copy for paid studio rates if those products exist; UI currently shows a placeholder tier.
- Admin `human_reviewed` badge art if reviewers will use a separate tool.
- Whether the legacy `/course/:id` tutor chat should share the studio assistant chrome (left as the existing panel).
