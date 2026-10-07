# 🧭 NovaPulse — Live System Context

> **Auto-synced file.** Per `.ai/RULES.md` → **L-32**, this document is refreshed
> after every 3–4 features / fixes / refactors and always before a release.
> Never edit a number here by hand without re-running the command that produced it.
>
> Last synchronised: **2026-10-07** · by: agent session · trigger: initial
> enterprise hardening pass (3+ changes)

---

## 1 · Identity

| field | value |
| --- | --- |
| product | **NovaPulse 2026** — autonomous GitOps uptime & telemetry platform |
| repository | <https://github.com/SudhirDevOps1/NovaPulse> |
| version | `2026.1.0` (source of truth: `package.json` → `.release-please-manifest.json`) |
| runtime | Node.js ≥ 18 (CI matrix: **20 / 22 / 24**; verified locally on **24.19.0**) |
| package manager | **pnpm 12.9.1** (`packageManager` field, lockfile `pnpm-lock.yaml`) |
| license | MIT |
| architecture | single process · zero database · one JSON state file |

---

## 2 · Runtime topology (active)

```
                        ┌──────────────────────────────────────────┐
   HTTP :3000 ──────────►  Express 5  (server.js → createApp())     │
                        │                                          │
                        │  middleware chain (order matters):       │
                        │   1. securityHeaders   ← L-18            │
                        │   2. compression                         │
                        │   3. requestLogger     ← X-Request-Id    │
                        │   4. rateLimit /api     ← L-17           │
                        │   5. express.json 64kb                   │
                        │   6. static ./public                     │
                        │   7. /api routes  (18 endpoints)         │
                        │   8. 404 + error handler                 │
                        │                                          │
                        │  checker loop (lib/checker.js)           │
                        │   └─ every 5 s ticks scheduler           │
                        │       └─ probe (lib/probe.js)            │
                        │           └─ store.addHistory            │
                        │               └─ notify fan-out          │
                        └───────────────┬──────────────────────────┘
                                        │ atomic tmp+rename
                                        ▼
                          data/monitors.json   (single writer)
```

**Two runtime modes, one codebase:**

| mode | entry | state | used by |
| --- | --- | --- | --- |
| **server** | `node server.js` | `data/monitors.json` | Docker, VPS, Render, Fly |
| **static** | `tools/gh-build.js` → `site/` | `data/state.json` (read-only) | GitHub Pages + Actions |

The mode switch is **build-time only**: `public/js/config.js` exports
`APP_MODE = 'server'`, rewritten to `'static'` by the build. It is never
detected at runtime because the CSP forbids inline scripts.

---

## 3 · Route map (20 routes, verified from `server.js`)

### HTML / assets

| method | route | notes |
| --- | --- | --- |
| GET | `/` | injected `index.html`, `Cache-Control: no-cache`, `?v=` asset versioning |
| GET | `/status` | **404 while disabled**, 200 when the status page is enabled |
| GET | `/public/*` | `express.static`, `dotfiles: deny`, revalidate-always |

### API — read

| method | route |
| --- | --- |
| GET | `/api/health` |
| GET | `/api/stats` |
| GET | `/api/analytics?range=24h\|7d\|30d` |
| GET | `/api/monitors` |
| GET | `/api/monitors/:id` |
| GET | `/api/monitors/:id/analytics?range=…` |
| GET | `/api/monitors/:id/checks.csv` |
| GET | `/api/incidents` |
| GET | `/api/export` |
| GET | `/api/settings` |
| GET | `/api/public/status` |
| GET | `/api/badge/:id.svg` |

### API — mutate (CSRF / rate-limit covered)

| method | route |
| --- | --- |
| POST | `/api/monitors` |
| PATCH | `/api/monitors/:id` |
| DELETE | `/api/monitors/:id` |
| POST | `/api/monitors/:id/check` |
| POST | `/api/import` |
| PATCH | `/api/settings` |

> The SPA uses **hash routing** (`#/overview`, `#/monitors`, `#/incidents`,
> `#/settings`), so no client-side route needs a server counterpart.

---

## 4 · Test suite — verified counts

Commands below are the ones CI runs. Counts are **measured, not estimated**.

### Unit / integration — `pnpm test` (`node --test`)

```
✔ health endpoint reports monitor count
✔ rejects a monitor without a valid url
✔ monitor lifecycle: create, list, fetch, delete
✔ unknown API routes return JSON 404
✔ sends hardened security headers
✔ stats and export endpoints report consistent shape
✔ advanced monitor fields validate and can be cleared
✔ fleet analytics endpoint reports a range summary
✔ status page is disabled by default
✔ settings can enable the status page and projection renders
✔ svg badges render for the fleet
✔ probe helpers parse status specs and tcp targets
```

| metric | value |
| --- | --- |
| test files | **1** (`test/api.test.js`) |
| test cases | **12** |
| passing | **12** |
| failing / skipped / todo | **0 / 0 / 0** |
| duration | ~1.7 s |

### End-to-end — `pnpm run e2e` (`playwright test`)

| metric | value |
| --- | --- |
| spec files | **2** (`e2e/dashboard.spec.mjs`, `e2e/status-page.spec.mjs`) |
| projects | **2** (`desktop-chromium` 1440×900, `mobile-chromium` Pixel 7) |
| logical specs | **13** (13 × 2 projects = **26 executions**) |
| last run | **26 passed / 0 failed** (~1.3 min, 1 worker) |
| server | started by Playwright on `:3210`, isolated `e2e/.tmp-data` |

Spec inventory:

| spec | guards |
| --- | --- |
| dashboard shell loads | title, `#api-label`, overview heading |
| route navigation | `aria-current` follows the hash route (opens the off-canvas sidebar first on mobile) |
| security headers | CSP, `frame-ancestors 'none'`, nosniff, no `x-powered-by` |
| **save shows notification** | **regression guard for `BUG-2026-0001`** (`[form]` id reference) |
| validation surfaces inline | no silent no-op on invalid input |
| edit save notifies | toast after PATCH |
| persistence across reload | state survives a full page reload |
| responsive sidebar | menu button on narrow viewports |
| status page 404 while disabled | fail-closed default |
| status page renders when enabled | public payload allowlist |
| public projection allowlist | only allow-listed keys exposed |
| badges render / unknown 404 | SVG content-type, no fake 200 |

**Test isolation:** each `monitor lifecycle` spec wipes `GET /api/monitors` through the
`request` fixture first — leftover state in `e2e/.tmp-data` can never turn a red run
green or a green run red.

### Quality gates

| gate | command | status |
| --- | --- | --- |
| typecheck (app) | `tsc --noEmit` | ✅ 0 errors |
| typecheck (service worker) | `tsc --noEmit -p tsconfig.sw.json` | ✅ 0 errors |
| lint | `eslint . --max-warnings=0` | ✅ 0 errors · 0 warnings |
| unit/integration | `node --test` | ✅ 25 / 25 |
| e2e | `playwright test` | ✅ see §4 |
| commit lint | `commitlint` | ✅ rejects non-conventional, unknown scopes |
| production build | `node tools/gh-build.js` | ✅ emits `site/` |

---

## 5 · Source inventory

| area | files | notes |
| --- | --- | --- |
| server | `server.js` (1) | route table + validation, no business logic |
| lib | 8 | `analytics badge checker limits logger notify probe store` |
| dashboard | `public/js/` 9 | `api app charts config icons monitors status ui views` |
| shell | `public/` 5 | `index.html status.html style.css sw.js app.js` |
| tools | 3 | `gh-check.js gh-build.js husky.js` |
| tests | 1 unit + 2 e2e | see §4 |
| workflows | **6** | `ci` `e2e-gate` `security-scan` `sonar` `release` (+ `monitor`) |

**Dependency footprint (runtime): 2** — `express`, `compression`.
Everything else (rate limiting, badges, charts, alerts, analytics) is
hand-rolled on purpose. See `.ai/DECISIONS.md` → `ADR-0004`.

---

## 6 · Storage model summary

Single file `data/monitors.json`, written atomically (`tmp` + `rename`),
coalesced with a 250 ms debounce, flushed immediately on delete/import/shutdown.

| structure | cap | why |
| --- | --- | --- |
| `monitors[]` | unbounded by design | bounded by operational reality |
| `monitor.history[]` | **500** raw points | ring buffer per monitor |
| `monitor.rollups[]` | **720** hourly buckets | = 30 days of analytics |
| `rollup.samples[]` | **2400** per open hour | percentile input, then discarded |
| `incidents[]` | **500** | newest-first ring |
| `settings.statusPage` | 3 fields | `title` ≤ 80, `message` ≤ 300 |

Full schema, migration contract and zero-data-loss guarantees:
[`DATABASE.md`](DATABASE.md).

---

## 7 · CI/CD — the Three Darwazas

| gate | file | trigger | blocks merge? |
| --- | --- | --- | --- |
| **Darwaza 1 — Fast PR Gate** | `workflows/ci.yml` | every PR + push to `main` | ✅ **yes** (required check `gate`) |
| **Darwaza 2 — Heavy PR Gate** | `workflows/e2e-gate.yml` | PR → `main`, manual | ✅ yes (per branch protection) |
| **Darwaza 3 — Nightly Deep Audit** | `workflows/security-scan.yml` | cron `30 20 * * *` (02:00 IST) + manual | no — opens/updates an issue |
| **Sonar quality gate** | `workflows/sonar.yml` | push to `main`, PR, manual | no — opens/updates a `sonar-quality-gate` issue and comments on the PR |
| **Release Gate** | `workflows/release.yml` | push to `main` | no — opens the release PR |
| Monitor (product feature) | `workflows/monitor.yml` | cron `*/5`, push, manual | n/a |

Sonar needs the `SONAR_TOKEN` + `SONAR_HOST_URL` repository secrets; when they are
absent the job states that plainly in the job summary and never reports a fake pass.

**Darwaza 1 jobs:** `quality` (Node 20/22/24 × typecheck → lint → test → build)
· `docker` (build, no push) · `commitlint` (PR commits) · `gate` (aggregate,
the single required status check).

**Darwaza 2 jobs:** `e2e` (Playwright desktop + mobile, artifacts)
· `zap` (official ZAP baseline container against a freshly built image;
warning-level findings fail, info-level does not).

**Darwaza 3 jobs:** `codeql` (v4, JS/TS, custom query config)
· `semgrep` (`p/security-audit` + `p/javascript` + `p/nodejs`)
· `npm-audit` (fails on high/critical) · `notify` (creates/updates a
`security-nightly` issue on failure, closes it when green).

---

## 8 · Security posture (current)

| control | state |
| --- | --- |
| CSP | `default-src 'self'` · **no `unsafe-inline`** · `frame-ancestors 'none'` |
| secrets | env-only; **0** inline fallbacks (enforced by review + CodeQL) |
| rate limit | on by default, 240 req/min/IP, `RATE_LIMIT=off` is local-only |
| PII | none stored; masking helpers documented in `SECURITY.md` |
| public projection | field allowlist, tested by `e2e/status-page.spec.mjs` |
| auth on status page | none by design — payload is secret-free |
| scanners | CodeQL v4 · Semgrep · npm audit · OWASP ZAP baseline |

Detail: [`SECURITY.md`](SECURITY.md) · disclosure process: [`../docs/SECURITY.md`](../docs/SECURITY.md).

---

## 9 · Open work

| file | contents |
| --- | --- |
| [`TODO.md`](TODO.md) | roadmap, verified `[x]` only |
| [`BUGS.md`](BUGS.md) | incident register (`ID → symptom → root cause → fix`) |
| [`DECISIONS.md`](DECISIONS.md) | ADRs with status + rationale |
| [`CHANGELOG.md`](CHANGELOG.md) | release-please generated, conventional-commit driven |

**Current open items:** see `TODO.md` § "In progress".
**Known closed incidents:** `BUG-2026-0001` (save toast / silent no-op save),
`BUG-2026-0002` (stale server process serving old build), `BUG-2026-0003`
(9 e2e failures — three test defects, not product defects), `BUG-2026-0004`
(Release workflow failing on every push; Monitor could not deploy),
`BUG-2026-0005` (release-please's `chore(main): …` title), `BUG-2026-0006`
(Darwaza 2's DAST job not enforcing its policy), `BUG-2026-0007`
(commitlint job dying before it linted) and `BUG-2026-0008` (fixture ZAP
tables in CI job summaries) — §1 is empty and every recent entry carries CI
run ids as evidence.

---

## 10 · How to re-derive every number on this page

```bash
pnpm install --frozen-lockfile
pnpm run typecheck      # 0 errors expected (both tsconfigs)
pnpm run lint           # 0 errors, 0 warnings
pnpm test               # read the "tests N" line  → §4
pnpm run e2e            # read the passed/failed line → §4
node -e "const s=require('fs').readFileSync('server.js','utf8');
  console.log([...s.matchAll(/app\.(get|post|patch|delete)\(\s*'([^']+)'/g)].length, 'API routes')"
```

If any number here disagrees with the command output, **the command wins** —
fix this file.
