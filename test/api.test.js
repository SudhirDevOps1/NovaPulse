const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

// Keep tests away from real monitor data.
process.env.UPTIME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-test-'));
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';

const { createApp } = require('../server');

let server;
let base;

before(async () => {
	server = createApp().listen(0);
	await new Promise((resolve) => {
		server.once('listening', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('health endpoint reports monitor count', async () => {
	const response = await fetch(`${base}/api/health`);
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.ok, true);
	assert.equal(body.monitors, 0);
});

test('rejects a monitor without a valid url', async () => {
	const response = await fetch(`${base}/api/monitors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Bad', url: 'ftp://example.com' }),
	});
	assert.equal(response.status, 400);
	const body = await response.json();
	assert.match(body.errors.join(' '), /http, https or tcp/);
});

test('monitor lifecycle: create, list, fetch, delete', async () => {
	const created = await fetch(`${base}/api/monitors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Local', url: 'http://127.0.0.1:1/', intervalSec: 60 }),
	});
	assert.equal(created.status, 201);
	const monitor = await created.json();
	assert.equal(monitor.status, 'unknown');
	assert.equal(monitor.uptime24h, null);

	const list = await (await fetch(`${base}/api/monitors`)).json();
	assert.equal(list.length, 1);
	assert.equal(list[0].id, monitor.id);

	const single = await fetch(`${base}/api/monitors/${monitor.id}`);
	assert.equal(single.status, 200);

	const removed = await fetch(`${base}/api/monitors/${monitor.id}`, { method: 'DELETE' });
	assert.equal(removed.status, 204);

	const empty = await (await fetch(`${base}/api/monitors`)).json();
	assert.equal(empty.length, 0);
});

test('unknown API routes return JSON 404', async () => {
	const response = await fetch(`${base}/api/nope`);
	assert.equal(response.status, 404);
	assert.equal((await response.json()).error, 'Not found');
});

test('sends hardened security headers', async () => {
	const response = await fetch(`${base}/api/health`);
	assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
	assert.equal(response.headers.get('x-frame-options'), 'DENY');
	assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
	assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
	assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
	assert.equal(response.headers.get('x-powered-by'), null);
	assert.ok(response.headers.get('x-request-Id') || response.headers.get('x-request-id'));
});

test('stats and export endpoints report consistent shape', async () => {
	const stats = await (await fetch(`${base}/api/stats`)).json();
	assert.deepEqual(Object.keys(stats.totals).sort(), [
		'degraded',
		'down',
		'monitors',
		'paused',
		'unknown',
		'up',
	]);
	assert.equal(stats.totals.monitors, 0);

	const exported = await (await fetch(`${base}/api/export`)).json();
	assert.equal(exported.version, 2);
	assert.ok(Array.isArray(exported.monitors));
	assert.ok(exported.settings);
});

test('export → import preserves the probe method (merge and replace)', async () => {
	// importState used to hard-code `m.method === 'POST' ? 'POST' : 'GET'`, so a
	// restored backup silently downgraded HEAD/PUT/PATCH/DELETE (TODO NOW-6).
	const created = await fetch(`${base}/api/monitors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Headroom', url: 'https://example.com/', method: 'HEAD' }),
	});
	assert.equal(created.status, 201);
	const createdBody = await created.json();
	assert.equal(createdBody.method, 'HEAD');
	assert.equal(typeof createdBody.id, 'string');

	const backup = await (await fetch(`${base}/api/export`)).json();

	try {
		for (const mode of ['merge', 'replace']) {
			const response = await fetch(`${base}/api/import?mode=${mode}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(backup),
			});
			assert.equal(response.status, 200, `${mode}: import accepted`);

			const list = await (await fetch(`${base}/api/monitors`)).json();
			const restored = list.find((monitor) => monitor.name === 'Headroom');
			assert.ok(restored, `${mode}: monitor restored`);
			assert.equal(restored.method, 'HEAD', `${mode}: method survives the round trip`);
		}
	} finally {
		// Leave the store as we found it: later specs assume a fleet of zero.
		await fetch(`${base}/api/monitors/${createdBody.id}`, { method: 'DELETE' });
	}
});

test('advanced monitor fields validate and can be cleared', async () => {
	// invalid expectedStatus is rejected
	const badSpec = await fetch(`${base}/api/monitors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Bad spec', url: 'https://example.com', expectedStatus: 'two-hundred' }),
	});
	assert.equal(badSpec.status, 400);

	// tcp without a port is rejected
	const badTcp = await fetch(`${base}/api/monitors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Bad tcp', url: 'tcp://example.com' }),
	});
	assert.equal(badTcp.status, 400);

	// a fully specified monitor is accepted
	const created = await fetch(`${base}/api/monitors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			name: 'API',
			url: 'tcp://127.0.0.1:1',
			type: 'tcp',
			expectedStatus: '200-299,304',
			expectedKeyword: 'ok',
			warnMs: 800,
			failuresBeforeDown: 3,
			tags: ['prod', 'api', 'prod'],
		}),
	});
	assert.equal(created.status, 201);
	const monitor = await created.json();
	assert.equal(monitor.type, 'tcp');
	assert.equal(monitor.expectedStatus, '200-299,304');
	assert.equal(monitor.expectedKeyword, 'ok');
	assert.equal(monitor.warnMs, 800);
	assert.equal(monitor.failuresBeforeDown, 3);
	assert.deepEqual(monitor.tags, ['prod', 'api']); // de-duplicated

	// rollups are never leaked in the list payload
	assert.equal(monitor.rollups, undefined);

	// analytics endpoint answers for a fresh monitor (the create-triggered check
	// may already have recorded one point, so only assert the shape)
	const analytics = await (await fetch(`${base}/api/monitors/${monitor.id}/analytics?range=7d`)).json();
	assert.equal(analytics.range, 168);
	assert.ok(Array.isArray(analytics.series));
	assert.ok(analytics.series.length <= 1);
	assert.equal(analytics.sla.target, 99.9);

	// csv export works
	const csv = await fetch(`${base}/api/monitors/${monitor.id}/checks.csv`);
	assert.equal(csv.status, 200);
	assert.match(csv.headers.get('content-type') || '', /text\/csv/);
	assert.match(await csv.text(), /timestamp,ok,http_status,response_ms/);

	// clearing an assertion with an empty value removes it
	const cleared = await fetch(`${base}/api/monitors/${monitor.id}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ expectedKeyword: '', warnMs: 0, tags: [] }),
	});
	const afterClear = await cleared.json();
	assert.equal(cleared.status, 200);
	assert.equal(afterClear.expectedKeyword, undefined);
	assert.equal(afterClear.warnMs, undefined);
	assert.deepEqual(afterClear.tags, []);

	const removed = await fetch(`${base}/api/monitors/${monitor.id}`, { method: 'DELETE' });
	assert.equal(removed.status, 204);
});

test('fleet analytics endpoint reports a range summary', async () => {
	const response = await fetch(`${base}/api/analytics?range=30d`);
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.range, 720);
	assert.ok(Array.isArray(body.series));
	assert.equal(body.checks, 0);
	assert.equal(body.uptime, null);
});

test('status page is disabled by default', async () => {
	const page = await fetch(`${base}/status`);
	assert.equal(page.status, 404);
	const projection = await fetch(`${base}/api/public/status`);
	assert.equal(projection.status, 404);
});

test('settings can enable the status page and projection renders', async () => {
	const patched = await fetch(`${base}/api/settings`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ statusPage: { enabled: true, title: 'Acme status', message: 'All good' } }),
	});
	assert.equal(patched.status, 200);
	const settings = await patched.json();
	assert.equal(settings.statusPage.enabled, true);
	assert.equal(settings.statusPage.title, 'Acme status');
	assert.ok(settings.alerts);

	const page = await fetch(`${base}/status`);
	assert.equal(page.status, 200);
	assert.match(page.headers.get('content-type') || '', /text\/html/);

	const projection = await fetch(`${base}/api/public/status`);
	assert.equal(projection.status, 200);
	const body = await projection.json();
	assert.equal(body.enabled, true);
	assert.equal(body.title, 'Acme status');
	assert.equal(body.overall, 'unknown');
	assert.deepEqual(body.services, []);
});

test('svg badges render for the fleet', async () => {
	const badge = await fetch(`${base}/api/badge/fleet.svg?style=for-the-badge`);
	assert.equal(badge.status, 200);
	assert.match(badge.headers.get('content-type') || '', /image\/svg/);
	// badges are documented as cross-origin embeddable (README §badges)
	assert.equal(badge.headers.get('cross-origin-resource-policy'), 'cross-origin');
	const text = await badge.text();
	assert.match(text, /<svg/);
	assert.match(text, /NOVAPULSE/); // for-the-badge uppercases the label
	assert.match(text, /UPTIME|UNKNOWN/);

	const missing = await fetch(`${base}/api/badge/nope.svg`);
	assert.equal(missing.status, 404);
});

// ALLOW_ORIGIN is read per request, so the env can be toggled inside one test.
test('ALLOW_ORIGIN honours a comma-separated list of origins', async () => {
	process.env.ALLOW_ORIGIN = 'https://app.example, https://status.example';
	try {
		const listed = await fetch(`${base}/api/health`, { headers: { Origin: 'https://app.example' } });
		assert.equal(listed.headers.get('access-control-allow-origin'), 'https://app.example');

		const second = await fetch(`${base}/api/health`, { headers: { Origin: 'https://status.example' } });
		assert.equal(second.headers.get('access-control-allow-origin'), 'https://status.example');

		// A caller that is not on the list gets no CORS grant at all.
		const stranger = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
		assert.equal(stranger.headers.get('access-control-allow-origin'), null);

		// Preflight succeeds only for a listed origin; a stray preflight is not
		// answered with 204, so the browser blocks the real request.
		const preflight = await fetch(`${base}/api/monitors`, {
			method: 'OPTIONS',
			headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' },
		});
		assert.equal(preflight.status, 204);
		const stray = await fetch(`${base}/api/monitors`, {
			method: 'OPTIONS',
			headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
		});
		assert.notEqual(stray.status, 204);
		assert.equal(stray.headers.get('access-control-allow-origin'), null);

		// No Origin header (server-to-server call) keeps the single-origin grant.
		process.env.ALLOW_ORIGIN = 'https://app.example';
		const noOrigin = await fetch(`${base}/api/health`);
		assert.equal(noOrigin.headers.get('access-control-allow-origin'), 'https://app.example');
	} finally {
		delete process.env.ALLOW_ORIGIN;
	}
});

test('probe helpers parse status specs and tcp targets', () => {
	const { parseStatusSpec, parseTcpTarget, statusMatches } = require('../lib/probe');
	assert.deepEqual(parseStatusSpec('200,204'), [[200, 200], [204, 204]]);
	assert.deepEqual(parseStatusSpec('500-599'), [[500, 599]]);
	assert.ok(statusMatches(204, parseStatusSpec('200-299')));
	assert.ok(!statusMatches(404, parseStatusSpec('200-299')));
	// malformed spec falls back to the historical 200-399 default
	assert.deepEqual(parseStatusSpec('nonsense'), [[200, 399]]);
	assert.deepEqual(parseTcpTarget('tcp://db.internal:5432'), { host: 'db.internal', port: 5432 });
	assert.equal(parseTcpTarget('db.internal'), null);
});
