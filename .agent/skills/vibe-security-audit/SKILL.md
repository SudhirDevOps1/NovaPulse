---
name: vibe-security-audit
description: >-
  Full security-audit routine for NovaPulse — scope, triage, severity ranking,
  use of the Three Darwazas and security-scan.yml artifacts, and the exact
  output format of an audit report.
---

# 🛡️ vibe-security-audit — full audit routine

> Skill pack member. This is the *scheduled / whole-tree* counterpart of
> [`vibe-security`](../vibe-security/SKILL.md) (per-diff hunting). It turns
> scanner output from the Three Darwazas plus manual review into a single
> ranked report. Rulebook: [`.ai/RULES.md`](../../../.ai/RULES.md) Parts B + C.

## When to use

- Before a release (it is part of the pre-release checklist in
  [`docs/RELEASE.md`](../../../docs/RELEASE.md)).
- When Darwaza 3 goes red overnight, or a `security-nightly` issue is opened.
- On a fixed cadence (e.g. monthly) or on demand via
  `workflow_dispatch` on `.github/workflows/security-scan.yml`.

## Inputs

| input | source |
| --- | --- |
| current tree / SHA | `git rev-parse HEAD` |
| Darwaza 1 result | `.github/workflows/ci.yml` → job `gate` |
| Darwaza 2 result | `.github/workflows/e2e-gate.yml` → jobs `e2e`, `zap` |
| Darwaza 3 result | `.github/workflows/security-scan.yml` → `codeql`, `semgrep`, `npm-audit` |
| scanner artifacts | Actions run → Artifacts (14-day retention) |
| review checklist | [`vibe-security`](../vibe-security/SKILL.md) Steps 1–8 |

---

## Procedure

### 1 · Scope

Audit exactly these surfaces — nothing invented, nothing skipped:

| surface | path | why it is in scope |
| --- | --- | --- |
| HTTP app + validation | `server.js` | every route, every `req.body` |
| domain / probing | `lib/*.js` (8 files) | outbound requests, notify fan-out |
| dashboard (L5) | `public/js/` (9 files), `public/*.html` | the only `innerHTML` path |
| persistence | `lib/store.js`, `data/` | single-writer JSON store |
| CI supply chain | `.github/workflows/*.yml`, `Dockerfile`, `docker-compose.yml` | gate integrity (L-34), image build |
| dependencies | `package.json`, `pnpm-lock.yaml` | 2 runtime deps, dev-tool chain |
| public surface | `/status`, `/api/public/status`, `/api/badge/:id.svg` | unauthenticated by design |

Out of scope: third-party hosts, operator infrastructure, and anything not in
this repository — say so explicitly in the report.

### 2 · Collect evidence from the three Darwazas

```bash
# Darwaza 1 — merge blocker (also run locally before the audit)
pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run lint && pnpm test

# Darwaza 2 — E2E + DAST (Playwright + ZAP baseline) is CI-only; fetch its artifacts
gh run list --workflow e2e-gate.yml --limit 5
gh run download <run-id> --name zap-baseline-report
gh run download <run-id> --name playwright-report

# Darwaza 3 — nightly SAST + CVEs
gh run list --workflow security-scan.yml --limit 5
gh run download <run-id> --name semgrep-report
gh run download <run-id> --name npm-audit-report

# CodeQL results live in the Security tab, not in artifacts
gh api repos/SudhirDevOps1/NovaPulse/code-scanning/alerts --jq \
  '.[] | select(.state=="open") | [.severity,.rule.id,.most_recent_instance.location.path] | @tsv'
```

Gate policies to apply when interpreting output (from the workflow files):

| scanner | hard gate | reported-only |
| --- | --- | --- |
| CodeQL v4 | open alerts with severity `error` fail the job | warning/note alerts |
| Semgrep (`p/security-audit` + `p/javascript` + `p/nodejs`) | `--error` ⇒ any finding fails | — |
| npm audit | `high` + `critical` counts > 0 fails | moderate/low |
| ZAP baseline | risk 1–3 (Low/Medium/High) findings in `report_json.json`, enforced by `tools/zap-policy.js` | risk 0 (Informational) |
| Playwright | any failed test fails | — |

### 3 · Triage

For every candidate: reproduce it first (L-04), then ask three questions in
order — (a) is it reachable from an untrusted input? (b) does the code as
written actually fail-open, or does the surrounding check neutralise it? (c)
which law does it violate? A scanner hit that cannot be reproduced and explained
is recorded as *informational*, never as a finding.

### 4 · Severity ranking

| severity | definition (this codebase) | example class |
| --- | --- | --- |
| **Critical** | unauthenticated attacker reads secrets/PII, corrupts `monitors.json`, or takes the process | secret in a public payload, path traversal into `data/` |
| **High** | attacker mutates state or bypasses a control without auth | CSRF on a mutating route, CSP removed, rate limit off by default |
| **Medium** | control weakened or leak requires unusual conditions | `ALLOW_FRAMING` default, missing validation on a new field, secret in logs |
| **Low** | hardening gap with no direct exploit | header ordering, verbose 500 body |
| **Info** | deliberate design, documented trade-off | no auth on `/status` (allowlisted payload, ADR-0002/0004 territory) |

Rankings must cite the law (`L-09`…`L-24`) and the gate that should have caught
it — a finding that no gate can catch is a gate-design gap, and gets its own row.

### 5 · Remediate and re-prove

Fix the underlying problem; never disable a gate (L-34), never loosen a
threshold to go green. After each fix, re-run the narrowest command that
proves it, per [`vibe-proof`](../vibe-proof/SKILL.md).

---

## Output format — audit report

Write to `.ai/` (or the PR description) using exactly this shape:

```markdown
# Security audit — YYYY-MM-DD · <short SHA>

## 1 · Scope & method
<in-scope table from step 1, scanners run, explicit out-of-scope list>

## 2 · Gate status
| darwaza | workflow | run | result |
| ------- | -------- | --- | ------ |
| 1 Fast PR Gate | ci.yml | <run id / local> | ✅ / ❌ |
| 2 Heavy PR Gate | e2e-gate.yml (e2e, zap) | <run id> | ✅ / ❌ |
| 3 Nightly Deep Audit | security-scan.yml (codeql, semgrep, npm-audit) | <run id> | ✅ / ❌ |

## 3 · Findings
| ID | severity | law | location | evidence (command → output) | gate that catches it | fix |
| -- | -------- | --- | -------- | --------------------------- | --------------------- | --- |
| SEC-YYYY-001 | High | L-10 | <file:line> | <verbatim> | review + CodeQL | <one line> |

## 4 · Verified-clean areas
<checks that ran and found nothing — commands listed, so absence of findings is evidence, not assumption>

## 5 · Artifacts
<artifact names + run URLs: zap-baseline-report, semgrep-report,
 npm-audit-report, playwright-report, CodeQL Security tab>

## 6 · Residual risk & trade-offs (L-05)
<what remains, what a fix costs, what was deliberately not done>

## 7 · Sign-off
<who/what ran it, date, next audit trigger>
```

## Definition of done

- [ ] All three Darwazas' latest results collected, with run IDs, and reproduced locally where the command exists.
- [ ] Every scanner hit reproduced before being called a finding (L-04).
- [ ] Findings ranked with severity + law + `file:line` + verbatim evidence.
- [ ] Absent findings backed by the command that checked for them (negative evidence recorded).
- [ ] No gate, threshold or scan config was weakened to reach green (L-34).
- [ ] Report filed; exploitable issues routed to a private advisory ([`docs/SECURITY.md`](../../../docs/SECURITY.md)); `.ai/BUGS.md` updated (L-32).

## References

- [`.ai/RULES.md`](../../../.ai/RULES.md) — Parts B/C, Enforcement Map
- [`.github/workflows/security-scan.yml`](../../../.github/workflows/security-scan.yml) — Darwaza 3 + issue auto-filing
- [`.github/workflows/e2e-gate.yml`](../../../.github/workflows/e2e-gate.yml) — ZAP baseline and its W/I policy
- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) — Darwaza 1 `gate` job
- [`vibe-security`](../vibe-security/SKILL.md) · [`vibe-proof`](../vibe-proof/SKILL.md) · [`docs/SECURITY.md`](../../../docs/SECURITY.md)
