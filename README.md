# NovaPulse 2026

[![Darwaza 1 · Fast PR Gate](https://github.com/SudhirDevOps1/NovaPulse/actions/workflows/ci.yml/badge.svg)](https://github.com/SudhirDevOps1/NovaPulse/actions/workflows/ci.yml)
[![Darwaza 2 · E2E + ZAP](https://github.com/SudhirDevOps1/NovaPulse/actions/workflows/e2e-gate.yml/badge.svg)](https://github.com/SudhirDevOps1/NovaPulse/actions/workflows/e2e-gate.yml)
[![Darwaza 3 · Nightly Security](https://github.com/SudhirDevOps1/NovaPulse/actions/workflows/security-scan.yml/badge.svg)](https://github.com/SudhirDevOps1/NovaPulse/actions/workflows/security-scan.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/SudhirDevOps1/NovaPulse?style=flat&logo=github)](https://github.com/SudhirDevOps1/NovaPulse/stargazers)
[![Issues](https://img.shields.io/github/issues/SudhirDevOps1/NovaPulse)](https://github.com/SudhirDevOps1/NovaPulse/issues)

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-SudhirDevOps1%2FNovaPulse-181717?logo=github&logoColor=white)](https://github.com/SudhirDevOps1/NovaPulse)
**Star the repo** → [github.com/SudhirDevOps1/NovaPulse ⭐](https://github.com/SudhirDevOps1/NovaPulse)

</div>

> Badges are live: every one resolves against this repository's real Actions
> runs, license file and GitHub API — no static or fabricated numbers.

**NovaPulse 2026** — autonomous, production-grade GitOps uptime monitoring & incident telemetry. Node.js + Express 5,
**zero database**: state lives in a single JSON file. One process serves the API and the
dashboard, so it fits comfortably in a free-tier container (≈60 MB RAM, no build step,
no separate frontend hosting).

```
┌────────────── one container / one process ──────────────┐
│  Express 5                                              │
│   ├─ /api/*        JSON API  (analytics, badges, …)     │
│   ├─ /             dashboard (vanilla JS, no bundler)   │
│   ├─ /status       public status page (opt-in)          │
│   └─ checker loop  probes endpoints, writes JSON        │
│  data/monitors.json   ← the only state, volume-mounted  │
└─────────────────────────────────────────────────────────┘
```

## Features

**Checks**

- HTTP/HTTPS (status-code ranges like `200-299,304`, expected keyword, custom
  headers, request body) and **TCP port** checks (`tcp://host:443`)
- Configurable interval (min 10s), per-check timeout, **grace period**
  (`failuresBeforeDown`) so one blip doesn't page you
- **Degraded ("Slow") state** when a healthy endpoint crosses `warnMs` — reported
  separately, still counted as up for uptime
- **SSL/TLS certificate inspection** with expiry warnings `SSL_WARN_DAYS` before
  deadline (notification-only, never flips a monitor down)
- Per-probe **timing waterfall**: DNS → connect → TLS → TTFB → download

**Analytics (2026-grade, all computed on the server from hourly rollups)**

- Latency **percentiles p50 / p95 / p99** over 24h / 7d / 30d with animated charts
- **SLA card**: uptime vs target, error-budget bar, incident count, MTTR
- 30-day **uptime day-cell strip** (GitHub-style) + response-time histogram
- Check-outcome and response-time charts on the overview

**Alerting (zero dependencies — plain `fetch`)**

- **Telegram, Discord, ntfy, generic JSON webhook** — any mix, via env vars
- Rules: degraded alerts (`ALERT_ON_DEGRADED`), SSL expiry, outage grace

**Sharing**

- **Public status page** at `/status` (enable in Settings) with services, day cells
  and incident history — no auth, no secrets in the payload
- **Shields-style SVG badges** (`/api/badge/fleet.svg`, per-monitor too; `flat` and
  `for-the-badge` styles) ready for READMEs

**UI/UX**

- **NovaPulse** identity, violet accent, dark/light/system theme
- Drawer detail view with live analytics, toasts, modals, skeletons, empty states
- **Command palette** (`⌘K` / `Ctrl+K`) + `?` keyboard-shortcut help, `n` new
  monitor, `/` search, `r` refresh — responsive from 360px up
- Count-up tiles, route transitions, chart draw-in animations (all respect
  `prefers-reduced-motion`), PWA install + offline-tolerant shell (service worker)
- Hardened responses: CSP without `unsafe-inline`, `frame-ancestors 'none'`,
  dependency-free rate limiting, request logging, graceful shutdown
- **Two runtime modes** from one codebase: the full self-hosted server, or a
  serverless **GitHub Actions + GitHub Pages** build (₹0, no card, never sleeps) —
  see Deployment → *§0 GitHub Pages + Actions*

### NovaPulse vs. the incumbents

| capability                         | NovaPulse | Uptime Kuma | UptimeRobot |
| ---------------------------------- | :-------: | :---------: | :---------: |
| Self-hosted, single JSON file      | ✅ | ✅ (Docker + DB-ish) | ❌ SaaS |
| Free tier without a card           | ✅ (Pages mode) | ✅ (server) | ✅ (50-mon cap) |
| p50/p95/p99 percentiles            | ✅ | ❌ | partial (avg) |
| SLA target + error budget + MTTR   | ✅ | ❌ | ❌ |
| Timing waterfall (DNS/TLS/TTFB)    | ✅ | ❌ | ❌ |
| Keyword + status-range + TCP       | ✅ | ✅ | partial |
| SSL expiry warnings                | ✅ | ✅ (Plus) | ✅ (paid) |
| Degraded (slow) state              | ✅ | ❌ | ❌ |
| Public status page + day cells     | ✅ | ✅ | ✅ (paid) |
| README badges                      | ✅ | ❌ | ✅ (paid) |
| Command palette / shortcut help    | ✅ | ❌ | ❌ |
| Zero-dependency alert channels ×4  | ✅ | ✅ | ✅ |
| Dependency footprint                | 2 npm pkgs | heavy | n/a |

Rough limits of the lightweight design (by design, not by accident): see
[Limits](#limits).

## Quick start

```bash
pnpm install      # or: npm install
pnpm start        # http://localhost:3000
```

| command      | what it does                                  |
| ------------ | --------------------------------------------- |
| `pnpm start` | run the server                                |
| `pnpm dev`   | run with auto-restart (`--watch`)             |
| `pnpm test`  | unit/integration tests (`node --test`)        |
| `pnpm run e2e` | Playwright E2E, desktop + mobile viewports  |
| `pnpm run typecheck` | TypeScript check, both tsconfigs        |
| `pnpm run lint` | ESLint with `--max-warnings=0`             |
| `pnpm run check` | typecheck + lint + test + build (local gate) |
| `pnpm gh:check` | probe every monitor in `config/monitors.json` (Actions runner) |
| `pnpm gh:build`  | build the static GitHub Pages bundle (`site/`) |

### Quality gates (the three Darwazas)

| gate | workflow | what it proves |
| ---- | -------- | -------------- |
| **Darwaza 1** | [.github/workflows/ci.yml](.github/workflows/ci.yml) | typecheck · lint · unit tests · production build · Docker build — **blocks merge** |
| **Darwaza 2** | [.github/workflows/e2e-gate.yml](.github/workflows/e2e-gate.yml) | Playwright desktop + mobile, OWASP ZAP baseline |
| **Darwaza 3** | [.github/workflows/security-scan.yml](.github/workflows/security-scan.yml) | nightly CodeQL v4 · Semgrep · npm audit, auto-files issues |
| **Sonar** | [.github/workflows/sonar.yml](.github/workflows/sonar.yml) | maintainability + coverage quality gate, notifies on failure |
| **Release** | [.github/workflows/release.yml](.github/workflows/release.yml) | release-please → changelog + version PR |

Rulebook for humans and agents: [docs/RULES.md](docs/RULES.md) ·
[.ai/RULES.md](.ai/RULES.md) (43 Golden Laws).

## Configuration (env vars)

Every variable is optional — the app boots with sensible defaults.

| variable            | default     | notes |
| ------------------- | ----------- | ----- |
| `PORT`              | `3000`      | HTTP port. Platforms like Render/Fly inject this automatically. |
| `HOST`              | `0.0.0.0`   | Bind address. Keep `0.0.0.0` in containers. |
| `NODE_ENV`          | dev         | `production` switches logging to JSON. |
| `UPTIME_DATA_DIR`   | `./data`    | Directory holding `monitors.json`. Point it at your volume/disk. |
| `LOG_LEVEL`         | prod: `info`, dev: `debug` | `debug\|info\|warn\|error\|silent` |
| `LOG_FORMAT`        | prod: `json`, dev: `pretty` | `json` for log aggregation, `pretty` for terminals |
| `TRUST_PROXY`       | `loopback`  | Set `1` behind Render/Fly/Nginx so rate limits see the real client IP |
| `ALLOW_ORIGIN`      | –           | Comma-separated origins, only if the API is called from another site |
| `RATE_LIMIT`        | on          | `off` disables the built-in limiter |
| `RATE_LIMIT_MAX`    | `240`       | Requests per window per IP |
| `TELEGRAM_BOT_TOKEN`| –           | Telegram alerts (with `TELEGRAM_CHAT_ID`) |
| `TELEGRAM_CHAT_ID`  | –           | Telegram alerts |
| `DISCORD_WEBHOOK_URL`| –          | Discord alerts (webhook URL) |
| `NTFY_URL`          | –           | ntfy topic URL, e.g. `https://ntfy.sh/novapulse-alerts` |
| `NTFY_TOKEN`        | –           | Optional ntfy access token (`Bearer`) |
| `WEBHOOK_URL`       | –           | Generic JSON POST webhook |
| `WEBHOOK_SECRET`    | –           | Sent as `x-novapulse-secret` header with webhook calls |
| `ALERT_ON_DEGRADED` | –           | `1` also notifies when a monitor turns Slow |
| `SSL_WARN_DAYS`     | `14`        | Warn this many days before certificate expiry |
| `SLA_TARGET`        | `99.9`      | SLA target percentage shown in the dashboard (50–100) |
| `ALLOW_FRAMING`     | –           | `1` relaxes `frame-ancestors` — **local QA only, never in production** |

A commented template lives in [`.env.example`](.env.example).

## API

| method   | route                     | description                                   |
| -------- | ------------------------- | --------------------------------------------- |
| `GET`    | `/api/health`             | liveness + monitor count                      |
| `GET`    | `/api/stats`              | aggregate dashboard numbers                   |
| `GET`    | `/api/analytics?range=24h\|7d\|30d` | fleet percentiles, series, day buckets, SLA |
| `GET`    | `/api/monitors`           | all monitors with `uptime24h`                 |
| `POST`   | `/api/monitors`           | create `{name, url, intervalSec, timeoutMs, …}` (advanced: `type`, `expectedStatus`, `expectedKeyword`, `warnMs`, `failuresBeforeDown`, `tags`, `headers`, `checkSsl`) |
| `GET`    | `/api/monitors/:id`       | one monitor                                   |
| `GET`    | `/api/monitors/:id/analytics?range=…` | per-monitor percentiles, histogram, SLA |
| `GET`    | `/api/monitors/:id/checks.csv` | CSV export of recent checks               |
| `PATCH`  | `/api/monitors/:id`       | update `name`, `enabled`, `intervalSec`, …    |
| `DELETE` | `/api/monitors/:id`       | remove a monitor                              |
| `POST`   | `/api/monitors/:id/check` | run a check immediately                       |
| `GET`    | `/api/incidents`          | recent incident timeline                      |
| `GET`    | `/api/settings`           | status-page config + alert-channel health      |
| `PATCH`  | `/api/settings`           | `{statusPage: {enabled, title, message}}`      |
| `GET`    | `/api/public/status`      | public status projection (404 while disabled)  |
| `GET`    | `/api/badge/:id.svg`      | shields-style badge (`fleet` or a monitor id)  |
| `GET`    | `/status`                 | public status page (404 while disabled)        |
| `GET`    | `/api/export`             | download the full state as JSON                |
| `POST`   | `/api/import`             | restore state (`mode=merge\|replace`)          |

```bash
curl -X POST http://localhost:3000/api/monitors \
  -H "content-type: application/json" \
  -d '{"name":"Example","url":"https://example.com","intervalSec":60}'
```

---

# Deployment

There is no database to provision and no build step — every deployment target is the
same recipe: **install production deps → set env → run `node server.js` → put a
volume/disk on `data/`**.

## 0. GitHub Pages + Actions — serverless mode (₹0, no card, never sleeps) ⭐

The same dashboard, but the "server" runs **inside GitHub Actions** (cron every
5 minutes) and the UI is served **from GitHub Pages**. Nothing sleeps, nothing needs a
credit card, and every byte of state lives in your repo.

```
config/monitors.json     ← you edit this (GitHub web UI or mobile app)
        │   every 5 min
        ▼
GitHub Actions → tools/gh-check.js   probes, records history, sends Telegram alerts
        │             └─ gh-state/*  force-pushed to the `state` branch (one commit)
        ▼
tools/gh-build.js → site/ → GitHub Pages   (same UI, read-only, live data)
```

**One-time setup (~3 minutes):**

1. Push this folder to a **public** GitHub repo (public repos get unlimited free
   Actions minutes):

   ```bash
   git init -b main
   git add .
   git commit -m "uptime monitor"
   git remote add origin https://github.com/SudhirDevOps1/NovaPulse.git
   git push -u origin main
   ```

2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Optional alerts: Settings → Secrets and variables → Actions → add
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
4. The first `Monitor` workflow run deploys the dashboard to
   `https://sudhirdevops1.github.io/uptime-monitor/` (see the Actions tab).

**Day-to-day:**

| you want to …                 | do this                                                 |
| ----------------------------- | ------------------------------------------------------- |
| add / edit / pause a monitor  | edit `config/monitors.json` on GitHub → commit           |
| see fresh data now            | wait ≤5 min, or Actions → Monitor → **Run workflow**     |
| change the check cadence      | edit the `cron` line in `.github/workflows/monitor.yml`  |
| run it locally first          | `pnpm gh:check` then `pnpm gh:build` (serves `site/`)    |

Notes:

- `intervalSec` in the config is a **minimum gap** — the real cadence follows the
  workflow cron (5 minutes is GitHub's fastest schedule).
- Check history (`gh-state/`) is force-pushed as a **single commit** to the `state`
  branch, so check history never bloats `main`.
- The Pages build is **read-only**: New monitor / edit / delete / import are hidden,
  and data comes from `./data/state.json` generated by the last run.
- **Private repo?** Scheduled runs consume your 2000 free Actions minutes/month —
  change the cron to `*/15`, or keep the repo public.
- GitHub pauses scheduled workflows after **60 days without repository activity** —
  any push re-enables them, so commit something small every ~50 days.
- Checks run from GitHub's IPs: monitors that whitelist your country/IP need a
  regular server deploy instead (sections 1–5 below).

## 1. Docker (works everywhere)

```bash
docker build -t novapulse .
docker run -d --name novapulse -p 3000:3000 -v novapulse-data:/app/data novapulse
```

or with Compose (reads `.env`):

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps     # STATUS should become "healthy"
```

> **Monitoring a service on the same host?** Inside a container `localhost` is the
> container itself. Use `http://host.docker.internal:3000/...` (Docker Desktop) or the
> host's real IP/`http://172.17.0.1:3000` (Linux).

## 2. GitHub + CI (any host afterwards)

Push the repo — `.github/workflows/ci.yml` then runs on every push/PR:

- `pnpm install --frozen-lockfile` + `pnpm test` on Node 20/22/24
- a Docker build (no push) so a broken `Dockerfile` fails in CI, not on the server

Host-side auto-deploy integrations (connect the same GitHub repo, deploy on push):

| host        | connect how                                        |
| ----------- | -------------------------------------------------- |
| **Render**  | New → Web Service → "Existing Dockerfile"           |
| **Fly.io**  | `fly launch` once, then `fly deploy` on push/CLI    |
| **Koyeb / Railway / Zeabur** | point at the repo, choose the Dockerfile |
| **VPS**     | GitHub Action with SSH (`appleboy/ssh-action`) running `git pull && docker compose up -d --build` |

## 3. Render (free web service)

1. New → **Web Service** → pick the GitHub repo → Runtime: **Docker**.
2. Build command: *(leave empty — the Dockerfile handles it)*, start: `node server.js`
   (default `CMD`), port: `3000`.
3. **Environment**: `NODE_ENV=production`, `TRUST_PROXY=1`, plus Telegram values if used.
4. **Disks → Add Disk**: mount at `/app/data` (name it `uptime-data`).
   On the free plan disks are ~1 GB — plenty for JSON.
5. Deploy; open the printed `onrender.com` URL.

> **Free-tier caveat (important):** without a disk, Render's filesystem is *ephemeral* —
> a redeploy/restart wipes `monitors.json`. Mount the disk, and/or schedule
> `curl -fsS https://your-app.onrender.com/api/export -o backup.json` (cron/GitHub
> Action) and restore with `POST /api/import`.

## 4. Fly.io (free allowances, real volumes)

```bash
fly launch            # accept defaults, internal port 3000, no public VM if you like
fly volumes create uptime_data --size 1
# in fly.toml set: [env] UPTIME_DATA_DIR = "/data"
#                  [[mounts]] source = "uptime_data" destination = "/data"
fly secrets set TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=…
fly deploy
```

## 5. Any VPS + PM2 (cheapest, full control)

```bash
git clone https://github.com/SudhirDevOps1/NovaPulse.git && cd NovaPulse
pnpm install --prod          # or: npm install --omit=dev
cp .env.example .env         # edit values
NODE_ENV=production pm2 start ecosystem.config.js
pm2 save && pm2 startup      # start on boot
```

Then put Nginx/Caddy in front with TLS (`proxy_pass http://127.0.0.1:3000`) and set
`TRUST_PROXY=1`. Data lives in `./data/monitors.json`; back it up with `/api/export`.

**Do not scale to multiple processes/instances** — the JSON store is single-writer.
One process, one volume.

## 6. Platforms that are NOT a good fit

- **Vercel / Netlify / Cloudflare Workers** — serverless functions are stateless and
  short-lived; there is nowhere to keep `monitors.json` and no long-running checker loop.
  Host the dashboard there only if you move storage out (e.g. to a database).
- **GitHub Pages / static hosts** — the UI needs the `/api` backend.

### About Neon (and databases in general)

Neon is a serverless **Postgres** — this project deliberately does not need it: state is
a single JSON file written atomically, so a free Neon tier would add a network hop, credentials
and cold-start risk for zero benefit. Reach for a DB only if you outgrow the JSON file
(multiple replicas, hundreds of monitors, multi-user). Migration path: `GET /api/export`
gives you the full state, so importing it into Postgres later is a one-way, lossless step.

## Backup / restore

```bash
# export
curl -fsS http://localhost:3000/api/export -o backup.json
# restore (replace = overwrite, merge = combine)
curl -X POST http://localhost:3000/api/import?mode=replace \
  -H 'content-type: application/json' --data-binary @backup.json
```

Or copy the file directly: `data/monitors.json` (safe to grab while running — every
write is atomic: temp file + rename).

## Resource footprint

Measured on a small container: ~60 MB RSS, single CPU is more than enough. Two Express
dependencies (`express`, `compression`) and nothing else — no bundler, no ORM, no Redis.

## Alerts — 4 channels (optional)

Every channel is plain `fetch` — still zero runtime dependencies. Any mix works;
the Settings page shows a live health pill per channel.

```bash
# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...  TELEGRAM_CHAT_ID=987654321
# Discord
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
# ntfy
NTFY_URL=https://ntfy.sh/novapulse-alerts   # optional: NTFY_TOKEN=...
# generic webhook (receives x-novapulse-secret when WEBHOOK_SECRET is set)
WEBHOOK_URL=https://example.com/hook      # optional: WEBHOOK_SECRET=...
```

Without these variables monitoring works exactly the same; only notifications are
skipped. Related rules: `ALERT_ON_DEGRADED=1` (notify on Slow), `SSL_WARN_DAYS`
(certificate expiry), outage grace comes from each monitor's `failuresBeforeDown`.

## Limits

Deliberate caps that keep NovaPulse featherweight (all enforced, not aspirational):

| limit                        | value            | why                                  |
| ---------------------------- | ---------------- | ------------------------------------ |
| raw check history per monitor| 500 points       | older data lives in hourly rollups   |
| hourly rollups per monitor   | 720 (30 days)    | fixed-size arrays, no table growth   |
| history ring in the drawer   | 50 recent checks | UI stays instant                     |
| request body probe cap       | 1 MB read        | bounded memory per probe             |
| custom headers per monitor   | 10               | payload sanity                       |
| JSON store                   | single file      | one writer, atomic tmp+rename writes |
| npm dependencies             | 2 (`express`, `compression`) | no ORM, no bundler, no Redis |

Exceeding these (hundreds of monitors, multi-replica, multi-user) is the signal to
migrate `/api/export` into a real database — the export format is lossless.

## Recommended 2026 combos (all free, no card)

| combo                        | dashboard        | checks            | best for                          |
| ---------------------------- | ---------------- | ----------------- | --------------------------------- |
| **GitHub Pages + Actions** ⭐| GitHub Pages     | Actions cron 5 min| personal fleet, ₹0 forever        |
| **Render free + disk**       | Render web       | in-process loop   | 10–30 s intervals, real-time      |
| **Fly.io free allowances**   | Fly VM + volume  | in-process loop   | volumes + low latency worldwide   |
| **Any VPS + PM2**            | Nginx/Caddy      | in-process loop   | full control, cheapest long-term  |
| **Docker on a NAS/home box** | local Docker     | in-process loop   | LAN devices + self-hosted status  |

The Pages combo is the unique one: no server exists between deploys, checks run in
Actions, and the state is a single git branch — perfect when "free tier" means
*never entering card details at all*.
