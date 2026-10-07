# 🛠️ NovaPulse — Prompt Template: Refactor

> Use this when the goal is **structure, not behaviour**. A refactor that
> changes an observable byte — a status code, a payload field, a header, a log
> line, a stored field — is not a refactor here; it needs an ADR first
> ([`../DECISIONS.md`](../DECISIONS.md)).
> Persona and lifecycle: [`MASTER_SYSTEM.md`](MASTER_SYSTEM.md).

---

## 1 · Inputs (fill these)

```text
Target:             {{file/module/function to restructure}}
Why:                {{one line: what is hard to change/test/read today — with evidence}}
Behaviour contract: {{the observable behaviour that must be identical afterwards:
                      routes/status codes/payload keys/headers/log shape/stored shape}}
Characterization:   {{existing test(s) that pin this behaviour — or "none, must be written first"}}
Out of scope:       {{things that look related but must not change this pass}}
Evidence of win:    {{metric that improves: LOC, branches, duplicate paths, test count, cycle}}
```

**Default assumption:** if you cannot name the behaviour contract, you are not
ready to refactor (**L-06**).

---

## 2 · The prompt

```markdown
You are the NovaPulse maintenance agent (.ai/PROMPTS/MASTER_SYSTEM.md).
Refactor request below. Zero behaviour change is the acceptance criterion.

## Step 1 — research before you write (L-41)
- Read the target file end to end; list its exports and every call site
  (grep the repo — public/, server.js, lib/, tools/, test/, e2e/).
- Read .ai/ARCHITECTURE.md §2 (5-layer model, dependency rule) and state which
  layer the code belongs to and which way calls are allowed to go.
- State what the code does today with file:line references (L-04).
- Check .ai/DECISIONS.md for a prior ADR that explains the current shape —
  existing ugliness is sometimes deliberate. If one exists, explain why it no
  longer applies before touching it.

## Step 2 — characterization tests FIRST (the safety net)
- Pin the current observable behaviour BEFORE editing: routes → status codes +
  payload keys; parsing/limits → table-driven cases; store → caps and atomicity;
  UI → an e2e spec.
- Run them and paste the green output. If coverage is too thin to pin the
  behaviour, add tests first and commit that as
  `test(<scope>): characterize <target> before refactor`.
- Rule: after the refactor these tests must be UNCHANGED and still green. If one
  has to change, the behaviour changed → stop, that is an ADR (see Step 5).

## Step 3 — refactor (the actual change)
- Move/rename/simplify with no edit to observable behaviour: same routes, same
  status codes, same JSON keys and null-vs-absent semantics, same headers, same
  log message shapes, same stored document (DATABASE.md §7).
- Keep the layer rule (a layer may only call downward); no new dependency, no
  new abstraction that only has one caller (L-07).
- No dead code left behind, no commented-out blocks, no "// TODO" (L-29).
- Leave it measurably better: name the metric (fewer branches, one fewer code
  path, +N tests) and report before/after (L-43).

## Step 4 — quality gate (paste real output)
  pnpm run typecheck     # 0 errors, both tsconfigs (L-26)
  pnpm run lint          # 0 warnings — refactors commonly "improve" a file
                         # into new lint errors; that is still a failure (L-27)
  pnpm test              # characterization tests unchanged and green (L-28)
  pnpm run e2e           # REQUIRED for public/js/** or server.js refactors
  pnpm run build         # static bundle still emits site/

## Step 5 — ADR required when the design changes
Write .ai/DECISIONS.md → ADR-XXXX (status: Proposed → Accepted) if any of these
is true:
  - a module's responsibility or the layer it lives in changes;
  - a public payload, route shape, stored schema or log format changes;
  - an existing ADR (ADR-0001…0008) is contradicted;
  - a behaviour difference is intentional (that is a behaviour change: name it,
    test it, changelog it — do not smuggle it into a refactor, L-42).
An ADR is not needed for mechanical moves that the tests already pin.

## Step 6 — docs (L-32, L-42)
- Update .ai/ARCHITECTURE.md if the file/layer map moved (§8 "where to change
  what" must stay true).
- Update .ai/CONTEXT.md §5 source inventory if file counts/names changed
  (re-run §10 first — the command wins over the doc).
- No user-visible behaviour → no CHANGELOG entry; if something observable did
  change, it was not a refactor.

## Step 7 — atomic commit
  refactor(<scope>): <what structurally changed> — <why it is better>
  - scope from the commitlint enum; one logical change
  - body: characterization test names + the metric that improved
  - NEVER bundle a behaviour change with a refactor in one commit

## Output format
MASTER_SYSTEM.md §8: Plan & Research → Changes → Verification (real output) →
Trade-offs (L-05: what got harder to read? what did the tests cost?) →
Verification guide → Commit → Doc sync.
```

---

## 3 · Refactor classes allowed in this repo

| class | example | extra rule |
| --- | --- | --- |
| extraction | split a 400-line view into two modules | exports keep their public names or every call site updates in the same commit |
| rename | `kestrel` → `novapulse` strings (see [`../TODO.md`](../TODO.md) NOW-7) | search all of `server.js`, `lib/`, `public/`, `tools/`, tests, README, workflows — partial renames are worse than no rename |
| dead-code removal | unused export / stale branch | prove zero call sites with grep output |
| simplification | collapse duplicated validation | characterization table must cover every collapsed branch |
| test restructuring | split `test/api.test.js` by area | total case count must not drop; `node --test` still discovers them |
| layering fix | move HTTP knowledge out of `lib/store` | ADR if it contradicts an existing decision |

---

## 4 · Definition of done

```markdown
- [ ] behavior contract written down BEFORE the edit
- [ ] characterization tests added/confirmed and green before the refactor (pasted)
- [ ] tests unchanged after the refactor (diff of test/ is empty, or explained)
- [ ] pnpm run typecheck / lint / test / e2e / build all green (pasted output)
- [ ] zero behaviour delta: routes, status codes, payload keys, headers,
      log shapes, stored document identical (state how you verified — e.g.
      curl /api/monitors before/after and a diff of the JSON)
- [ ] no new dependency, no dead code, no placeholders (L-07, L-29)
- [ ] improvement metric reported before/after (L-43)
- [ ] ADR written if design/responsibility changed (Step 5)
- [ ] ARCHITECTURE.md / CONTEXT.md still accurate (L-32)
- [ ] commit: refactor(scope): … (behaviour changes excluded)
```

---

## 5 · Failure modes (auto-reject)

| red flag | why it fails review |
| --- | --- |
| "while I was here I also fixed…" | that is a `fix`/`feat` in disguise; split it (**L-07**, **L-42**) |
| characterization tests written *after* the edit | they pin the new behaviour, not the old one |
| a green suite with deleted assertions | weaker tests are not evidence (**L-34**) |
| payload key renamed "because it is clearer" | public contract change → ADR + changelog |
| refactor spans 10+ files with one commit | unreviewable; split by module (**L-31**) |
| e2e skipped as "not needed for a pure refactor" | DOM wiring is exactly what unit tests miss (`BUG-2026-0001`) |
