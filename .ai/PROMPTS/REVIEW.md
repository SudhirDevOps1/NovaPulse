# ✅ NovaPulse — Review Checklist (Gate for Any Change)

> Run this **before approving any change** — human or agent. Every line is
> PASS / FAIL / N/A with evidence; "looks fine" is not an answer (**L-04**).
> Laws: [`../RULES.md`](../RULES.md). Lifecycle:
> [`MASTER_SYSTEM.md`](MASTER_SYSTEM.md).
>
> **Blocking rule:** one FAIL in §B, §D or §E blocks the merge outright. A FAIL
> in §A, §C or §F blocks unless the author produced an ADR or a written
> correction. N/A requires a one-line reason.

---

## 0 · Before you start (60 seconds)

```bash
cd D:\basic\uptime-monitor
git status --short            # what is actually in this change
git diff --stat               # blast radius
node -e "console.log(require('./package.json').version)"   # which build (BUG-2026-0002)
```

- [ ] The diff contains **only** the files the change claims to touch (no
      drive-by edits, no reformatting of unrelated files — **L-07**, **L-41**).
- [ ] The change is one logical change; if not, it must be split before review
      (**L-31**).
- [ ] You know which mode(s) it affects: server · static/Pages · both.

---

## 1 · Part A — Truth & anti-yes-man (L-01…L-08) · blocking

| # | check | PASS if |
| --- | --- | --- |
| A1 (**L-01**) | No blind agreement | the author states what the code does **today** with `file:line`, and raised at least the constraints/costs of the request — or said "this is wrong because…" |
| A2 (**L-02**) | No vaporware | nothing in the diff, PR text or docs describes an unmerged capability; future work went to `TODO.md` |
| A3 (**L-03**) | No fake demos | every screenshot/benchmark/sample output in the change came from a real run; no hand-written "expected output" blocks presented as results |
| A4 (**L-04**) | Evidence attached | at least one real command + its pasted output supports the correctness claim; claims without output are **FAIL** |
| A5 (**L-05**) | Trade-offs stated | the PR names what this costs (latency, memory, complexity, maintenance, risk) — a recommendation with no ⚠️ line is incomplete |
| A6 (**L-06**) | Uncertainty declared | open questions/unknowns are listed instead of papered over |
| A7 (**L-07**) | No scope inflation | every added file/dep/abstraction is required by the stated task; dev-dependency or runtime additions justified (runtime needs an ADR — ADR-0004) |
| A8 (**L-08**) | Premises correct | route names, config keys, limits, and "bugs" were verified against code; intended behaviour was not "fixed" |

**Verdict §A:** ______ (list failed ids)

---

## 2 · Part B — Fail-closed security (L-09…L-18) · blocking

| # | check | PASS if |
| --- | --- | --- |
| B1 (**L-09**) | Fail closed | a security check that cannot run stops the operation — no permissive default, no `catch → continue` on a security path |
| B2 (**L-10**) | No inline fallback secrets | `grep -rn "process.env." server.js lib tools .github` returns only the **non-credential** knobs (`PORT`, `HOST`, `TRUST_PROXY`, `RATE_LIMIT_MAX`, `RATE_LIMIT`, `LOG_LEVEL`, `LOG_FORMAT`, `ALLOW_*`, `SSL_WARN_DAYS`, `SLA_TARGET`, `UPTIME_DATA_DIR`) and truthiness checks in `lib/notify.js` — any logical-OR or coalescing default applied to a credential is a FAIL; plus no token/password/API key literal in code, tests, docs or workflow YAML |
| B3 (**L-11**) | Required env | any new secret/config that must exist is read through a single accessor that throws naming the key — no silent degradation (see `SECURITY.md` §3.1 for the current gap) |
| B4 (**L-12**) | Secrets not logged | no `logger.*` call passes a token, webhook URL with credentials, or `Authorization`; if a new log field can hold one, redaction is in `lib/logger.js` |
| B5 (**L-13**) | Public projection allowlist | any new field in a public/status/badge payload was added **deliberately** to the allowlist; no internal object spread into a response; e2e allowlist spec still passes |
| B6 (**L-14**) | Output encoding | user data renders via `text:`/`escapeHtml()`/`escapeXml()`; `html:` and `innerHTML` receive only trusted static markup; no new `insertAdjacentHTML`/`outerHTML` sinks |
| B7 (**L-15**) | Scheme allowlist | new URL/image inputs restricted to `https:`/`http:`/safe `data:image/`; no `javascript:`, no protocol-relative URLs |
| B8 (**L-16**) | Mutating routes guarded | every new `POST/PATCH/PUT/DELETE` has same-origin/CSRF handling and is under `/api` rate limiting; cross-site `Origin` rejected (see `TODO.md` NOW-4) |
| B9 (**L-17**) | Rate limit intact | limiter still on by default (240/min/IP); `RATE_LIMIT=off` appears only in test/QA config, never in a shipped default |
| B10 (**L-18**) | Headers intact | CSP has **no** `unsafe-inline`; `frame-ancestors 'none'` (unless `ALLOW_FRAMING=1`, local only), nosniff, DENY, `no-referrer`, Permissions-Policy, COOP present on every response |

```bash
pnpm test                 # includes "sends hardened security headers"
pnpm run e2e              # includes header + allowlist specs
```

**Verdict §B:** ______

---

## 3 · Part C — Zero PII (L-19…L-24) · blocking on FAIL, advisory on gaps

| # | check | PASS if |
| --- | --- | --- |
| C1 (**L-19**) | No PII in state | the change adds no field that identifies a person (name, email, phone, account id) |
| C2 (**L-20**) | Masking where PII can arrive | any new free-text input that could carry PII is masked per the documented formats before display/log/export |
| C3 (**L-21**) | Logs are public-ish | no log line contains a secret, PII, or a non-public hostname |
| C4 (**L-22**) | Exports safe to attach | nothing new leaks through `/api/export` or CSV without redaction (current known gap: monitor `headers` — `SECURITY.md` §3.7) |
| C5 (**L-23**) | No third-party telemetry | no new origin in CSP, no analytics/error beacon, no CDN font/script |
| C6 (**L-24**) | Retention bounded | any new array/queue has a cap; raising 500 / 720 / 2400 / 500 has an ADR **with a disk/memory projection** from `DATABASE.md` §10 |

**Verdict §C:** ______

---

## 4 · Part D — Zero-defect gate (L-25…L-34) · blocking

Run, paste, judge:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck    # L-26 → 0 errors, tsconfig.json + tsconfig.sw.json
pnpm run lint         # L-27 → 0 errors, 0 warnings (--max-warnings=0)
pnpm test             # L-28 → every test green; counts line matches CONTEXT §4
pnpm run e2e          # required if public/, routes, headers, status page touched
pnpm run build        # site/ emitted (static mode must not regress)
```

| # | check | PASS if |
| --- | --- | --- |
| D1 (**L-25**) | Lifecycle followed | all 7 steps present in the change description, in order |
| D2 (**L-26**) | Typecheck | `pnpm run typecheck` exits 0 — **both** `tsconfig.json` and `tsconfig.sw.json` |
| D3 (**L-27**) | Lint | `pnpm run lint` exits 0 with `--max-warnings=0`; a warning is a failure |
| D4 (**L-28**) | Tests | `pnpm test` (and `pnpm run e2e` when applicable) fully green; no re-run-to-pass, no flake tolerated |
| D5 (**L-29**) | No placeholders | `git diff` contains no `TODO`, `FIXME`, `lorem ipsum`, stub functions returning canned data, or commented-out blocks kept "for later" (search the diff, not just the new files) |
| D6 (**L-30**) | No mock data in prod paths | fallbacks are honest empties (`null`, `[]`, `'unknown'`), never invented values that look real |
| D7 (**L-31**) | Commit format | `type(scope): subject`, scope from `commitlint.config.mjs` enum, subject ≤90 chars, one logical change |
| D8 (**L-32**) | Doc sync | this change is batch 3–4 → `CONTEXT.md`, `CHANGELOG.md`, `BUGS.md`, `DECISIONS.md`, `TODO.md` all touched; numbers re-derived with their commands |
| D9 (**L-33**) | Three Darwazas | `ci.yml`, `e2e-gate.yml`, `security-scan.yml` green on the PR/head — local success alone is not done |
| D10 (**L-34**) | No gate tampering | `git diff` touches **no** workflow, `eslint.config.mjs`, `tsconfig*.json`, `commitlint.config.mjs`, `.husky/*` unless the change *is* a gate change with an ADR; no `continue-on-error: true`, no `\|\| true`, no `.skip`/`.only`, lowered thresholds, deleted tests |

**Verdict §D:** ______

---

## 5 · Part E — Data integrity (L-35…L-39) · blocking

| # | check | PASS if |
| --- | --- | --- |
| E1 (**L-35**) | Atomic writes | any new write path goes through `store.save()`/`flush()` (tmp + rename); no `writeFileSync` directly over `monitors.json`; no truncation before a full write |
| E2 (**L-36**) | Auto-migrating | a state file from *before* the change still loads: new fields have read-path defaults, `load()` normalises (see `TODO.md` NOW-1), no manual migration step introduced |
| E3 (**L-37**) | Non-destructive | no path deletes/overwrites user data; shrink/rename/restructure has an export-first backup path **and** an entry in `DATABASE.md` |
| E4 (**L-38**) | Isolated failure | each independent state statement has its own `try/catch`; one failure does not block the rest; security errors still halt (B1) |
| E5 (**L-39**) | Single writer | no second process/volume against one `data/`; tests/E2E keep `UPTIME_DATA_DIR` isolated; `ecosystem.config.js` still `instances: 1` |
| E6 | Schema docs | `DATABASE.md` §7 row added/edited for every stored field; `OPTIONAL_FIELDS` covers it so `POST /api/import` does not drop it |

**Verdict §E:** ______

---

## 6 · Part F — Process & communication (L-40…L-43) · blocking on FAIL

| # | check | PASS if |
| --- | --- | --- |
| F1 (**L-40**) | Every mutation notifies | create/edit/delete/import/settings give a toast on success and an inline error on failure; a save with no feedback is a **failed save** regardless of the API result (regression guard: e2e *"saving a new monitor shows a success notification"*) |
| F2 (**L-41**) | Read before write | naming, file layout, and patterns match the surrounding code; no second implementation of an existing helper (`h()`, `escapeHtml`, `logger`, `fmt`) |
| F3 (**L-42**) | Nothing changes silently | observable behaviour changes appear in `CHANGELOG.md` context/PR notes; judgement calls have an ADR with status |
| F4 (**L-43**) | Left better | the touched files measurably improved (clearer name / one fewer branch / one more test / one fewer dead path) — or at minimum were not degraded |

**Verdict §F:** ______

---

## 7 · Architecture & layer checks (from `ARCHITECTURE.md`)

- [ ] Calls only go downward: `public/` → `server.js` → `lib` domain → `lib`
      integration → `lib/store`.
- [ ] `server.js` gained no business logic (no percentiles, probe logic,
      query building) — it validates and delegates.
- [ ] `lib/store` knows nothing of HTTP or notifications; `lib/notify` /
      `lib/badge` never touch disk.
- [ ] Frontend builds DOM through `h()`; overlays go through `mountOverlay()`;
      no inline styles/scripts (CSP).
- [ ] Hash routes unchanged (`#/overview #/monitors #/incidents #/settings`)
      unless the change is explicitly about routing (ADR-0002).
- [ ] "Where to change what" table (`ARCHITECTURE.md` §8) still points at the
      right files.

---

## 8 · Evidence block (paste into the review)

```text
$ pnpm run typecheck
<output>
$ pnpm run lint
<output>
$ pnpm test
<output — include the counts line>
$ pnpm run e2e
<output — or "n/a: no UI/route/header change — reason: …">
$ git diff --stat
<output>
```

---

## 9 · Verdict

| section | result | failed ids |
| --- | --- | --- |
| §1 A — truth | PASS / FAIL | |
| §2 B — security | PASS / FAIL | |
| §3 C — PII | PASS / FAIL | |
| §4 D — quality gate | PASS / FAIL | |
| §5 E — data integrity | PASS / FAIL | |
| §6 F — process | PASS / FAIL | |
| §7 architecture | PASS / FAIL | |

**Decision (choose one, no others are allowed):**

1. **APPROVE** — every section PASS (N/A justified in line).
2. **REQUEST CHANGES** — list each failed id with the exact evidence that
   failed and the law it violates (e.g. "D5: `git diff` shows `// TODO` → L-29").
3. **BLOCK** — §B/§D/§E FAIL, or gate tampering detected (D10) → escalate to an
   ADR, not a hotfix (**L-34**).

Write the verdict as a short table + one-paragraph rationale. Never approve on
"should work" (**L-04**), never soften a FAIL into a suggestion, and never
approve your own unreviewed change without running this checklist against it.
