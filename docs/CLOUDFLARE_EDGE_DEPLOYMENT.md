# 🧡 Cloudflare Workers & D1 Edge Deployment Guide (Pingflare & UptimeFlare Style)

> **NovaPulse 2026** · *Edge Serverless Observability, 1-Minute Cron Precision, ₹0 Forever*

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SudhirDevOps1/NovaPulse)

---

## ⚡ Why Deploy on Cloudflare Workers?

Unlike GitHub Actions (which runs once and terminates, suffering from 3-hour cron queue delays), Cloudflare Workers offers:
- ⏱️ **Exact 1-Minute Native Edge Cron (`* * * * *`)**: Probing runs every 60 seconds across 300+ global edge locations.
- 🚫 **Never Sleeps, Never Dies**: Stateless edge worker waking up on-schedule with millisecond precision.
- 💳 **100% Free Forever Without Credit Cards**:
  - Cloudflare Workers Free Tier includes **100,000 requests per day**.
  - 1 cron execution per minute = 1,440 executions/day (only **1.4% of your daily free quota**!).
  - Cloudflare D1 provides **5 Million row reads/day** and **100,000 row writes/day** for free.

---

## 🚀 Quick Setup (2 Minutes)

### Option 1: One-Click Deploy Button
Click the button above to clone and deploy directly into your Cloudflare account!

---

### Option 2: CLI Deployment with Wrangler

#### Step 1: Install Wrangler & Login
```bash
npm install -g wrangler
wrangler login
```

#### Step 2: Create Cloudflare D1 Database
```bash
wrangler d1 create novapulse-db
```
Wrangler will output your database configuration:
```toml
[[d1_databases]]
binding = "DB"
database_name = "novapulse-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
Copy that snippet into your [`wrangler.toml`](../wrangler.toml).

#### Step 3: Run Database Schema Migration
```bash
wrangler d1 execute novapulse-db --file=./schema.sql
```

#### Step 4: Configure Alert Secrets (Optional)
```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put DISCORD_WEBHOOK_URL
```

#### Step 5: Deploy to Cloudflare Edge!
```bash
wrangler deploy
```

Your NovaPulse Edge Worker is now live at `https://novapulse.<your-subdomain>.workers.dev` and executing 1-minute probes 24/7 without interruption!
