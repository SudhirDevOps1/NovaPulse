# 📋 NovaPulse — Changelog

> **This file is maintained by [release-please](https://github.com/googleapis/release-please)**
> from Conventional Commits merged to `main`. Do not hand-edit entries — they
> will be overwritten on the next release. Hand-written notes belong in the PR
> description, where release-please picks them up as the release notes.
>
> Versioning: [Conventional Commits](https://www.conventionalcommits.org/) —
> `feat` → minor · `fix` → patch · `BREAKING CHANGE` footer → major.
> Scope enum lives in `commitlint.config.mjs`.
> Runbook: [`../docs/RELEASE.md`](../docs/RELEASE.md).

<!-- release-please-block -->
<!-- release-please-unblock -->

## [2026.1.2](https://github.com/SudhirDevOps1/NovaPulse/compare/v2026.1.1...v2026.1.2) (2026-10-07)


### Bug Fixes

* **ci:** close the unterminated here-string quote in the commitlint step ([82ee10b](https://github.com/SudhirDevOps1/NovaPulse/commit/82ee10be5a919293eea58aa66f9123a8a6c23b2c))
* **ci:** fetch only missing SHAs so the commitlint job can actually lint ([bcf6e74](https://github.com/SudhirDevOps1/NovaPulse/commit/bcf6e747cc76b283313f1062a2c2956f03bc330a))
* **security:** send COEP/CORP and move the ZAP action off the retired artifact service ([8a26a6c](https://github.com/SudhirDevOps1/NovaPulse/commit/8a26a6c65fe73103431b15dfb5b581133150958e))
* **store:** normalise at boot, quarantine corrupt data, keep imported methods ([c0f0e82](https://github.com/SudhirDevOps1/NovaPulse/commit/c0f0e828077c5f172997b07afbc0a6f8965622d3))
* **store:** normalise at boot, quarantine corrupt data, keep imported methods ([ce57e94](https://github.com/SudhirDevOps1/NovaPulse/commit/ce57e9461547e5283f30b6c11e39a8e7f35a5124))

## [2026.1.1](https://github.com/SudhirDevOps1/NovaPulse/compare/v2026.1.0...v2026.1.1) (2026-10-07)


### Bug Fixes

* **ci:** enforce Darwaza 2's ZAP policy against a report that exists ([34680fa](https://github.com/SudhirDevOps1/NovaPulse/commit/34680fa5b7a0285a7db63a843126c74a9b7a4f54))
* **ci:** make release-please's title pass commitlint by dropping ${scope} ([1ce9378](https://github.com/SudhirDevOps1/NovaPulse/commit/1ce93782d231d54a599bd17da94a4f42f80b850a))
* **ci:** unblock the release workflow and make the Pages deploy failure self-explanatory ([7e8ee37](https://github.com/SudhirDevOps1/NovaPulse/commit/7e8ee370eff7b0b5de91a0a5fe7d69d46166ca67))
* wire up save notifications, honour comma-separated ALLOW_ORIGIN and finish the NovaPulse rebrand ([1ec66ac](https://github.com/SudhirDevOps1/NovaPulse/commit/1ec66ac762a16ad36b66c6988b5f4aead5854ef6))

## [2026.1.0](https://github.com/SudhirDevOps1/NovaPulse/compare/v2026.1.0...HEAD) (2026-10-07)

### ⚠ BREAKING CHANGES

* **ui:** the modal submit button is now associated with its form via the
  HTML5 `[form]` attribute. Any code that assumed `type="submit"` alone would
  submit a form from outside its subtree is now incorrect — see
  `BUG-2026-0001`.

### Features

* **ci:** add the Three Darwazas — Fast PR Gate, Heavy PR Gate (Playwright +
  OWASP ZAP baseline) and the nightly Deep Audit (CodeQL v4, Semgrep, npm
  audit with auto-filed issues)
* **ci:** add release-please v4 with a manifest, JSON version bump and
  grouped release PRs
* **ci:** add Dependabot with patch/minor grouped and majors isolated
* **security:** add commitlint + Husky pre-commit gate (typecheck + lint)
  and commit-msg enforcement
* **docs:** add the `.ai/` knowledge base (43 Golden Laws, architecture,
  database, security, PRD, decisions, bugs, changelog, prompts) and the
  `.agent/skills/` skill pack
* **tools:** add `typecheck` (`tsc --noEmit` over app + service worker) and
  `lint` (`eslint . --max-warnings=0`) as first-class scripts
* **ci:** add a fourth scanner — `sonar.yml` (SonarQube/SonarCloud analysis
  from real `node --test` coverage) that evaluates the quality gate through
  the API, files/updates a `sonar-quality-gate` issue, comments on the PR,
  and closes the issue when green; states plainly in the job summary when the
  `SONAR_TOKEN` / `SONAR_HOST_URL` secrets are absent instead of faking a pass
* **docs:** add the MIT `LICENSE` and `sonar-project.properties`
* **ui:** add professional GitHub links — a topbar icon button and a
  sidebar "Star on GitHub" card pointing at
  `SudhirDevOps1/NovaPulse`, plus a "Source on GitHub" footer link on the
  public status page (no fabricated star counts anywhere)

### Bug Fixes

* **ui:** associate the monitor form's submit button with its form so saving
  actually submits, notifies the user, and creates the monitor
  ([BUG-2026-0001](BUGS.md))
* **api:** honour a comma-separated `ALLOW_ORIGIN` — split the list, echo only
  the caller's origin when it is listed, and answer preflights solely for
  listed origins; covered by a new CORS test (19 unit tests today)
* **status:** read the theme preference from `novapulse.theme` first with a
  legacy `kestrel.theme` fallback, so the public status page and the
  dashboard can no longer disagree after a theme switch
* **brand:** finish the NovaPulse rebrand — boot log, CSV/JSON export
  filenames, PM2 app name, Docker service/image, fleet badge label and the
  stylesheet banner now say NovaPulse (no `kestrel` left outside documented
  legacy localStorage fallbacks)
* **ui:** render a success toast after create/edit so every mutation gives
  feedback ([RULES L-40](RULES.md))
* **types:** resolve all 53 `tsc` errors — JSDoc signatures for optional
  destructured params, DOM element narrowing, service-worker globals
* **lint:** resolve all 6 ESLint errors — unused bindings, useless
  assignments, promise-executor return
* **docs:** correct repository URLs, badges and metadata for
  `SudhirDevOps1/NovaPulse`
* **docs:** replace every stale `kestrel` / `<you>` reference in the README,
  `.env.example` and the deploy snippets with the real repository, image and
  webhook-header names (`x-novapulse-secret` matches `lib/notify.js`)
* **ci:** make the E2E suite deterministic — open the off-canvas sidebar
  before clicking nav links, use exact label matching, reset server state
  through the `request` fixture, and address the topbar CTA by id
  ([BUG-2026-0003](BUGS.md))
* **ci:** fix the release-please schema rejection and make both failing
  workflows self-diagnosing — Pages preflight with the exact UI path, a
  failure-time cause list for release-please
  ([BUG-2026-0004](BUGS.md))
* **ci:** drop `${scope}` from release-please's `pull-request-title-pattern`
  (and its group twin) so the bot stops emitting `chore(main): …`, which
  commitlint rightly rejects — the group key alone changed nothing because a
  single-package manifest never takes that path; retitle merged PR #1 to the
  compliant shape so release-please could parse it and publish `v2026.1.1`
  ([BUG-2026-0005](BUGS.md))
* **ci:** stop Darwaza 1's commitlint job from dying before it lints —
  `git fetch --depth=0` is invalid (`fatal: depth 0 is not a positive
  number`, exit 128), so the required `gate` check was red on every PR for a
  reason unrelated to the code; fetch only what is actually missing
  ([BUG-2026-0007](BUGS.md))
* **test:** keep fixture ZAP output off real CI surfaces — `pnpm test` runs
  with `GITHUB_STEP_SUMMARY` pointing at Darwaza 1's job summary, so each
  `main()` call in the zap-policy specs published a fake "blocking findings"
  table; the spec now unsets the variable and asserts its output against a
  temp file instead, keeping 19/19 coverage
  ([BUG-2026-0008](BUGS.md))
* **ci:** make Darwaza 2's DAST job enforce the policy it always claimed to —
  drop the two inputs `zaproxy/action-baseline` does not declare, stop the
  action from filing issues this token may not write, and evaluate the real
  `report_json.json` with `tools/zap-policy.js` (risk 1–3 blocks, risk 0 is a
  notice) instead of grepping a file ZAP never produces; 6 new specs take the
  suite to 19/19
  ([BUG-2026-0006](BUGS.md))
* **security:** send `Cross-Origin-Embedder-Policy: require-corp` and
  `Cross-Origin-Resource-Policy: same-origin` on every response — the two
  real findings ZAP had been reporting all along — while badge SVGs keep
  `cross-origin` so the documented embeddable-badge feature still works
  ([BUG-2026-0006](BUGS.md))
* **ci:** pin `zaproxy/action-baseline@v0.15.0` — v0.12.0 uploads through the
  retired artifact service and aborted the scan with `Create Artifact
  Container failed` (v0.14.0 is the release that stopped using the
  deprecated `upload-artifact`)
  ([BUG-2026-0006](BUGS.md))
* **ci:** ignore Playwright/ZAP/Sonar/coverage artefacts in `.gitignore`
* **docs:** close the NOW-7 doc-drift sweep — `CONTEXT.md` re-derived (13
  specs / 6 workflows / 19 tests), `docs/` exists with `RULES`·`SECURITY`·
  `RELEASE`, all relative links across 24 Markdown files resolve

### Miscellaneous

* pin the npm audit policy to high/critical and fail the nightly on either
* document the stale-process diagnosis procedure (`BUG-2026-0002`)

---

<!--
The block below is rewritten in place by release-please. Everything above the
`release-please-block` marker is human-maintained release context.
-->
