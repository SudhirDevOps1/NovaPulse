# 🔒 NovaPulse — Security Policy

> How to report a vulnerability privately, what this project defends against,
> and how to deploy it safely. The normative rules are
> [`../.ai/RULES.md`](../.ai/RULES.md) Parts **B (L-09…L-18)** and
> **C (L-19…L-24)**; this file is the public-facing description of them.

---

## 1 · Supported versions

Only the **latest release** is supported — fixes land on `main` and ship in the
next release. Versions are read from
[`.release-please-manifest.json`](../.release-please-manifest.json).

| version | supported |
| --- | --- |
| current release (manifest value, e.g. `2026.1.0`) | ✅ yes |
| any older release | ❌ upgrade — no back-porting |

Running from `main` between releases is supported for testing, but it is not a
released artefact: report bugs against the exact commit SHA.

---

## 2 · Reporting a vulnerability — privately

Report through **GitHub Security Advisories** on
[`SudhirDevOps1/NovaPulse`](https://github.com/SudhirDevOps1/NovaPulse/security/advisories):
**Security tab → Report a vulnerability** (private, reaches the maintainers
only, is not published until an advisory is issued).

Include:

1. **What** — affected file/line, route or configuration.
2. **Impact** — what an attacker gains (state corruption, secret disclosure, DoS).
3. **Reproduction** — exact commands and verbatim output
   ([`../.agent/skills/vibe-proof/SKILL.md`](../.agent/skills/vibe-proof/SKILL.md)); a proof-of-concept that uses a
   local, made-up target only.
4. **Environment** — version/commit, Node version, deployment mode (server vs. GitHub Pages).
5. **Suggested fix**, if you have one.

Do **not**: open a public issue for an exploitable flaw, paste live secrets,
tokens or webhook URLs, or include personal data of any kind (L-19/L-21 — logs
and reports are treated as public). Non-exploitable hardening suggestions are
welcome as normal issues with the `security` label.

### Response targets

Stated targets for this project (not a paid SLA):

| severity | first response | mitigation / fix target |
| --- | --- | --- |
| Critical (unauthenticated state corruption, secret disclosure) | 3 business days | 7 days, or a documented workaround |
| High (bypass of a documented control) | 5 business days | 30 days |
| Medium | 10 business days | next release |
| Low / informational | 15 business days | best effort |

You will get an acknowledgement, a severity assessment and either a fix
timeline or a reasoned decline with the design rationale (L-06: we say "we
don't know" early rather than guessing).

---

## 3 · Security controls summary (verified in code)

| control | state |
| --- | --- |
| Content-Security-Policy | `default-src 'self'` · `base-uri 'none'` · `form-action 'self'` · `object-src 'none'` · `script-src 'self'` · `frame-ancestors 'none'` — **no `unsafe-inline`** (`server.js` → `securityHeaders()`) |
| Framing | `X-Frame-Options: DENY` + `frame-ancestors 'none'`; relaxed **only** by `ALLOW_FRAMING=1` (local QA) |
| Other headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin` (badge SVGs answer `cross-origin` so they stay embeddable), `X-DNS-Prefetch-Control: off`, HSTS on TLS, `x-powered-by` disabled |
| Rate limiting | hand-rolled limiter (`lib/limits.js`) on `/api`: **240 req/min/IP** (`RATE_LIMIT_MAX`), `X-RateLimit-*` + `429` with `Retry-After` |
| Input validation | single ingress `validateMonitor()` in `server.js` — URL must be `http:`/`https:`/`tcp:`, length/range/enum limits on every field, JSON body capped at 64 kb, ≤10 custom headers with name/value rules |
| CSRF posture | JSON-only bodies (a cross-site form cannot forge them), no CORS headers unless `ALLOW_ORIGIN` is set, `form-action 'self'` |
| Secrets | environment-only; **0** inline fallback credentials; `.env` is gitignored; alert channels are optional-by-design (empty ⇒ channel off, reported by `channelStatus()`) |
| Output encoding | every node through `h()` in `public/js/ui.js` — `text:` for data, `html:` for trusted static markup only, `escapeHtml()` available |
| Public projection | explicit field allowlist (`enabled, title, message, overall, services, updated, incidents`) asserted by `e2e/status-page.spec.mjs` |
| Status page | **disabled by default** — `/status` and `/api/public/status` return 404 until an operator opts in |
| Badges | SVG only, content-type enforced, unknown monitor ⇒ 404 (no fake 200) |
| Static serving | `dotfiles: deny`, HTML `no-cache`, assets revalidated |
| PII | none stored (monitor URLs, checks, incidents only); no third-party telemetry or CDNs |
| Dependencies | **2** runtime packages (`express`, `compression`); everything else hand-rolled (ADR-0004) |
| Data | single JSON file, atomic temp+rename writes, single-writer (`ecosystem.config.js` → `instances: 1`) |
| Auth | **none built in** — see §6 |

### Automated scanning (the Three Darwazas)

| darwaza | workflow | what it runs | gate |
| --- | --- | --- | --- |
| 1 · Fast PR Gate | `ci.yml` | typecheck, lint (`--max-warnings=0`), tests, build, Docker build, commitlint | blocks merge (`gate`) |
| 2 · Heavy PR Gate | `e2e-gate.yml` | Playwright desktop + mobile, **OWASP ZAP baseline** (passive) | blocks merge; any ZAP risk 1–3 (Low/Medium/High) finding fails via `tools/zap-policy.js`, risk 0 (Informational) is reported only |
| 3 · Nightly Deep Audit | `security-scan.yml` | CodeQL v4 (fails on open `error` alerts), Semgrep (`p/security-audit`, `p/javascript`, `p/nodejs`), npm audit (fails on high/critical) | nightly + manual; failure opens/updates a `security-nightly` issue |

Artifacts from a run (`semgrep-report`, `npm-audit-report`, `zap-baseline-report`,
`playwright-report`) are retained **14 days** on the workflow run.

---

## 4 · Hardening and deployment guidance

Environment template: [`.env.example`](../.env.example) (copy to `.env`;
Compose loads it). Everything there is optional — the safe values are the ones
shipped.

| variable | production value | why |
| --- | --- | --- |
| `NODE_ENV` | `production` | JSON logging, production behaviour |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | bind inside the container only; never publish extra ports |
| `UPTIME_DATA_DIR` | volume path (`/app/data` in Docker) | state must survive restarts; back it up (see below) |
| `LOG_FORMAT` | `json` | machine-parseable; `pretty` is for terminals |
| `TRUST_PROXY` | `1` behind Render/Fly/Nginx, otherwise `loopback` | without it, rate-limit keys see the proxy IP and every client shares one bucket |
| `ALLOW_ORIGIN` | **unset** | setting it exposes the API cross-site — only for a genuine cross-origin integration, and only with the exact origin list |
| `RATE_LIMIT` | **unset (on)** | see §5 — never `off` in production |
| `RATE_LIMIT_MAX` | `240` | raise deliberately, not casually |
| `TELEGRAM_*`, `DISCORD_WEBHOOK_URL`, `NTFY_*`, `WEBHOOK_URL`, `WEBHOOK_SECRET` | set via environment / secret manager | never in code, commits or images; `WEBHOOK_SECRET` is sent as the `x-novapulse-secret` header (`lib/notify.js`) |
| `SSL_WARN_DAYS` / `SLA_TARGET` / `ALERT_ON_DEGRADED` | `14` / `99.9` / unset | alerting policy, not security |
| `ALLOW_FRAMING` | **never set** | relaxes `frame-ancestors` — local QA only |
| `ALLOW_PRIVATE_TARGETS` | **never set** | disables the SSRF guard (`lib/probe.js`) so probes may hit loopback/RFC-1918/link-local/metadata addresses — local QA only (see §5) |
| `ALERT_COOLDOWN_MS` | `300000` | per-monitor alert cooldown; `0` disables it, which invites alert floods |

Deployment checklist:

1. **Terminate TLS in front** (Nginx/Caddy/platform) and proxy to `127.0.0.1:3000`; HSTS is emitted automatically when `req.secure`.
2. **One process, one volume** — never scale the JSON store horizontally (L-39).
3. **Put authentication in front if the instance is reachable beyond your LAN** (see §6): reverse-proxy basic auth, SSO or a VPN.
4. **Back up with `/api/export`** on a schedule; the export is state only, but treat it as sensitive configuration (it contains your monitored URLs and headers).
5. **Keep the container image built from this repo's `Dockerfile`** — CI validates the build on every PR but publishes no image, so `docker pull` of an unverified third-party tag is out of scope for this policy.
6. **Keep `pnpm install --frozen-lockfile` results fresh** and let Darwaza 3's npm-audit gate surface high/critical advisories.

---

## 5 · Safe configuration defaults

| default | state | rule |
| --- | --- | --- |
| Rate limit | **on**, 240 req/min/IP | `RATE_LIMIT=off` is permitted **only** for local QA/E2E (`playwright.config.mjs` sets it inside the test server). It must never appear in a Dockerfile, compose file, shipped config or production environment (L-17). |
| Framing | denied (`frame-ancestors 'none'`) | `ALLOW_FRAMING=1` is local-only and must be noted as such whenever used (L-18). |
| CORS | off (no `Access-Control-Allow-Origin`) | add `ALLOW_ORIGIN` only for a known cross-site caller. |
| Status page | disabled → 404 | enabling it publishes the allowlisted projection to the internet without auth — read §6 first. |
| Inline script/CSP | strict, no `unsafe-inline` | never relax the CSP for a demo; there is no third-party script or font exception (L-23). |
| Secrets | environment only | zero inline fallbacks is a permanent invariant (L-10) — a `|| "fallback"` credential is a reportable defect. |
| Retention | bounded (500 raw points, 720 hourly rollups, 500 incidents) | raising a cap needs an ADR (L-24). |
| Probe targets | private/loopback/link-local/metadata addresses refused | `resolveTarget()` pre-resolves the hostname and pins every connection (including redirects) to a vetted public address; only `http`/`https` are followed. `ALLOW_PRIVATE_TARGETS=1` opts out for local QA — never in production. |

---

## 6 · Design notes (what this product deliberately does not do)

- **No built-in authentication.** `server.js` exposes no login, session or API-key route: anyone who can reach the HTTP port can read and mutate monitors. This is an accepted design for a self-hosted tool on a private network (ADR-0001/ADR-0002 territory) — **exposing it publicly without a fronting auth layer is a deployment error, not a product bug.**
- **The status page is public by design.** Its payload is an allowlist with no secrets; enabling it is an explicit operator choice and it 404s until then.
- **Single writer.** Multiple instances against one `data/` directory corrupt state; PM2 pins `instances: 1`.
- **Availability degrades, security halts** (L-09): a missing alert channel or an unreadable data file is logged and survived; a security check that cannot run must stop the process.

---

## References

- [`../.ai/RULES.md`](../.ai/RULES.md) — Part B (fail-closed security), Part C (zero PII), Enforcement Map
- [`../.ai/ARCHITECTURE.md`](../.ai/ARCHITECTURE.md) — §6 rendering contract, §7 failure semantics
- [`.env.example`](../.env.example) — the annotated configuration template
- [`.github/workflows/security-scan.yml`](../.github/workflows/security-scan.yml) · [`e2e-gate.yml`](../.github/workflows/e2e-gate.yml) · [`ci.yml`](../.github/workflows/ci.yml)
- [`../.agent/skills/vibe-security/SKILL.md`](../.agent/skills/vibe-security/SKILL.md) · [`../.agent/skills/vibe-security-audit/SKILL.md`](../.agent/skills/vibe-security-audit/SKILL.md)
- [`RULES.md`](RULES.md) — daily-work rulebook · [`RELEASE.md`](RELEASE.md) — release gates
