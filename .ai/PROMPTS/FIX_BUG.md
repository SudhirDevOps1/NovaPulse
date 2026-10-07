# 🐞 NovaPulse — Prompt Template: Fix a Bug

> Copy this into the session with the bug report. The contract is simple:
> **reproduce → root cause → minimal fix → regression test → log it**. Nothing
> gets called "fixed" until a command proves it (**L-04**).
> Register format and triage procedure live in
> [`../BUGS.md`](../BUGS.md); persona in [`MASTER_SYSTEM.md`](MASTER_SYSTEM.md).

---

## 1 · Inputs (fill these)

```text
Symptom:            {{what the user sees, verbatim quote if available}}
Reported against:   {{URL/screen/command}}
Expected:           {{what should happen}}
Observed:           {{what actually happens — status codes, console output}}
Since:              {{first bad commit/version, or "unknown"}}
Reproducible:       {{always | sometimes | never — how often, and what varies}}
Environment:        {{server mode | static/Pages mode · node version · OS · behind proxy?}}
Suspected area:     {{server.js | lib/*.js | public/js/* | workflows | unknown}}
```

If any input is `unknown`, say so in the reply (**L-06**) — do not fill gaps
with plausible prose.

---

## 2 · The prompt

```markdown
You are the NovaPulse maintenance agent (.ai/PROMPTS/MASTER_SYSTEM.md).
Bug report below. Follow .ai/BUGS.md §3 triage, in order.

## Step 0 — prove WHICH code is running (before blaming the code)
- Compare GET /api/health "version" with package.json "version".
- Check for orphaned processes holding the port:
    netstat -ano | findstr ":3000"        (Windows)
    lsof -i :3000                          (POSIX)
  A stale node server.js serving an old build is BUG-2026-0002 — symptoms
  reported "against current code" that are actually produced by a previous one.
- If the reported environment is static mode (APP_MODE='static'), reproduce in
  static mode: pnpm run build && node tools/gh-build.js — server-mode results
  do not count (L-04).

## Step 1 — reproduce with a real command (mandatory, before any edit)
- Choose the narrowest command that shows the failure: pnpm test, pnpm run e2e,
  curl against a running server, or a new node script in a temp dir with
  UPTIME_DATA_DIR pointed away from data/ (L-39: never touch real state).
- Paste the ACTUAL failing output (expected vs observed).
- If you cannot reproduce it, stop and say "not reproduced" — do not fix
  something you cannot demonstrate (L-03, L-06).

## Step 2 — find the ROOT CAUSE, not the nearest symptom
- Read the call path end to end with file:line references. A toast that does
  not appear is rarely a toast problem (BUG-2026-0001: the submit button had no
  owner form, so no request was ever sent).
- State the causal chain in one line: "X → Y → Z".
- If the behaviour is intended, stop: correct the premise (L-08), log nothing,
  and explain which law/ADR/test defines it.

## Step 3 — minimal fix
- Smallest change that removes the cause. No drive-by refactor, no new
  dependency, no new abstraction (L-07, L-41).
- If the fix changes shipped behaviour, it needs a CHANGELOG entry (L-42); if it
  is a judgement call, it needs an ADR.
- If the bug reveals a whole class of mistake, write a law: add the entry to
  .ai/RULES.md (next free number) and reference it here (as BUG-2026-0001 did
  with L-40).

## Step 4 — regression test (mandatory)
- Add a test that FAILS before the fix and PASSES after. Prove both runs:
    $ pnpm test        # before fix → shows the failure
    $ pnpm test        # after fix  → shows green
- Prefer the layer where the defect lives: unit/integration in test/ for logic,
  e2e/ for DOM wiring, request or header behaviour. DOM-wiring bugs are only
  visible end-to-end (BUG-2026-0001).
- Never delete or weaken an existing test to get green (L-34).

## Step 5 — quality gate (paste real output)
  pnpm run typecheck     # 0 errors (L-26)
  pnpm run lint          # 0 warnings (L-27)
  pnpm test              # 100% green (L-28)
  pnpm run e2e           # required when the fix touches public/, routes or headers

## Step 6 — log the incident in .ai/BUGS.md
- NEXT FREE ID: **BUG-2026-0003** (register currently ends at BUG-2026-0002,
  both closed). Re-check §1/§2 of .ai/BUGS.md at execution time and use the
  next free id; assign it the moment the incident is REPRODUCED, not when it is
  fixed (BUGS.md §4).
- If the id is already taken by the time you write, increment — never reuse.
- Insert the entry with the exact section shape:

  ### BUG-2026-XXXX — <one-line symptom>
  | field | value |
  | status | 🔴 OPEN — <date>   (then ✅ CLOSED with the closing date) |
  | severity | critical | high | medium | low  (+ one-line justification) |
  | area | <file> → <function>() |
  | introduced | <commit/version or "since the first commit (sha)"> |
  | rule produced | L-XX or "none" |

  **Symptom** (verbatim report) · **Investigation — what was actually observed**
  (numbered, with real output) · **Root cause** (causal chain, code snippet) ·
  **Fix** (what changed and why this minimal change) · **Verification** (table:
  check → result, incl. the regression test name) · **Fallout / laws written**.

## Step 7 — atomic commit
  fix(<scope>): <what broke and what now happens>
  - scope from the same enum as features (commitlint enforced)
  - body references the incident: (BUG-2026-XXXX) and the law if one was written
  - one logical change: fix + its regression test land together

## Output format
MASTER_SYSTEM.md §8, plus the BUGS.md entry inline and the before/after test
runs.
```

---

## 3 · Severity guide (used in the register)

| severity | definition | NovaPulse examples |
| --- | --- | --- |
| **critical** | silent data loss, or the user believes a save succeeded when it did not | `BUG-2026-0001` (save with no request and no toast) |
| **high** | makes correct code look broken, or blocks the gates | `BUG-2026-0002` (stale process serving an old build) |
| **medium** | wrong behaviour a user notices but with a workaround | status pill wrong for paused monitors |
| **low** | cosmetic / copy / log formatting | label typo in a badge |

---

## 4 · Reproduction recipes that work in this repo

```bash
# unit/integration (starts its own server on an ephemeral port, temp data dir)
pnpm test

# end-to-end (Playwright starts node server.js on :3210, e2e/.tmp-data)
pnpm run e2e
pnpm run e2e:ui          # interactive, for DOM-wiring bugs

# live server, isolated state — never point at data/ (L-39)
$env:UPTIME_DATA_DIR="$env:TEMP\novapulse-repro"; node server.js
curl -sS -o - -w "`n%{http_code}`n" http://127.0.0.1:3000/api/health
curl -sS -X POST http://127.0.0.1:3000/api/monitors -H 'content-type: application/json' `
  -d '{"name":"repro","url":"https://example.com","intervalSec":60}'

# which build is actually being served?
curl -sS http://127.0.0.1:3000/api/health   # "version" must match package.json
```

---

## 5 · Definition of done

```markdown
- [ ] Step 0 done: the running build was identified (version + PID)
- [ ] reproduced with a pasted command and its real output (L-04)
- [ ] root cause stated as a causal chain with file:line
- [ ] minimal fix; no dependency, no scope creep (L-07)
- [ ] regression test added; shown failing before and passing after (L-28)
- [ ] pnpm run typecheck / lint / test / e2e green (paste output)
- [ ] entry added to .ai/BUGS.md with the next free id (BUG-2026-XXXX)
- [ ] law written if the bug is a whole class of mistake (L-40 / L-04 precedent)
- [ ] docs batch synced if this is change 3–4 in the batch (L-32)
- [ ] commit: fix(scope): … (BUG-2026-XXXX)
```

---

## 6 · What "fixed" does not mean

- ❌ "the test passes now" without a test that **failed before** the change.
- ❌ "I could not reproduce it but I hardened the code" — that is scope
  inflation plus an unverifiable claim (**L-03**, **L-07**).
- ❌ "works on my machine" when the report came from another mode (static vs
  server), version, or process (**BUG-2026-0002**).
- ❌ closing the register entry before the verification table has a real result
  in every row.
