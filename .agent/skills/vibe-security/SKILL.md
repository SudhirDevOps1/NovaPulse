---
name: vibe-security
description: >-
  Vulnerability-hunting workflow for the NovaPulse codebase — fail-closed env,
  inline fallback secrets, XSS/escaping, URL scheme allowlist, CSRF, rate limit,
  secrets in logs and PII — with the exact commands that must be green before a
  finding is reported.
---

# 🔍 vibe-security — vulnerability hunting in NovaPulse

> Skill pack member. Applies **Part B (L-09…L-18)** and **Part C (L-19…L-24)** of the canonical rulebook [`.ai/RULES.md`](../../../.ai/RULES.md) to a concrete diff or to the whole tree. Companion skills: [`vibe-security-audit`](../vibe-security-audit/SKILL.md) (full audit routine), [`vibe-proof`](../vibe-proof/SKILL.md) (evidence format).

## When to use

- Before opening a PR that touches `server.js`, `lib/`, `public/js/`, or anything that reads `process.env`.
- When reviewing someone else's diff for the security laws (L-09…L-24).
- When a scanner (CodeQL / Semgrep / ZAP) reports something and you must decide whether it is real.
- After adding any endpoint, alert channel, or user-controlled field.

## Inputs

| input | where it lives |
| --- | --- |
| the diff under review | `git diff main...HEAD` |
| the 43 Golden Laws (Parts B + C) | [`.ai/RULES.md`](../../../.ai/RULES.md) |
| route table + validation | [`server.js`](../../../server.js) |
| storage + public projection | [`lib/store.js`](../../../lib/store.js), [`lib/analytics.js`](../../../lib/analytics.js) |
| DOM escape hatch | [`public/js/ui.js`](../../../public/js/ui.js) (`h()`, `escapeHtml()`) |
| known incidents | [`.ai/BUGS.md`](../../../.ai/BUGS.md) |

---

## Procedure

### Step 1 — Fail-closed env (L-09, L-11)

Security-relevant switches must default to the **safe** value and refuse to operate when unusable:

```bash
rg -n "process\.env\.[A-Z_]+" server.js lib public tools
```

Verify each hit is one of: an optional feature with an honest empty (`TELEGRAM_BOT_TOKEN` unset ⇒ channel off, `channelStatus()` reports it), a **safe** default (`ALLOW_FRAMING` unset ⇒ `frame-ancestors 'none'`, `TRUST_PROXY` ⇒ `loopback`, `RATE_LIMIT` ⇒ on), or a value that must crash the process when missing in production.

> **Known gap to check against:** L-11 names `getRequiredEnv()` as the single accessor for sensitive values, but no such helper exists anywhere in `lib/` or `server.js` today (the only occurrence of the name is inside `.ai/RULES.md`). Any *new* credential read must introduce or use such an accessor, or the deviation must be written up as an ADR in [`.ai/DECISIONS.md`](../../../.ai/DECISIONS.md).

### Step 2 — Inline fallback secrets (L-10)

Current state is documented as **0** inline fallbacks (`.ai/CONTEXT.md` §8) — your job is to keep it at 0:

```bash
rg -n "(\|\||\?\?)\s*['\"][A-Za-z0-9_\-]{8,}['\"]" server.js lib public tools test
rg -ni "(token|secret|password|api[_-]?key)\s*[:=]\s*['\"][^'\"]+['\"]" server.js lib public tools
rg -ni "(ghp_|sk-[a-z0-9]|xox[bap]|AKIA[0-9A-Z]{16}|1[0-9]{9}:AA[0-9A-Za-z_-]{30})" . -g '!node_modules' -g '!*lock*'
```

Numeric/non-secret fallbacks such as `Number(process.env.RATE_LIMIT_MAX) || 240`
or `PORT || 3000` are fine; a credential-shaped fallback is an immediate
finding — delete it and log it in `.ai/BUGS.md`.

### Step 3 — XSS and output encoding (L-14)

There is exactly one `innerHTML` path, in `h()`:

```bash
rg -n "innerHTML|html:|escapeHtml" public/js
```

Expected call sites: `public/js/ui.js` (the `html:` branch of `h()`,
`escapeHtml()` at line 140, the static `SVG_CLOSE` icon), and the chart/icon
builders in `views.js`, `monitors.js`, `icons.js`, `app.js`. For each hit
confirm the payload is **static markup or numeric-only data** (SVG coordinates
from computed numbers). Anything derived from a monitor `name`, `url`,
`expectedKeyword`, tag or incident text must go through `text:` or
`escapeHtml()`. `html:` receiving user input is a blocked review.

### Step 4 — URL and image scheme allowlist (L-15)

```bash
rg -n "new URL|protocol|https?:|data:image|javascript:" server.js lib public/js
```

`validateMonitor()` in `server.js` is the single ingress for user URLs: only
`http:`/`https:` are accepted (plus `tcp:` for TCP probes); anything else
produces a 400. Confirm no new field bypasses it, and that no renderer ever
writes an unvalidated URL into `href`, `src` or CSS `url()`.

### Step 5 — CSRF on mutating routes (L-16)

```bash
rg -n "app\.(post|patch|put|delete)" server.js
rg -n "ALLOW_ORIGIN|Access-Control" server.js
```

The six mutating routes (`POST /api/monitors`, `PATCH|DELETE /api/monitors/:id`,
`POST /api/monitors/:id/check`, `POST /api/import`, `PATCH /api/settings`) rely
on same-origin enforcement: JSON-only bodies (`express.json({limit:'64kb'})`
rejects form encodings a cross-site page can send), no CORS headers unless the
operator sets `ALLOW_ORIGIN`, and `form-action 'self'` in the CSP. A new
mutating route must keep all three properties — never mount it behind a
permissive `ALLOW_ORIGIN` and never accept form-encoded bodies.

### Step 6 — Rate limit and anti-bot (L-17)

```bash
rg -n "RATE_LIMIT" -g '!node_modules' -g '!pnpm-lock.yaml' .
```

Expected hits: `lib/limits.js` (the gate), `server.js` (mounted on `/api`,
240 req/min/IP with `X-RateLimit-*` and 429 + `Retry-After`), `.env.example`
(documented), `playwright.config.mjs` (`off`, test-only — allowed). Any
Dockerfile, compose file, workflow or shipped default that sets `RATE_LIMIT=off`
is a finding.

### Step 7 — Secrets in logs (L-12)

```bash
rg -n "logger\.(error|warn|info|debug)\(" server.js lib
rg -n "process\.env\.(TELEGRAM|DISCORD|NTFY|WEBHOOK|.*TOKEN|.*SECRET)" server.js lib public
```

No log call may pass a token, webhook URL with credentials, or an
`Authorization`-shaped value. `lib/logger.js` has **no redaction layer** —
redaction therefore has to happen at the call site: never hand the logger a
secret in the first place. Also check `requestLogger` (logs `req.originalUrl`):
no route may accept a credential via query string.

### Step 8 — PII (L-19…L-24)

```bash
rg -ni "\bemail\b|\bphone\b|password|ssn|dob\b" server.js lib public/js
```

The store holds monitor URLs, check results and incidents only. Confirm the CSV export (`/api/monitors/:id/checks.csv`) keeps its fixed four columns, that `/api/export` output contains no env-derived values, and that the public projection allowlist in `e2e/status-page.spec.mjs` (`enabled, title, message, overall, services, updated, incidents`) still passes.

### Step 9 — Run the gates (all must exit 0)

```bash
pnpm install --frozen-lockfile
pnpm run typecheck     # tsc --noEmit + tsc --noEmit -p tsconfig.sw.json
pnpm run lint          # eslint . --max-warnings=0
pnpm test              # node --test — 25/25 expected
pnpm run e2e           # Playwright desktop + mobile (Darwaza 2 locally)
```

Optional SAST — Darwaza 3 runs this nightly; no Semgrep config file is committed, the rule packs are fetched by name (needs network once):

```bash
npx semgrep scan --config p/security-audit --config p/javascript --config p/nodejs \
  --error --metrics=off lib public tools server.js test
pnpm audit             # Darwaza 3 fails on any high/critical advisory
```

`semgrep.sarif` (what the nightly writes), `semgrep-report.json` (a manual
`--json` run) and `npm-audit-report.json` are gitignored — never commit them.

---

## Reporting a finding

Never report a scan hit you have not reproduced. Report format:

| field | content |
| --- | --- |
| ID | `SEC-YYYY-NNN` (internal) or GitHub Security Advisory (exploitable) |
| severity | Critical / High / Medium / Low / Info — ranking table in [`vibe-security-audit`](../vibe-security-audit/SKILL.md) |
| law | the violated law ID, e.g. `L-10` |
| location | `file:line` |
| evidence | exact command + verbatim output (L-04) |
| impact | what an attacker gains, plainly (L-05: also state the cost of the fix) |
| fix | smallest change that closes it |

Routing: **exploitable** issues go through a private [GitHub Security Advisory](https://github.com/SudhirDevOps1/NovaPulse/security/advisories) ([`docs/SECURITY.md`](../../../docs/SECURITY.md)) — never a public issue, never a pasted live secret. Non-exploitable hardening work may be a public issue with the `security` label. Every confirmed finding is also recorded in `.ai/BUGS.md` (`ID → symptom → root cause → fix`).

## Definition of done

- [ ] All 8 check groups executed against the actual diff, each with a command shown.
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm test` exit 0; `pnpm run e2e` green if UI changed.
- [ ] Zero inline fallback secrets; zero secrets/PII in any log line or export.
- [ ] Every finding reproduced with verbatim output and routed per the table above.
- [ ] New/changed behaviour reflected in `.ai/CHANGELOG.md` (L-42) and docs synced (L-32).

## References

- [`.ai/RULES.md`](../../../.ai/RULES.md) — Part B (L-09…L-18), Part C (L-19…L-24)
- [`.github/workflows/security-scan.yml`](../../../.github/workflows/security-scan.yml) — Darwaza 3 scanners
- [`.github/workflows/e2e-gate.yml`](../../../.github/workflows/e2e-gate.yml) — ZAP baseline policy (W fails, I does not)
- [`docs/SECURITY.md`](../../../docs/SECURITY.md) — disclosure process and controls
- [`public/js/ui.js`](../../../public/js/ui.js) — `h()` / `escapeHtml()` contract (`.ai/ARCHITECTURE.md` §6)
