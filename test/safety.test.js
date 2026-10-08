// Safety rails added in the hardening pass: the SSRF guard, the redirect
// deadline, backup-import validation, the incidents clamp and the CSV quoting.
// Env has to be set before lib/store loads — it reads the data dir at require.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.UPTIME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-safety-'));
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
delete process.env.ALLOW_PRIVATE_TARGETS;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { probe, isPrivateAddress, isPrivateHost } = require('../lib/probe');
const store = require('../lib/store');
const { createApp } = require('../server');

/** Run `fn` with ALLOW_PRIVATE_TARGETS=1 so the local fixtures are reachable. */
async function withPrivateTargets(fn) {
	process.env.ALLOW_PRIVATE_TARGETS = '1';
	try {
		return await fn();
	} finally {
		delete process.env.ALLOW_PRIVATE_TARGETS;
	}
}

function listen(handler) {
	const server = http.createServer(handler);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve(server));
	});
}

function close(server) {
	return new Promise((resolve) => {
		server.close(resolve);
	});
}

let app;
let base;

before(async () => {
	app = createApp().listen(0, '127.0.0.1');
	await new Promise((resolve) => {
		app.once('listening', resolve);
	});
	base = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
	await close(app);
});

test('loopback, RFC1918, metadata and CGNAT addresses are all classified private', () => {
	for (const address of [
		'127.0.0.1',
		'10.0.0.5',
		'172.16.4.4',
		'192.168.1.1',
		'169.254.169.254', // cloud metadata — the classic SSRF target
		'100.64.0.1',
		'0.0.0.0',
		'255.255.255.255',
		'::1',
		'fe80::1',
		'fd00::1',
		'::ffff:192.168.0.1',
	]) {
		assert.equal(isPrivateAddress(address), true, `${address} must be blocked`);
	}

	for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
		assert.equal(isPrivateAddress(address), false, `${address} must stay reachable`);
	}

	// Unparseable input fails closed.
	assert.equal(isPrivateAddress('not-an-ip'), true);
	assert.equal(isPrivateHost('localhost'), true);
	assert.equal(isPrivateHost('example.com'), false);
});

test('an HTTP probe to loopback is refused before a socket opens', async () => {
	const result = await probe({ url: 'http://127.0.0.1:1/', timeoutMs: 2000 });
	assert.equal(result.ok, false);
	assert.match(result.error, /Blocked private network target/);
});

test('a TCP probe to loopback is refused before a socket opens', async () => {
	const result = await probe({ type: 'tcp', url: 'tcp://127.0.0.1:6379', timeoutMs: 2000 });
	assert.equal(result.ok, false);
	assert.match(result.error, /Blocked private network target/);
});

test('ALLOW_PRIVATE_TARGETS=1 restores LAN monitoring on demand', async () => {
	await withPrivateTargets(async () => {
		const server = await listen((req, res) => {
			res.writeHead(200, { 'content-type': 'text/plain' });
			res.end('healthy');
		});
		try {
			const result = await probe({ url: `http://127.0.0.1:${server.address().port}/`, timeoutMs: 3000 });
			assert.equal(result.ok, true, result.error || '');
			assert.equal(result.status, 200);
		} finally {
			await close(server);
		}
	});
});

test('a redirect to a non-http scheme settles instead of hanging the monitor forever', async () => {
	// `file:` used to throw synchronously inside the recursive call, leaving the
	// promise unsettled and the monitor's in-flight slot occupied for good.
	await withPrivateTargets(async () => {
		const server = await listen((req, res) => {
			res.writeHead(302, { Location: 'file:///etc/passwd' });
			res.end();
		});
		try {
			const result = await Promise.race([
				probe({ url: `http://127.0.0.1:${server.address().port}/`, timeoutMs: 2000 }),
				new Promise((resolve) => {
					const timer = setTimeout(
						() => resolve({ ok: false, status: null, error: 'probe never settled' }),
						4000,
					);
					timer.unref?.();
				}),
			]);
			assert.notEqual(result.error, 'probe never settled', 'the probe must always settle');
			// 302 is inside the default 200-399 acceptance window, so the probe
			// reports the status it actually saw rather than wedging.
			assert.equal(result.status, 302);
		} finally {
			await close(server);
		}
	});
});

test('the timeout spans the whole redirect chain, not each hop', async () => {
	// A redirect loop where every hop burns most of the budget: per-hop timeouts
	// multiplied to ~6x the configured value.
	await withPrivateTargets(async () => {
		const loop = await listen((req, res) => {
			setTimeout(() => {
				res.writeHead(302, { Location: '/' });
				res.end();
			}, 600);
		});
		try {
			const started = Date.now();
			const result = await probe({
				url: `http://127.0.0.1:${loop.address().port}/`,
				timeoutMs: 700,
			});
			const elapsed = Date.now() - started;
			assert.equal(result.ok, false, 'a looping redirect must not report success');
			assert.ok(elapsed < 2000, `deadline must cut the chain short, took ${elapsed}ms`);
		} finally {
			await close(loop);
		}
	});
});

test('/api/health reports persistence state so a failing disk is visible', async () => {
	const response = await fetch(`${base}/api/health`);
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.ok, true);
	assert.ok(body.persistence, 'persistence block is present');
	assert.equal(body.persistence.ok, true);
	assert.equal(body.persistence.lastError, null);
	assert.ok(body.persistence.file.endsWith('monitors.json'));
});

test('a negative incident limit clamps instead of slicing away the tail', () => {
	store.pushIncident({ monitorId: 'clamp-1', name: 'C', url: 'https://example.com', type: 'down' });
	assert.equal(store.incidents(-5).length, 1);
	assert.equal(store.incidents(0).length, 1);
	assert.equal(store.incidents(1).length, 1);
});

test('the CSV export neutralises spreadsheet formulas', async () => {
	const created = await fetch(`${base}/api/monitors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'CSV guard', url: 'https://example.com/csv' }),
	});
	assert.equal(created.status, 201);
	const monitor = await created.json();

	// addHistory is the path a restored/hand-edited file takes; csvCell has to
	// survive an `at` value a spreadsheet would execute.
	store.addHistory(monitor.id, { at: '=cmd|calc!A1', ok: true, status: 200, ms: 12 });

	const csv = await (await fetch(`${base}/api/monitors/${monitor.id}/checks.csv`)).text();
	assert.match(csv, /timestamp,ok,http_status,response_ms/);
	assert.match(csv, /'=cmd\|calc!A1/, 'formula leading char is neutralised');

	await fetch(`${base}/api/monitors/${monitor.id}`, { method: 'DELETE' });
});

test('a crafted backup cannot smuggle oversized fields past validation', () => {
	store.importState(
		{
			monitors: [
				{
					name: 'Smuggler',
					url: `https://example.com/${'a'.repeat(5000)}`,
					intervalSec: 1,
					timeoutMs: 999999,
					headers: {
						// Too long on its own → dropped outright.
						authorization: 'Bearer '.padEnd(5000, 'x'),
						// Valid but too many → only the first 10 survive.
						...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`h${i}`, `value-${i}`])),
					},
					body: 'b'.repeat(10000),
					expectedStatus: 'two-hundred',
					expectedKeyword: 'k'.repeat(500),
					warnMs: 999999,
					failuresBeforeDown: 99,
					tags: Array.from({ length: 40 }, (_, i) => `tag-${i}`),
					rollups: [
						{
							hour: Date.now(),
							n: 1,
							ok: 1,
							sum: 1,
							samples: Array.from({ length: 5000 }, () => 1),
						},
					],
					history: [
						{ at: 'not-a-date', ok: true },
						{ at: '2026-01-01T00:00:00.000Z', ok: true, ms: 5, status: 200 },
					],
				},
			],
		},
		'replace',
	);

	const monitor = store.list().find((m) => m.name === 'Smuggler');
	assert.ok(monitor, 'the monitor is imported');
	assert.ok(monitor.url.length <= 2048, 'url length is capped');
	assert.equal(monitor.intervalSec, 10, 'interval clamps to the API minimum');
	assert.equal(monitor.timeoutMs, 60000, 'timeout clamps to the API maximum');
	assert.equal(Object.keys(monitor.headers).length, 10, 'at most 10 headers survive');
	assert.ok(Object.values(monitor.headers).every((value) => value.length <= 2048));
	assert.ok(monitor.body.length <= 4096, 'body is capped');
	assert.equal(monitor.expectedStatus, undefined, 'malformed status spec is dropped');
	assert.ok(monitor.expectedKeyword.length <= 120, 'keyword is capped');
	assert.equal(monitor.warnMs, undefined, 'out-of-range warnMs is dropped');
	assert.equal(monitor.failuresBeforeDown, undefined, 'out-of-range threshold is dropped');
	assert.ok(monitor.tags.length <= 10, 'tag count is capped');
	assert.ok(monitor.rollups[0].samples.length <= 2400, 'rollup samples are capped');
	assert.equal(monitor.history.length, 1, 'unparseable history rows are dropped');
});
