/**
 * Vercel Serverless Cron Handler
 * Triggered automatically by Vercel Cron according to vercel.json.
 */

const { getDb } = require('../lib/db');
const { probe } = require('../lib/probe');
const { notify } = require('../lib/notify');

module.exports = async function handler(req, res) {
	// Verify Vercel Cron secret or authorization if configured
	const authHeader = req.headers['authorization'];
	if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const db = getDb(process.env);
	const monitors = await db.list();
	const now = Date.now();
	const results = [];

	for (const monitor of monitors) {
		if (!monitor.enabled) continue;
		// Same cadence guard the Cloudflare edge worker applies: a monitor's own
		// intervalSec stays meaningful even when the platform cron fires more
		// often than the monitor needs.
		const last = monitor.lastCheck ? Date.parse(monitor.lastCheck.at) : 0;
		const intervalMs = Math.max(10, monitor.intervalSec || 60) * 1000;
		if (Number.isFinite(last) && now - last < intervalMs) continue;

		try {
			const result = await probe(monitor);
			const at = new Date().toISOString();
			const previousStatus = monitor.status;
			const newStatus = result.ok ? (result.degraded ? 'degraded' : 'up') : 'down';

			await db.addHistory(monitor.id, { at, ok: result.ok, status: result.status, ms: result.ms });
			await db.update(monitor.id, {
				status: newStatus,
				lastCheck: { at, ...result },
			});

			// Serverless mode keeps no persistent alert state between invocations,
			// so a status *transition* is the alert gate (mirrors edge/worker.js):
			// one DOWN/UP notification per flap, never a repeat alert for an
			// endpoint that stays down. `notify` logs its own failures and never
			// throws, so a webhook outage cannot fail the cron run.
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
				await notify(
					`🔴 DOWN: ${monitor.name}\n${monitor.url}\n${result.error}${result.responseSnippet ? `\n\nPreview:\n${result.responseSnippet.slice(0, 200)}...` : ''}`,
					{ event: 'down', title: 'Monitor down', monitor: { name: monitor.name, url: monitor.url } },
				);
			} else if (newStatus === 'up' && previousStatus === 'down') {
				await db.pushIncident({
					monitorId: monitor.id,
					name: monitor.name,
					url: monitor.url,
					type: 'up',
					reason: 'Recovered',
					at,
				});
				await notify(`🟢 UP: ${monitor.name}\n${monitor.url} is back online.`, {
					event: 'up',
					title: 'Monitor recovered',
					monitor: { name: monitor.name, url: monitor.url },
				});
			}

			results.push({ name: monitor.name, ok: result.ok, status: newStatus, ms: result.ms });
		} catch (err) {
			results.push({ name: monitor.name, ok: false, error: err.message });
		}
	}

	return res.status(200).json({
		ok: true,
		checked: results.length,
		runtime: 'vercel-serverless-cron',
		timestamp: new Date().toISOString(),
		results,
	});
};
