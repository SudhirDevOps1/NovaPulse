---
name: vibe-proof
description: >-
  Evidence-before-claim skill (L-03 / L-04): how to produce reproducible proof
  for any change — exact command, real output, stated environment — and the
  verification-guide template every NovaPulse change must ship with.
---

# 📎 vibe-proof — evidence before claim

> Skill pack member. Implements **L-03 (No Fake Demos)** and **L-04 (Evidence
> Before Claim)** of [`.ai/RULES.md`](../../../.ai/RULES.md): *"should work"*,
> *"this fixes it"* and *"I tested it mentally"* are not acceptable. A claim of
> correctness requires a reproducible command **and its actual output** attached
> to the change or the comment.

## When to use

- Every PR, commit message body, review reply and status update that asserts
  something about behaviour ("tests pass", "the header is set", "status page is
  404 when disabled").
- Before writing any number into [`.ai/CONTEXT.md`](../../../.ai/CONTEXT.md) —
  that file's rule is *"the command wins"* (§10).
- When a demo, screenshot, benchmark or sample output is about to be shown.

## Inputs

| input | notes |
| --- | --- |
| the claim to prove | one falsifiable sentence |
| the working tree | must be the exact tree you are claiming about (`git rev-parse --short HEAD` recorded) |
| the commands below | run from the repository root |
| the output | captured verbatim, unedited |

---

## Procedure

1. **Rewrite the claim as something a command can answer.**
   "The status page is fail-closed" → *"GET /status returns 404 while disabled"*.
   If no command can answer it, the claim is an opinion — label it as one.
2. **Record the environment first**, so the proof can be reproduced later:
   `node -v`, `pnpm -v` (or `npm -v`), OS, and `git rev-parse --short HEAD`.
3. **Run the smallest command that settles it.** Standard proof set:

   ```bash
   pnpm run typecheck   # 0 errors, both tsconfigs
   pnpm run lint        # eslint . --max-warnings=0 → 0 problems
   pnpm test            # node --test
   pnpm run e2e         # Playwright, desktop-chromium + mobile-chromium
   pnpm run build && pnpm run build:check   # emits site/
   ```

4. **Paste the output verbatim.** No hand-typed "expected" output (L-03). If
   you trimmed it, say so and mark the cut with `… (trimmed)`. Never paste a
   result you did not personally observe on this tree.
5. **State the pass criterion next to the output** (`exit 0`, `12 pass`,
   `HTTP 404`) so a reviewer does not have to interpret it.
6. **Attach it** to the PR description, the commit body, or the review comment.
   For a release-relevant change, put it in the verification guide (template
   below) committed with the change.
7. **When output contradicts a document, the document loses** — fix the doc in
   the same change (`.ai/CONTEXT.md` §10, L-42).

### A real, currently reproducible example

Environment: Windows (`win32`), Node `v24.19.0`, tree `novapulse@2026.1.0`,
captured 2026-10-07.

```console
$ npm test        # package.json script "test": "node --test"
✔ health endpoint reports monitor count (235.6707ms)
✔ rejects a monitor without a valid url (92.7555ms)
✔ monitor lifecycle: create, list, fetch, delete (155.439ms)
✔ unknown API routes return JSON 404 (7.188ms)
✔ sends hardened security headers (6.1754ms)
✔ stats and export endpoints report consistent shape (17.1866ms)
✔ advanced monitor fields validate and can be cleared (182.9346ms)
✔ fleet analytics endpoint reports a range summary (8.7989ms)
✔ status page is disabled by default (11.1349ms)
✔ settings can enable the status page and projection renders (49.7447ms)
✔ svg badges render for the fleet (11.6763ms)
✔ probe helpers parse status specs and tcp targets (1.6161ms)
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1842.2097
```

Pass criterion: `fail 0` / exit 0. This is the acceptable shape of every proof.

---

## Verification guide template

Commit as `docs/verify-<change>.md` (or paste into the PR) — one guide per
change, filled with **observed** values only.

```markdown
# Verification — <one-line change description>

- date: YYYY-MM-DD
- tree: <short SHA> · branch: <name>
- environment: <os>, node <version>, <package manager> <version>
- laws: L-03, L-04 (+ any law this change specifically exercises)

## 1 · Claim
<one falsifiable sentence>

## 2 · Preconditions
<state the app must be in, e.g. "fresh data dir, status page disabled by default">
1. `pnpm install --frozen-lockfile`
2. `pnpm start`   # or: the command under test

## 3 · Steps and commands
| # | command | purpose |
| - | ------- | ------- |
| 1 | `<exact command>` | <what it proves> |

## 4 · Observed output (verbatim)
```console
$ <command>
<actual output — trimmed only with … (trimmed)>
```

## 5 · Pass criterion and result
<e.g. "HTTP 404" → **pass** / **fail**>

## 6 · Negative control (when applicable)
<the same command against the opposite state, e.g. status page enabled → 200>

## 7 · Gates
| gate | command | result |
| ---- | ------- | ------ |
| typecheck | `pnpm run typecheck` | exit 0 |
| lint | `pnpm run lint` | exit 0 |
| unit/integration | `pnpm test` | 13/13 |
| e2e (if UI changed) | `pnpm run e2e` | <n>/<n> |

## 8 · Residual risk / trade-off (L-05)
<what this proof does NOT cover>
```

### Deriving repo facts instead of asserting them

Numbers such as route counts must be computed, not remembered
(from `.ai/CONTEXT.md` §10):

```bash
node -e "const s=require('fs').readFileSync('server.js','utf8');
  console.log([...s.matchAll(/app\.(get|post|patch|delete)\(\s*'([^']+)'/g)].length, 'API routes')"
```

## Definition of done

- [ ] Every behavioural claim in the change carries a command and its verbatim output.
- [ ] Environment (os, node, SHA) recorded with the output.
- [ ] No hand-written expected output anywhere (L-03).
- [ ] Negative control run where the claim is a default/fail-closed behaviour.
- [ ] Gate results table attached; all commands exit 0.
- [ ] Docs that state the proved number are updated in the same change (L-32/L-42).

## References

- [`.ai/RULES.md`](../../../.ai/RULES.md) — L-03, L-04, L-05, L-25 (7-step lifecycle)
- [`.ai/CONTEXT.md`](../../../.ai/CONTEXT.md) — §10 "How to re-derive every number on this page"
- [`docs/RULES.md`](../../../docs/RULES.md) — human-facing lifecycle and PR rules
- [`vibe-security`](../vibe-security/SKILL.md) — evidence format for security findings
