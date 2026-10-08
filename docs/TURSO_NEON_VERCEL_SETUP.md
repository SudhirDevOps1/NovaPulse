# ▲ Vercel, Netlify, Turso & Neon Serverless Setup Guide

> **NovaPulse 2026** · *Multi-Platform Serverless Observability & Pluggable Edge Databases*

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SudhirDevOps1/NovaPulse)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/SudhirDevOps1/NovaPulse)

---

## 💾 Modern Pluggable Edge Databases

NovaPulse supports pluggable serverless storage adapters, enabling you to run on Vercel, Netlify, Cloudflare, or local Node without vendor lock-in.

---

### 1. Turso libSQL (Distributed SQLite over HTTP)
Turso provides 500 free databases, 9 GB storage, and **1 Billion row reads/month** for ₹0.

#### Setup:
1. Create a free database on [Turso.tech](https://turso.tech):
   ```bash
   turso db create novapulse
   turso db show novapulse --url
   turso db tokens create novapulse
   ```
2. Run database migration:
   ```bash
   turso db shell novapulse < schema.sql
   ```
3. Set environment variables on Vercel/Netlify/Worker:
   ```env
   TURSO_DATABASE_URL=https://novapulse-[org].turso.io
   TURSO_AUTH_TOKEN=your_turso_jwt_token
   ```

---

### 2. Neon Serverless PostgreSQL
Neon provides serverless PostgreSQL with connection pooling that works seamlessly over HTTP from edge functions without cold starts.

#### Setup:
1. Create a free project on [Neon.tech](https://neon.tech) (0.5 GB free storage).
2. Run SQL migration from `schema.sql` inside the Neon SQL Console.
3. Set the connection string:
   ```env
   NEON_DATABASE_URL=postgres://user:password@ep-xyz.neon.tech/neondb?sslmode=require
   ```

---

## ⚡ Vercel Deployment with Vercel Cron

NovaPulse includes native [`vercel.json`](../vercel.json) configuration:
```json
{
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "* * * * *"
    }
  ]
}
```

1. Click **Deploy with Vercel** above.
2. In the Vercel project settings, add:
   - `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (or `NEON_DATABASE_URL`)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL` (optional)
3. Deploy! Vercel Cron will automatically trigger `/api/cron` every minute and update your telemetry dashboard.
