---
name: agentic-seo
description: >-
  SEO for NovaPulse's public surfaces — the opt-in status page
  (public/status.html → /status), the dashboard shell, the GitHub Pages bundle
  (site/) and the README — with a verified inventory of the meta tags that
  actually exist today and the e2e constraints any change must respect.
---

# 🌐 agentic-seo — search & share metadata for NovaPulse

> Skill pack member. **Evidence rule (L-02/L-03):** this document only claims
> tags and files that were verified to exist in this tree on 2026-10-07. Nothing
> below may be described as shipped until a command proves it. Re-verify before
> every use.

## When to use

- Changing `<head>` content in `public/index.html` or `public/status.html`.
- Preparing a public GitHub Pages deployment or a release announcement.
- Improving how the README or a status page renders when shared (link previews).
- Auditing a self-hosted instance's indexability.

## Inputs

| input | where |
| --- | --- |
| HTML shells | [`public/index.html`](../../../public/index.html), [`public/status.html`](../../../public/status.html) |
| static build | `tools/gh-build.js` → `site/` (gitignored, built by CI) |
| Pages deploy | [`.github/workflows/monitor.yml`](../../../.github/workflows/monitor.yml) |
| README | [`README.md`](../../../README.md) |
| CSP (constrains any add-on) | `server.js` → `securityHeaders()` |

---

## Verified inventory (2026-10-07)

Repo-wide search for `og:`, `twitter:`, `canonical`, `robots`, `sitemap`,
`application/ld+json` returned **zero matches**; a file search for
`robots*` / `sitemap*` returned only `public/manifest.webmanifest`.

| surface | served at | what exists | what does **not** exist |
| --- | --- | --- | --- |
| Dashboard shell | `/` | `<title>NovaPulse 2026 — Autonomous GitOps Telemetry</title>`, `meta description`, `theme-color` ×2 (dark/light), `color-scheme`, `viewport`, `lang="en"`, favicon, `manifest.webmanifest` link | `og:*`, `twitter:*`, `canonical`, JSON-LD |
| Status page | `/status` — **404 while disabled** | `<title>Service status — NovaPulse 2026</title>`, `meta description`, `theme-color` ×2, `color-scheme`, `viewport`, favicon | `og:*`, `twitter:*`, `canonical`, JSON-LD, manifest link |
| Static bundle | GitHub Pages (`site/`) | byte-copy of `public/` plus `.nojekyll`, `data/*.json`, `badge/*.svg` — no HTML is generated or rewritten | `robots.txt`, `sitemap.xml` |
| Repository | `github.com/SudhirDevOps1/NovaPulse` | README: single H1, live workflow/license/stars/issues badges, feature sections, comparison table, deployment guide | — |

Caching/URL facts that affect crawling: `/` and `/status` are sent with
`Cache-Control: no-cache`; static assets use `public, no-cache, must-revalidate`;
dashboard asset URLs carry a `?v=<version>-<start>` suffix injected by
`server.js`.

## Procedure

### 1 · Audit what is actually served

```bash
# head tags as shipped (works for both shells)
grep -nE "<title>|name=\"description\"|og:|twitter:|canonical|ld\+json" public/index.html public/status.html

# nothing sneaked in at build time?
grep -rnE "og:|twitter:|canonical|ld\+json" tools/ site/ 2>/dev/null || echo "no OG/canonical in build path"

# files that would have to be added are still absent?
ls public/robots.txt public/sitemap.xml 2>/dev/null || echo "no robots/sitemap in public/"
```

### 2 · Audit a running instance

```bash
pnpm start                       # terminal 1
curl -sI http://127.0.0.1:3000/            # HTML, cache-control: no-cache
curl -s -o /dev/null -w "%{http_code}\n" \
  http://127.0.0.1:3000/status             # 404 while the status page is disabled
```

Enable the page (Settings → Status page, or `PATCH /api/settings`) and repeat:
`/status` then returns 200 and the payload is the allowlisted projection —
that is the only page a crawler can ever index on a NovaPulse instance.

### 3 · Audit the README

- Exactly one H1 (`# NovaPulse 2026`); badges resolve to this repository's real
  Actions runs and shields endpoints (no fabricated numbers — L-03).
- Every internal link target exists (`grep -oE '\]\([^)h][^)]*\)' README.md`).
- Feature list matches `main` — anything unshipped belongs in `.ai/TODO.md`
  (L-02), not in the README.

### 4 · Make changes (only the ones that are missing)

Ordered by value for this project; each is a *proposal until merged*:

1. **Open Graph + Twitter tags** on both shells: `og:title`, `og:description`,
   `og:type`, `og:url`, `twitter:card`. Use the existing `<title>` /
   `meta description` values as the source of truth so the tags cannot drift.
2. **`robots.txt` / `sitemap.xml`** — meaningful only for a deployment with a
   stable public origin (the GitHub Pages mode). A self-hosted instance has no
   canonical origin, and its `/status` is 404 until an operator opts in, so a
   sitemap generated per deployment (not committed as a universal file) is the
   honest shape. `tools/gh-build.js` copies `public/` verbatim into `site/`, so
   a `public/robots.txt` would ship to Pages automatically.
3. **JSON-LD structured data** — the CSP is `script-src 'self'` with **no
   `unsafe-inline`** (L-18), which blocks an inline
   `<script type="application/ld+json">`. Serve it as a same-origin file or
   don't add it; never relax the CSP for SEO (L-18).
4. **Per-page titles** are already distinct for `/` and `/status` — keep them so.

Constraints on every change: no third-party fonts, scripts or analytics
(L-23 — the CSP would block them anyway), and keep the head static: the CSP
forbids inline script, so nothing may be injected at runtime.

### 5 · Prove the change

```bash
pnpm run lint && pnpm run typecheck && pnpm test
pnpm run e2e       # title assertions below must stay green
```

Hard constraints encoded in e2e — breaking them fails Darwaza 2:
`e2e/dashboard.spec.mjs` requires `toHaveTitle(/NovaPulse/)` on `/`, and
`e2e/status-page.spec.mjs` requires `toHaveTitle(/status/i)` on `/status` plus
the absence of secrets and stack traces in the public HTML.

## Definition of done

- [ ] Every metadata claim in the PR is backed by the `grep` output that shows it.
- [ ] No tag claims a URL/origin that the deployment does not have.
- [ ] `/` and `/status` titles still satisfy the e2e title assertions; `pnpm run e2e` green.
- [ ] CSP, PII and no-third-party laws untouched (L-18, L-19, L-23).
- [ ] README/`docs/` updated to describe only shipped behaviour (L-02/L-32).

## References

- [`public/index.html`](../../../public/index.html) · [`public/status.html`](../../../public/status.html)
- [`tools/gh-build.js`](../../../tools/gh-build.js) — what `site/` actually contains
- [`.github/workflows/monitor.yml`](../../../.github/workflows/monitor.yml) — Pages build + deploy
- [`e2e/status-page.spec.mjs`](../../../e2e/status-page.spec.mjs) — public-surface assertions
- [`.ai/RULES.md`](../../../.ai/RULES.md) — L-02, L-03, L-18, L-23 · [`docs/RULES.md`](../../../docs/RULES.md)
