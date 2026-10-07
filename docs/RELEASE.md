# 🚀 NovaPulse — Release Process

> NovaPulse releases are driven by **[release-please v4](https://github.com/googleapis/release-please)**
> from Conventional Commits. Humans merge code; the bot versions it, writes the
> changelog, tags it and publishes the GitHub Release. Rules that feed this
> process: [`RULES.md`](RULES.md) (L-31 commits, L-32 docs sync, L-33/L-34 gates).

---

## 1 · The two files release-please owns

| file | current content | role |
| --- | --- | --- |
| [`release-please-config.json`](../release-please-config.json) | one package at `"."` | *how* to release |
| [`.release-please-manifest.json`](../.release-please-manifest.json) | `{ ".": "2026.1.0" }` | *what is already released* — the bookkeeping baseline for the next bump |

`release-please-config.json`, key by key (as read from the file):

| key | value | meaning |
| --- | --- | --- |
| `packages["."].release-type` | `node` | Node release strategy (bumps `package.json`) |
| `packages["."].package-name` | `novapulse` | used in release PR titles / tags |
| `packages["."].changelog-path` | `.ai/CHANGELOG.md` | the changelog release-please maintains |
| `packages["."].include-component-in-tag` | `false` | plain tags: `v2026.1.0`, no `novapulse-` prefix |
| `packages["."].bump-minor-pre-major` | `false` | no minor→patch rewrite before major 1 |
| `packages["."].bump-patch-for-minor-pre-major` | `false` | `feat` stays a minor bump |
| `packages["."].draft` / `prerelease` | `false` / `false` | published releases, no pre-releases |
| `packages["."].separate-pull-requests` | `false` | one grouped release PR |
| `packages["."].extra-files` | `[{type: json, path: package.json, jsonpath: $.version}]` | keeps `package.json` `version` in step with the manifest |
| `sequential-calls` | `false` | GitHub API calls are batched |
| `group-pull-request-title-pattern` | `chore${scope}: release${component} ${version}` | the release PR title pattern |
| `release-please.bootstrap-sha` | `""` | empty — history is taken from existing tags/commits |

Both files are edited **only by the bot**. Hand-editing them or the generated
changelog entries will be overwritten on the next release.

---

## 2 · Versioning scheme

Verified: `package.json` → `2026.1.0`, manifest → `2026.1.0`, changelog heading
→ `## [2026.1.0](https://github.com/SudhirDevOps1/NovaPulse/compare/v2026.1.0...HEAD) (2026-10-07)`. The scheme is
**calendar-flavoured semver**: the leading component is the release year, the
remaining two follow normal semver rules applied by release-please to whatever
is currently in the manifest:

| commit merged to `main` | next version | notes |
| --- | --- | --- |
| `fix(...)` | `2026.1.1` | patch |
| `feat(...)` | `2026.2.0` | minor |
| `feat!:` or `BREAKING CHANGE:` footer | `2027.0.0` | **major — the year component jumps**; decide deliberately |
| `chore`/`docs`/`ci`/`refactor`/`test`/`style`/`perf`/`build`/`revert` alone | no release | no version change, no changelog entry |

`perf` and `refactor` are treated as patch-class by release-please's semver
rules. Because the leading number is a year, a breaking change in
October 2026 lands as `2027.0.0` — that is the intended, documented behaviour
of this scheme, not a bug to "fix" quietly.

---

## 3 · The `release.yml` workflow

[`.github/workflows/release.yml`](../.github/workflows/release.yml)
— *Release (release-please v4)*:

| aspect | value |
| --- | --- |
| triggers | `push` to `main`, and `workflow_dispatch` |
| concurrency | group `release-please`, `cancel-in-progress: false` (never abort a half-finished release) |
| permissions | `contents: write`, `pull-requests: write` |
| action | `googleapis/release-please-action@v4` with `secrets.GITHUB_TOKEN`, `config-file: release-please-config.json`, `manifest-file: .release-please-manifest.json` |
| outputs surfaced | `releases_created`, `pr`, `tag_name` appended to `$GITHUB_STEP_SUMMARY` in the *Summarise* step |
| relation to gates | intentionally decoupled from Darwazas 1–2 (see ADR-0008) |

**Nothing is ever tagged without a green CI:** the bot only opens/updates a
release PR; that PR is an ordinary PR and must clear Darwaza 1 (`gate`) and
Darwaza 2 (`e2e` + `zap`) before it can merge.

---

## 4 · How a tag and release are produced

```
commits merged to main (Conventional)
        │  every push to main → release.yml
        ▼
release-please computes the bump from commits since the last tag
        │
        ▼
opens/updates ONE release PR:  chore(release): release v<next>  (grouped title pattern)
        │  PR body = curated release notes
        ├── must pass Darwaza 1 + Darwaza 2, then a human merges it
        ▼
next run of release.yml detects the merged release PR
        ├── creates tag v<next>   (include-component-in-tag: false)
        ├── creates the GitHub Release with the notes
        ├── appends the section to .ai/CHANGELOG.md
        └── bumps .release-please-manifest.json and package.json → version
```

Confirm after every release:

```bash
git fetch --tags
git tag --list "v*" | sort -V | tail -3
node -p "require('./package.json').version"      # must equal the manifest
```

---

## 5 · What the changelog contains

`.ai/CHANGELOG.md` is generated from commit messages; sections appear in this
order when present: **⚠ BREAKING CHANGES**, **Features**, **Bug Fixes**,
**Miscellaneous**, each release headed by a compare link
`v<prev>...v<next>` and the release date. Header guidance in that file:

- Entries are release-please's; **do not hand-edit them** (they are rewritten).
- Human-written release context belongs **above** the
  `<!-- release-please-block -->` marker and in the **release PR description**,
  which release-please reuses as the GitHub Release notes.
- A commit that is not Conventional produces no entry — that is why
  `ci.yml`'s `commitlint` job lints **every** PR commit, and `.husky/commit-msg`
  lints every local one.

---

## 6 · Pre-release checklist

Run against the tree you are about to release; all boxes are mandatory
(L-32: docs sync, L-33: three Darwazas).

**Gates**

- [ ] **Darwaza 1** `ci.yml` green on `main` — job `gate` (typecheck, lint, test, build, docker, commitlint).
- [ ] **Darwaza 2** `e2e-gate.yml` green for the release PR — Playwright desktop + mobile **and** ZAP baseline with zero `W` findings.
- [ ] **Darwaza 3** latest nightly `security-scan.yml` green (CodeQL error alerts = 0, Semgrep clean, npm audit high/critical = 0) and no open `security-nightly` issue. If it is stale/red, run it manually via `workflow_dispatch` and fix before releasing.
- [ ] Local proof attached: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` all exit 0.

**Docs**

- [ ] `.ai/CONTEXT.md` re-synced — every number re-derived with the commands in its §10; `version` row matches the release being cut.
- [ ] `.ai/CHANGELOG.md` shows the pending section as release-please wrote it.
- [ ] `.ai/BUGS.md`, `.ai/DECISIONS.md`, `.ai/TODO.md` reflect current state (open work not described as shipped, L-02).
- [ ] `README.md` and `docs/` describe only what is on `main`; env var tables match `.env.example`.
- [ ] `docs/RULES.md` / `docs/SECURITY.md` still match the workflows and hooks they describe.

**Content sanity**

- [ ] Every PR commit since the last tag is Conventional and has an allowed scope.
- [ ] Breaking changes are intentional — they jump the leading `2026` component.
- [ ] No secrets, PII, or fabricated numbers anywhere in the release notes (L-19, L-03).

---

## 7 · Troubleshooting

| symptom | cause | fix |
| --- | --- | --- |
| No release PR appears | last commits are not Conventional (`chore`-only or unparseable) | check the *Summarise* step output in the run; rewrite/fix the commit messages |
| Wrong bump | a commit type was mis-classified | add a corrective Conventional commit (never edit the manifest by hand) |
| PR title looks odd | `group-pull-request-title-pattern` applied | cosmetic — merge normally; do not retitle |
| Version skew `package.json` vs manifest | interrupted run | re-run `release.yml` via `workflow_dispatch`; release-please reconciles both files |
| Release PR red | a gate failed | fix the code — never disable a gate (L-34) |
| Changelog entry missing | commit type outside the enum | fix the commit message; the next release picks it up |

## References

- [`../.ai/RULES.md`](../.ai/RULES.md) — L-02, L-31, L-32, L-33, L-42
- [`../.ai/CHANGELOG.md`](../.ai/CHANGELOG.md) — generated log + the block markers
- [`../commitlint.config.mjs`](../commitlint.config.mjs) — types, scopes, length limits
- [`.github/workflows/release.yml`](../.github/workflows/release.yml) · [`ci.yml`](../.github/workflows/ci.yml) · [`e2e-gate.yml`](../.github/workflows/e2e-gate.yml) · [`security-scan.yml`](../.github/workflows/security-scan.yml)
- [`../.ai/DECISIONS.md`](../.ai/DECISIONS.md) — ADR-0008 (three-darwaza CI)
