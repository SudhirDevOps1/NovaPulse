# 🔒 NovaPulse — Threat Model & Security Controls

> What we defend, how, what we deliberately do **not** defend, and where the
> weaknesses are. Every control listed here was read out of the code (or
> reproduced) before being claimed — **L-03**, **L-04**. Trade-offs are stated
> in the open per **L-05**; anything that does not exist is marked
> *not implemented*, never described as if it did (**L-02**).
>
> Companion files: [`RULES.md`](RULES.md) (the laws) ·
> [`DATABASE.md`](DATABASE.md) (what is stored) ·
> [`PRD.md`](PRD.md) (NFR-security) · [`PROMPTS/REVIEW.md`](PROMPTS/REVIEW.md)
> (the gate that checks all of this).

---

## 1 · What this system is

A single-process HTTP service (`Express 5`, port 3000) that (a) probes targets
on a schedule, (b) stores results in one JSON file, (c) serves a dashboard and
an optional public status page, (d) fans alerts out to Telegram / Discord /
ntfy / a generic webhook. Two runtime dependencies: `express@^5.2.1`,
`compression@^1.8.1`.

---

## 2 · Threat model

| # | asset | threat | surface | control |
| --- | --- | --- | --- | --- |
| A1 | alert-channel credentials (`TELEGRAM_BOT_TOKEN`, `WEBHOOK_URL`, `NTFY_TOKEN`…) | leak via source, logs, error output | env + logger | no inline fallbacks (§3.1), no secret is ever passed to `logger.*` (§3.7) |
| A2 | monitor `headers` (users put `Authorization: Bearer …` there) | leak via API/export/log | `data/monitors.json`, `/api/*` | **accepted risk, no auth** — see §7.1 |
| A3 | the state file (fleet topology, uptime, incidents) | tamper / wipe / read | `POST/PATCH/DELETE /api/*`, file system | atomic writes (§3.9), no auth → see §7.1 |
| A4 | the host / internal network | **SSRF**: server is told to fetch arbitrary URLs | `POST /api/monitors` → immediate `checkNow` | scheme allowlist only (§3.5) — see §7.2 |
| A5 | the operator's browser (dashboard) | XSS → session-less but state-destroying action | reflected user content: monitor names, URLs, tags, error strings | escaping (§3.6), strict CSP (§3.3) |
| A6 | the public status page visitor | clickjacking, injection, data exposure | `/status`, `/api/public/status`, `/api/badge/:id.svg` | headers + projection allowlist (§3.8) |
| A7 | the supply chain | compromised dependency | `pnpm-lock.yaml`, dev tooling | 2 runtime deps, Dependabot, `npm audit` gate (§3.10) |
| A8 | availability of the API | brute force / burst | all `/api` routes | fixed-window rate limit (§3.4) |

Trust boundaries: **the network port is the trust boundary.** There is no
second boundary inside it — no user, no role, no session (§7.1).

---

## 3 · Controls (verified in code)

### 3.1 Fail-closed environment — *partially implemented*

| law | status | evidence |
| --- | --- | --- |
| **L-10** zero inline fallback secrets | ✅ implemented | grep for `process.env.*\|\|` / `??` over `lib/` and `server.js` finds no secret default: every channel reads `process.env.X` directly and is enabled only when the value is truthy (`lib/notify.js` → `enabled()`). `.env.example` ships empty values. |
| **L-11** `getRequiredEnv()` throws on a missing key | ❌ **not implemented** | there is no `getRequiredEnv` (or any required-env accessor) anywhere in the source — the symbol appears only in `RULES.md`. |
| **L-09** fail closed on a security failure | ✅ for headers/rate-limit/CSP; ⚠️ not for env | a *partially* configured channel (e.g. `TELEGRAM_BOT_TOKEN` set, `TELEGRAM_CHAT_ID` missing) silently reports `telegram: false` in `/api/health` and `/api/settings` instead of crashing at boot. |

Consequence (honest): a misconfigured alert channel degrades to *no alerts*, and
you find out during an outage. Closing this gap is item **N1** in
[`TODO.md`](TODO.md). Non-secret knobs (`PORT`, `HOST`, `TRUST_PROXY`,
`RATE_LIMIT_MAX`, `LOG_LEVEL`) legitimately have defaults.

### 3.2 CSRF

**There is no CSRF token and no `Origin`/`Referer` check in the code** — L-16 as
literally written is *not* implemented. What actually defends the mutating
routes, in order of importance:

1. **No ambient credentials.** The app sets no cookies and has no session, so
   the classic attack — riding an authenticated victim's browser — has nothing
   to ride. This is the real reason CSRF is low-risk here, not a token.
2. **JSON-only mutations.** `express.json({limit: '64kb'})` parses
   `application/json` only; a cross-site `fetch` with that content type is
   preflighted, and the preflight fails because no `Access-Control-Allow-Origin`
   is sent unless `ALLOW_ORIGIN` is set (default: unset).
3. **CSP `form-action 'self'`** stops *our* pages from posting anywhere else.

Residual risk: none of the above is an explicit same-origin assertion, and
`ALLOW_ORIGIN` set to a permissive value would remove (2). Adding an
`Origin`/`Referer` guard on `POST/PATCH/PUT/DELETE` is item **N2**
([`TODO.md`](TODO.md)) — cheap, and it makes L-16 true rather than incidental.

### 3.3 Security headers (set on **every** response)

```
Content-Security-Policy: default-src 'self'; base-uri 'none'; form-action 'self';
  frame-ancestors 'none'; img-src 'self' data:; style-src 'self'; script-src 'self';
  connect-src 'self'; font-src 'self'; object-src 'none'          ← no unsafe-inline
X-Content-Type-Options: nosniff          X-Frame-Options: DENY
Referrer-Policy: no-referrer             Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin  X-DNS-Prefetch-Control: off
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin  ← badges answer cross-origin (embeddable)
Strict-Transport-Security: max-age=31536000; includeSubDomains     ← only when req.secure
X-Powered-By: disabled                   X-Request-Id: <8-char uuid per request>
```

`ALLOW_FRAMING=1` relaxes `frame-ancestors` to `http: https:` — local QA harness
only, never a shipped default (**L-18**). Because `connect-src 'self'` and
`script-src 'self'` are closed, adding any third-party script/font/beacon is a
CSP violation first and a review rejection second (**L-23**).
Verified by `test/api.test.js` → *"sends hardened security headers"* and by
`e2e/dashboard.spec.mjs` → *"sends hardened security headers"*.

### 3.4 Rate limiting & anti-bot

| property | value | source |
| --- | --- | --- |
| implementation | dependency-free fixed-window limiter | `lib/limits.js` |
| scope | `/api` routes only (static assets unlimited) | `server.js` |
| default budget | **240 requests / 60 s / IP** (`RATE_LIMIT_MAX`) | `server.js` |
| response | `429` + `Retry-After`, plus `X-RateLimit-Limit/Remaining/Reset` | `lib/limits.js` |
| client IP | `req.ip`, with `trust proxy` defaulting to `loopback` (set `TRUST_PROXY=1` behind a remote proxy) | `server.js`, `.env.example` |
| off switch | `RATE_LIMIT=off` — used only by the E2E harness (`playwright.config.mjs`) and permitted for local QA (**L-17**) | |

Buckets live in a `Map` in process memory: they reset on restart and are not
shared across instances (one of the reasons there is only ever one instance).

### 3.5 URL / scheme allowlist (input side and probe side)

- `validateMonitor()` accepts only `http:`, `https:` and `tcp:` URLs; anything
  else → `400 url must use http, https or tcp`; `tcp://` must parse as
  `tcp://host:port` with port 1–65535.
- `lib/probe.js` re-checks: `probe()` refuses a URL that does not match
  `^https?:` (or is not `tcp`), even if the store was hand-edited.
- Redirects: max **5** hops (`MAX_REDIRECTS`), `Location` resolved with
  `new URL(location, url)`; body read is capped at **1 MB** (`BODY_CAP`) and the
  socket is destroyed at the cap.
- Custom headers: 10 max, 2048 chars max, RFC-token names, and
  `host`/`content-length`/`connection`/`transfer-encoding`/`expect` are dropped
  (`FORBIDDEN_HEADERS`) so a probe cannot smuggle request framing.
- Image/data URLs: `img-src 'self' data:` — no remote image origin at all.

**Accepted and explicit:** an uptime monitor's *job* is to fetch URLs it is
given. See §7.2 (SSRF).

### 3.6 Output encoding

| channel | mechanism | rule |
| --- | --- | --- |
| dashboard DOM | `h()` from `public/js/ui.js`: `text:` → `textContent`, `html:` → `innerHTML` | `html:` is reserved for trusted static markup; there is exactly one `innerHTML` assignment path reachable from view code, and it is fed icons/charts, never user data |
| rare interpolation | `escapeHtml()` (`& < > " '`) | used before a string enters trusted markup |
| SVG badges | `escapeXml()` in `lib/badge.js` on label *and* message; status colour comes from an allowlisted map, `uptime` must be a finite number | label text cannot introduce markup into `image/svg+xml` |
| error strings | rendered as text nodes via `h('…', {text: …})` | probe errors can contain target-controlled text (e.g. a `Location` header) — they never reach `html:` |

The single-`innerHTML` choke point is what makes **L-14** enforceable by
inspection (`ARCHITECTURE.md` §6).

### 3.7 Logging, secrets and PII

- `lib/logger.js` writes `{t, level, message, meta}` (JSON in production,
  pretty otherwise) with `LOG_LEVEL` thresholds; request logs carry
  `id, method, path, status, ms`.
- **No secret reaches a log line today** because no call site passes one:
  notify failures log only `{channel, error: 'HTTP 5xx'}`, probe logs log monitor
  *name* and status numbers, and `/api/health` reports booleans
  (`telegram: true/false`), never values.
- **But there is no redaction layer.** `logger.write()` performs no masking, so
  **L-12 is enforced by call-site discipline, not mechanically** — and
  `requestLogger` records `req.originalUrl` verbatim, so a secret placed in a
  query string *would* be logged. Item **N3** in [`TODO.md`](TODO.md).
- **PII:** the schema has no place to put any (**L-19**) — monitors, incidents
  and settings only (see [`DATABASE.md`](DATABASE.md) §7). No masking helper
  exists in code because nothing to mask exists yet; when PII can arrive (e.g.
  via a webhook body), the required formats are `9876****10` for phones and
  `r**@domain.com` for emails (**L-20**), applied before display, log or export.
- **Exports are currently *not* redacted** — `GET /api/export` returns the full
  state, including custom `headers` (§7.3). L-22 as written is **not met**;
  documented as gap **N4**. Treat an export as sensitive material.

### 3.8 Public status projection — deny by default

`analytics.statusProjection()` builds the payload field-by-field; nothing is
spread from an internal object (**L-13**). The full allowlist is:

```
enabled, title, message, overall, updated,
services[]: name, url|null (tcp → null), status, intervalSec, tags,
            uptime30d, uptime24h, days[]{day, uptime}, responseMs
incidents[≤20]: at, name, type, reason
```

Explicitly **excluded**: monitor `id`, `headers`, `body`, `history`, `rollups`,
`ssl`, `lastCheck`, `consecutiveFailures`, and every **disabled** monitor
(filtered out). Both `/status` and `/api/public/status` answer **404 while the
status page is disabled** (fail-closed default, tested twice: `test/api.test.js`
→ *"status page is disabled by default"*, `e2e/status-page.spec.mjs` → *"returns
404 while disabled"* + *"public projection JSON exposes only allow-listed
fields"*).

### 3.9 Data integrity (security-adjacent)

Atomic `tmp` + `rename`, 250 ms coalesced flush, immediate flush on
delete/import/shutdown, corrupt-file semantics — all in
[`DATABASE.md`](DATABASE.md) §3–§4 (**L-35**, **L-38**). No auth on the file
either: `flush()` does not set a restrictive mode, so on a multi-user host the
file inherits the process umask (commonly `0644`). Keep `data/` on a private
volume.

### 3.10 Dependency & supply-chain posture

| item | value |
| --- | --- |
| runtime dependencies | **2** — `express@^5.2.1`, `compression@^1.8.1` (ADR-0004) |
| hand-rolled instead of shipped | rate limiter, badges, charts, alert fan-out, percentiles |
| dev dependencies (not shipped) | eslint, typescript, commitlint, husky, playwright, `@types/node`, `globals`, `@eslint/js` |
| update cadence | Dependabot weekly (Mon 06:30 IST), runtime minor/patch grouped, majors isolated, 5 open PR limit |
| CVE gate | `npm audit` fails Darwaza 3 on any **high/critical** advisory |
| container | `node:22-alpine`, multi-stage, non-root `app` user, prod-only `pnpm install --frozen-lockfile --prod`, `HEALTHCHECK` against `/api/health` |

### 3.11 Scanning — the Three Darwazas plus Sonar

| gate | file | what it catches | blocks? |
| --- | --- | --- | --- |
| Darwaza 1 — Fast PR | `workflows/ci.yml` | typecheck (2 tsconfigs), lint `--max-warnings=0`, 25 unit tests, static build, Docker build, commitlint (Node 20/22/24) | ✅ required `gate` check |
| Darwaza 2 — Heavy PR | `workflows/e2e-gate.yml` | Playwright (13 specs × desktop+mobile) + **OWASP ZAP baseline** against a freshly built container, seeded with a monitor and the status page enabled | ✅ warning-level ZAP findings fail; info-level does not |
| Darwaza 3 — Nightly | `workflows/security-scan.yml` | **CodeQL v4** (JS/TS, fails on any open error-severity alert), **Semgrep** (`p/security-audit`, `p/javascript`, `p/nodejs`, `--error`), **npm audit** (high/critical) | nightly — opens/updates a `security-nightly` issue, closes it when green |
| Sonar | `workflows/sonar.yml` | maintainability, duplication, coverage, quality gate | non-blocking, files a `sonar-quality-gate` issue |
| local | `.husky/pre-commit` | `npm run typecheck` + `npm run lint` before every commit | ✅ local |

**Never** `continue-on-error`, `|| true`, or a loosened threshold to go green
(**L-34**).

---

## 4 · Verification commands

```bash
pnpm run typecheck      # 0 errors, both tsconfigs      (L-26)
pnpm run lint           # 0 warnings                    (L-27)
pnpm test               # 25/25 incl. CORS + security-header + status-404 + ZAP-policy + store-robustness tests
pnpm run e2e            # 13 specs × 2 projects, incl. allowlist + headers
# grep the source for the negative claims (these must return nothing):
grep -rn "unsafe-inline" server.js public
grep -rn -E "getRequiredEnv|csrf" server.js lib public tools test   # absent today — see §3.1/§3.2
```

---

## 5 · Zero-PII posture

| question | answer |
| --- | --- |
| what personal data is stored? | none — no name, email, phone, account or cookie exists in the schema (**L-19**) |
| is there analytics/telemetry? | no SDK, no beacon, no third-party font or script; CSP would block it (**L-23**) |
| what does a log line contain? | timestamp, level, message, monitor name/URL, status codes, latency, request id |
| is an export safe to attach to a ticket? | **not today** — it contains monitor URLs and any custom headers; see §3.7 (**L-22** gap) |
| what about *targets'* data? | a probe reads at most 1 MB of a response body to evaluate `expectedKeyword` and **discards it** — no response content is ever stored |

---

## 6 · Explicitly OUT of scope

Stated plainly so nobody assumes them into existence (**L-02**, **L-05**):

| not provided | what that means for you |
| --- | --- |
| **authentication / accounts / RBAC** | no login, no session, no API key — *any client that can reach the port has full admin*: create, edit, delete monitors, replace state via `POST /api/import?mode=replace`, enable the status page, and **read monitor `headers` back out**. Verify with `grep -rni "authorization\|cookie\|session" server.js lib/` → the only hit is `lib/notify.js` building an *outbound* `Authorization` header for ntfy; there is no auth middleware anywhere. |
| CSRF token / Origin assertion | see §3.2 — mitigated by "no session exists", not by a token |
| TLS termination | run it behind a proxy or an HTTPS platform edge; HSTS is emitted only when `req.secure` |
| SSRF protection on targets | see §7.2 — the probe will fetch whatever URL it is told to |
| encryption at rest | `data/monitors.json` is plain JSON; custom `headers` are stored in the clear |
| audit log of who changed what | there is no "who" |
| multi-tenancy / per-user isolation | one fleet, one file, one trust domain |
| secret redaction & export redaction | §3.7 — discipline today, mechanism pending |
| WAF / bot management | the built-in limiter is per-process and in-memory |
| a security-disclosure file | ✅ [`docs/SECURITY.md`](../docs/SECURITY.md) — threat model, env-knob table, weakness ranking and the disclosure channel (added 2026-10-07) |

**Deployment rule that follows from the table:** bind the port to a private
network, a reverse proxy with its own auth, `localhost`, or a platform with an
access layer. Exposing `:3000` to the internet exposes *the entire control
plane*, not just the status page. `HOST=0.0.0.0` (Docker/PM2 default) assumes
you meant that.

---

## 7 · Known weaknesses, ranked (L-05 — the inconvenient parts)

### 7.1 No authentication on the API — by omission, not by design

`ARCHITECTURE.md` §9 justifies "no auth on `/status`" (payload is an allowlist
with no secrets). It does **not** justify the admin API, and none exists: the
middleware chain is `securityHeaders → compression → requestLogger → rateLimit
→ json → static → routes`. Anyone with network reach can rewrite the fleet and
read stored bearer tokens out of `headers`. *Trade-off accepted* for
zero-friction self-hosting; the honest mitigations are network-level. Adding
optional auth (reverse-proxy header, basic auth, or a single admin token) is a
**Next**-tier item with an ADR — it must not silently break `/api/health`
container probes or the ZAP/E2E harness.

### 7.2 SSRF is inherent to the product

`POST /api/monitors` fires `checkNow()` immediately (`server.js`), so the
server fetches attacker-supplied URLs including `http://169.254.169.254/…`
cloud metadata or internal admin panels. The scheme allowlist (§3.5) does not
stop this — nor could it: probing internal services is a legitimate use case.
Mitigations available today: keep the port private, restrict container egress.
A target allow/deny list would trade away the product's core flexibility;
documented as a **Later** option, not a promise.

### 7.3 Stored credentials are readable

A monitor `headers.authorization` value is returned by `GET /api/monitors`,
included in `GET /api/export`, and written plaintext to disk. Any future
redaction must not break the edit form (the dashboard round-trips headers), so
it needs a design decision — ADR, then N4.

### 7.4 Rule-to-code drift (the rules are ahead of the code)

| law | claims | reality in code today |
| --- | --- | --- |
| L-11 | `getRequiredEnv()` for every sensitive value | absent (§3.1) |
| L-12 | redaction at the logger | absent (§3.7) |
| L-16 | CSRF token or same-origin enforcement | absent (§3.2) |
| L-20 | PII masking helpers | no helper exists (nothing to mask yet) |
| L-22 | exports are redacted exports | export is verbatim (§3.7) |

Each row has a matching item in [`TODO.md`](TODO.md). Until they land, this
file — not the law text — describes the shipped behaviour.

---

## 8 · Reporting a vulnerability

Open a private security advisory / issue on
`https://github.com/SudhirDevOps1/NovaPulse/issues` with reproduction steps and
the commit that shows the behaviour. Do not file exploits against deployments
you do not own. The disclosure page lives at
[`docs/SECURITY.md`](../docs/SECURITY.md) §2 and links back here.
