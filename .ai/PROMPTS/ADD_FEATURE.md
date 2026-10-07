# ➕ NovaPulse — Prompt Template: Add a Feature

> Copy this file into your session, fill the **Inputs** block, and send the rest
> verbatim. It forces the 7-Step Lifecycle
> ([`MASTER_SYSTEM.md`](MASTER_SYSTEM.md) §3) onto every feature request.
> Companion templates: [`FIX_BUG.md`](FIX_BUG.md) · [`REFACTOR.md`](REFACTOR.md) ·
> [`REVIEW.md`](REVIEW.md).

---

## How to use

1. Fill every `{{…}}` slot. If you cannot fill one, say `unknown` — never
   invent it (**L-06**).
2. Paste sections 1–6 of this file as the prompt. Section 7 is the agent's
   output contract.
3. Nothing here overrides the laws; if the template and
   [`../RULES.md`](../RULES.md) disagree, the laws win.

---

## 1 · Inputs (fill these)

```text
Feature:            {{one-sentence description of the user-visible behaviour}}
Persona / why:      {{who needs it — PRD.md §2 persona id (P1/P2/P3) or a real user quote}}
Acceptance criteria:
  1. {{observable behaviour + how it is checked}}
  2. {{…}}
  3. {{…}}
Touching:           {{files/areas you expect: server.js | lib/*.js | public/js/* | workflows | docs}}
Not touching:       {{areas that must stay unchanged}}
Route(s) involved:  {{existing route names, or "new route → name it"}}
Data affected:      {{none | monitor fields → list them (DATABASE.md §7)}}
Edge cases:         {{empty state, disabled status page, static mode, oversized input, …}}
```

**Constraints that are not negotiable** (state them in the prompt so the agent
cannot renegotiate them later): 2 runtime dependencies, no bundler, no
database, single writer, CSP without `unsafe-inline`, hash routing.

---

## 2 · The prompt

```markdown
You are the NovaPulse maintenance agent (persona: .ai/PROMPTS/MASTER_SYSTEM.md).
Request: {{Feature}}

## Plan & Research (step 1 — do this before any edit)
- Read .ai/RULES.md, .ai/ARCHITECTURE.md (5-layer model + dependency rule),
  .ai/CONTEXT.md (route map, counts), .ai/PRD.md (which FR this extends) and
  .ai/DATABASE.md if any stored field changes.
- Read the files listed in "Touching" plus their existing tests. State what the
  code does TODAY with file:line references (L-04).
- Check for a second way of doing the same thing already in the repo and use
  the established one instead (L-41).
- Flag any false premise in the request before executing it (L-08).
- Name every file you will create or modify, and the layer it belongs to
  (ARCHITECTURE.md §2: L5 public/ → L4 server.js → L3 lib domain → L2
  lib integration → L1 lib/store; a layer may only call downward).

## Code (step 2)
- Minimal implementation of the acceptance criteria. No new dependency without
  an ADR (L-07 / ADR-0004). No placeholder, stub or commented-out code (L-29,
  L-30).
- Follow the rendering contract: DOM through h(); user data via text:, never
  html: (L-14). All input validated server-side in validateMonitor()-style
  code, with explicit limits.
- Every mutating route: same-origin guard, rate-limit covered (/api prefix),
  error envelope {errors: [...]} or {error: "..."} like the existing routes.
- Every user-visible mutation produces a toast or inline error (L-40).
- If a stored shape changes: auto-migrating default on read (L-36),
  non-destructive (L-37), OPTIONAL_FIELDS updated for import (DATABASE.md §8),
  and DATABASE.md updated in the same change.

## Quality gate (steps 3–5 — paste real output for each)
  pnpm run typecheck     # 0 errors, tsconfig.json + tsconfig.sw.json (L-26)
  pnpm run lint          # eslint . --max-warnings=0 → 0 warnings (L-27)
  pnpm test              # node --test, 100% green (L-28)
  pnpm run e2e           # REQUIRED if public/, routes, headers or status page changed
  pnpm run build         # static bundle still emits site/
- Add tests for the new behaviour: a unit/integration test in test/ for logic,
  an e2e spec in e2e/ for anything a user clicks. A feature without a test is
  not done.
- Do not weaken, skip or delete an existing test to get green (L-34).

## Definition of done (all must be true)
  [ ] acceptance criteria 1..n each mapped to a named test or a verifiable command
  [ ] pnpm run typecheck / lint / test / e2e all green, output pasted
  [ ] no new runtime dependency; public/ bundle untouched unless required
  [ ] .ai/DATABASE.md updated if state shape or caps changed (L-32, L-37)
  [ ] .ai/PRD.md FR table extended/edited if the feature adds surface
  [ ] docs batch synced (CONTEXT / CHANGELOG / DECISIONS / TODO) — L-32
  [ ] README section added/updated if the user-facing surface changed

## Commit (step 7 — atomic, conventional)
  type(scope): subject
  - type ∈ feat | fix | refactor | docs | test | ci | chore | perf | revert
  - scope ∈ api probe store analytics notify checker ui dashboard status
           security ci docs deps release monitor tools   (commitlint enforced)
  - subject ≤ 90 chars, one logical change, body lines ≤ 120 chars
  - BREAKING CHANGE footer only if the behaviour change is breaking (release-please reads it)

## Output format
Follow MASTER_SYSTEM.md §8 exactly: Plan & Research → Changes → Verification
(with real command output) → Trade-offs (L-05) → Verification guide →
Commit → Doc sync.
```

---

## 3 · Research checklist the agent must show

| check | why | reference |
| --- | --- | --- |
| the route/field/module named in the request actually exists | wrong premises produce confident wrong work (**L-08**) | `CONTEXT.md` §3 route map |
| no second implementation of the same idea | one way of doing things (**L-41**) | grep the area first |
| layer respected (no upward calls, store knows nothing of HTTP) | architecture contract | `ARCHITECTURE.md` §2 |
| the feature is not already built | avoid duplicate work (**L-02**) | grep `lib/`, `public/js/` |
| caps/limits affected? | bounded retention (**L-24**) | `DATABASE.md` §5 |

---

## 4 · Feature-class rules

| class | extra requirements |
| --- | --- |
| new API route | added to `CONTEXT.md` §3; 404/400 envelope matches existing; covered by a `test/api.test.js` case; mutating → same-origin guard |
| new stored field | `DATABASE.md` §7 row + `OPTIONAL_FIELDS` for import + read-path default (**L-36**) + non-destructive (**L-37**) |
| new public payload field | must be added to the projection allowlist deliberately (**L-13**) + e2e allowlist spec updated |
| new UI screen | hash route + `aria-current` nav behaviour + e2e navigation spec (**L-40** for save feedback) |
| new alert channel | `lib/notify.js` only, zero deps, `channelStatus()` boolean, never log the credential (**L-12**) |
| new dependency | ADR first, then `pnpm add`; justify against ADR-0004 (**L-07**) |
| workflow/gate change | ADR (**L-34**); never weaken an existing gate |
| doc-only change | links resolve; every number re-derived with its command (**L-04**) |

---

## 5 · Definition of done (copy into the PR description)

```markdown
## DoD
- [ ] acceptance criteria mapped to tests (names below)
- [ ] pnpm run typecheck → 0 errors
- [ ] pnpm run lint → 0 warnings
- [ ] pnpm test → all green (N/N — paste the counts line)
- [ ] pnpm run e2e → all green (or "n/a: no UI/route/header change — reason: …")
- [ ] pnpm run build → site/ emitted
- [ ] no new runtime dependency / no scope creep (L-07)
- [ ] docs batch synced (L-32): CONTEXT ☐ CHANGELOG ☐ BUGS ☐ DECISIONS ☐ TODO ☐
- [ ] trade-offs stated (L-05)
```

---

## 6 · Commit format examples (real, accepted shapes)

```text
feat(api): expose per-monitor error budget on the stats endpoint
fix(ui): submit the monitor form when Enter is pressed in a text field
feat(notify): retry transient webhook failures twice with backoff
docs(store): document the import body cap and the file-copy restore path
test(analytics): cover the p99 merge across hourly rollups
```

Rejected by `commitlint`: `feat: added stuff` with an empty body explaining
what, `Feat(api): …` (wrong case), `feat(my-feature): …` (unknown scope),
subject > 90 chars.

---

## 7 · Output contract (what you must get back)

Exactly [`MASTER_SYSTEM.md`](MASTER_SYSTEM.md) §8: **Plan & Research → Changes →
Verification (real output) → Trade-offs → Verification guide → Commit → Doc
sync**, plus a "not committed — blocker:" line if any gate failed. If the agent
returns a summary without command output, it has not finished (**L-04**).
