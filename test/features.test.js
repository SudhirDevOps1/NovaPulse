// Features: tag filters, Prometheus metrics, RSS incident feed and the
// Settings → test-alert hook. Every route is additive; these tests pin the
// contracts docs/MONITORING.md and README promise.
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Keep tests away from real monitor data.
process.env.UPTIME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-features-'));

const { createApp } = require('../server');
const store = require('../lib/store');

let server;
let base;
const originalFetch = global.fetch;

before(async () => {
	server = createApp().listen(0);
	await new Promise((resolve) => {
		server.once('listening', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
	server.close();
	global.fetch = originalFetch;
});

async function createMonitor(name, url, tags) {
	const created = await fetch(`${base}/api/monitors`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name, url, tags }),
	});
	assert.equal(created.status, 201);
	return created.json();
}

test('?tag= filters the monitor list', async () => {
	const prod = await createMonitor('Prod API', 'https://example.com/prod-api', ['prod', 'core']);
	const staging = await createMonitor('Staging API', 'https://example.com/staging-api', ['staging']);

	const filtered = await (await fetch(`${base}/api/monitors?tag=prod`)).json();
	assert.deepEqual(
		filtered.map((m) => m.id).sort(),
		[prod.id].sort(),
	);

	const everything = await (await fetch(`${base}/api/monitors`)).json();
	assert.ok(everything.some((m) => m.id === staging.id));

	await fetch(`${base}/api/monitors/${prod.id}`, { method: 'DELETE' });
	await fetch(`${base}/api/monitors/${staging.id}`, { method: 'DELETE' });
});

test('?tag= filters the fleet analytics', async () => {
	await createMonitor('Tagged SLA', 'https://example.com/sla', ['gold']);
	const all = await (await fetch(`${base}/api/analytics`)).json();
	const tagged = await (await fetch(`${base}/api/analytics?tag=gold`)).json();
	assert.equal(tagged.checks, all.checks); // same single monitor either way
	assert.equal(typeof tagged.series, 'object');
	await fetch(`${base}/api/monitors/${(await (await fetch(`${base}/api/monitors`)).json())[0].id}`, { method: 'DELETE' });
});

test('GET /api/metrics exposes Prometheus exposition', async () => {
	await createMonitor('Metrics "test"', 'https://example.com/metrics', ['metric-tag']);

	const response = await fetch(`${base}/api/metrics`);
	assert.match(response.headers.get('content-type') || '', /text\/plain/);
	const text = await response.text();

	assert.match(text, /^# TYPE novapulse_monitors gauge$/m);
	assert.match(text, /\nnovapulse_monitors \d+\n/);
	// The quote in the monitor name must arrive escaped per the exposition spec.
	assert.match(text, /novapulse_monitor_up\{.*name="Metrics \\"test\\""\}/);
	assert.match(text, /novapulse_monitor_last_ms\{/);
	assert.match(text, /novapulse_uptime_24h_ratio/);
	// A scrape-side parser would choke on a raw newline inside a label.
	assert.ok(!/\n["\\]/.test(text));
	await fetch(`${base}/api/monitors/${(await (await fetch(`${base}/api/monitors`)).json())[0].id}`, { method: 'DELETE' });
});

test('GET /api/feed.xml serves escaped RSS incidents', async () => {
	store.pushIncident({
		monitorId: 'feed-test',
		name: 'A <b>&B</b> "deep"',
		type: 'down',
		reason: 'Connection refused',
		status: null,
	});

	const response = await fetch(`${base}/api/feed.xml`);
	assert.match(response.headers.get('content-type') || '', /application\/rss\+xml/);
	const xml = await response.text();

	assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
	assert.match(xml, /<rss version="2\.0">/);
	assert.match(xml, /<title>🔴 DOWN: A &lt;b&gt;&amp;B&lt;\/b&gt; &quot;deep&quot;<\/title>/);
	// Raw angle brackets from monitor data must never appear:
	assert.ok(!xml.includes('<b>'));
});

test('POST /api/settings/test reports configured channels', async () => {
	const calls = [];
	global.fetch = /** @type {any} */ (async (url, options) => {
		if (/telegram|discord|slack|ntfy|webhook/i.test(url)) {
			calls.push({ url, options });
			return { ok: true, status: 200 };
		}
		// Everything else reaches the test server normally.
		return originalFetch(url, options);
	});

	const savedTelegram = [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID];
	process.env.TELEGRAM_BOT_TOKEN = 'token';
	process.env.TELEGRAM_CHAT_ID = '42';
	try {
		const response = await fetch(`${base}/api/settings/test`, { method: 'POST' });
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.ok, true);
		assert.equal(body.channels.telegram, true);
		assert.equal(calls.length, 1);
		// Assert on the parsed URL, not a bare substring: /api\.telegram\.org/
		// can also match an impostor like https://evil.test/?x=api.telegram.org
		// (CodeQL js/regex/missing-regexp-anchor). Parse and compare the host.
		assert.equal(new URL(calls[0].url).host, 'api.telegram.org');
		assert.match(JSON.parse(calls[0].options.body).text, /test/i);
	} finally {
		[process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID] = savedTelegram;
		global.fetch = originalFetch;
	}
});
