# 🛠️ Developer Guide — Actions, Settings & Monitoring

This is the "how does this machine actually work" document for someone who has
to **change code, get it merged, and keep an eye on it**. Everything below was
read out of the workflow files or off the live Settings screens on
**2026-10-07** — job names, triggers, toggles and artifact names are real, not
representative.

> New here? Read [`GETTING_STARTED.md`](GETTING_STARTED.md) first (install, use,
> fork, deploy). This file is the *operations* companion to it.

---

## 1 · The 60-second map

```
you edit code ──► branch ──► pull request ──► 4 required checks ──► merge to main
                                                                    │
                        ┌───────────────────────────────────────────┤
                        ▼                                           ▼
              Release (release-please)                    Monitor (every 5 min)
              opens `chore: release X` PR                 probe → state branch → Pages
                        │
                        ▼
              you merge that PR ──► tag + GitHub Release published
```

| Path | What lives there |
| :--- | :--- |
| `server.js`, `lib/` | HTTP server, probe / store / notify / analytics engines |
| `public/` | dashboard source · `site/` = its generated static copy (`pnpm run build`) |
| `test/` | 25 unit+integration specs (`node --test`) |
| `e2e/` | Playwright — 13 logical specs × 2 projects = **26 executions** |
| `tools/` | CI helpers: `gh-check.js` (prober), `gh-build.js` (static builder), `zap-policy.js` |
| `.github/workflows/` | the six workflows in §2 |
| `.github/dependabot.yml` | weekly grouped dependency PRs (Mondays 06:30 `Asia/Kolkata`) |
| `.ai/`, `.agent/` | architecture, rules, bug register, decision log, agent skills |
| `docs/` | this file · `GETTING_STARTED` · `RULES` · `SECURITY` · `RELEASE` |

---

## 2 · The six workflows — what runs, when, and what a red ✗ means

Everything lives in the **Actions** tab. Each run = a workflow; inside it are
**jobs**; a job is what reports a ✅/✗ next to a PR.

| # | Workflow (file) | Triggers | Jobs (exact names) | Required on PRs? |
| --- | --- | --- | --- | --- |
| 1 | **Darwaza 1 · Fast PR Gate** (`ci.yml`) | every PR to `main`, every push to `main` | `Quality gate (Node 20)` · `Quality gate (Node 22)` · `Quality gate (Node 24)` · `Docker build` · `Conventional commit lint` · **`gate`** | ✅ **`gate`** |
| 2 | **Darwaza 2 · Heavy PR Gate** (`e2e-gate.yml`) | every PR to `main`, manual | `Playwright E2E (desktop + mobile)` · `OWASP ZAP baseline (DAST)` | ✅ **both** |
| 3 | **Sonar quality gate** (`sonar.yml`) | every PR, every push to `main`, manual | `SonarQube scan + quality gate notification` | ✅ |
| 4 | **Darwaza 3 · Nightly Deep Audit** (`security-scan.yml`) | nightly `30 20 * * *` UTC (= **02:00 IST**), manual | `codeql` · `Semgrep SAST` · `NPM critical/high CVE audit` · `File issue on failure` | ❌ nightly only |
| 5 | **Release** (`release.yml`) | push to `main`, manual | `release-please` | ❌ |
| 6 | **Monitor** (`monitor.yml`) | push to `main`/`master`, cron `*/5 * * * *`, manual | `monitor` | ❌ |

### Darwaza 1 — the fast gate (`ci.yml`)

* **`Quality gate (Node 20/22/24)`** — matrix over three Node versions, each
  runs `pnpm run check` = `typecheck` (two tsconfigs) → `lint`
  (`--max-warnings=0`) → `test` (25 specs) → `build` (regenerates `site/`).
* **`Docker build`** — the image must build (Buildx, no push).
* **`Conventional commit lint`** — lints **every commit in the PR** against
  `commitlint.config.mjs`. Runs only on `pull_request` events, so pushes to
  `main` skip it (there is nothing to lint there).
* **`gate`** — the single aggregate: it fails unless every job above succeeded.
  This is what the branch-protection rule waits for, so one ✗ anywhere turns
  the merge button off.
* Concurrency `darwaza1-…-${ref}` with `cancel-in-progress: true` — a newer
  push to the same PR cancels the stale run instead of racing it.

### Darwaza 2 — the heavy gate (`e2e-gate.yml`)

* **`Playwright E2E (desktop + mobile)`** — installs browsers, runs the suite
  (desktop 1440×900 + Pixel 7). Playwright **starts its own server** on port
  `3210` with an isolated `e2e/.tmp-data`, so E2E never touches your real
  `data/monitors.json`. Artifact: **`playwright-report`** (14 days).
* **`OWASP ZAP baseline (DAST)`** — builds the scan target image, seeds a
  monitor so ZAP crawls a populated UI, runs `zaproxy/action-baseline@v0.15.0`,
  then `tools/zap-policy.js` evaluates the **real** `report_json.json`:
  **risk 3/2/1 block, risk 0 is a notice**. Artifacts: **`zap-baseline-report`**
  and ZAP's own **`zap_scan`** (14 days).

### Sonar (`sonar.yml`)

Runs tests with coverage, analyses, then calls the quality-gate API.
**If `SONAR_TOKEN` / `SONAR_HOST_URL` are missing it says so loudly**
(`::notice::Sonar skipped — SONAR_TOKEN / SONAR_HOST_URL secrets are not set`)
and exits green — it never pretends it analysed anything. That is the state
this repo is in **today** (Settings → Secrets shows *no secrets*, see §3).
Artifact: **`sonar-report`** (14 days).

### Darwaza 3 — nightly deep audit (`security-scan.yml`)

CodeQL (fails on error-severity alerts), Semgrep SAST (SARIF uploaded + artifact
`semgrep-report`), and an `npm audit` that **fails on any high/critical
advisory**. On failure the `notify` job files/updates a GitHub issue. Not part
of the merge gate — it is your overnight sweep.

### Release (`release.yml`)

`release-please` reads the Conventional Commits merged to `main` and either
opens or updates a PR titled **`chore: release <version>`** (see PR #2).
Merging **that** PR is what creates the tag and the GitHub Release — release
never pushes to `main` itself. Title shape is governed by the root
`pull-request-title-pattern` in `release-please-config.json`; don't rename it
(commitlint would reject it).

### Monitor (`monitor.yml`) — your ₹0 SaaS replacement

1. restore previous state from the **`state` branch**,
2. `tools/gh-check.js` probes every monitor in `config/monitors.json`,
   records history and fires Telegram/Discord/… alerts,
3. save state back to `state` (one force-pushed commit — the repo never grows),
4. `tools/gh-build.js` rebuilds `site/` from that state,
5. deploy `site/` to **GitHub Pages**.

A summary line like *"State unchanged"* means probes ran and nothing flipped —
that is the healthy case.

---

## 3 · Settings — what each screen is for, and what **this** repo has

Opened and read on 2026-10-07 (Settings is repo-owner only).

### 3.1 Branches — the protection rule (`main`)

| Setting | Value | What it does in practice |
| --- | --- | --- |
| Branch name pattern | `main` | applies to exactly 1 branch |
| Require a pull request before merging | ✅ (approvals **not** required) | direct `git push origin main` is rejected (`GH006: Protected branch update failed`); you *can* merge your own PR once green |
| Require status checks to pass | ✅ | merge button stays disabled until **`gate`**, **`OWASP ZAP baseline (DAST)`**, **`Playwright E2E (desktop + mobile)`** and **`SonarQube scan + quality gate notification`** are all green |
| Require branches to be up to date | ❌ off | fewer pointless re-runs when `main` moves |
| Do not allow bypassing the above settings | ✅ on | admins are bound by the rule too |
| Allow force pushes | ❌ off | history can't be rewritten |
| (deletions) | blocked | `main` can't be deleted |

Forks **do not inherit** this rule — see the fork section in
[`GETTING_STARTED.md`](GETTING_STARTED.md#4-mode-a--fork-and-deploy-on-github-0).

### 3.2 Actions → General

| Setting | Value | Why it matters |
| --- | --- | --- |
| Actions permissions | **Allow all actions and reusable workflows** | third-party actions used by the Darwazas (ZAP, CodeQL, Sonar scanners) can run |
| Pull request approvals | **Require approval for first-time contributors** | this is the *"Approve workflows to run"* button you click once on a first PR (including `github-actions[bot]` PRs) |
| Workflow permissions | **Read and write permissions** | Monitor must be able to push the `state` branch and deploy Pages |
| Allow GitHub Actions to create and approve pull requests | ✅ | release-please needs to open/update its release PR |

### 3.3 Secrets and variables → Actions

**This repository currently has no secrets** (verified 2026-10-07), so every
optional integration is off. The ones the code understands:

| Secret(s) | Enables |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Telegram alerts (a **pair** — both or neither) |
| `DISCORD_WEBHOOK_URL` | Discord alerts |
| `SLACK_WEBHOOK_URL` | Slack alerts |
| `NTFY_URL` (+ optional `NTFY_TOKEN`) | ntfy.sh alerts |
| `WEBHOOK_URL` (+ optional `WEBHOOK_SECRET`) | generic JSON webhook (`x-novapulse-secret` header) |
| `SONAR_TOKEN` + `SONAR_HOST_URL` | real Sonar analysis — without them the Sonar job announces it skipped |

Rules of the road:

* secrets are **never** passed to workflows triggered by a PR **from a fork**
  (GitHub platform rule — that's why forked deployments add their own);
* adding a secret does not re-run anything — push an empty commit or use
  *Re-run failed jobs*;
* the Settings panel shows a per-channel health pill so you can see which
  channels are actually wired.

### 3.4 Pages

* **Source: `GitHub Actions`** (required — if it ever gets unset, the Monitor
  run fails with `::error title=GitHub Pages is not enabled::` and tells you so
  in its summary).
* Live at `https://sudhirdevops1.github.io/NovaPulse/`, last deployed by the
  **Monitor** workflow; HTTPS enforced (default domain).
* The deploy job talks to the auto-created **`github-pages`** environment.

### 3.5 What is *not* configured (so you know the gap)

* **Rulesets**: none — the classic branch rule in §3.1 is doing the work.
* **Custom domain / Environments with secrets**: none.
* **Sonar**: skipped until `SONAR_TOKEN`/`SONAR_HOST_URL` are added (§2).
* **Alerts**: no channel secrets, so `/api/health` reports `telegram: false`,
  `discord: false`, … and the Settings pills show red.

---

## 4 · Day-to-day: ship a change

```bash
git checkout -b fix/short-description      # any branch except main
# … edit …
pnpm run verify                            # = check + e2e, exactly what CI runs
git commit -m "fix(ui): keep the toast visible"   # Conventional Commits
git push -u origin fix/short-description
```

1. Open the PR (the compare page prints the URL on push).
   Title is linted like a commit subject — types/scopes are in
   [`CONTRIBUTING.md`](../CONTRIBUTING.md).
2. Watch the **Checks** tab: 4 required checks (§2). First PR from a new
   account → click **Approve workflows to run** once.
3. All green → **Merge pull request**. Nothing else can land on `main`.
4. After the merge, `main` kicks off **Monitor**, **Release** (updates the
   `chore: release X` PR), **Sonar** and **Darwaza 1**.
5. When release-please's PR is green, merge it → tag + GitHub Release.

---

## 5 · Monitoring: where to look

| I want to know… | Go to | Notes |
| --- | --- | --- |
| Is any run going on? | [Actions](https://github.com/SudhirDevOps1/NovaPulse/actions) | filter box: `branch:main`, `event:pull_request`, or pick a workflow on the left |
| Did *my* PR pass? | PR → **Checks** tab | only the 4 **Required** ones block merging; the rest are informational |
| Why is a check yellow? | Actions → that run → failing job → **job summary** (top of the log) | summaries carry the ZAP policy table, Docker summary, Pages error hints, Sonar skip notice |
| What did ZAP/E2E find? | the run → **Artifacts** (`zap-baseline-report`, `zap_scan`, `playwright-report`, `sonar-report`, `semgrep-report`, `npm-audit-report` — kept **14 days**) | download and unzip; `zap-policy.js`'s verdict is in the job summary |
| Is the site live? | <https://sudhirdevops1.github.io/NovaPulse/> or `curl …/api/health` | health returns monitor count, channel status, version |
| Are probes healthy? | Actions → **Monitor** → latest run | `State unchanged` = healthy no-flip |
| What version is out? | [Releases](https://github.com/SudhirDevOps1/NovaPulse/releases) | created by merging the release PR |
| Quality trend | [SonarCloud summary](https://sonarcloud.io/summary/new_code?project=SudhirDevOps1_NovaPulse) | needs the Sonar secrets (§3.3) |

**"Expected — Waiting for status to be reported"** (what PR #4 shows while the
queue is busy) simply means GitHub hasn't started the runner yet — look at the
Actions list, where the run says **`queued`**. It is *not* a failure; the check
turns red only if the job actually fails.

---

## 6 · When a check goes red

1. Actions → the run → failing job → read the **job summary** first, then the
   first ❌ line of the log.
2. Fix, push — GitHub re-runs automatically. If the base moved under you or the
   failure was infra (`Create Artifact Container failed`, runner blip): **Re-run
   failed jobs**.
3. Common causes are tabulated in
   [`GETTING_STARTED.md` §7](GETTING_STARTED.md#7-troubleshooting-real-errors--real-fixes)
   (commitlint `scope-enum`, Pages source, missing Playwright browsers, port
   3210, rate limits).
4. **Never loosen a gate to make it pass** — if a Darwaza is wrong, fix the
   Darwaza and say why (`.ai/RULES.md` L-34, `.ai/BUGS.md`).

---

## 7 · Glossary

| Term | Meaning |
| --- | --- |
| **Darwaza** | "gate" — the three CI gates: fast (1), heavy (2), nightly (3) |
| **required check** | a status check branch protection demands before merging |
| **`gate` job** | Darwaza 1's aggregate job; red if any prerequisite failed |
| **release-please** | bot that turns Conventional Commits into a release PR |
| **`state` branch** | single force-pushed commit holding probe history (Mode A) |
| **`action_required`** | GitHub parked a workflow until a maintainer approves it |
| **`GH006`** | direct push to a protected branch — must go through a PR |
| **quarantine file** | `monitors.json.corrupt-<ts>` — untouched copy of an unreadable data file |

---

**Related:** [`GETTING_STARTED.md`](GETTING_STARTED.md) ·
[`CONTRIBUTING.md`](../CONTRIBUTING.md) · [`RELEASE.md`](RELEASE.md) ·
[`SECURITY.md`](SECURITY.md) · [`.ai/RULES.md`](../.ai/RULES.md)
