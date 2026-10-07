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
  listed origins; covered by a new CORS test (13 unit tests)
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
* **ci:** ignore Playwright/ZAP/Sonar/coverage artefacts in `.gitignore`
* **docs:** close the NOW-7 doc-drift sweep — `CONTEXT.md` re-derived (13
  specs / 6 workflows / 13 tests), `docs/` exists with `RULES`·`SECURITY`·
  `RELEASE`, all relative links across 24 Markdown files resolve

### Miscellaneous

* pin the npm audit policy to high/critical and fail the nightly on either
* document the stale-process diagnosis procedure (`BUG-2026-0002`)

---

<!--
The block below is rewritten in place by release-please. Everything above the
`release-please-block` marker is human-maintained release context.
-->
