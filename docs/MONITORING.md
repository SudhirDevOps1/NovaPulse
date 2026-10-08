# 🩺 Monitoring Operations Guide

> How NovaPulse actually checks things, **where you change what**, what the free
> competitors (Uptime Kuma, UptimeRobot, StatusCake, Pingdom, Better Stack) do
> differently — and which of their behaviours this repo now matches.
> Deployment recipes (Render/Docker/PM2, sub-minute intervals) live in the
> [24/7 Deployment Guide](PERSISTENT_247_DEPLOYMENT.md).

---

## 1 · How one check actually travels

```
config/monitors.json          ← the ONLY place monitors are defined (GitOps)
        │
        │  triggers (see §3): schedule "*/5" → keeper loop · repository_dispatch
        │                     (external pinger) · workflow_dispatch (manual)
        │                     · push to config/public/site/tools
        ▼
tools/gh-check.js             ← probes HTTP/TCP (+ SSL, keyword, timing),
        │                        respects intervalSec as a MINIMUM GAP,
        │                        writes gh-state/ (history + incidents)
        │                        lib/checker.js decides DOWN/UP/SLOW and calls
        ▼                        lib/notify.js → your alert channels
git push --force → `state` branch (gh-state/**)   ← history lives here, one commit
        ▼
tools/gh-build.js             ← rebuilds site/ (static dashboard + data/state.json)
        ▼
GitHub Pages deploy           ← sudhirdevops1.github.io/NovaPulse/
```

| File | Job |
| :--- | :--- |
| `config/monitors.json` | Monitor definitions — edit via GitHub web → PR → merge |
| `.github/workflows/monitor.yml` | Cadence: probes, state push, deploys (`probe` · `keeper` · `deploy` jobs) |
| `tools/gh-check.js` | One probe pass over every due monitor |
| `lib/checker.js` | Transition logic: `failuresBeforeDown` → 🔴 DOWN, recovery → 🟢 UP, `warnMs` → 🟠 SLOW |
| `lib/notify.js` | Alert fan-out: Telegram · Discord · **Slack** · ntfy · webhook |
| `tools/gh-build.js` | Static site build from `gh-state/` |
| `state` branch | History + incidents snapshot (`gh-state/`), force-pushed, never grows |
| `docs/PERSISTENT_247_DEPLOYMENT.md` | Mode B (always-on daemon) recipes: Render, Docker, PM2 |

---

## 2 · Where to change what

### ➕ Add or edit a monitor

GitHub web (or mobile app) → `config/monitors.json` → ✏️ **Edit** → commit to a
branch → open a PR → the four required checks go green → merge. The next Monitor
run picks it up (a push to `config/**` triggers one immediately).

```json
{
  "name": "My API",
  "url": "https://api.example.com/health",
  "method": "GET",
  "intervalSec": 300,
  "timeoutMs": 10000,
  "expectedStatus": "200-299",
  "expectedKeyword": "ok",
  "failuresBeforeDown": 2,
  "warnMs": 800,
  "tags": ["prod"]
}
```

`intervalSec` is a **minimum gap between two probes of that monitor** — the
*when* comes from the triggers in §3. `failuresBeforeDown: 2` means one bad
response does not alert; two consecutive failures do.

### 🔔 Turn alerts on (they are OFF by default)

**Settings → Secrets and variables → Actions → New repository secret**, then
pick any channel:

| Channel | Secret name(s) | How to get it |
| :--- | :--- | :--- |
| **Telegram** | `TELEGRAM_BOT_TOKEN` **+** `TELEGRAM_CHAT_ID` (**both required**) | Telegram → **@BotFather** → `/newbot` → copy the token; **@userinfobot** → send any message → your chat id |
| Discord | `DISCORD_WEBHOOK_URL` | Server settings → Integrations → Webhooks → New webhook → Copy URL |
| **Slack** | `SLACK_WEBHOOK_URL` | api.slack.com → **Create an app → Incoming Webhooks** → add channel → Copy URL |
| ntfy | `NTFY_URL` (+ optional `NTFY_TOKEN`) | ntfy.sh app → subscribe to a topic → `https://ntfy.sh/your-topic` |
| Generic webhook | `WEBHOOK_URL` (+ optional `WEBHOOK_SECRET`) | Your own endpoint; receives JSON, `x-novapulse-secret` header when set |

Nothing is configured until the secret exists — the dashboard's health block
shows it live: `health.alerts = { telegram: false, discord: false, slack: false, … }`.

### 🏷️ Status page & badges (already live)

* Status page: `https://sudhirdevops1.github.io/NovaPulse/status.html`
* Fleet badge: `https://sudhirdevops1.github.io/NovaPulse/badge/fleet.svg`

### 🎛️ Manual controls

**Actions → Monitor → Run workflow** offers `mode`:

| mode | What runs |
| :--- | :--- |
| `auto` (default) | one probe pass + deploy |
| `keeper` | the 5-minute loop, by hand |
| `deploy` | rebuild + publish `site/` only |

---

## 3 · Cadence — how often checks really happen (measured)

**What the dashboard promises:** every monitor is probed whenever it is due
(`intervalSec` = minimum gap), and history shows real timestamps.

**What triggers those probes:**

| Trigger | Behaviour |
| :--- | :--- |
| `schedule: "*/5 * * * *"` | GitHub's cron. **Measured 2026-10-07/08: only 4 ticks arrived in 24 h (expected ≈ 288) — 17:27, 22:09, 01:53, 08:02 UTC, gaps of 4 h 42 m, 3 h 44 m, 6 h 09 m.** |
| **keeper loop** (what a tick now starts) | Instead of one probe, the tick starts a loop: probe → save state → request a deploy → sleep → repeat, every ~5 min, for up to **5 h 30 m**, handing over early the moment another Monitor run is queued. So between (late) ticks the cadence is still the honest 5 minutes. |
| `repository_dispatch` (`probe`/`check`/`monitor`) | External pinger → instant run. Setup: [24/7 Guide · Option 4](PERSISTENT_247_DEPLOYMENT.md#⏰-option-4-eliminating-github-actions-cron-lag-mode-a-fix) (cron-job.org, free). |
| `workflow_dispatch` | Manual "Run workflow" — see `mode` table in §2. |
| `push` to `config/**`, `public/**`, `site/**`, `tools/**`, or the workflow | One probe + deploy right away (docs/test/`lib/` pushes do **not** redeploy Pages). |

**Why a loop instead of trusting cron:** GitHub's scheduler on this repo runs
hours late (same measurement: Darwaza 3's nightly `30 20 * * *` arrived at
00:20 UTC, +3 h 50 m; BUG-2026-0013). The keeper turns *whatever* gap GitHub
delivers into continuous 5-minute probing. Its limits are honest: sub-minute
intervals (10 s / 30 s / 60 s) are **not** possible on GitHub-hosted runners —
that needs an always-on process, i.e. [Mode B](PERSISTENT_247_DEPLOYMENT.md).

**Verify it yourself (30 seconds):**

1. **Actions → Monitor** — look for runs ~5 min apart inside one keeper run's
   log (`keeper iteration 1, 2, 3 …`) plus its `Monitor · deploy` children.
2. Open the dashboard → *Recent checks* timestamps should be ~`intervalSec`
   apart (My site 5 min, Google DNS 10 min).
3. `https://github.com/SudhirDevOps1/NovaPulse/tree/state` → `gh-state/monitors.json`
   → `history` array grows by one entry per probe.

---

## 4 · What fires an alert

| Event | Condition | Text |
| :--- | :--- | :--- |
| 🔴 DOWN | `failuresBeforeDown` consecutive failed probes | `🔴 DOWN: <name>` |
| 🟢 UP | first successful probe after an incident | `🟢 UP: <name> is back online.` |
| 🟠 SLOW | response slower than `warnMs` | `🟠 SLOW: <name> … (threshold …)` |

Alerts are sent by `lib/checker.js` → `lib/notify.js` **on every configured
channel at once**; a channel that fails is logged, never blocking the others
(`test/notify.test.js`). Incidents are stored in `state` → `gh-state/`
and shown on the dashboard's Incidents route and the status page.

---

## 5 · Competitor analysis — how the others do it, and where NovaPulse stands

Facts below are from the vendors' own pricing/help pages (retrieved 2026-10-08).

| Tool | Who runs the scheduler | Free tier (checked 2026) | Fastest interval | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Uptime Kuma** | **your server** (self-hosted Node daemon, in-process timer) | unlimited, forever (you host it) | config-driven, seconds | Setup 15–60 min; live UI; its own box is the single point of failure |
| **UptimeRobot** | their cloud | 50 monitors @ **5 min**, personal/non-commercial only, 1 basic status page | 30 s (Enterprise) | Paid Solo ≈ $7–9/mo → 10 monitors @ 60 s |
| **StatusCake** | their cloud | 10 monitors @ 5 min, commercial OK, must log in every 90 days | 30 s (Business ≈ $67–80/mo) | Superior ≈ $20–24/mo → 1 min |
| **Pingdom** (SolarWinds) | their cloud | none (14-day trial) | 60 s — hard floor at every tier | From ≈ $10–16.50/mo for 10 checks; transaction tests, RUM |
| **Better Stack** | their cloud | 10 monitors @ 3 min | 30 s paid | Incident management on top |
| **Upptime** | GitHub Actions (like us) | repo is free | 5 min | Same architecture class as NovaPulse Mode A |
| **NovaPulse Mode A** (this repo) | GitHub Actions + keeper loop | **unlimited monitors, ₹0, no card** | 5 min (loop); exact 5 min with an external pinger | Everything in Git; no account anywhere |
| **NovaPulse Mode B** | **your machine** (Render/Docker/PM2 daemon) | ₹0 forever | your `intervalSec` (10 s+) | [24/7 Guide](PERSISTENT_247_DEPLOYMENT.md) |

**What that means, honestly:**

* ✅ **Matched for free:** UptimeRobot's *free-tier* experience (5-minute
  rhythm, alerts, status page, unlimited monitors) — and unlike the free SaaS
  tiers there is no commercial-use ban, no login-expiry, no per-monitor cap.
* ✅ **Matched with Mode B:** Uptime Kuma's always-on, sub-minute behaviour —
  NovaPulse already ships the same daemon (`server.js` + scheduler in
  `lib/checker.js`); it just needs a machine to live on.
* ⚠️ **Not ours:** multi-region probes (UptimeRobot/Pingdom check from their
  fleets of locations; GitHub gives one runner region), SMS/phone alerts, paid
  SLA reports. Single-region is the trade for ₹0.

---

## 6 · Honesty list — claims that were wrong, and their fix

| Claim that existed | Reality | Fix |
| :--- | :--- | :--- |
| README / GETTING_STARTED / DEVELOPER_GUIDE / `monitor.yml` promised **Slack** alerts | `lib/notify.js` never implemented Slack | Slack sender implemented (BlockKit payload) + `test/notify.test.js` |
| Dashboard banner said *"alerts arrive on Telegram"* | no secret was configured → no alert would arrive anywhere | Banner now lists all channels and says *"once those secrets are configured"* |
| *"Checks run every 5 minutes"* (cron) | GitHub delivered 4 ticks per 24 h (measured, §3) | Keeper loop probes every 5 min between ticks; external pinger option documented |

---

## 7 · Quick reference

| I want to… | Go to |
| :--- | :--- |
| add/edit a monitor | `config/monitors.json` → PR → merge |
| get alerts | Settings → Secrets and variables → Actions → new secret (§2) |
| check right now | Actions → Monitor → Run workflow (`mode: auto`) |
| get exact 5-min cadence 24/7 | cron-job.org → `repository_dispatch` ([Option 4](PERSISTENT_247_DEPLOYMENT.md#⏰-option-4-eliminating-github-actions-cron-lag-mode-a-fix)) |
| get 10 s/30 s/60 s cadence | [Mode B recipes](PERSISTENT_247_DEPLOYMENT.md) |
| see raw history | `state` branch → `gh-state/monitors.json` |
| see who changed what | `.ai/BUGS.md` (incidents) · `docs/CHANGELOG…` via Releases |
