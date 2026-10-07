const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const compression = require('compression');

const pkg = require('./package.json');
const logger = require('./lib/logger');
const store = require('./lib/store');
const { rateLimit } = require('./lib/limits');
const { checkNow, createScheduler } = require('./lib/checker');
const { parseTcpTarget } = require('./lib/probe');
const analytics = require('./lib/analytics');
const { badgeSvg } = require('./lib/badge');
const { channelStatus } = require('./lib/notify');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const startedAt = Date.now();
const assetVersion = `${pkg.version}-${startedAt}`;

// One list for the API validator and the store's import/create path, so a
// restored backup can never carry a method the API would have rejected.
const { HTTP_METHODS } = store;
const STATUS_SPEC_RE = /^(\d{3}|\d{3}-\d{3})(\s*,\s*(\d{3}|\d{3}-\d{3}))*$/;

/**
 * Validate + normalise an incoming monitor payload.
 * `value` is a sparse patch object (only fields the caller supplied), which is
 * why it is typed as a generic record rather than a fixed shape.
 *
 * @param {Record<string, any>} [body]
 * @returns {{errors: string[], value: Record<string, any>}}
 */
function validateMonitor(body = {}) {
	const errors = [];
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const url = typeof body.url === 'string' ? body.url.trim() : '';
	const value = { name, url };

	if (!name) errors.push('name is required');
	if (name.length > 60) errors.push('name must be 60 characters or fewer');

	let type = body.type === 'tcp' ? 'tcp' : 'http';
	if (!url) {
		errors.push('url is required');
	} else {
		try {
			const parsed = new URL(url);
			if (parsed.protocol === 'tcp:') type = 'tcp';
			else if (!/^https?:$/.test(parsed.protocol)) errors.push('url must use http, https or tcp');
			if (type === 'tcp' && !parseTcpTarget(url)) errors.push('tcp url must look like tcp://host:port');
		} catch {
			errors.push('url must be a valid absolute URL');
		}
	}
	value.type = type;

	const intervalSec = body.intervalSec === undefined ? 60 : Number(body.intervalSec);
	const timeoutMs = body.timeoutMs === undefined ? 10000 : Number(body.timeoutMs);
	if (!Number.isFinite(intervalSec) || intervalSec < 10 || intervalSec > 86400) {
		errors.push('intervalSec must be between 10 and 86400');
	}
	if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 60000) {
		errors.push('timeoutMs must be between 500 and 60000');
	}
	value.intervalSec = intervalSec;
	value.timeoutMs = timeoutMs;

	const method = body.method === undefined ? 'GET' : String(body.method).toUpperCase();
	if (!HTTP_METHODS.includes(method)) errors.push('method must be GET, HEAD, POST, PUT, PATCH or DELETE');
	value.method = method;

	// --- optional probe assertions (empty / omitted = default behaviour) ---
	if (body.expectedStatus !== undefined && body.expectedStatus !== null && String(body.expectedStatus).trim() !== '') {
		const spec = String(body.expectedStatus).trim();
		if (!STATUS_SPEC_RE.test(spec)) errors.push('expectedStatus must look like "200-299" or "200,204,301"');
		else value.expectedStatus = spec;
	}
	if (body.expectedKeyword !== undefined && body.expectedKeyword !== null && String(body.expectedKeyword).trim() !== '') {
		value.expectedKeyword = String(body.expectedKeyword).trim().slice(0, 120);
	}
	if (body.warnMs !== undefined && body.warnMs !== null && body.warnMs !== '') {
		const warnMs = Number(body.warnMs);
		if (!Number.isFinite(warnMs) || warnMs < 0 || warnMs > 60000) {
			errors.push('warnMs must be between 0 and 60000');
		} else if (warnMs > 0) {
			value.warnMs = Math.round(warnMs);
		}
	}
	if (body.failuresBeforeDown !== undefined && body.failuresBeforeDown !== null && body.failuresBeforeDown !== '') {
		const failures = Number(body.failuresBeforeDown);
		if (!Number.isInteger(failures) || failures < 1 || failures > 10) {
			errors.push('failuresBeforeDown must be an integer between 1 and 10');
		} else if (failures > 1) {
			value.failuresBeforeDown = failures;
		}
	}
	if (body.checkSsl !== undefined && body.checkSsl !== null) {
		value.checkSsl = body.checkSsl !== false && body.checkSsl !== 'false';
	}
	if (body.body !== undefined && body.body !== null && String(body.body) !== '') {
		const payload = String(body.body);
		if (payload.length > 4096) errors.push('request body must be 4096 characters or fewer');
		else value.body = payload;
	}
	if (body.headers !== undefined && body.headers !== null) {
		if (typeof body.headers !== 'object' || Array.isArray(body.headers)) {
			errors.push('headers must be an object with string values');
		} else {
			const entries = Object.entries(body.headers);
			if (entries.length > 10) errors.push('at most 10 headers are allowed');
			let headersValid = entries.length <= 10;
			for (const [key, headerValue] of entries) {
				if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(key)) {
					errors.push(`invalid header name "${String(key).slice(0, 30)}"`);
					headersValid = false;
				} else if (typeof headerValue !== 'string') {
					errors.push(`header "${key}" must be a string value`);
					headersValid = false;
				} else if (headerValue.length > 2048) {
					errors.push(`header "${key}" is too long (2048 max)`);
					headersValid = false;
				}
			}
			if (headersValid) value.headers = body.headers;
		}
	}
	if (body.tags !== undefined && body.tags !== null) {
		if (!Array.isArray(body.tags)) {
			errors.push('tags must be an array');
		} else {
			const tags = body.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim().slice(0, 24));
			if (tags.length > 10) errors.push('at most 10 tags are allowed');
			else value.tags = [...new Set(tags)];
		}
	}

	return { errors, value };
}

/** Monitor JSON without the bulky rollups (they are served by /api/monitors/:id/analytics). */
function publicMonitor(monitor) {
	const payload = { ...monitor, uptime24h: store.uptime24h(monitor) };
	delete payload.rollups;
	return payload;
}

function requestedRange(query) {
	const range = typeof query.range === 'string' ? query.range : '24h';
	return ['24h', '7d', '30d'].includes(range) ? range : '24h';
}

function securityHeaders(req, res, next) {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	// Cross-origin isolation (ZAP baseline flags their absence): no cross-origin
	// subresource may load without opting in, and documents are not readable
	// cross-origin. CSP already forbids cross-origin sources, so require-corp
	// cannot break the UI; embeddable badge SVGs relax CORP below (README §badges).
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
	res.setHeader('X-DNS-Prefetch-Control', 'off');
	res.setHeader(
		'Content-Security-Policy',
		[
			"default-src 'self'",
			"base-uri 'none'",
			"form-action 'self'",
			// Framing is denied by default. ALLOW_FRAMING=1 (local QA harness only)
			// relaxes this so the UI can be rendered inside sized iframes.
			process.env.ALLOW_FRAMING === '1'
				? 'frame-ancestors http: https:'
				: "frame-ancestors 'none'",
			"img-src 'self' data:",
			"style-src 'self'",
			"script-src 'self'",
			"connect-src 'self'",
			"font-src 'self'",
			"object-src 'none'",
		].join('; '),
	);
	if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

	// ALLOW_ORIGIN accepts one origin or a comma-separated list; the response
	// echoes only the caller's origin when it is on that list (a comma inside
	// the header value would be rejected by browsers).
	const allowOrigin = process.env.ALLOW_ORIGIN;
	if (allowOrigin) {
		const allowed = allowOrigin.split(',').map((value) => value.trim()).filter(Boolean);
		const origin = req.get('Origin');
		const matched = allowed.includes('*')
			? '*'
			: origin
				? (allowed.includes(origin) ? origin : null)
				: allowed.length === 1
					? allowed[0]
					: null;
		if (matched) {
			res.setHeader('Access-Control-Allow-Origin', matched);
			res.setHeader('Vary', 'Origin');
			res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'content-type');
			if (req.method === 'OPTIONS') return res.status(204).end();
		}
	}
	return next();
}

function requestLogger(req, res, next) {
	const id = crypto.randomUUID().slice(0, 8);
	req.id = id;
	res.setHeader('X-Request-Id', id);
	const started = process.hrtime.bigint();
	res.on('finish', () => {
		const ms = Number(process.hrtime.bigint() - started) / 1e6;
		const line = { id, method: req.method, path: req.originalUrl, status: res.statusCode, ms: Math.round(ms) };
		if (res.statusCode >= 500) logger.error('request', line);
		else if (res.statusCode >= 400) logger.warn('request', line);
		else logger.debug('request', line);
	});
	next();
}

function createApp() {
	const app = express();

	app.disable('x-powered-by');
	app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
	app.set('etag', 'strong');

	app.use(securityHeaders);
	app.use(compression());
	app.use(requestLogger);

	app.use(
		'/api',
		rateLimit({
			max: Number(process.env.RATE_LIMIT_MAX) || 240,
			windowMs: 60_000,
			keyOf: (req) => req.ip,
		}),
	);

	app.use(express.json({ limit: '64kb' }));

	const publicDir = path.join(__dirname, 'public');

	// Versioned asset URLs (?v=...) so a deploy or restart never leaves a
	// browser running stale JS from a previous cache window.
	const indexHtml = fs
		.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
		.replace(
			/(href|src)="([^"]+\.(?:css|js|svg))"/g,
			(_match, attr, file) => `${attr}="${file}?v=${assetVersion}"`,
		);

	app.get('/', (req, res) => {
		res.setHeader('Cache-Control', 'no-cache');
		res.type('html').send(indexHtml);
	});

	// Public status page — enabled from Settings → Status page.
	app.get('/status', (req, res) => {
		const settings = store.getSettings();
		if (!settings.statusPage.enabled) {
			return res
				.status(404)
				.type('text')
				.send('Status page is disabled. Enable it in Settings → Status page.');
		}
		res.setHeader('Cache-Control', 'no-cache');
		res.sendFile(path.join(publicDir, 'status.html'));
	});

	app.use(
		express.static(publicDir, {
			index: false,
			dotfiles: 'deny',
			setHeaders(res, filePath) {
				// Small assets: always revalidate (ETag → 304) so a deploy is
				// picked up immediately without paying full bandwidth.
				if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
				else res.setHeader('Cache-Control', 'public, no-cache, must-revalidate');
			},
		}),
	);

	// ---- API ----

	app.get('/api/health', (req, res) => {
		res.json({
			ok: true,
			version: pkg.version,
			node: process.version,
			env: process.env.NODE_ENV || 'development',
			uptimeSec: Math.round((Date.now() - startedAt) / 1000),
			monitors: store.list().length,
			telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
			alerts: channelStatus(),
			now: new Date().toISOString(),
		});
	});

	app.get('/api/stats', (req, res) => {
		res.json(store.stats());
	});

	app.get('/api/analytics', (req, res) => {
		res.json({
			...analytics.summary(store.list(), requestedRange(req.query)),
			days: analytics.dayBuckets(store.list(), 30),
			sla: analytics.slaReport({
				monitor: null,
				monitors: store.list(),
				incidents: store.incidents(500),
			}),
		});
	});

	app.get('/api/monitors', (req, res) => {
		const order = { down: 0, unknown: 1, up: 2 };
		const monitors = store
			.list()
			.map((m) => publicMonitor(m))
			.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name));
		res.json(monitors);
	});

	app.post('/api/monitors', (req, res) => {
		const { errors, value } = validateMonitor(req.body);
		if (errors.length) return res.status(400).json({ errors });

		const monitor = store.create(value);
		logger.info('Monitor created', { name: monitor.name, url: monitor.url });
		checkNow(monitor).catch(() => {});
		res.status(201).json(publicMonitor(monitor));
	});

	app.get('/api/monitors/:id', (req, res) => {
		const monitor = store.get(req.params.id);
		if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
		res.json(publicMonitor(monitor));
	});

	app.get('/api/monitors/:id/analytics', (req, res) => {
		const monitor = store.get(req.params.id);
		if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
		res.json({
			...analytics.summary(monitor, requestedRange(req.query)),
			histogram: analytics.histogram(monitor),
			days: analytics.dayBuckets(monitor, 30),
			sla: analytics.slaReport({ monitor, incidents: store.incidents(500) }),
		});
	});

	app.get('/api/monitors/:id/checks.csv', (req, res) => {
		const monitor = store.get(req.params.id);
		if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
		const lines = ['timestamp,ok,http_status,response_ms'];
		for (const entry of monitor.history) {
			lines.push(
				`${entry.at},${entry.ok ? 1 : 0},${entry.status ?? ''},${Number.isFinite(entry.ms) ? entry.ms : ''}`,
			);
		}
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="novapulse-checks-${monitor.id}.csv"`);
		res.send(lines.join('\n'));
	});

	app.patch('/api/monitors/:id', (req, res) => {
		const monitor = store.get(req.params.id);
		if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

		const body = req.body || {};
		const { errors, value } = validateMonitor({ ...monitor, ...body });
		if (errors.length) return res.status(400).json({ errors });

		const patch = { ...value };
		if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

		// Explicit clears: the field was sent empty/zero → drop it from storage.
		const clearable = ['expectedStatus', 'expectedKeyword', 'warnMs', 'failuresBeforeDown', 'body', 'headers'];
		for (const field of clearable) {
			if (body[field] !== undefined && value[field] === undefined) patch[field] = undefined;
		}

		const updated = store.update(monitor.id, patch);
		res.json(publicMonitor(updated));
	});

	app.delete('/api/monitors/:id', (req, res) => {
		const monitor = store.get(req.params.id);
		if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
		store.remove(req.params.id);
		scheduler.forget(req.params.id);
		logger.info('Monitor deleted', { name: monitor.name });
		res.status(204).end();
	});

	app.post('/api/monitors/:id/check', async (req, res, next) => {
		try {
			const monitor = store.get(req.params.id);
			if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
			const updated = await checkNow(monitor);
			res.json(publicMonitor(updated));
		} catch (error) {
			next(error);
		}
	});

	app.get('/api/incidents', (req, res) => {
		const limit = Math.min(Number(req.query.limit) || 50, 200);
		res.json(
			store.incidents(limit, {
				monitorId: typeof req.query.monitorId === 'string' ? req.query.monitorId : undefined,
				type: req.query.type === 'up' || req.query.type === 'down' ? req.query.type : undefined,
			}),
		);
	});

	app.get('/api/export', (req, res) => {
		res.setHeader('Content-Disposition', `attachment; filename="novapulse-export-${Date.now()}.json"`);
		res.json(store.exportState());
	});

	app.post('/api/import', (req, res) => {
		const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
		try {
			const result = store.importState(req.body, mode);
			logger.info('Backup imported', { mode, ...result });
			res.json(result);
		} catch (error) {
			res.status(400).json({ errors: [error.message] });
		}
	});

	// ---- settings (status page, alert channel report) ----

	app.get('/api/settings', (req, res) => {
		res.json({ ...store.getSettings(), alerts: channelStatus() });
	});

	app.patch('/api/settings', (req, res) => {
		const updated = store.updateSettings(req.body || {});
		res.json({ ...updated, alerts: channelStatus() });
	});

	// ---- public status projection (no auth, no secrets) ----

	app.get('/api/public/status', (req, res) => {
		const projection = analytics.statusProjection({
			monitors: store.list(),
			incidents: store.incidents(20),
			settings: store.getSettings(),
		});
		if (!projection.enabled) return res.status(404).json({ error: 'Status page is disabled' });
		res.setHeader('Cache-Control', 'public, max-age=30');
		res.json(projection);
	});

	// ---- embeddable SVG badges ----

	app.get('/api/badge/:id.svg', (req, res) => {
		const style = req.query.style === 'for-the-badge' ? 'for-the-badge' : 'flat';
		let name;
		let status;
		let uptime;

		if (req.params.id === 'fleet') {
			const totals = store.stats().totals;
			name = 'novapulse';
			status = totals.down ? 'down' : totals.degraded ? 'degraded' : totals.up ? 'up' : 'unknown';
			const summary = analytics.summary(store.list(), '30d');
			uptime = summary.uptime;
		} else {
			const monitor = store.get(req.params.id);
			if (!monitor) return res.status(404).type('text').send('unknown monitor');
			name = monitor.name;
			status = monitor.enabled ? monitor.status : 'paused';
			const buckets = analytics.dayBuckets(monitor, 30);
			let checks = 0;
			let ok = 0;
			for (const bucket of buckets) {
				checks += bucket.checks;
				ok += bucket.ok;
			}
			uptime = checks ? Math.round((ok / checks) * 1000) / 10 : null;
		}

		res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
		res.setHeader('Cache-Control', 'public, max-age=60');
		// Badges exist to be embedded in READMEs and status pages hosted
		// elsewhere — they must stay cross-origin embeddable (README §badges).
		res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
		res.send(badgeSvg({ name, status, uptime, style }));
	});

	app.use('/api', (req, res) => {
		res.status(404).json({ error: 'Not found' });
	});

	app.use((err, req, res, next) => {
		if (res.headersSent) return next(err);
		if (err?.type === 'entity.parse.failed') {
			return res.status(400).json({ errors: ['Invalid JSON body'] });
		}
		if (err?.type === 'entity.too.large') {
			return res.status(413).json({ errors: ['Payload too large'] });
		}
		logger.error('Unhandled error', { path: req.originalUrl, error: err?.message });
		return res.status(500).json({ error: 'Internal server error' });
	});

	// Non-API misses (hash routing handles the SPA, so anything else is a 404).
	app.use((req, res) => {
		res.status(404).json({ error: 'Not found' });
	});

	return app;
}

const scheduler = createScheduler(store);

if (require.main === module) {
	const app = createApp();
	const server = app.listen(PORT, HOST, () => {
		logger.info(`NovaPulse v${pkg.version} listening`, {
			url: `http://localhost:${PORT}`,
			node: process.version,
			env: process.env.NODE_ENV || 'development',
		});
	});

	const schedulerTimer = scheduler.start(5000);

	let shuttingDown = false;
	const shutdown = (signal) => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info(`Received ${signal}, shutting down`);
		clearInterval(schedulerTimer);
		server.close(() => {
			store.save(true);
			logger.info('Shutdown complete');
			process.exit(0);
		});
		setTimeout(() => {
			store.save(true);
			process.exit(0);
		}, 8000).unref();
	};

	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('unhandledRejection', (reason) => {
		logger.error('Unhandled rejection', { error: reason instanceof Error ? reason.message : String(reason) });
	});
}

module.exports = { createApp, pkg };
