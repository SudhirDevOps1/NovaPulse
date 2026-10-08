/**
 * NovaPulse 2026 — Cloudflare Worker Edge Engine
 *
 * Runs 24/7 on Cloudflare's 300+ city global edge network.
 * Features:
 *   - Native Cron Triggers: Every 1 minute (* * * * *) with zero queue lag.
 *   - Zero Infrastructure: Powered by Cloudflare D1 (Serverless SQLite).
 *   - 100% Free Forever: Consumes ~1,440 requests/day (< 1.5% of 100,000/day free quota).
 *   - Multi-Channel Alerts: Telegram, Discord, Slack, ntfy.
 */

import { D1Adapter } from '../lib/db/d1.js';

function generateScreenshotUrl(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return `https://s0.wp.com/mshots/v1/${encodeURIComponent(parsed.origin)}?w=800&h=500`;
		}
	} catch {
		// ignore
	}
	return null;
}

async function probeTarget(monitor) {
	const startedAt = Date.now();
	const timeoutMs = monitor.timeoutMs || 10000;

	try {
		const res = await fetch(monitor.url, {
			method: monitor.method || 'GET',
			headers: {
				'user-agent': 'novapulse/2026-edge',
				accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
				...(monitor.headers || {}),
			},
			signal: AbortSignal.timeout(timeoutMs),
		});

		const ms = Date.now() - startedAt;
		const status = res.status;
		const text = await res.text();

		let ok = status >= 200 && status < 400;
		let error = ok ? null : `Unexpected status ${status}`;

		if (ok && monitor.expectedKeyword) {
			const needle = String(monitor.expectedKeyword).toLowerCase();
			if (!text.toLowerCase().includes(needle)) {
				ok = false;
				error = `Keyword not found in response: "${monitor.expectedKeyword}"`;
			}
		}

		const warnMs = Number(monitor.warnMs) || 0;
		const degraded = ok && warnMs > 0 && ms >= warnMs;

		return {
			ok,
			status,
			ms,
			error,
			degraded,
			bytes: text.length,
			responseSnippet: !ok && text ? text.slice(0, 1024) : null,
			responseHeaders: !ok ? { 'content-type': res.headers.get('content-type') } : null,
			screenshotUrl: generateScreenshotUrl(monitor.url),
		};
	} catch (err) {
		const ms = Date.now() - startedAt;
		return {
			ok: false,
			status: null,
			ms,
			error: err?.message || 'Network error',
			degraded: false,
			bytes: 0,
			responseSnippet: null,
			responseHeaders: null,
			screenshotUrl: generateScreenshotUrl(monitor.url),
		};
	}
}

async function sendAlert(env, text) {
	const promises = [];
	if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
		promises.push(
			fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
			}).catch(() => {})
		);
	}
	if (env.DISCORD_WEBHOOK_URL) {
		promises.push(
			fetch(env.DISCORD_WEBHOOK_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: text.slice(0, 2000), username: 'NovaPulse' }),
			}).catch(() => {})
		);
	}
	if (env.SLACK_WEBHOOK_URL) {
		promises.push(
			fetch(env.SLACK_WEBHOOK_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text }),
			}).catch(() => {})
		);
	}
	if (env.NTFY_URL) {
		promises.push(
			fetch(env.NTFY_URL, {
				method: 'POST',
				headers: { Title: 'NovaPulse Edge Alert' },
				body: text,
			}).catch(() => {})
		);
	}
	await Promise.all(promises);
}

async function triggerGitHubIncidentIssue(env, monitor, failure) {
	const token = env.GITHUB_TOKEN || env.GH_PAT;
	const repo = env.GITHUB_REPOSITORY;
	if (!token || !repo) return;
	try {
		await fetch(`https://api.github.com/repos/${repo}/issues`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'Content-Type': 'application/json',
				'User-Agent': 'novapulse/2026-edge-worker',
			},
			body: JSON.stringify({
				title: `🚨 Incident: ${monitor.name} is DOWN`,
				body: `### 🚨 Outage Detected: ${monitor.name}\n\n**Target**: \`${monitor.url}\`\n**Time**: \`${new Date().toISOString()}\`\n**Status**: \`${failure.status || 'DOWN'}\` · ${failure.error || 'Connection Failed'}\n\n*Automated by NovaPulse Edge Worker (Cloudflare Edge).*`,
				labels: ['incident', 'downtime'],
			}),
		});
	} catch {
		// ignore
	}
}

export default {
	/** Cloudflare Native 1-Minute Cron Trigger */
	async scheduled(event, env, ctx) {
		if (!env.DB) return;
		const db = new D1Adapter(env.DB);
		const monitors = await db.list();
		const now = Date.now();

		for (const monitor of monitors) {
			if (!monitor.enabled) continue;
			const last = monitor.lastCheck ? Date.parse(monitor.lastCheck.at) : 0;
			const intervalMs = Math.max(10, monitor.intervalSec || 60) * 1000;
			if (now - last < intervalMs) continue;

			ctx.waitUntil(
				(async () => {
					const result = await probeTarget(monitor);
					const at = new Date().toISOString();
					const previousStatus = monitor.status;
					const newStatus = result.ok ? (result.degraded ? 'degraded' : 'up') : 'down';

					await db.addHistory(monitor.id, { at, ok: result.ok, status: result.status, ms: result.ms });
					await db.update(monitor.id, { status: newStatus, lastCheck: { at, ...result } });

					if (newStatus === 'down' && previousStatus !== 'down') {
						await db.pushIncident({
							monitorId: monitor.id,
							name: monitor.name,
							url: monitor.url,
							type: 'down',
							reason: result.error,
							status: result.status,
							responseSnippet: result.responseSnippet,
							screenshotUrl: result.screenshotUrl,
							at,
						});
						await sendAlert(
							env,
							`🔴 DOWN: ${monitor.name}\n${monitor.url}\n${result.error}${result.responseSnippet ? `\n\nPreview:\n${result.responseSnippet.slice(0, 200)}...` : ''}`
						);
						await triggerGitHubIncidentIssue(env, monitor, result);
					} else if (newStatus === 'up' && previousStatus === 'down') {
						await db.pushIncident({
							monitorId: monitor.id,
							name: monitor.name,
							url: monitor.url,
							type: 'up',
							reason: 'Recovered',
							at,
						});
						await sendAlert(env, `🟢 UP: ${monitor.name}\n${monitor.url} is back online.`);
					}
				})()
			);
		}
	},

	/** Cloudflare Worker HTTP REST API Gateway */
	async fetch(request, env, _ctx) {
		const url = new URL(request.url);
		const db = env.DB ? new D1Adapter(env.DB) : null;

		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			'Content-Type': 'application/json',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders, status: 204 });
		}

		if (url.pathname === '/api/health') {
			const count = db ? (await db.list()).length : 0;
			return new Response(
				JSON.stringify({
					ok: true,
					runtime: 'cloudflare-worker',
					edgeLocation: request.cf?.colo || 'EDGE',
					cronCadence: '1 minute',
					monitors: count,
					now: new Date().toISOString(),
				}),
				{ headers: corsHeaders }
			);
		}

		if (url.pathname === '/api/monitors' && request.method === 'GET') {
			const monitors = db ? await db.list() : [];
			return new Response(JSON.stringify(monitors), { headers: corsHeaders });
		}

		if (url.pathname === '/api/incidents' && request.method === 'GET') {
			const incidents = db ? await db.incidents(50) : [];
			return new Response(JSON.stringify(incidents), { headers: corsHeaders });
		}

		return new Response(JSON.stringify({ error: 'Not found', path: url.pathname }), {
			status: 404,
			headers: corsHeaders,
		});
	},
};
