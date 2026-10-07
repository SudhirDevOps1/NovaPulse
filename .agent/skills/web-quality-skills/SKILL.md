---
name: web-quality-skills
description: >-
  Frontend quality checklist for the NovaPulse dashboard and status page —
  accessibility (aria-current, dialogs, focus), the responsive breakpoints that
  actually exist in public/style.css (1100/900/640/480), performance budgets,
  visual-regression handling, and how to run the Playwright desktop + mobile
  projects.
---

# 🎛 web-quality-skills — frontend quality checklist

> Skill pack member. Covers layer **L5 (presentation)** of
> [`.ai/ARCHITECTURE.md`](../../../.ai/ARCHITECTURE.md) and the user-visible
> half of **L-40 (notify on save)**. Breakpoints and a11y attributes below were
> read from `public/style.css`, `public/js/ui.js` and `public/js/app.js` — not
> from memory.

## When to use

- Any change to `public/**` (HTML, `style.css`, `js/*`, `sw.js`).
- Before requesting review on a UI change — the reviewer runs this checklist.
- When a Playwright run fails on desktop **or** mobile only.

## Inputs

| input | where |
| --- | --- |
| styles / breakpoints | [`public/style.css`](../../../public/style.css) |
| DOM primitives, focus trap | [`public/js/ui.js`](../../../public/js/ui.js) (`h()`, `mountOverlay()`, `escapeHtml()`) |
| routing, polling, aria-current | [`public/js/app.js`](../../../public/js/app.js) |
| screens | `public/js/views.js` |
| e2e config + specs | [`playwright.config.mjs`](../../../playwright.config.mjs), `e2e/*.spec.mjs` |

---

## 1 · Accessibility checklist

- [ ] **Active route** — `aria-current="page"` is set on `[data-nav="<route>"]`
      and removed from the others (`app.js`), asserted by
      `e2e/dashboard.spec.mjs` → *navigates between routes and marks the active nav item*.
- [ ] **Skip link** — `a.skip-link` → `#view` present and first focusable in `index.html`.
- [ ] **Dialogs & drawer** — every overlay is created via `mountOverlay()` with
      `role="dialog"`, `aria-modal="true"`, an `aria-label` (or `aria-labelledby`
      on the status hero), and an icon close button carrying an `aria-label`
      (`Close dialog` / `Close panel` / `Dismiss`). No hand-rolled overlays.
- [ ] **Focus** — one active overlay; focus moves into it on open, Tab is trapped
      (`focusables()`), `Esc` closes, focus returns to the previously focused
      element (`isConnected` checked). Views never implement their own focus logic.
- [ ] **Icon-only controls** — `aria-label` on theme toggle, sound toggle, neon
      toggle, refresh, menu button; menu button keeps `aria-expanded` +
      `aria-controls="sidebar"` in sync (`app.js`).
- [ ] **Status feedback** — `#toasts` is `role="status" aria-live="polite"`;
      every mutation still produces a toast or an inline error (L-40 —
      regression guard: `BUG-2026-0001`).
- [ ] **Status page** — `#status-overall` is `role="status"`, sections carry
      `aria-label`/`aria-labelledby`, day-cell strips are `role="img"` with a
      summary label, badge `<img>` has real `alt` text.
- [ ] **Text over colour** — state is never conveyed by colour alone (badges and
      status pills also carry text: UP / DOWN / DEGRADED / PAUSED).

## 2 · Responsive checklist — breakpoints that exist

`public/style.css` uses exactly four widths (plus reduced motion):

| breakpoint | what changes |
| --- | --- |
| **1100px** | `.tiles` → 2 columns; `.grid-2` → 1 column |
| **900px** | `.shell` → 1 column; sidebar becomes fixed off-canvas (`translateX(-100%)`), `.sidebar.open` slides in; `.menu-btn` appears; `.refresh-info` hidden |
| **640px** | `.tiles`, `.form-grid`, `.advanced-grid` → 1 column; `.btn-label` hidden (icon-only buttons); `.drawer` full width; `table.rows .hide-sm` hidden; inputs forced to **16px** (prevents iOS zoom); safe-area bottom padding; chart labels/strokes enlarged; `.setting-row` stacks; compact row actions (30px) |
| **480px** | chart axis labels 21px / line 4.5; row actions 28px; `.tile-value` 1.6rem |
| `prefers-reduced-motion: reduce` | all animations/transitions collapsed to 0.001ms |

Notes: `.shell` uses `min-height: 100dvh`; the file header records the widths it
was verified at (**360 / 414 / 768 / 1280**). Add a new breakpoint only if one
of these four cannot express the change (L-07).

- [ ] Check 360, 480, 640, 900, 1100, 1440 px — no horizontal scroll, no clipped labels.
- [ ] Below 900px the hamburger opens the sidebar; clicking a nav link closes it (e2e helper `clickNav` documents this).
- [ ] Long URLs ellipsize (`.name-cell a`), cards wrap their heads, tables hide `.hide-sm` columns instead of overflowing.

## 3 · Performance checklist

- [ ] No framework, no bundler, no new runtime dependency (ADR-0003 / ADR-0004 — runtime deps stay at **2**: `express`, `compression`).
- [ ] New DOM still built through `h()`; no `document.createElement` sprawl, no inline style/script (CSP has no `unsafe-inline`).
- [ ] Polling stays one timer (`state.pollMs`, default 5000 ms) — do not add a second interval per view; entrance animations run on route change only.
- [ ] Service worker contract preserved: navigations network-first with shell fallback, **all data requests always network** (`public/sw.js`, cache `novapulse-shell-v2026.2`) — never let it serve stale state.
- [ ] Server-side levers unchanged: `?v=` asset versioning, strong ETag, `compression()`, `Cache-Control: no-cache` on HTML.
- [ ] Charts render from server-computed analytics (`lib/analytics.js`) — no client-side recomputation of percentiles over raw history.

## 4 · Visual regressions

- [ ] Compare desktop **and** mobile: `playwright-report/` and `test-results/` hold screenshots, traces and videos for failures only.
- [ ] There is **no snapshot baseline suite** in this repo (no `toHaveScreenshot`/`toMatchSnapshot` in `e2e/`) — the guard is behavioural (visibility, roles, attributes), so a visual change must be described in the PR with a real screenshot (L-03).
- [ ] Skeletons, empty states and error states verified for any screen you touched.

## 5 · Running Playwright (desktop + mobile)

```bash
pnpm run e2e                      # both projects, server auto-started on :3210
pnpm exec playwright test --project=desktop-chromium   # 1440×900
pnpm exec playwright test --project=mobile-chromium    # Pixel 7
pnpm exec playwright test --grep "status page"         # by name
pnpm run e2e:ui                   # interactive mode
pnpm run e2e:report               # open the HTML report
```

Facts to rely on: `webServer` starts `node server.js` with an isolated
`UPTIME_DATA_DIR=./e2e/.tmp-data`, `workers: 1`, `fullyParallel: false`,
`retries: 1` in CI, and `RATE_LIMIT=off` **inside the test server only** (never
a shipped default, L-17). First run on a new machine:
`pnpm exec playwright install --with-deps chromium`.

## Definition of done

- [ ] A11y items above pass for every overlay and nav state you touched.
- [ ] Layout checked at 360 / 480 / 640 / 900 / 1100 / 1440 px against the four real breakpoints.
- [ ] `pnpm run lint`, `pnpm run typecheck`, `pnpm test` exit 0 and `pnpm run e2e` is green on **both** projects.
- [ ] No new dependency, no inline script, no stale-cache path introduced.
- [ ] Save/edit still notifies (L-40) and the e2e regression guards for it still pass.

## References

- [`.ai/RULES.md`](../../../.ai/RULES.md) — L-14, L-40, L-41 · [`docs/RULES.md`](../../../docs/RULES.md)
- [`.ai/ARCHITECTURE.md`](../../../.ai/ARCHITECTURE.md) — §6 rendering contract, §2 dependency rule
- [`.ai/BUGS.md`](../../../.ai/BUGS.md) — `BUG-2026-0001` (silent no-op save)
- [`playwright.config.mjs`](../../../playwright.config.mjs) · `e2e/dashboard.spec.mjs` · `e2e/status-page.spec.mjs`
