// api/cron.js: serverless mode must raise ONE incident + notification on a
// status transition (mirroring edge/worker.js), respect intervalSec, and never
// re-alert an endpoint that simply stays down.
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.UPTIME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-cron-'));

const store = require('../lib/store');
const handler = require('../api/cron');

const originalFetch = global.fetch;
const channelCalls = [];

let target; // local HTTP server the probe points at
let targetUrl;
let upNow = false;

before(async () => {
	target = http.createServer((req, res) => {
		res.statusCode = upNow ? 200 : 404;
		res.end();
	});
	await new Promise((resolve) => {
		target.listen(0, '127.0.0.1', resolve);
	});
	targetUrl = `http://127.0.0.1:${target.address().port}/flap`;

	// The probe's SSRF guard blocks loopback targets; this test points the
	// monitor at a local HTTP server, so opt in (same allowance safety.test.js
	// exercises for LAN monitoring).
	process.env.ALLOW_PRIVATE_TARGETS = '1';

	// Capture cron-mode notifications instead of hitting real channels.
	global.fetch = /** @type {any} */ (async (url, options) => {
		if (/telegram|discord|slack|ntfy|webhook/i.test(url)) {
			channelCalls.push({ url: String(url), options });
			return { ok: true, status: 200 };
		}
		return originalFetch(url, options);
	});
	process.env.TELEGRAM_BOT_TOKEN = 'token';
	process.env.TELEGRAM_CHAT_ID = '42';
});

after(() => {
	target.close();
	global.fetch = originalFetch;
	delete process.env.TELEGRAM_BOT_TOKEN;
	delete process.env.TELEGRAM_CHAT_ID;
	delete process.env.ALLOW_PRIVATE_TARGETS;
});

function runCron() {
	const req = { headers: {} };
	const res = {
		statusCode: 0,
		body: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(body) {
			this.body = body;
			return body;
		},
	};
	return handler(req, res).then(() => res); // res: filled in by the handler
}

/** Pretend the last check happened `ageSeconds` ago so the next cron run is due. */
function ageLastCheck(monitor, ageSeconds = 20) {
	const lastCheck = { ...monitor.lastCheck, at: new Date(Date.now() - ageSeconds * 1000).toISOString() };
	store.update(monitor.id, { lastCheck });
}

test('transitions raise one incident + notification; stays-down stays quiet', async () => {
	const monitor = store.create({ name: 'Cron toy', url: targetUrl, intervalSec: 10 });

	upNow = false; // target answers 404 → DOWN
	let res = await runCron();
	assert.equal(res.body.checked, 1);
	assert.equal(res.body.results[0].status, 'down');

	const downIncidents = store.incidents(200, { monitorId: monitor.id, type: 'down' });
	assert.equal(downIncidents.length, 1);
	assert.equal(channelCalls.filter((c) => JSON.stringify(c.options.body).includes('DOWN')).length, 1);

	// Still down, now due again: NO new incident, NO new notification. But the
	// probe result is still recorded (status remains down).
	ageLastCheck(store.get(monitor.id));
	await runCron();
	assert.equal(store.incidents(200, { monitorId: monitor.id, type: 'down' }).length, 1);
	const stillDownNotifications = channelCalls.filter((c) => JSON.stringify(c.options.body).includes('DOWN')).length;
	assert.ok(stillDownNotifications <= 1);

	// Recovery: target answers 200 → UP transition.
	upNow = true;
	ageLastCheck(store.get(monitor.id));
	res = await runCron();
	assert.equal(res.body.results[0].status, 'up');
	const upIncidents = store.incidents(200, { monitorId: monitor.id, type: 'up' });
	assert.equal(upIncidents.length, 1);
	assert.match(upIncidents[0].reason, /Recovered/);
	assert.ok(channelCalls.some((c) => JSON.stringify(c.options.body).includes('UP:')));

	// intervalSec gate: an immediate second run must skip everything.
	const repeated = await runCron();
	assert.equal(repeated.body.checked, 0);

	store.remove(monitor.id);
});

test('CRON_SECRET rejects callers without the bearer token', async () => {
	process.env.CRON_SECRET = 's3cret';
	try {
		const res = await runCron();
		assert.equal(res.statusCode, 401);
	} finally {
		delete process.env.CRON_SECRET;
	}
});
