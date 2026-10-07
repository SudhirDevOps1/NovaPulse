# 🧭 NovaPulse — Backlog (Honest TODO)

> **Rules for this file** (from [`RULES.md`](RULES.md) **L-02**, **L-04**,
> **L-32**): only items that are *really missing* appear here; every "done"
> claim carries the command that proved it; nothing is listed as "in progress"
> unless a session is actively working on it right now. Acceptance criteria are
> written so an agent can verify them without asking a question.
>
> Last reviewed against `main`: **2026-10-07** · baseline `2026.1.0`.

---

## 0 · What already exists (so we do not re-build it)

| area | state | evidence |
| --- | --- | --- |
| monitors CRUD + http/tcp probes + timing waterfall | shipped | `test/api.test.js` 13/13 |
| scheduler with grace period, jitter, no self-overlap | shipped | `lib/checker.js` |
| incidents, SSL expiry warnings, 4 alert channels | shipped | `lib/checker.js`, `lib/notify.js` |
| analytics (p50/p95/p99, day buckets, histogram, SLA/MTTR) | shipped | `lib/analytics.js`, unit tests |
| status page (opt-in, allowlisted) + SVG badges | shipped | e2e `status-page.spec.mjs` |
| atomic JSON store, ring caps, export/import/CSV | shipped | [`DATABASE.md`](DATABASE.md) |
| dashboard with hash routing, toasts, validation, responsive shell | shipped | 8 e2e specs |
| static GitHub Pages mode + `monitor.yml` cron | shipped | `tools/gh-check.js`, `gh-build.js` |
| security headers, CSP, rate limit, ZAP/CodeQL/Semgrep gates | shipped | [`SECURITY.md`](SECURITY.md) §3 |
| 3 Darwazas + Sonar + release-please + Dependabot | shipped | `.github/workflows/` (6 files) |

**In progress: none.** The register is clear (same as `.ai/BUGS.md` §1: no open
incidents).

---

## 1 · Now — correctness and rule-to-code gaps

Ordered by risk. Each item is small, self-contained and has a test as its
definition of done.

### NOW-1 · Normalise monitor fields on load (missing `history` breaks the API) — ✅ closed 2026-10-07

- **Why:** a hand-edited or truncated `monitors.json` whose monitor lacks
  `history` made `GET /api/monitors`, `GET /api/monitors/:id` and
  `GET /api/stats` answer **500**, and `store.addHistory` threw
  `TypeError: Cannot read properties of undefined (reading 'push')` — measured,
  see [`DATABASE.md`](DATABASE.md) §8. **L-36** was only partially met.
- **Acceptance criteria:**
  - [x] `load()` (or a `normaliseMonitor()` helper) defaults `history: []`,
        `rollups: []`, `tags: []`, `status: 'unknown'`, `enabled: true`,
        `consecutiveFailures: 0`, `wasDown: false`, `intervalSec`, `timeoutMs`,
        `method` when absent — no throw, no 500.
  - [x] Unit test loads a fixture missing every optional field and asserts
        `GET /api/monitors` → 200 and `addHistory` succeeds.
  - [x] Existing tests stay green; `pnpm run typecheck` / `lint` exit 0.
- **Proof:** `lib/store.js` → `normaliseMonitor()` (called from `load()`),
  `test/store-normalise.test.js` (2 specs), re-measured
  `GET /api/monitors|/api/monitors/hand-1|/api/stats → 200`, suite now
  `pnpm test` → **25/25**, `DATABASE.md` §4/§8 rewritten from fresh runs.

### NOW-2 · Quarantine a corrupt state file instead of overwriting it — ✅ closed 2026-10-07

- **Why:** `load()` used to warn and start empty, and the **first debounced
  flush renamed over the corrupt bytes** — measured, no backup was created
  ([`DATABASE.md`](DATABASE.md) §4). Silent destruction of the only copy.
- **Acceptance criteria:**
  - [x] On a non-ENOENT read failure, the file is copied/renamed to
        `monitors.json.corrupt-<ISO-ts>` before state can be written.
  - [x] The warning log names the quarantine path.
  - [x] Test: write invalid JSON → boot → assert quarantine file exists, the
        app serves `monitors: 0`, and `monitors.json` is only replaced by an
        explicit save.
  - [x] [`DATABASE.md`](DATABASE.md) §4 updated in the same change (**L-32**).
- **Proof:** `lib/store.js` → `quarantineCorruptFile()` (copy happens before
  `state` exists; `load()` performs no write), `test/store-quarantine.test.js`
  (3 specs: bytes preserved · warning names the path · replaced only on save),
  re-measured boot trace in `DATABASE.md` §4.

### NOW-3 · `getRequiredEnv()` — fail closed on partial alert configuration

- **Why:** **L-11** requires a required-env accessor that throws naming the
  missing key; no such function exists (`SECURITY.md` §3.1). Today
  `TELEGRAM_BOT_TOKEN` without `TELEGRAM_CHAT_ID` silently disables Telegram
  and you discover it during an outage.
- **Acceptance criteria:**
  - [ ] One accessor in a single module (e.g. `lib/env.js`) used by every
        *channel pair* — throws `Missing required env: <KEY>` when one half of a
        pair is set and the other is empty.
  - [ ] A wholly-unconfigured channel stays optional (no env at all = off).
  - [ ] Boot test: partial Telegram config fails fast with the key named;
        no config at all boots cleanly.
  - [ ] No inline fallback secrets introduced (**L-10**), and `SECURITY.md`
        §3.1 status changes from ❌ to ✅.

### NOW-4 · Explicit same-origin guard on mutating routes (L-16)

- **Why:** CSRF is currently prevented only *incidentally* (no cookies, JSON-only
  body, CORS off by default) — `SECURITY.md` §3.2. The law demands token or
  same-origin enforcement.
- **Acceptance criteria:**
  - [ ] Middleware on `POST/PATCH/PUT/DELETE /api/*`: when an `Origin` header is
        present it must match the request host, else `403`; absent `Origin`
        (curl, server-to-server) is allowed so the CLI/ZAP/E2E flows keep
        working.
  - [ ] Tests: cross-origin `Origin` → 403; same-origin → normal result; no
        `Origin` → normal result.
  - [ ] `pnpm run e2e` green (no regression to the ZAP seeding curl commands).
  - [ ] `ALLOW_ORIGIN` (if set) still permits the configured origin.

### NOW-5 · Logger redaction at the source of truth (L-12) — plus query-string safety

- **Why:** `lib/logger.js` has **no redaction layer**; safety depends on nobody
  ever passing a secret. `requestLogger` logs `req.originalUrl` verbatim, so a
  secret in a query string would land in stdout (`SECURITY.md` §3.7).
- **Acceptance criteria:**
  - [ ] `logger.write()` masks values that match credential shapes: Telegram
        bot tokens (`\d+:[A-Za-z0-9_-]{30,}`), `Bearer …`, `Authorization`
        values, `…bot<token>` URL segments, `x-novapulse-secret` values.
  - [ ] `requestLogger` logs `req.path` (no query) or redacts query values.
  - [ ] Unit tests: each shape is masked in the output line; a normal line is
        byte-identical to today.
  - [ ] Overhead measured or argued (**L-05**).

### NOW-6 · Fix the silent `method` downgrade on import — ✅ closed 2026-10-07

- **Why:** `importState` used to write `method: m.method === 'POST' ? 'POST' :
  'GET'`, so an exported `HEAD`/`PUT`/`PATCH`/`DELETE` monitor returned from
  `POST /api/import` as `GET` — measured round trip in
  [`DATABASE.md`](DATABASE.md) §8. A backup that changes behaviour is not a
  backup.
- **Acceptance criteria:**
  - [x] Import accepts the FR-1 method list (or passes the validated value
        through) with the same validation as `validateMonitor`.
  - [x] Round-trip test: create with `HEAD` → export → import (merge **and**
        replace) → method still `HEAD`.
  - [x] `status`, `consecutiveFailures`, `lastCheck` still reset to re-probe
        (that part is by design).
- **Proof:** `HTTP_METHODS` now lives in `lib/store.js` and is imported by
  `server.js` (one list, both validators); `normaliseMethod()` used by
  `create()` and `importState()`; `test/api.test.js` → *export → import
  preserves the probe method (merge and replace)*; all six methods re-measured
  round-tripping in `DATABASE.md` §8 (`garbage method TRACE -> GET`).

### NOW-7 · Document drift sweep (docs must not lie)

- **Why:** **L-32**/**L-42** — verified mismatches as of 2026-10-07:
  - [x] `CONTEXT.md` §4 said **11** logical e2e specs; re-derived: `e2e/*.spec.mjs`
        has **13** (`test(` count: 8 + 5) — synced.
  - [x] `CONTEXT.md` §5 said **4** workflows; `.github/workflows/` holds **6**
        (`ci`, `e2e-gate`, `monitor`, `release`, `security-scan`, `sonar`) —
        §5 table and §7 now describe all six including `sonar.yml`.
  - [x] `.env.example` said the webhook header was `x-kestrel-secret`; the code
        sends `x-novapulse-secret` (`lib/notify.js`) — comment corrected.
  - [x] `.env.example` said `ALLOW_ORIGIN` is "comma-separated"; `server.js`
        now splits the list and echoes only the caller's origin (plus a
        `test/api.test.js` coverage for listed / stray / origin-less callers).
  - [x] Branding drift: boot log says `NovaPulse v…`, CSV/export filenames are
        `novapulse-*`, PM2 app name and the compose service/image are
        `novapulse` — product is NovaPulse.
  - [x] `RULES.md`/`CONTEXT.md`/`CHANGELOG.md` link `../docs/RULES.md`,
        `../docs/SECURITY.md`, `../docs/RELEASE.md` — the `docs/` directory now
        exists with all three, so the links resolve.
- **Acceptance criteria:** every box above either fixed or converted into a
  deliberate ADR/link target in the same PR; `CONTEXT.md` §10 re-derivation
  commands all run clean. ✅ met 2026-10-07 (all six boxes fixed, links
  re-checked with a relative-link sweep).

---

## 2 · Next — quality, operability, and payload cost

### NEXT-1 · Unit tests for the layers that currently have none

- **Why:** `test/api.test.js` (14 tests) exercises HTTP end-to-end, but
  `lib/analytics.js` math, `lib/limits.js` windows and `lib/notify.js` channel
  selection have no direct tests — the ring-buffer caps and percentile math are
  only covered *indirectly* or not at all. (`lib/store.js` corruption and
  missing-field handling **do** have direct tests since NOW-1/NOW-2:
  `test/store-normalise.test.js`, `test/store-quarantine.test.js`.)
- **Acceptance criteria:** one test file per lib module; caps (500/720/2400/500)
  asserted by pushing past them; `pnpm test` still runs under `node --test` and
  stays under ~5 s.

### NEXT-2 · Stop shipping 500 history points in the list payload

- **Why:** `publicMonitor()` strips `rollups` only — `GET /api/monitors`
  returns each monitor's full `history` (≈33 kB at cap, ≈3.3 MB for 100
  monitors). The list view needs only the 32-bar sparkline
  (`public/js/monitors.js` → `spark()`).
- **Acceptance criteria:**
  - [ ] List payload omits `history` (or replaces it with a bounded `spark[]`),
        detail/drawer still renders real history.
  - [ ] Measured payload for a 100-monitor fixture before/after, reported in the
        PR (evidence, **L-04**).
  - [ ] e2e "persistence across reload" and sparkline rendering still pass.

### NEXT-3 · Alert delivery retries

- **Why:** `lib/notify.js` sends once via `Promise.allSettled`; a transient
  `5xx`/timeout on a channel loses the alert forever (logged only).
- **Acceptance criteria:** bounded retry (e.g. 2 retries, exponential backoff,
  total ≤ the probe interval), per-channel failure isolation preserved, no
  dependency added (**L-07**), tests with a stubbed fetch asserting retry count
  and no retry on `4xx`.

### NEXT-4 · Redact credentials in export and API responses (L-22)

- **Why:** monitor `headers` may hold bearer tokens; they are returned by
  `GET /api/monitors` and included verbatim in `GET /api/export`
  (`SECURITY.md` §7.3). L-22 requires exports to be ticket-safe.
- **Acceptance criteria:** design decision recorded as an ADR (the edit form
  round-trips headers, so masking must be reversible or opt-in); exports mask by
  default with an explicit unmasked mode; tests for both paths; `SECURITY.md`
  §3.7 updated.

### NEXT-5 · Put `pnpm test` in the local pre-commit gate

- **Why:** `.husky/pre-commit` runs `typecheck` + `lint` only; the 25 tests take
  ~2.0 s (`Measure-Command { pnpm test }` → 2.01 s, 2026-10-07) and would catch
  API regressions before the push (Darwaza 1 catches them later, i.e. after the
  developer has context-switched).
- **Acceptance criteria:** hook runs `typecheck → lint → test`; total hook time
  stays < 10 s on the reference machine; `commitlint` still enforces the scope
  enum; documented in `RULES.md`'s enforcement map (doc sync).

### NEXT-6 · Restore path that does not choke at 64 kB

- **Why:** `POST /api/import` inherits `express.json({limit: '64kb'})` → `413`
  for a payload of ~5 maxed-out monitors, while `GET /api/export` is unbounded
  (measured, [`DATABASE.md`](DATABASE.md) §9). Today's guidance is "copy the
  file", which is fine for a VPS and wrong for a hosted control plane.
- **Acceptance criteria:** either a raised/streaming body limit for
  `/api/import` (with its own DoS analysis — the rate limiter stays) or an
  explicit `413` response body that tells the operator to use the file path;
  test asserts the chosen behaviour; `DATABASE.md` §9 and `README.md` agree.

---

## 3 · Later — only with an ADR and a stated trade-off

### LATER-1 · Optional authentication for the admin API

- **Why:** there is none, by omission — anyone who can reach the port has full
  admin and can read stored `headers` (`SECURITY.md` §7.1). The status page
  stays public by design (**ARCHITECTURE** §9); the *admin* surface is the gap.
- **Acceptance criteria:** ADR first (compare: single static admin token,
  reverse-proxy `Authorization`, basic auth); must keep `/api/health`
  unauthenticated for container probes; must not break the ZAP seed curls or
  E2E; fail-closed when enabled but unconfigured (**L-09**); E2E added for both
  states; `SECURITY.md` §6/§7 updated honestly either way.

### LATER-2 · SSRF guardrails for probe targets

- **Why:** `POST /api/monitors` immediately fetches attacker-supplied URLs,
  including cloud metadata addresses (`SECURITY.md` §7.2). Inherent to the
  product, but optional guardrails exist.
- **Acceptance criteria:** ADR weighing a `PROBE_DENY` CIDR list (default:
  none, i.e. behaviour unchanged) against the flexibility cost; if implemented,
  opt-in via env with a documented default and tests for `169.254.169.254`.

### LATER-3 · Self-monitoring in server mode

- **Why:** the GitHub Pages mode self-checks every 5 minutes via `monitor.yml`;
  server mode has no watchdog for "the monitor itself is wedged" beyond the
  container healthcheck.
- **Acceptance criteria:** ADR; no third-party telemetry (**L-23**); must not
  add a runtime dependency.

### LATER-4 · Durable flushes (`fsync`) behind a flag

- **Why:** `flush()` is atomic but not durable — a power loss in the same
  instant can lose the last flush (`DATABASE.md` §3). Cost: an `fsync` per flush
  on spinning/network storage.
- **Acceptance criteria:** opt-in (`UPTIME_FSYNC=1`), default unchanged,
  measured cost per flush attached to the ADR (**L-05**, **L-24**).

### LATER-5 · Raise retention caps (500 / 720 / 500)

- **Why:** longer history is the most common user ask; caps exist to bound RAM
  and disk (**L-24**).
- **Acceptance criteria:** ADR with a disk/memory projection computed from the
  real formula in [`DATABASE.md`](DATABASE.md) §10 (≈112 kB per monitor at
  current caps); caps become env-configurable with the current values as
  defaults; `DATABASE.md` §5 updated.

---

## 4 · Explicitly not doing (do not add without an ADR)

| idea | why it is refused today |
| --- | --- |
| database / SQLite / Postgres | ADR-0001 — costs a card, a connection, a migration path; the export format already migrates out cleanly |
| frontend framework or bundler | ADR-0003 — build step + hydration for a JSON re-render; CSP stays stricter without |
| WebSocket live updates | `ARCHITECTURE.md` §9 — data changes only when a probe completes; polling is proxy-friendly |
| new runtime dependency for anything hand-rolled | ADR-0004 — every package is supply chain (**L-07**) |
| more alert channels (email/SMS/PagerDuty) | not requested by any persona in [`PRD.md`](PRD.md) §2; adding channels multiplies credential handling |
| storing response bodies / log ingestion | changes the product class; today's ≤1 MB read is evaluated and discarded |

---

## 5 · How to work this file

1. Pick an item, run the **7-Step Lifecycle**
   ([`PROMPTS/MASTER_SYSTEM.md`](PROMPTS/MASTER_SYSTEM.md)).
2. Definition of done = the checkbox list, verbatim, with command output pasted
   (**L-04**).
3. When an item lands: tick it, move it to a short "Done" line with the commit
   sha, and sync `CONTEXT.md` / `CHANGELOG.md` / `BUGS.md` / `DECISIONS.md` in
   the same batch (**L-32**).
4. If work reveals the premise was wrong (a "gap" that is intended behaviour),
   delete the item and record the reasoning in
   [`DECISIONS.md`](DECISIONS.md) (**L-08**).
