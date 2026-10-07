# 📋 NovaPulse — Product Requirements Document

> What NovaPulse must do, for whom, and how we know it does it. Every
> requirement below describes **shipped functionality** that exists in this
> repository today — each FR names the file and the test that proves it
> (**L-02**, **L-03**). Targets that are *not* yet met are labelled as targets
> and live in [`TODO.md`](TODO.md).
>
> Version `2026.1.0` · scope baseline: `main` at 2026-10-07 ·
> laws: **L-01** (research before agreeing), **L-05** (state the cost), **L-07**
> (no scope inflation).

---

## 1 · Product statement

NovaPulse is a **self-hosted uptime and telemetry monitor** that a single
person can run forever on free-tier infrastructure: no database, no build step,
no vendor. It probes HTTP(S) and TCP targets on a schedule, records bounded
history, tells you when something breaks, and publishes a status page when you
want the world to see it.

Constraints that shape every requirement (`ARCHITECTURE.md` §1): must run with
no card and no cold starts; must survive a restart with state intact; must serve
hundreds of checks from a ~60 MB-class process; must keep a CSP with no
`unsafe-inline`; must stay single-writer; must keep a 2-dependency runtime.

---

## 2 · Personas

| persona | who | job to be done | success looks like |
| --- | --- | --- | --- |
| **P1 — Solo operator** | a developer with 5–50 side projects, a VPS and no on-call team | "tell me when something breaks, before a user does" | one dashboard, alerts on Telegram/Discord/ntfy/webhook, no agent to install, no monthly bill |
| **P2 — Small team / support** | 2–10 people who need to *show* service health | "give customers a page that never leaks internals" | an opt-in status page and embeddable badges, with an allowlisted payload and a fail-closed default |
| **P3 — GitOps / static user** | someone who lives in GitHub and wants ₹0 monitoring | "monitor from CI, publish to Pages, review state as code" | `monitor.yml` cron probes `config/monitors.json`, state is a single-commit branch, the dashboard is read-only on Pages |

Non-personas (explicitly not designed for): enterprises needing RBAC/audit
trails, multi-tenant SaaS, and teams needing sub-second alerting — see §6.

---

## 3 · User stories with acceptance criteria

**US-1 — Create a monitor and see it check itself**
> As P1, I add a URL and immediately see whether it is up.

- AC1.1 Given the dashboard, When I submit a valid name + URL, Then the API
  answers `201`, the monitor appears with `status: unknown|up`, and a success
  toast is shown (regression guard: `e2e/dashboard.spec.mjs` → *"saving a new
  monitor shows a success notification"*, **L-40**).
- AC1.2 Given an invalid URL (`ftp://…`), When I submit, Then the API answers
  `400` with `url must use http, https or tcp` and the error is shown inline —
  never a silent no-op (`test/api.test.js`).
- AC1.3 Given a create, When the response returns, Then a probe has already been
  fired without blocking the response (`checkNow` fire-and-forget).

**US-2 — Tune a check so it does not cry wolf**
> As P1, flapping networks must not page me; real outages must.

- AC2.1 `failuresBeforeDown` (1–10) declares an outage only after N
  consecutive failures (`lib/checker.js`).
- AC2.2 `warnMs` (0–60000) marks a monitor `degraded` instead of `down`, and a
  degraded alert is sent only when `ALERT_ON_DEGRADED=1`.
- AC2.3 `expectedStatus` accepts `200-299` / `200,204,301` and rejects anything
  else at save time; `expectedKeyword` (≤120 chars) is matched case-insensitively
  against the first 1 MB of the body (`lib/probe.js`).
- AC2.4 Clearing an assertion with an empty value removes it from storage
  (`test/api.test.js` → *"advanced monitor fields validate and can be cleared"*).

**US-3 — Be told, on the channel I already use**
> As P1, alerts must leave the box without a third-party "incident platform".

- AC3.1 Telegram, Discord, ntfy and a generic JSON webhook each work
  independently; a failing channel is logged and never blocks the probe loop
  (`lib/notify.js`, `Promise.allSettled`).
- AC3.2 An alert fires on the transition (Nth consecutive failure) and again on
  recovery, with the outage duration in the message (`lib/checker.js`).
- AC3.3 SSL expiry warns once per 24 h when `daysLeft ≤ SSL_WARN_DAYS`
  (default 14) and stays quiet otherwise.
- AC3.4 `/api/settings` and `/api/health` report per-channel availability as
  booleans — never the secret values.

**US-4 — Understand *why* latency moved**
> As P1, a number without context is useless.

- AC4.1 Fleet and per-monitor analytics for `24h | 7d | 30d` with uptime, avg,
  and **p50 / p95 / p99** computed from hourly rollups (`lib/analytics.js`).
- AC4.2 30 fixed UTC day buckets (`null` uptime = no data, never a fake 0).
- AC4.3 A response-time histogram from the 500-point raw window.
- AC4.4 An SLA report: target (`SLA_TARGET`, default 99.9), met/not-met, error
  budget remaining, incident count and MTTR over the window.
- AC4.5 `rollups` are never shipped in list payloads — they are served only by
  `/api/monitors/:id/analytics` (`publicMonitor()`).

**US-5 — Publish status without leaking internals**
> As P2, the public page must show health, not architecture.

- AC5.1 Status page is **off by default**: `/status` and `/api/public/status`
  answer `404` until enabled in Settings (`test/api.test.js`, `e2e/status-page.spec.mjs`).
- AC5.2 The projection exposes only the allowlisted fields
  (`SECURITY.md` §3.8); no ids, headers, bodies, history or disabled monitors.
- AC5.3 Page title ≤80 chars and message ≤300 chars, enforced on write.
- AC5.4 Badges render as SVG for `fleet` and any monitor id, with
  `flat` / `for-the-badge` styles and `max-age=60` caching; an unknown id is a
  `404`, never a 200 with empty data (`e2e/status-page.spec.mjs`).

**US-6 — Lose nothing, restore anything**
> As P1, my history must survive restarts and a bad deploy.

- AC6.1 Every write is atomic; a crash mid-write leaves the previous file
  intact (`lib/store.js`, **L-35**).
- AC6.2 `GET /api/export` returns `{version: 2, exportedAt, monitors,
  incidents, settings}`; `POST /api/import` merges by id or replaces, and both
  paths flush immediately.
- AC6.3 History/incidents are ring-bounded (500 / 500 / 720 hourly buckets), so
  the file cannot grow without limit (**L-24**, [`DATABASE.md`](DATABASE.md) §5).
- AC6.4 Known limits are documented, not discovered: restore via
  `POST /api/import` is capped by the 64 kB JSON body
  ([`DATABASE.md`](DATABASE.md) §9); large fleets restore by file copy.

**US-7 — Run it from CI with zero infrastructure**
> As P3, monitoring should cost ₹0 and live in my repo.

- AC7.1 `monitor.yml` runs every 5 minutes: probes `config/monitors.json`,
  records history, fires alerts, force-pushes a single-commit `state` branch,
  rebuilds `site/` and deploys to Pages.
- AC7.2 The built dashboard reports `APP_MODE = 'static'` and every mutation
  rejects with a read-only explanation instead of a confusing failure
  (`public/js/api.js` → `readOnly()`).
- AC7.3 Static and server mode share one codebase; the switch is build-time
  only, because the CSP forbids inline scripts (ADR-0002/0003).

**US-8 — Operate it like a service**
> As the operator, I need to know *which code* is running and what it did.

- AC8.1 `GET /api/health` reports `version` (must equal `package.json`),
  `node`, `env`, `uptimeSec`, monitor count and alert-channel booleans.
- AC8.2 Every request carries `X-Request-Id` and one structured log line with
  status and duration; 5xx logs at `error`, 4xx at `warn`.
- AC8.3 `SIGINT`/`SIGTERM` stops the scheduler, closes the server and force-
  flushes state before exit (8 s failsafe).

---

## 4 · Functional requirements

| ID | requirement | implemented in | verified by |
| --- | --- | --- | --- |
| FR-1 | Create/read/update/delete monitors with `http(s)` and `tcp` targets | `server.js`, `lib/store.js` | `test/api.test.js` lifecycle |
| FR-2 | Schedule checks per monitor: `intervalSec` 10–86400, 5 s tick, no self-overlap, jittered start | `lib/checker.js` → `createScheduler` | code + e2e persistence spec |
| FR-3 | Probe with timing waterfall (DNS→connect→TLS→TTFB→download), method, headers (≤10), body (≤4096), timeout 500–60000 ms, ≤5 redirects, 1 MB body cap | `lib/probe.js` | `test/api.test.js`, `e2e` |
| FR-4 | Status model `unknown/up/degraded/down` with a configurable failure grace | `lib/checker.js` | e2e lifecycle specs |
| FR-5 | Incident log: `down`/`up` pairs with reason and duration; queryable by `monitorId`/`type`, `limit` ≤200; cap 500 | `store.pushIncident`, `GET /api/incidents` | `test/api.test.js` shape |
| FR-6 | Alert fan-out to Telegram/Discord/ntfy/webhook with per-channel isolation + SSL expiry warnings | `lib/notify.js`, `lib/checker.js` | `/api/health` booleans; manual |
| FR-7 | Analytics: ranges, percentiles, day buckets, histogram, SLA/error budget/MTTR | `lib/analytics.js` | `test/api.test.js` (`range=7d`, `range=30d`, `sla.target`) |
| FR-8 | Opt-in status page with allowlisted projection, fail-closed 404 default | `analytics.statusProjection`, `/status` | unit + e2e allowlist specs |
| FR-9 | Embeddable SVG badges (fleet + per monitor, 2 styles), XML-escaped | `lib/badge.js`, `/api/badge/:id.svg` | `test/api.test.js`, e2e badges |
| FR-10 | Full export/import (merge/replace) and per-monitor CSV | `store.exportState/importState`, routes | `test/api.test.js` export shape |
| FR-11 | Settings: status-page block only, allowlisted fields, channel status | `store.updateSettings`, `/api/settings` | `test/api.test.js` settings spec |
| FR-12 | Dashboard: hash routes `#/overview #/monitors #/incidents #/settings`, toast on every save, inline validation, responsive sidebar, state survives reload | `public/js/*` | 8 dashboard e2e specs |
| FR-13 | Static (GitHub Pages) mode: read-only dashboard + alerts from Actions | `tools/gh-check.js`, `tools/gh-build.js`, `monitor.yml` | `pnpm run build` + `build:check` |
| FR-14 | Security baseline on every response: CSP without `unsafe-inline`, nosniff, DENY, `no-referrer`, Permissions-Policy, COOP/COEP/CORP, HSTS-when-TLS, `X-Request-Id`, rate limit 240/min/IP on `/api` | `server.js` → `securityHeaders`, `lib/limits.js` | unit + e2e header specs |
| FR-15 | Graceful shutdown with state flush; atomic writes with debounced coalescing | `server.js`, `lib/store.js` | code review + [`DATABASE.md`](DATABASE.md) §3 |

---

## 5 · Non-functional requirements

### 5.1 Performance

| ID | requirement | basis |
| --- | --- | --- |
| NFR-P1 | Scheduler tick 5 s; per-monitor checks never overlap; a monitor is checked at most once per `intervalSec` | `lib/checker.js` |
| NFR-P2 | Response bodies read at ≤1 MB, redirects ≤5, every probe bounded by `timeoutMs` (≤60 s) | `lib/probe.js` |
| NFR-P3 | API mutation payloads ≤64 kB; validation rejects oversize headers/body/tags before storage | `express.json({limit})`, `validateMonitor` |
| NFR-P4 | Writes coalesced to ≤1 flush per 250 ms; list payloads omit `rollups` | `lib/store.js`, `publicMonitor` |
| NFR-P5 | Static assets revalidate (ETag → 304); HTML `no-cache`; gzip via `compression` | `server.js` |
| NFR-P6 | *Target*, not a claim: at 100 monitors at cap, state = ~11.1 MiB JSON and process RSS ~78 MiB (measured, [`DATABASE.md`](DATABASE.md) §10); PM2 restarts at 250 MB | measurement |
| NFR-P7 | Rate limit protects the API at 240 req/min/IP by default | `server.js` |

### 5.2 Availability & durability

| ID | requirement | basis |
| --- | --- | --- |
| NFR-A1 | Zero data loss on process crash: atomic tmp+rename | `store.flush` (**L-35**) |
| NFR-A2 | Restart preserves state from the last flush; shutdown flushes synchronously | `SIGINT`/`SIGTERM` handler |
| NFR-A3 | Availability faults degrade, security faults halt (corrupt data file → quarantine the bytes to `monitors.json.corrupt-<ts>`, warn + start empty; CSP/rate-limit/header failures are never skipped) | `ARCHITECTURE.md` §7, **L-09** |
| NFR-A4 | Single-writer only: `instances: 1`, one volume, isolated data dir per test harness | `ecosystem.config.js`, **L-39** |
| NFR-A5 | Container health check answers without touching disk | `Dockerfile` → `/api/health` |
| NFR-A6 | Unhandled rejection is logged and the process keeps serving; the checker loop is supervised per check | `server.js`, `lib/checker.js` |

### 5.3 Security, privacy, portability

| ID | requirement | basis |
| --- | --- | --- |
| NFR-S1 | Full header/CSP baseline on every response; no `unsafe-inline`, no third-party origin | FR-14, [`SECURITY.md`](SECURITY.md) §3.3 |
| NFR-S2 | Fail-closed defaults: status page off, rate limit on, framing denied, no inline fallback secrets | **L-09/L-10/L-17/L-18** |
| NFR-S3 | Zero PII in state, logs, exports and badges | **L-19…L-23**, [`SECURITY.md`](SECURITY.md) §5 |
| NFR-S4 | Public projection is an explicit allowlist, tested | FR-8, e2e allowlist spec |
| NFR-S5 | Two runtime dependencies; `npm audit` fails on high/critical; nightly CodeQL + Semgrep; ZAP baseline on PRs | [`SECURITY.md`](SECURITY.md) §3.10–§3.11 |
| NFR-C1 | Node ≥18 (CI matrix 20/22/24); pnpm `12.9.1` frozen lockfile | `package.json`, `ci.yml` |
| NFR-C2 | Runs as non-root in `node:22-alpine`, prod-only dependencies | `Dockerfile` |
| NFR-C3 | Two runtime modes from one codebase (server / static) | FR-13 |
| NFR-Q1 | Zero-defect gate: `typecheck` 0 errors (2 tsconfigs), `lint --max-warnings=0`, unit tests 100% green, e2e green, three Darwazas green | **L-26…L-34** |

---

## 6 · Out of scope (do not build without an ADR)

1. **Authentication / accounts / RBAC / audit logs** — see
   [`SECURITY.md`](SECURITY.md) §6–§7 for the honest exposure.
2. **A database, Redis, or horizontal scaling** — rejected in ADR-0001;
   revisit only at multi-replica or ~hundreds of monitors.
3. **A frontend framework or bundler** — ADR-0003; `tsc --noEmit` over
   `checkJs` is the type-safety substitute.
4. **WebSocket/live push** — polling at 5–30 s is enough; the data changes only
   when a probe completes (`ARCHITECTURE.md` §9).
5. **Mobile apps, email/SMS/pager integrations, on-call rotations.**
6. **Multi-region probes or agent-based checks** — probes run from the single
   host/Actions runner; that is a *feature* of the ₹0 model, not an omission.
7. **Response-body storage, log ingestion, metrics pipelines** — NovaPulse
   records probe *outcomes*, not content (≤1 MB read, discarded).
8. **Any third-party telemetry in the product** — CSP forbids it (**L-23**).

---

## 7 · Success metrics

**Shipped today (measured 2026-10-07, re-derivable — `CONTEXT.md` §10):**

| metric | value |
| --- | --- |
| unit/integration tests | **12 / 12 pass**, 0 fail/skip, ~1.4 s |
| e2e specs | **13** across 2 files × 2 viewport projects (desktop-chromium, mobile-chromium) |
| typecheck | 0 errors across `tsconfig.json` + `tsconfig.sw.json` |
| lint | `eslint . --max-warnings=0` → 0 errors, 0 warnings |
| routes | 20 (18 API + `/` + `/status`) |
| runtime dependencies | 2 |
| status page default | 404 until enabled |
| rate limit default | 240 req/min/IP |

**Targets (aspirational, tracked in [`TODO.md`](TODO.md), not claims):**

| target | measure |
| --- | --- |
| alert delivery | an outage produces a channel message within one `intervalSec` + probe timeout of the Nth failure |
| gate coverage | every FR above has at least one automated test; today FR-6 (alert fan-out) and FR-13 rely on manual/CI verification |
| restore fidelity | export → import round trip preserves every monitor field (incl. `method` since NOW-6 — [`DATABASE.md`](DATABASE.md) §8) |
| red zero | no open `error`-severity CodeQL alert, no high/critical advisory, zero ZAP warning-level findings |

---

## 8 · Change control

New requirements start as an entry in [`TODO.md`](TODO.md), become an ADR in
[`DECISIONS.md`](DECISIONS.md) if they are costly to reverse, and land through
the 7-Step Lifecycle in [`PROMPTS/MASTER_SYSTEM.md`](PROMPTS/MASTER_SYSTEM.md).
Nothing ships that is not on `main` (**L-02**), and nothing is claimed without a
command and its output (**L-04**).
