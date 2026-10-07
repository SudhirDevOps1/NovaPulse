# 📘 NovaPulse — Human-Facing Rulebook

> **Companion to the canonical rulebook.** The 43 Golden Laws live in
> [`../.ai/RULES.md`](../.ai/RULES.md) — that file is the source of truth and is
> quoted there in full. This document is the *daily-work* view: what the laws
> mean when you sit down to change something, which command enforces which law,
> and how commits and PRs are judged. **Law > individual preference > aesthetic
> taste.** If this file ever disagrees with `.ai/RULES.md`, `.ai/RULES.md` wins.

---

## 1 · The six groups, summarised

| group | laws | in daily work it means | primary enforcement |
| --- | --- | --- | --- |
| **A — Truth & Anti-Yes-Man** | L-01…L-08 | research before agreeing; no vaporware, no fake demos; evidence for every claim (L-03/L-04); state the cost of a proposal (L-05); correct false premises (L-08) | PR review + verification guides ([`../.agent/skills/vibe-proof/SKILL.md`](../.agent/skills/vibe-proof/SKILL.md)) |
| **B — Fail-Closed Security** | L-09…L-18 | refuse to run rather than run unprotected; zero inline fallback secrets; never log a secret; allowlist public payloads; `escapeHtml()`; URL scheme allowlist; CSRF on mutations; rate limit on; security headers intact | Darwaza 3 (CodeQL, Semgrep, ZAP) + review |
| **C — Zero PII** | L-19…L-24 | store monitor data only; mask anything person-shaped; treat logs/exports as public; no third-party telemetry; bounded retention | Darwaza 3 + review |
| **D — Zero-Defect Quality Gate** | L-25…L-34 | the 7-step lifecycle every time; typecheck/lint/tests 100% clean; no placeholders or mock data; atomic Conventional Commits; docs synced; three Darwazas green; never weaken a gate | `ci.yml`, `.husky/pre-commit`, `eslint`, `tsc`, `commitlint` |
| **E — Data Integrity** | L-35…L-39 | atomic tmp+rename writes; auto-migrating, non-destructive schema; failure isolated per statement; one writer per `data/` | `test/api.test.js`, review |
| **F — Process & Communication** | L-40…L-43 | every mutation notifies; read before you write; no silent behaviour changes; leave the file better | e2e guards + review |

Full wording of each law: [`../.ai/RULES.md`](../.ai/RULES.md).

---

## 2 · Quick reference — law → enforcement

| law(s) | enforced by | the command / artifact you run |
| --- | --- | --- |
| L-01, L-02, L-05…L-08 | review | PR review; evidence attached to the PR |
| L-03, L-04 | review + skill | verification guide with command + verbatim output |
| L-09, L-10, L-11 | review + SAST | `rg "\|\| ['\"]" server.js lib public tools` · Darwaza 3 |
| L-12, L-13, L-14, L-15 | review + tests | `pnpm test` (headers, status allowlist), `rg innerHTML public/js` |
| L-16 | review | `rg "app\.(post\|patch\|delete)" server.js` |
| L-17 | code default + review | `lib/limits.js` gate; `rg RATE_LIMIT -g '!node_modules' .` |
| L-18 | tests | `pnpm test` → *sends hardened security headers*; `e2e/dashboard.spec.mjs` → *sends hardened security headers* |
| L-19…L-24 | review + Darwaza 3 | `security-scan.yml`, `docs/SECURITY.md` |
| L-25 | process | the 7-step lifecycle (§3 below) |
| **L-26 typecheck** | tooling | `pnpm run typecheck` → exit 0 (both `tsconfig.json`, `tsconfig.sw.json`) |
| **L-27 lint** | tooling | `pnpm run lint` → `eslint . --max-warnings=0`, 0 warnings |
| **L-28 tests** | tooling | `pnpm test` → `node --test`, 25/25 |
| L-29, L-30 | review + lint | no `TODO`/`FIXME`/stubs/canned data; `no-console` etc. via `eslint.config.mjs` |
| **L-31 commits** | hooks + CI | `.husky/commit-msg` → `commitlint`; `ci.yml` job `commitlint` |
| L-32 | process | sync `.ai/` files every 3–4 changes and before releases |
| L-33 | CI | Darwazas 1 (`ci.yml`), 2 (`e2e-gate.yml`), 3 (`security-scan.yml`) |
| L-34 | review | never `continue-on-error`, `|| true`, or a loosened threshold |
| L-35…L-39 | tests + review | `pnpm test` (store lifecycle), single-writer contract (`instances: 1`) |
| L-40 | e2e | *save shows notification*, *validation surfaces inline*, *edit save notifies* |
| L-41…L-43 | review | structure, naming, changelog entry, no dead paths |

Commands are run from the repository root with `pnpm` (`npm` runs the same
scripts). CI runs the identical commands on Node 20 / 22 / 24.

---

## 3 · The 7-step lifecycle (L-25 — mandatory, in order)

No commit may exist before steps 1–6 have passed.

| # | step | what "done" looks like |
| --- | --- | --- |
| 1 | **Plan & research** | read the relevant `.ai/` files and the code; premises verified (L-08); scope bounded (L-07) |
| 2 | **Code** | matches existing structure and naming (L-41); no placeholders (L-29); honest empties instead of mock data (L-30) |
| 3 | **Typecheck** | `pnpm run typecheck` → 0 errors |
| 4 | **Lint** | `pnpm run lint` → 0 problems (warnings are failures) |
| 5 | **Tests** | `pnpm test` fully green; `pnpm run e2e` green for UI changes |
| 6 | **Verification guide** | command + verbatim output + pass criterion attached ([`vibe-proof`](../.agent/skills/vibe-proof/SKILL.md)) |
| 7 | **Atomic Conventional commit** | one logical change, `type(scope): subject`, passes `commitlint` |

Darwaza 0 (local) mirrors step 3–4 automatically: `.husky/pre-commit` runs
`npm run typecheck` and `npm run lint`; `.husky/commit-msg` runs `commitlint`.
`.husky` is installed by `pnpm install` (`prepare` script), or forced with
`pnpm run hooks:install`.

---

## 4 · Commits and PRs

### Commit message format

```
type(scope): subject ≤ 90 chars
<blank line>
body lines ≤ 120 chars
```

- **Types** must be accepted by `@commitlint/config-conventional`:
  `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
  `style`, `test`. Types are lowercase; a subject is required and must not end
  with a full stop.
- **Scopes are optional but, when present, must come from the enum in
  [`commitlint.config.mjs`](../commitlint.config.mjs)** (L-31):

  | | | | |
  | --- | --- | --- | --- |
  | `api` | `probe` | `store` | `analytics` |
  | `notify` | `checker` | `ui` | `dashboard` |
  | `status` | `security` | `ci` | `docs` |
  | `deps` | `release` | `monitor` | `tools` |

- **Length limits:** header ≤ 120, subject ≤ 90, body line ≤ 120.
- **Why it matters:** `release-please` derives the next version and
  [`../.ai/CHANGELOG.md`](../.ai/CHANGELOG.md) from these messages —
  `feat` → minor, `fix` → patch, `feat!`/`BREAKING CHANGE` → major.

```bash
git commit -m "fix(ui): submit monitor form from the modal footer"   # ✅
git commit -m "bugfix: quick change"                                 # ✗ unknown type
git commit -m "feat(frontend): add widget"                           # ✗ scope not in enum
```

### PR expectations

1. One logical change per PR; commits atomic and Conventional.
2. Verification evidence attached (L-04) — commands, output, screenshots for UI.
3. All three Darwazas green: `ci.yml` (`gate`), `e2e-gate.yml`
   (Playwright + ZAP), latest `security-scan.yml` nightly.
4. Changelog-worthy behaviour changes noted (L-42); docs synced (L-32).
5. No gate disabled, skipped or loosened to get green (L-34).
6. Trade-offs and costs stated in the PR body (L-05).

### When you must break a law

Write an ADR in [`../.ai/DECISIONS.md`](../.ai/DECISIONS.md) with
`Status: Accepted` *before* merging — never a silent exception.

---

## 5 · Docs sync cadence (L-32)

After every **3–4 features / bug fixes / refactors**, and always before a
release, refresh `.ai/CONTEXT.md`, `.ai/CHANGELOG.md`, `.ai/BUGS.md`,
`.ai/DECISIONS.md` and `.ai/TODO.md`. Regenerate numbers by running the
commands in `.ai/CONTEXT.md` §10 — never hand-edit a measured value.

---

## 6 · Where to find what

| question | file |
| --- | --- |
| the laws in full, with the Enforcement Map | [`../.ai/RULES.md`](../.ai/RULES.md) |
| shape of the system, layers, "where to change what" | [`../.ai/ARCHITECTURE.md`](../.ai/ARCHITECTURE.md) |
| live numbers, route map, gate status | [`../.ai/CONTEXT.md`](../.ai/CONTEXT.md) |
| decisions and ADRs | [`../.ai/DECISIONS.md`](../.ai/DECISIONS.md) |
| incident register | [`../.ai/BUGS.md`](../.ai/BUGS.md) |
| release runbook | [`RELEASE.md`](RELEASE.md) |
| disclosure policy & hardening | [`SECURITY.md`](SECURITY.md) |
| skill pack (security, proof, frontend, SEO) | [`../.agent/skills/`](../.agent/skills/) |
