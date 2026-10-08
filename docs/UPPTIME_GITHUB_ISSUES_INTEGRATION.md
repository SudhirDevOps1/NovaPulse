# 🐙 Upptime-Grade GitHub Issues & GitOps Guide
### *Autonomous Incident Management & Immutable Git State*

NovaPulse 2026 brings full feature parity with **[Upptime](https://github.com/upptime/upptime)** while completely eliminating Upptime's primary flaw: **GitHub Actions scheduled workflow delays and 60-day inactivity shutdowns**.

---

## ⚡ How It Works

### 1. Auto-Opening GitHub Issues on Outages
Whenever a monitored service fails consecutive health checks:
1. NovaPulse checks GitHub via REST API for an existing open incident issue for that service.
2. If no open issue exists, it creates an issue automatically:
   - **Title**: `🚨 Incident: [Monitor Name] is DOWN`
   - **Labels**: `incident`, `downtime`, `automated`
   - **Markdown Details**:
     - Endpoint URL
     - Timestamp (ISO & UTC)
     - HTTP Status code / error reason
     - Latency (ms)
     - **1KB Raw Error Body Snippet** (Diagnostics)
     - **Visual Headless Snapshot** (Website Screenshot Preview)

### 2. Auto-Resolving & Auto-Closing Issues on Recovery
When the service responds normally:
1. NovaPulse posts a resolution comment to the issue:
   - `"🟢 Service Recovered: [Monitor Name] is back online at [Time] (~X minutes downtime)."`
2. It automatically sets the issue state to `closed` with reason `completed`.

---

## 🚀 Setup (30 Seconds)

### Step 1: Create a GitHub Personal Access Token (PAT)
1. Go to **GitHub Settings → Developer Settings → Personal access tokens → Fine-grained tokens**.
2. Grant permissions:
   - **Issues**: Read & Write
   - **Contents**: Read & Write (only if using Git commit storage)

### Step 2: Configure Environment Variables
Set the following variables in your `.env` or cloud provider console (Cloudflare / Vercel / Render / Docker):

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_REPOSITORY=yourusername/yourrepo
```

Optional: To store monitors directly in git commit history (Upptime style):
```env
GITHUB_STORAGE=true
```

---

## 🔄 Dual-Engine Architecture: Edge + Upptime

```
┌─────────────────────────────────┐
│ Cloudflare Edge / Vercel Cron   │ ◄─── Continuous 1-minute probes (Never sleeps)
└───────────────┬─────────────────┘
                │ Outage detected
                ▼
┌─────────────────────────────────┐
│ GitHub Issues Automation API    │ ◄─── Auto-opens issue with 1KB snippet & screenshot
└───────────────┬─────────────────┘
                │ Service recovers
                ▼
┌─────────────────────────────────┐
│ GitHub Issues Close API         │ ◄─── Auto-comments duration & closes issue
└─────────────────────────────────┘
```

You get the best of both worlds:
- **Cloudflare Workers / Vercel Edge**: 100% uptime with 0 queue delay.
- **GitHub Issues**: High visibility team collaboration and public transparency.
