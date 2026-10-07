# 🚀 Getting Started — NovaPulse 2026

Everything in this page was executed against this repository — commands, URLs,
workflow names and error strings are real, not aspirational. Pick the path that
matches what you want to do:

| I want to… | Go to |
| :--- | :--- |
| Run it on my laptop in 60 seconds | [§1 Run locally](#1-run-locally-60-seconds) |
| Understand the dashboard & API | [§2 Use the app](#2-use-the-app) |
| Get alerts (Telegram/Discord/Slack/ntfy/webhook) | [§3 Alerts](#3-alerts-optional) |
| **Fork it and run it on GitHub for free (₹0)** | [§4 Mode A — fork & deploy](#4-mode-a--fork-and-deploy-on-github-0) |
| Run it in Docker / on a VPS | [§5 Mode B — self-hosted](#5-mode-b--docker-vps-or-any-server) |
| Know what CI does to my pull request | [§6 CI/CD map](#6-cicd-map-what-happens-when) |
| Fix a red build | [§7 Troubleshooting](#7-troubleshooting-real-errors--real-fixes) |

---

## 1. Run locally (60 seconds)

**Prerequisites:** Node.js **18+** (CI tests 20/22/24) and **pnpm 12+**
(`corepack enable` switches npm's bundled pnpm on).

```bash
git clone https://github.com/SudhirDevOps1/NovaPulse.git
cd NovaPulse
pnpm install          # 2 runtime deps: express + compression
pnpm start            # production server  → http://localhost:3000
# or, with auto-reload while you edit:
pnpm dev
```

Sanity check (must return HTTP 200 with JSON):

```bash
curl -fsS http://localhost:3000/api/health
# {"ok":true,"version":"2026.1.1","node":"v24.19.0",...,"monitors":1,...}
```

> First boot creates `data/monitors.json` with one sample monitor, so the
> dashboard is never an empty shell.

### Every script you'll use

| Command | What it does |
| :--- | :--- |
| `pnpm start` | Run the server (`server.js`). |
| `pnpm dev` | Same, with `node --watch` auto-reload. |
| `pnpm test` | Unit + integration suite (`node --test`). |
| `pnpm run check` | **The PR gate:** typecheck ×2 → lint (`--max-warnings=0`) → tests → static build. |
| `pnpm run e2e` | Playwright end-to-end suite (26 specs × desktop + mobile). |
| `pnpm e2e:install` | Download the Chromium browsers Playwright needs (**run once**). |
| `pnpm run verify` | Everything CI requires locally: `check` + `e2e`. |
| `pnpm run lint:fix` | Auto-fix lint findings. |
| `pnpm run build` | Regenerate the static `site/` copy used by GitHub Pages. |

---

## 2. Use the app

Open <http://localhost:3000> and click **New monitor**.

| Field | Meaning | Good starting value |
| :--- | :--- | :--- |
| **Name** | Display name on cards, badges and alerts. | `My API` |
| **URL** | Target. `https://…` for HTTP, `tcp://host:5432` for a port. | `https://example.com/health` |
| **Type** | `HTTP(S) request` or `TCP port`. | `HTTP(S) request` |
| **Interval (sec)** | Time between probes. Hard limits: **10 – 86400**. | `60` |
| **Timeout (ms)** | Abort the probe after this long. | `10000` |
| **Method / Expected status** | e.g. `GET` + `200-299`. Catches a 200 that shouldn't be one. | `GET`, `200-299` |
| **Keyword** | Response body must contain this text (catches "HTTP 200 but crashed"). | `healthy` |
| **Warn after (ms)** | Above this latency the monitor turns **Slow/degraded** instead of Up. | `0` (off) |
| **Failures before down** | Consecutive failures required before an **Down** alert. | `1` |
| **Check SSL** | Watch certificate expiry (warns at 14/21 days). | on |
| **Headers / Body** | Sent with the probe (`Authorization: Bearer …`, JSON payload). | – |

Other things worth knowing on day one:

- **Drawer** — click a monitor card: pause/resume, run a check now, CSV export,
  per-monitor charts.
- **Badges** — embed live status in any README:
  `GET /api/badge/fleet.svg` or `/api/badge/<monitor-id>.svg`
  (append `?style=for-the-badge`).
- **Status page** — `status.html` is the read-only public view; in Mode A it is
  served from GitHub Pages.
- **Backup** — the whole database is one JSON file:

  ```bash
  curl -fsS http://localhost:3000/api/export -o backup.json
  curl -X POST "http://localhost:3000/api/import?mode=replace" \
    -H 'content-type: application/json' --data-binary @backup.json
  ```

- **Themes** — dark/light toggle plus the `⚡` neon cyber mode in the top bar.

---

## 3. Alerts (optional)

Zero dependencies — pick any mix. Locally put them in `.env` (copy
`.env.example`); in Mode A add them as **Actions secrets**.

| Channel | Variables |
| :--- | :--- |
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (token from `@BotFather`) |
| Discord | `DISCORD_WEBHOOK_URL` |
| Slack | `SLACK_WEBHOOK_URL` |
| ntfy.sh | `NTFY_URL` (+ optional `NTFY_TOKEN`) |
| Webhook | `WEBHOOK_URL` (+ `WEBHOOK_SECRET` → `x-novapulse-secret` header) |

Alerts fire on **Down**, **Recovered** (with outage duration) and — if you set
`ALERT_ON_DEGRADED=1` — **Slow/degraded**. The Settings panel shows a health
pill per channel so you can see at a glance which ones are wired.

---

## 4. Mode A — fork and deploy on GitHub (₹0)

This is the "I don't want to pay for a server" mode: GitHub Actions probes every
5 minutes, GitHub Pages serves the dashboard. **A fork is the intended way to
get your own copy.**

1. **Fork** the repository on GitHub (top-right **Fork** button). Your copy is
   now `https://github.com/<your-user>/NovaPulse`.

2. **Turn Actions on** — for a brand-new fork GitHub disables workflows until
   you say so:
   **Actions →** *«I understand my workflows, go ahead and enable them»*.

3. **Turn Pages on** (this is the #1 first-run failure):
   **Settings → Pages → Build and deployment → Source: `GitHub Actions`**.

4. **Add alert secrets** *(optional)*: **Settings → Secrets and variables →
   Actions → New repository secret** — `TELEGRAM_BOT_TOKEN`, `NTFY_URL`, …

5. **Tell it what to watch** — edit
   [`config/monitors.json`](../config/monitors.json) in the GitHub web editor
   and commit to `main`. Example entry:

   ```json
   {
     "name": "My site",
     "url": "https://example.com",
     "type": "http",
     "intervalSec": 300,
     "timeoutMs": 10000,
     "expectedStatus": "200-299",
     "failuresBeforeDown": 2
   }
   ```

6. **Watch it go live**: the **Monitor** workflow runs on every push *and* on a
   `*/5 * * * *` cron. Open **Actions → Monitor** and wait for green — your site
   is then at:

   ```
   https://<your-user>.github.io/NovaPulse/          (dashboard)
   https://<your-user>.github.io/NovaPulse/status.html (public status page)
   ```

7. **Your check history** lives on the `state` branch (one force-pushed commit,
   so the repo never grows). The working copy of it is `gh-state/`.

> ⚠️ **Forks do not inherit settings.** Branch protection, Actions secrets,
> environments and Pages config all start empty in a fork. To get the same
> gates as upstream: **Settings → Branches → Add classic branch protection
> rule → pattern `main`**, then tick *Require a pull request before merging*,
> *Require status checks to pass* and add `gate`,
> `OWASP ZAP baseline (DAST)`, `Playwright E2E (desktop + mobile)` and
> `SonarQube scan + quality gate notification`.

---

## 5. Mode B — Docker, VPS, or any server

### 🐳 Docker

```bash
docker build -t novapulse .
docker run -d --name novapulse -p 3000:3000 -v novapulse-data:/app/data novapulse
curl -fsS http://localhost:3000/api/health     # must return "ok":true
```

### 🐳 Docker Compose

```bash
cp .env.example .env      # every value is optional; compose reads it
docker compose up -d --build
```

The volume/persistent directory is `./data` (`UPTIME_DATA_DIR`) — back it up and
your entire monitoring state moves with it.

### 📦 Node.js on a VPS (PM2)

```bash
git clone https://github.com/SudhirDevOps1/NovaPulse.git /opt/novapulse
cd /opt/novapulse
pnpm install --prod
pm2 start ecosystem.config.js     # NOT "node index.js" — the entry is server.js
pm2 save && pm2 startup           # survive reboots
```

`ecosystem.config.js` already sets production logging, `PORT=3000` and the data
directory, and pins `instances: 1` — the JSON store is single-writer.

### ☁️ Free cloud recipes

Render / Fly.io / Railway steps live in the
[README § Option C](../README.md#option-c-free-cloud-deployment-recipes).
The two rules that matter everywhere: start command is `pnpm start`, and the
disk must be mounted where `UPTIME_DATA_DIR` points.

---

## 6. CI/CD map (what happens when)

Six workflows, all under [`.github/workflows/`](../.github/workflows/):

| Workflow | Trigger | What it proves |
| :--- | :--- | :--- |
| **Darwaza 1 · Fast PR Gate** (`ci.yml`) | every PR + push to `main` | typecheck, ESLint at 0 warnings, unit tests on Node 20/22/24, Docker build, **commitlint**. Summary job: **`gate`**. |
| **Darwaza 2 · Heavy PR Gate** (`e2e-gate.yml`) | every PR | Playwright E2E (desktop + mobile) and the OWASP ZAP baseline DAST scan, evaluated by `tools/zap-policy.js`. |
| **Sonar quality gate** (`sonar.yml`) | every PR + push | SonarCloud analysis + quality-gate notification. |
| **Darwaza 3 · Nightly Deep Audit** (`security-scan.yml`) | nightly 02:00 + manual | CodeQL, Semgrep, `npm audit` — files an issue when it finds something. |
| **Release** (`release.yml`) | push to `main` + manual | `release-please` opens/updates the release PR, and on merge tags + publishes the GitHub Release. |
| **Monitor** (`monitor.yml`) | push + every 5 min | probes your monitors, pushes state, deploys `site/` to Pages. |

**Branch protection on `main` (enabled on this repo):** pull requests only, no
force pushes, no admin bypass, and these four checks must be green before merge
— `gate`, `OWASP ZAP baseline (DAST)`, `Playwright E2E (desktop + mobile)`,
`SonarQube scan + quality gate notification`. No approvals are required, so a
solo maintainer can merge their own PR once it's green.

**Release flow:** merge a PR containing a `feat:`/`fix:` → the Release workflow
opens `chore: release <version>` → merge that → tag + GitHub Release are
published automatically.

---

## 7. Troubleshooting (real errors → real fixes)

| You see | Why | Fix |
| :--- | :--- | :--- |
| **«Approve workflows to run»** on a PR | GitHub requires approval for workflows triggered by first-time contributors (this includes every bot PR). | Repo maintainer: open the PR → click **Approve workflows to run**. If base moved after approval, use **Re-run failed jobs**. |
| `::error title=GitHub Pages is not enabled::` (Monitor run) | Pages source is not "GitHub Actions". | **Settings → Pages → Build and deployment → Source: `GitHub Actions`**, then re-run the workflow (it prints the same hint in the job summary). |
| `scope must be one of [api, probe, store, …] [scope-enum]` | Commit scope isn't in the allowed list. | Use a bare type (`fix: …`) or a scope from the list in `commitlint.config.mjs`. Full rules: [CONTRIBUTING.md](../CONTRIBUTING.md). |
| `footer must have leading blank line` | A `Closes:`/`Refs:` footer sat directly under a paragraph. | Put a blank line before the footer. |
| Playwright: `Executable doesn't exist … chromium` | Browsers not downloaded yet. | `pnpm e2e:install` (once), then `pnpm run e2e`. |
| E2E hangs at *"webServer"* or fails on port | Port **3210** already has a server. | Stop it (or `E2E_PORT=3300 pnpm run e2e`). Playwright starts its own server with an isolated `e2e/.tmp-data`. |
| Rate-limit 429s while hammering the API | Built-in limiter: 240 req/min/IP. | `RATE_LIMIT=off` (tests only) or raise `RATE_LIMIT_MAX`. |
| A red check you believe is stale | The PR snapshot used an older `main`. | **Actions → the run → Re-run failed jobs** (never weaken a gate to make it pass). |
| Release PR title looks like `chore: release 2026.x.y` | That title is required — release-please parses it to build the tag. | Don't rename it. |
| Where did my data go? | Everything is one JSON file. | Daemon mode: `data/monitors.json`. Mode A: `state` branch (`gh-state/` locally). Export any time: `GET /api/export`. |
| Monitor run says *«State unchanged»* | Probes ran, nothing flipped. | Normal — that's the healthy case. |

Still stuck? Check the [bug register](../.ai/BUGS.md) (every incident has its
symptom, root cause, fix and the CI run that proved it) or open an issue.

---

## 8. Where to go next

- [README](../README.md) — feature tour, comparison table, full REST API table
- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to get a PR merged here
- [docs/SECURITY.md](SECURITY.md) — threat model & private disclosure
- [docs/RELEASE.md](RELEASE.md) — how versioning and the release PR work
- [docs/RULES.md](RULES.md) — the human-facing rulebook
- [.ai/ARCHITECTURE.md](../.ai/ARCHITECTURE.md) — how the code is laid out
