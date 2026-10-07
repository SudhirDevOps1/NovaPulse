const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The fixture has to be on disk before lib/store loads: it reads at require
// time (store.js → load()).
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-normalise-'));
process.env.UPTIME_DATA_DIR = DATA_DIR;
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
fs.writeFileSync(
	path.join(DATA_DIR, 'monitors.json'),
	// A hand-edited monitor: id, name, url — nothing else (TODO NOW-1).
	JSON.stringify({ monitors: [{ id: 'hand-1', name: 'Hand edited', url: 'https://example.com' }] }),
);

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = require('../lib/store');

test('a monitor missing every optional field is normalised on load', () => {
	const monitor = store.list()[0];
	assert.ok(monitor, 'the hand-edited monitor survives the load');
	assert.equal(monitor.name, 'Hand edited');
	assert.equal(monitor.url, 'https://example.com');
	assert.deepEqual(monitor.history, []);
	assert.deepEqual(monitor.rollups, []);
	assert.deepEqual(monitor.tags, []);
	assert.equal(monitor.status, 'unknown');
	assert.equal(monitor.enabled, true);
	assert.equal(monitor.consecutiveFailures, 0);
	assert.equal(monitor.wasDown, false);
	assert.equal(monitor.intervalSec, 60);
	assert.equal(monitor.timeoutMs, 10000);
	assert.equal(monitor.method, 'GET');
	assert.equal(monitor.type, 'http');
	assert.equal(typeof monitor.createdAt, 'string');
});

test('the normalised monitor takes history and answers the list API', async () => {
	// This threw `Cannot read properties of undefined (reading 'push')` before.
	assert.doesNotThrow(() =>
		store.addHistory('hand-1', { at: new Date().toISOString(), ms: 12, ok: true, status: 200 }),
	);

	const { createApp } = require('../server');
	const server = createApp().listen(0);
	await new Promise((resolve) => {
		server.once('listening', resolve);
	});
	try {
		const base = `http://127.0.0.1:${server.address().port}`;
		const response = await fetch(`${base}/api/monitors`);
		assert.equal(response.status, 200, 'GET /api/monitors must not 500');
		const list = await response.json();
		assert.equal(list.length, 1);
		assert.equal(list[0].id, 'hand-1');
	} finally {
		server.close();
	}
});
