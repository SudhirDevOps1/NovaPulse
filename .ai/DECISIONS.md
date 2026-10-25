# 🧠 NovaPulse — Architectural Decision Records

> An ADR records **one** decision: what we chose, what we rejected, and why.
> Status is mandatory — an ADR without a status is a draft, not a decision.
>
> **Status values:** `Proposed` → `Accepted` → `Superseded by ADR-XXXX` |
> `Deprecated`. Never delete an ADR; supersede it so the reasoning survives.
>
> Write a new ADR whenever a decision is costly to reverse, or whenever a
> [`BUGS.md`](BUGS.md) incident reveals that a prior decision was wrong.

---

## ADR-0001 — Single JSON file instead of a database

| field | value |
| --- | --- |
| status | **Accepted** |
| date | 2026-01-15 |
| deciders | maintainer |

**Context.**
The platform must run on a free tier with no card, no connection string and no
cold starts. It needs to survive container restarts and be restorable with a
single `curl`.

**Decision.**
Persist all state in `data/monitors.json`, written atomically (temp file +
rename), held in memory, flushed on a 250 ms debounce.

**Alternatives rejected.**

| option | why rejected |
| --- | --- |
| SQLite | native binary in the image; still needs migrations; pointless for one writer |
| Postgres/Neon | credentials, connection pooling, cold start, an extra network hop — all for zero benefit at this scale |
| Redis | a cache for data that is already in memory |
| nothing (in-memory only) | restart loses history — violates zero data loss |

**Consequences.**

- ✅ ~60 MB RSS, zero infra, one `volume:` line in compose.
- ✅ Backup = `GET /api/export`; restore = `POST /api/import`.
- ⚠️ Single-writer only — never run two instances on one data dir (**L-39**).
- ⚠️ Beyond ~hundreds of monitors or multi-replica, revisit. The export format
  is lossless, so migrating out is a one-way safe step.

**Superseded?** No.

---

## ADR-0002 — Hash routing instead of server-side routes

| field | value |
| --- | --- |
| status | **Accepted** |
| date | 2026-01-15 |
| deciders | maintainer |

**Context.**
The dashboard is a single page with four screens, and it must also deploy to
GitHub Pages, which has no server to rewrite URLs.

**Decision.**
Client-side hash routing: `#/overview`, `#/monitors`, `#/incidents`,
`#/settings`. The server serves `/` for the shell and 404s everything else
that is not a real file or API route.

**Alternatives rejected.**
History-API routing (`/monitors`) — requires server rewrite rules *and* a
`404.html` shim on Pages; two code paths for zero user-visible gain.

**Consequences.**
✅ identical behaviour in server and static mode; ✅ no rewrite config;
⚠️ URLs are less pretty; ⚠️ `<a href="#/…">` cannot be pre-fetched.

**Superseded?** No.

---

## ADR-0003 — No frontend framework, no bundler

| field | value |
| --- | --- |
| status | **Accepted** |
| date | 2026-01-18 |
| deciders | maintainer |

**Context.**
The UI is a dashboard that re-renders from JSON every few seconds, plus a
public status page. It must work with a CSP that forbids `unsafe-inline`.

**Decision.**
Vanilla ES modules rendered through a tiny `h()` helper. No React/Vue/Svelte,
no Webpack/Vite/Turbopack. `tools/gh-build.js` copies and rewrites files for
the static mode instead of bundling.

**Alternatives rejected.**

| option | why rejected |
| --- | --- |
| React/Next.js | build step + hydration cost for pages that just replace JSON; Next.js has no SSR target here (no Node on Pages) |
| Svelte/Vue | same objection; adds a toolchain to a repo whose headline feature is a 2-package footprint |
| htm + preact | still a runtime dependency and a JSX-alike for no measurable win |

**Consequences.**
✅ `node server.js` is the whole deploy story; ✅ CSP stays strict with no
inline scripts anywhere; ✅ Lighthouse-friendly (no hydration flash);
⚠️ more verbose view code; ⚠️ no compiler catches prop typos — mitigated by
`tsc --noEmit` with `checkJs` over `public/js/**`.

**Superseded?** No.

---

## ADR-0004 — Two runtime dependencies, everything else hand-rolled

| field | value |
| --- | --- |
| status | **Accepted** |
| date | 2026-01-20 |
| deciders | maintainer |

**Context.**
Dependency count is a direct security and maintenance liability: every package
is a supply-chain surface, an audit finding waiting to happen, and a Renovate
PR.

**Decision.**
Runtime dependencies are exactly `express` and `compression`. Rate limiting
(`lib/limits.js`), badge rendering (`lib/badge.js`), alert fan-out
(`lib/notify.js`), charts (`public/js/charts.js`) and percentiles
(`lib/analytics.js`) are implemented in-repo.

**Consequences.**
✅ `npm audit` has a tiny surface; ✅ cold start and image size stay minimal;
✅ no transitive CVE treadmill;
⚠️ we own the correctness of those implementations — mitigated by unit tests
(`test/api.test.js` covers status parsing, probe helpers, headers).

**Dev-dependencies** (eslint, typescript, commitlint, husky, playwright) are
not shipped and are exempt — they *reduce* defect rate.

**Superseded?** No.

---

## ADR-0005 — Fail-closed environment secrets

| field | value |
| --- | --- |
| status | **Accepted** |
| date | 2026-02-02 |
| deciders | maintainer |
| enforces | [`RULES.md`](RULES.md) → L-09 … L-12 |

**Context.**
`process.env.X || 'fallback'` is the single most common way a production
system silently runs with a default credential.

**Decision.**
No inline fallbacks for sensitive values. All credentials are read through a
required-env accessor that throws naming the missing key, so a misconfigured
production deploy **crashes at boot** instead of running unauthenticated.

**Alternatives rejected.**
Warn-and-continue — a warning in a log nobody reads is not a security control;
it converts a deploy error into an incident.

**Consequences.**
✅ misconfiguration is caught at deploy, not by an attacker;
⚠️ local development must provide `.env` (`.env.example` documents every key);
⚠️ a missing secret takes the whole service down — accepted, per L-09.

**Superseded?** No.

---

## ADR-0006 — Separate TypeScript project for the service worker

| field | value |
| --- | --- |
| status | **Accepted** |
| date | 2026-10-07 |
| deciders | maintainer, agent |
| raised by | typecheck gate (Darwaza 1) |

**Context.**
Adding `tsc --noEmit` surfaced 53 errors, of which 7 were the service worker
requiring `webworker` globals (`ExtendableEvent`, `FetchEvent`,
`ServiceWorkerGlobalScope`) while the app requires `dom`. The two libraries
conflict — `self` is `Window` in one and `WorkerGlobalScope` in the other.

**Decision.**
Two configs, both enforced by `pnpm run typecheck`:

- `tsconfig.json` — app + server + tools (`lib: ES2023, DOM`), excludes `sw.js`
- `tsconfig.sw.json` — `public/sw.js` only (`lib: ES2022, WebWorker`)

**Alternatives rejected.**

| option | why rejected |
| --- | --- |
| single config with both `DOM` and `WebWorker` | duplicate identifier errors on `self`, `caches`, `addEventListener` signatures — the libs are mutually exclusive by design |
| `skipLibCheck`-style suppression of `sw.js` | an unchecked file in a zero-defect gate is a hole, not a solution |
| exclude the SW from typecheck entirely | same objection |

**Consequences.**
✅ both environments fully typed, gate still exits 0;
⚠️ two files to keep in sync — acceptable, the SW is ~90 lines.

**Superseded?** No.

---

## ADR-0007 — `[form]` attribute rather than a click handler for modal submit

| field | value |
| --- | --- |
| status | **Accepted** |
| date | 2026-10-07 |
| deciders | maintainer, agent |
| raised by | [`BUGS.md`](BUGS.md) → BUG-2026-0001 |

**Context.**
`openModal()` places the body (containing the `<form>`) and the footer
(containing the submit button) as siblings. The button therefore had no owner
form, and clicking it did nothing at all.

**Decision.**
Give each modal form a unique id (`monitor-form-${++formSeq}`) and set
`form: formId` on the submit button.

**Alternatives rejected.**

| option | why rejected |
| --- | --- |
| `saveBtn.onclick = () => form.requestSubmit()` | fixes click but **not** implicit submission (<kbd>Enter</kbd> in a field), which is the more common path |
| move the button inside the `<form>` | forces the footer into `.modal-body`, breaking the existing modal layout and every other dialog that passes a footer |
| make `openModal` render `footer` inside `body` when it is a form | implicit coupling; a caller passing a form as body and buttons as footer must know the rule |

**Consequences.**
✅ declarative, spec-intended, fixes both explicit and implicit submission;
✅ survives reordering of the modal slots;
⚠️ `openMonitorForm` is now the only caller that must know about `formId` —
the comment at the call site documents why.

**Superseded?** No.

---

## ADR-0008 — Three-darwaza CI instead of one monolithic workflow

| field | value |
| --- | --- |
| status | **Accepted** |
| date | 2026-10-07 |
| deciders | maintainer, agent |

**Context.**
Typecheck + lint + unit tests + a browser E2E suite + a DAST scan in one
workflow produces 20-minute PR feedback and no signal about *what* broke.

**Decision.**
Split by cost and by what question each gate answers:

| darwaza | question | duration target |
| --- | --- | --- |
| 1 `ci.yml` | does it compile, lint and pass tests? | < 3 min |
| 2 `e2e-gate.yml` | does the real browser flow work, and does it leak? | < 10 min |
| 3 `security-scan.yml` | is there anything a slow deep scan would find? | nightly, non-blocking |

Only Darwaza 1's aggregate `gate` job is a *required* status check, so adding
or removing a matrix leg never requires editing branch protection.

**Consequences.**
✅ fast feedback on the common case; ✅ expensive scans never block an
emergency fix; ✅ nightly failures raise an issue instead of being ignored;
⚠️ Darwaza 2 is opt-in by branch protection — documented in
[`../docs/RULES.md`](../docs/RULES.md).

**Superseded?** No.

---

## ADR-0009 — release-please drafts release PRs; a follow-up workflow tags the release

| field | value |
| --- | --- |
| status | Accepted |
| date | 2026-10-25 |
| deciders | repo maintainer + repo-ops agent |
| raised by | BUG-2026-0004 follow-up: release-please's POST /releases still 403s after the Darwaza-3 fixes (PR #28) |

**Context.** ADR-era release pipeline left `skip-github-release: false`,
so every push to `main` failed inside release-please with
`403 Resource not accessible by integration` — measured on the same
job, seconds apart and with the same token (run `40174328094`:
scratch `POST /releases` as `GITHUB_TOKEN` -> 201; release-please's own
attempt 3 s later -> 403; the identical payload from an operator token
answers 422 `already_exists`). Repo settings were verified clean
(`default_workflow_permissions=write`; no rulesets beyond `main`
protection), so this is a server-side verdict for the github-actions
integration, not a fixable misconfiguration. The state machine also
bit both sides: a merged release PR whose `autorelease: pending` label
never gets swapped makes release-please abort drafting the next
release PR ("There are untagged, merged release PRs outstanding",
run `40177869155`, blocking 2026.1.4 behind PR #30).

**Decision.** We will keep release-please only as the release-PR
drafting engine (`skip-github-release: true` in `release.yml`) and
create the tag + release in a separate workflow - `release-tag.yml`
runs on release-PR merge (`gh release create --target <merge SHA>`),
then swaps the label `autorelease: pending -> tagged` so the drafting
engine never wedges.

**Alternatives rejected.**

| option | why it lost |
| --- | --- |
| store an operator PAT as a secret for release-please | broadens the blast radius of one secret to full repo writes for a convenience `gh release create` already provides |
| call the releases endpoint with a different token type inside the action run | same 403 shape - the verdict belongs to the integration, not the token type |
| abandon release-please and draft release PRs by hand | loses conventional-commit -> semver mapping and changelog block maintenance |

**Consequences.**
- the Release workflow is green on every push (post-PR #28, zero failures);
- the tag is pinned to the release PR's merge SHA, immune to racing merges;
- the label swap closes the drafting loop without the action.
Costs: two workflows must stay in sync (the label glob needs the
literal `autorelease: pending` spelling - the no-space bug ate PR #30's
auto-tag once; fixed in PR #35); and `--verify-tag` semantics do not
apply (the tag never exists pre-create), so the workflow pins with
`--target` instead - the guard comment lives next to the step.

**Superseded?** No.

---

## Writing a new ADR

```markdown
## ADR-XXXX — <decision as a statement, not a question>

| field | value |
| --- | --- |
| status | Proposed | Accepted | Superseded by ADR-YYYY | Deprecated |
| date | YYYY-MM-DD |
| deciders | who |
| raised by | BUG-… / L-… / PR link (optional) |

**Context.** What forced a choice now? What constraints apply?
**Decision.** One sentence, active voice: "We will …"
**Alternatives rejected.** Table: option → why it lost.
**Consequences.** ✅ gains, ⚠️ costs. Be honest about the ⚠️ column.
**Superseded?** No, or ADR-YYYY.
```
