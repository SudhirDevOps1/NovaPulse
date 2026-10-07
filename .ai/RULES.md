# 🛡️ NovaPulse — 43 Golden Laws

> **Canonical rulebook for every human and every agent working in this repository.**
> These laws are not aspirational. Each one is either enforced by an automated
> gate (CI, lint, typecheck, test) or by a mandatory step in the
> 7-Step Execution Lifecycle. If a law cannot be enforced by tooling, it is
> enforced by `.ai/PROMPTS/REVIEW.md` before any change is merged.
>
> **Precedence:** Law > individual preference > aesthetic taste.
> Violating a law requires an ADR in `.ai/DECISIONS.md` with `Status: Accepted`.

---

## Part A — Truth & Anti-Yes-Man (Laws 1–8)

### L-01 · Anti-Yes-Man Principle — "Haan me haan mat milana"
Never blindly agree with the user. Before endorsing any feature, change or
architecture claim, perform real research against the live codebase and state
the technical truth — including the parts that are inconvenient. If the request
is wrong, say so plainly and propose the correct alternative. Agreeing to ship
something you know is broken is a fireable offense in this repo.

### L-02 · No Vaporware
Never describe a capability that does not exist in `main` as if it does. If it
is not merged, it is not shipped. Future work goes in `.ai/TODO.md`, not in
release notes or README feature lists.

### L-03 · No Fake Demos
Every demo, screenshot, benchmark and sample output must come from a real run
of the real code. Hand-written expected output that "shows what it would look
like" is forbidden. Verify, then show.

### L-04 · Evidence Before Claim
"Should work", "this fixes it", and "I tested it mentally" are not acceptable.
A claim of correctness requires a reproducible command and its actual output
attached to the change or the comment.

### L-05 · Surface Trade-offs Frankly
Every recommendation must state what it costs: latency, memory, complexity,
lock-in, maintenance burden, operational risk. A recommendation without a
stated downside is incomplete and will be rejected in review.

### L-06 · Say "I Don't Know" Early
If the answer is uncertain, say so and go verify. Do not paper over gaps with
confident prose. Uncertainty declared early is cheap; a wrong confident answer
discovered in production is not.

### L-07 · No Scope Inflation
Do not add libraries, abstractions, layers or files that the stated task does
not require. Every added dependency is a liability on the balance sheet of this
repository.

### L-08 · Question Premises
If a request assumes a fact about the system that is false (wrong route name,
non-existent config, a "bug" that is intended behaviour), stop and correct the
premise before executing. Executing on a false premise produces confident,
wrong work.

---

## Part B — Fail-Closed Security (Laws 9–18)

### L-09 · Fail-Closed, Never Fail-Open
When a security check cannot be performed — missing secret, unreadable config,
expired token, unparseable allowlist — the system must **refuse to operate**.
Never fall back to a permissive default. A crash at boot is a feature; a
running system with a null cipher is an incident.

### L-10 · Zero Inline Fallback Secrets
No `|| "default_secret"`, no `?? "mock_key"`, no hardcoded credential, token,
API key or password anywhere in source. Not in code, not in tests, not in
docs, not in workflow YAML. If you see one, delete it and log it in
`.ai/BUGS.md`.

### L-11 · `getRequiredEnv()` for Every Sensitive Value
All credentials are read through a single accessor that throws when the key is
absent or empty. In production a missing secret must crash the process
immediately with a clear message naming the missing key — not silently
degrade, not skip the feature, not continue unauthenticated.

### L-12 · Never Log a Secret
Redaction happens at the logger, not at the call site. Anything matching a
credential shape (tokens, `Authorization`, webhook URLs with keys, bot tokens)
is masked before it reaches a transport, a file, or stdout.

### L-13 · Deny by Default on the Public Surface
The public status projection returns an explicit allowlist of fields. Adding a
field to the public payload requires a conscious edit to that allowlist —
never spread an internal object into a public response.

### L-14 · Strict Output Encoding
Anything rendered into HTML goes through `escapeHtml()` (or is set via the
`text:` property of `h()`). `html:` is reserved for trusted, statically-known
markup only and must never receive user input.

### L-15 · URL and Image Scheme Allowlist
`https:`, `http:`, and safe `data:image/` (with quote-escape validation) only.
`javascript:`, `vbscript:`, `data:text/html`, and protocol-relative tricks are
blocked outright. Validate on the way in; do not rely on the browser.

### L-16 · CSRF Defence on Every Mutating Route
All `POST`/`PATCH`/`PUT`/`DELETE` endpoints require token verification or
same-origin enforcement. A new mutating route without CSRF handling is a
blocked review.

### L-17 · Anti-Bot and Rate Limit
The built-in rate limiter is on by default and must stay on in production.
Disabling it (`RATE_LIMIT=off`) is permitted only for local QA and must never
be the default in any shipped config, Dockerfile, or compose file.

### L-18 · Security Headers Are Not Optional
`Content-Security-Policy` (no `unsafe-inline`), `frame-ancestors 'none'`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`
and `Permissions-Policy` are set on every response. Relaxing them for a demo
requires `ALLOW_FRAMING=1` **and** an explicit note that it is local-only.

---

## Part C — Zero PII (Laws 19–24)

### L-19 · Zero PII in State
NovaPulse stores monitor URLs, check results and incidents. It must never
store customer names, email addresses, phone numbers, or any identifier that
can be linked to a person.

### L-20 · Mask PII in All Output
If PII ever reaches the system, it is masked before display or logging:
`9876****10` for phones, `r**@domain.com` for emails. Raw values never appear
in a log line, a toast, an export, or a badge.

### L-21 · Logs Are Public-ish
Write every log line as if it will be pasted into a public GitHub issue.
No secrets, no PII, no internal hostnames that are not already public.

### L-22 · Exports Are Redacted Exports
`/api/export` and CSV downloads pass through the same masking rules as logs.
An export file must be safe to attach to a ticket.

### L-23 · No Third-Party Telemetry
No analytics SDK, no error-reporting beacon, no third-party font or script.
The CSP already forbids it; do not add an exception.

### L-24 · Retention Is Bounded
History is capped (500 raw points, 720 hourly rollups, 500 incidents per the
limits in `.ai/DATABASE.md`). Raising a cap requires an ADR with a memory and
disk projection attached.

---

## Part D — Zero-Defect Quality Gate (Laws 25–34)

### L-25 · The 7-Step Lifecycle Is Mandatory
Plan & Research → Code → Typecheck → Lint → Tests → Verification Guide →
Atomic Conventional Commit. No step may be skipped, and no commit may be
produced before the previous six have passed.

### L-26 · Typecheck Must Be Clean
`pnpm run typecheck` exits 0. Zero errors, in both `tsconfig.json` and
`tsconfig.sw.json`. Type errors are not "warnings to deal with later".

### L-27 · Lint Must Be Silent
`pnpm run lint` exits 0 with `--max-warnings=0`. A warning is a failure.

### L-28 · Tests Must Be 100% Green
`pnpm test` passes fully. A flaky test is a bug in the test — fix it or delete
it, never re-run until it passes.

### L-29 · No Placeholders
Zero `// TODO`, zero `FIXME`, zero `lorem ipsum`, zero stub functions that
return canned data, zero commented-out blocks kept "for later". If it is not
needed, remove it; if it is needed, implement it.

### L-30 · No Mock Data in Non-Test Code
Production code paths never return fabricated data. Fallbacks must be honest
empties (`null`, `[]`, `'unknown'`), never invented values that look real.

### L-31 · Atomic Conventional Commits
Every commit is `type(scope): subject` from the enum in
`commitlint.config.mjs`. One logical change per commit. The scope must be one
of: `api probe store analytics notify checker ui dashboard status security ci
docs deps release monitor tools`.

### L-32 · Docs Sync After Every 3–4 Changes
After every 3–4 features, bug fixes or refactors — and always before a release
— synchronise **all** of `.ai/CONTEXT.md`, `.ai/CHANGELOG.md`, `.ai/BUGS.md`,
`.ai/DECISIONS.md` and `.ai/TODO.md`. The system must never run with stale
documentation. This happens automatically, without being asked.

### L-33 · Three Darwazas Must Stay Green
`ci.yml` (merge blocker), `e2e-gate.yml` (E2E + ZAP) and `security-scan.yml`
(nightly) are all part of the definition of done. A change is not done because
it works locally; it is done when all three gates pass.

### L-34 · Never Disable a Gate to Get Green
No `continue-on-error: true`, no `|| true`, no skipping a job, no loosening a
threshold to make CI pass. Fix the underlying problem. If a gate is genuinely
wrong, that is an ADR, not a hotfix.

---

## Part E — Data Integrity (Laws 35–39)

### L-35 · Zero Data Loss
Every write is atomic: write to a temp file, then rename. Never truncate the
real file before the new content is fully written. A crash mid-write must
leave the previous good state intact.

### L-36 · Schema Changes Are Auto-Migrating
`CREATE TABLE IF NOT EXISTS` / add-field-if-missing semantics for every store.
Reads normalise missing fields to safe defaults instead of throwing. No manual
migration step exists, and none may be introduced.

### L-37 · Migrations Are Non-Destructive
No operation may delete or overwrite user data. Shrinking, renaming or
restructuring stored state requires an export-first backup path and an entry
in `.ai/DATABASE.md`.

### L-38 · Isolated Failure Per Statement
Each independent schema/state statement runs in its own `try/catch`. One
warning must never block the remaining statements. Boot continues past a
recoverable state error, but fails closed on a security error (see L-09).

### L-39 · Single-Writer Discipline
The JSON store is single-process, single-volume. Never run more than one
instance against the same `data/` directory — this is why `ecosystem.config.js`
pins `instances: 1`.

---

## Part F — Process & Communication (Laws 40–43)

### L-40 · Notify on Save and State Change
Every user-visible mutation produces feedback: a toast on success, an inline
error on failure. A save that produces no notification is treated as a
**failed save**, regardless of what the API returned. (This law exists because
it was violated — see `.ai/BUGS.md` → `BUG-2026-0001`.)

### L-41 · Read Before You Write
Analyse the existing structure, naming conventions and patterns before adding
a file. Match them. Never introduce a second way of doing something that
already has an established way.

### L-42 · Change Nothing Silently
Every modification to shipped behaviour must be visible in `.ai/CHANGELOG.md`
and, when it is a judgement call, justified in `.ai/DECISIONS.md`. No silent
behaviour changes.

### L-43 · Leave It Better
When you touch a file, leave it measurably better than you found it: clearer
name, one fewer branch, one more test, one fewer dead path. If you cannot
improve it, at minimum do not degrade it.

---

## Enforcement Map

| Law group | Enforced by |
| --- | --- |
| A — Truth & Anti-Yes-Man | `.ai/PROMPTS/REVIEW.md`, PR review |
| B — Fail-Closed Security | `security-scan.yml`, CodeQL, Semgrep, ZAP |
| C — Zero PII | `security-scan.yml`, `docs/SECURITY.md`, review |
| D — Zero-Defect Gate | `ci.yml`, `.husky/pre-commit`, `eslint`, `tsc` |
| E — Data Integrity | `test/api.test.js`, `.ai/DATABASE.md` |
| F — Process & Communication | `.ai/PROMPTS/*`, `.ai/CONTEXT.md` sync |

See also: [docs/RULES.md](../docs/RULES.md) (human-facing rulebook) ·
[.ai/PROMPTS/MASTER_SYSTEM.md](PROMPTS/MASTER_SYSTEM.md) (agent persona).
