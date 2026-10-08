# ⚡ 24/7 Persistent Monitoring & Visual Telemetry Guide

> **NovaPulse 2026** · *Autonomous Telemetry, Visual Incident Diagnostics & Zero-Downtime Deployment*

---

## 📌 Executive Summary

Traditional monitoring tools (Uptime Kuma, UptimeRobot, Better Stack) rely on **persistent polling workers**. If you run monitoring purely on GitHub Actions (`.github/workflows/monitor.yml`), you may notice that:
1. Probing runs immediately when you push code (`push` event).
2. However, subsequent checks do **not** run every 30 or 60 seconds according to your monitor interval settings.
3. Scheduled runs (`schedule: - cron: "*/5 * * * *"`) often experience **20-minute to 3-hour delays** on GitHub free public runners.

This guide explains **why this happens**, how to achieve **true 24/7 continuous monitoring with sub-minute precision (10s–60s)** for **100% free (₹0, zero credit card)**, and how NovaPulse delivers **Better Stack-grade visual screenshots and error diagnostics**.

---

## 🔍 Root Cause Analysis: GitHub Actions vs. Always-On Daemon

### 1. Ephemeral Container vs. Persistent Worker
- **GitHub Actions (Mode A)** spins up an ephemeral virtual machine, executes `tools/gh-check.js`, pushes state to the `state` branch, deploys the static dashboard to GitHub Pages, and **immediately exits**.
- GitHub Actions is **not a daemon**; it cannot maintain an in-memory loop or execute `setInterval()` timers between runs.
- **Minimum Cron Limitation**: GitHub Actions does not support cron intervals faster than **5 minutes** (`*/5 * * * *`). Setting `intervalSec: 30` or `intervalSec: 60` inside monitor settings cannot be enforced by GitHub Actions alone.

### 2. GitHub Public Cron Queue Delays (Verified Evidence)
From the live GitHub API logs of `SudhirDevOps1/NovaPulse`:
- Run `37730500308` (`workflow_dispatch`): `05:03:51 UTC`
- Run `37747258664` (`schedule` cron): `08:02:51 UTC`
- **Result:** An exact **3-hour delay (180 minutes)** occurred between scheduled runs!
- GitHub free runners queue cron schedules with lowest priority during peak global traffic.

---

## 🚀 How to Run 24/7 Continuous Monitoring (₹0 Forever)

To achieve **sub-minute precision (10s, 30s, 60s)** without any delay, run NovaPulse in **Mode B (Always-On Node.js Daemon)** using one of these free tiers:

### 🌟 Option 1: Render.com Free Web Service (Recommended)
Render provides free Node.js hosting with automatic SSL:
1. Sign up at [Render.com](https://render.com) (No credit card required).
2. Click **New +** ➔ **Web Service**.
3. Connect your repository: `SudhirDevOps1/NovaPulse`.
4. Configure service settings:
   - **Environment**: `Node`
   - **Build Command**: `pnpm install --frozen-lockfile`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
5. Click **Deploy Web Service**.
6. **Keep-Alive (Prevent Free Tier Sleep)**:
   - Render free services sleep after 15 minutes of inactivity.
   - To keep your monitor alive 24/7, create a free ping monitor on [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com) to ping `https://your-novapulse.onrender.com/api/health` every **5 minutes**.
   - Your NovaPulse server will now stay awake 24/7 and probe all your targets continuously at their exact intervals!

---

### 🐳 Option 2: Docker / Docker Compose (VPS, Home Server, Raspberry Pi)
If you have a Linux VPS (Oracle Cloud Free Tier, Hetzner, AWS Free Tier) or local server:

```bash
# Run with volume mount for persistent monitors & incident data
docker run -d \
  --name novapulse \
  --restart unless-stopped \
  -p 3000:3000 \
  -v novapulse-data:/app/data \
  novapulse
```

Or using Docker Compose:
```yaml
version: '3.8'
services:
  novapulse:
    image: novapulse:latest
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
```

---

### 🐧 Option 3: Linux VPS with PM2 Daemon
```bash
git clone https://github.com/SudhirDevOps1/NovaPulse.git /opt/novapulse
cd /opt/novapulse
pnpm install --prod

# Start with PM2 process manager
pm2 start server.js --name "novapulse" -i 1
pm2 save
pm2 startup
```

---

### ⏰ Option 4: Eliminating GitHub Actions Cron Lag (Mode A Fix)
If you want to keep monitoring 100% inside GitHub without deploying a server, you can eliminate GitHub's 3-hour cron queue delay using **free external webhook triggers**:

NovaPulse supports GitHub's `repository_dispatch` trigger:
```yaml
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:
  repository_dispatch:
    types: [probe, check, monitor]
```

#### Setup Free 5-Minute Webhook Ping:
1. Generate a GitHub Personal Access Token (classic or fine-grained) with `repo` or `actions:write` scope.
2. Go to [cron-job.org](https://cron-job.org) (100% free forever).
3. Create a new cron job:
   - **URL**: `https://api.github.com/repos/SudhirDevOps1/NovaPulse/dispatches`
   - **Method**: `POST`
   - **Headers**:
     - `Authorization`: `Bearer YOUR_GITHUB_PAT`
     - `Accept`: `application/vnd.github+json`
     - `User-Agent`: `NovaPulse-Pinger`
   - **Request Body**:
     ```json
     {"event_type": "probe"}
     ```
   - **Schedule**: Every 5 minutes (or 2 minutes).
4. **Result:** cron-job.org sends a webhook ping directly to GitHub Actions. This bypasses GitHub's internal scheduled cron queue and starts the runner **instantly within seconds**!

---

## 📸 Visual Screenshots & Error Diagnostics (Better Stack Style)

NovaPulse includes automated incident diagnostics inspired by Better Stack and Uptime Kuma:

### 1. Website Screenshot Thumbnails
- Every HTTP/HTTPS monitor automatically generates responsive visual screenshot snapshots via high-reliability zero-API headless rendering.
- Displays directly inside the monitor detail drawer:
  - Interactive "Visual Website Snapshot" preview card.
  - Quick-action link to open the target website.

### 2. Incident Response Snippet & Header Inspection
When a monitored endpoint fails (HTTP 4xx/5xx, keyword mismatch, timeout):
- **Response Body Snippet**: Captures the first 1,024 bytes of raw response HTML/JSON (e.g. `502 Bad Gateway`, `Database connection error`, `Cloudflare Error 521`).
- **Response Headers**: Captures diagnostic headers like `Server`, `Content-Type`, and `Date`.
- **Better Stack Drawer View**: Renders the exact error message and formatted code block in the incident drawer so you understand the outage before inspecting server logs.
- **Alert Embeds**: Attaches outage preview snippets directly into Telegram, Discord, and Slack notifications.

---

## 📊 Summary Comparison

| Capability | GitHub Actions Alone (Mode A) | GitHub Actions + cron-job.org | Render / VPS / Docker (Mode B) |
| :--- | :---: | :---: | :---: |
| **Interval Precision** | 5m (delayed up to 3h) | **Exact 5m guaranteed** | **Sub-minute (10s – 60s)** |
| **Hosting Cost** | ₹0 Forever | ₹0 Forever | ₹0 Forever |
| **Credit Card Required** | Never | Never | Never |
| **RAM Footprint** | Ephemeral | Ephemeral | ~60 MB RAM |
| **Live Visual Screenshots** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Error Snippets** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Live WebSocket Auto-Refresh**| ❌ No (Static Pages) | ❌ No (Static Pages) | ✅ Real-time live UI |
