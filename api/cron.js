/**
 * Vercel Serverless Cron Handler
 * Triggered automatically by Vercel Cron according to vercel.json.
 */

const { getDb } = require('../lib/db');
const { probe } = require('../lib/probe');

module.exports = async function handler(req, res) {
	// Verify Vercel Cron secret or authorization if configured
	const authHeader = req.headers['authorization'];
	if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const db = getDb(process.env);
	const monitors = await db.list();
	const results = [];

	for (const monitor of monitors) {
		if (!monitor.enabled) continue;
		try {
			const result = await probe(monitor);
			const at = new Date().toISOString();
			await db.addHistory(monitor.id, { at, ok: result.ok, status: result.status, ms: result.ms });
			await db.update(monitor.id, {
				status: result.ok ? (result.degraded ? 'degraded' : 'up') : 'down',
				lastCheck: { at, ...result },
			});
			results.push({ name: monitor.name, ok: result.ok, ms: result.ms });
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
