const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

// Set isolated test environment with ADMIN_PASSWORD enabled
process.env.UPTIME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-auth-test-'));
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'ClusterMasterSecret2026!';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-bytes-long!';

const { createApp } = require('../server');
const auth = require('../lib/auth');

let server;
let base;

before(async () => {
	server = createApp().listen(0);
	await new Promise((resolve) => {
		server.once('listening', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
	server.close();
	try {
		fs.rmSync(process.env.UPTIME_DATA_DIR, { recursive: true, force: true });
	} catch {
		// ignore cleanup
	}
});

test('lib/auth helpers verify credentials and tokens accurately', () => {
	assert.equal(auth.isAuthRequired(), true);
	assert.equal(auth.verifyCredentials('admin', 'ClusterMasterSecret2026!'), true);
	assert.equal(auth.verifyCredentials('ADMIN', 'ClusterMasterSecret2026!'), true);
	assert.equal(auth.verifyCredentials('wrong', 'ClusterMasterSecret2026!'), false);
	assert.equal(auth.verifyCredentials('admin', 'wrongpass'), false);
	assert.equal(auth.verifyCredentials('', ''), false);

	const token = auth.createSessionToken('admin');
	assert.equal(typeof token, 'string');
	const decoded = auth.verifySessionToken(token);
	assert.equal(decoded.user, 'admin');
	assert.ok(decoded.exp > Date.now());

	// Corrupted token returns null
	assert.equal(auth.verifySessionToken('bad.token'), null);
	assert.equal(auth.verifySessionToken(''), null);
	assert.equal(auth.verifySessionToken(token.slice(0, -5) + 'xxxxx'), null);
});

test('public endpoints are accessible without credentials even when auth is active', async () => {
	// 1. Health
	const healthRes = await fetch(`${base}/api/health`);
	assert.equal(healthRes.status, 200);

	// 2. SVG Badge
	const badgeRes = await fetch(`${base}/api/badge/fleet.svg`);
	assert.equal(badgeRes.status, 200);

	// 3. RSS Feed
	const feedRes = await fetch(`${base}/api/feed.xml`);
	assert.equal(feedRes.status, 200);

	// 4. Ping/Push heartbeat endpoint (returns 404 for unknown monitor, NOT 401)
	const pingRes = await fetch(`${base}/api/ping/nonexistent-id`);
	assert.equal(pingRes.status, 404);

	// 5. Auth status endpoint
	const meRes = await fetch(`${base}/api/auth/me`);
	assert.equal(meRes.status, 200);
	const meData = await meRes.json();
	assert.equal(meData.authRequired, true);
	assert.equal(meData.authenticated, false);
});

test('protected management endpoints reject unauthenticated requests with HTTP 401', async () => {
	const endpoints = [
		{ path: '/api/monitors', method: 'GET' },
		{ path: '/api/monitors', method: 'POST', body: { name: 'Test', url: 'https://example.com' } },
		{ path: '/api/stats', method: 'GET' },
		{ path: '/api/analytics', method: 'GET' },
		{ path: '/api/incidents', method: 'GET' },
		{ path: '/api/settings', method: 'GET' },
		{ path: '/api/export', method: 'GET' },
		{ path: '/api/metrics', method: 'GET' },
	];

	for (const ep of endpoints) {
		const res = await fetch(`${base}${ep.path}`, {
			method: ep.method,
			headers: ep.body ? { 'content-type': 'application/json' } : undefined,
			body: ep.body ? JSON.stringify(ep.body) : undefined,
		});
		assert.equal(res.status, 401, `Expected 401 for ${ep.method} ${ep.path}, got ${res.status}`);
		const json = await res.json();
		assert.match(json.error, /Authentication required/i);
	}
});

test('login rejects invalid credentials and accepts valid ones', async () => {
	// Wrong password
	const failRes = await fetch(`${base}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: 'admin', password: 'incorrect-password' }),
	});
	assert.equal(failRes.status, 401);
	const failData = await failRes.json();
	assert.match(failData.error, /invalid username or password/i);

	// Correct password
	const okRes = await fetch(`${base}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: 'admin', password: 'ClusterMasterSecret2026!' }),
	});
	assert.equal(okRes.status, 200);
	const okData = await okRes.json();
	assert.equal(okData.ok, true);
	assert.equal(okData.user, 'admin');
	assert.ok(typeof okData.token === 'string' && okData.token.length > 20);

	const setCookie = okRes.headers.get('set-cookie');
	assert.ok(setCookie && setCookie.includes('np_session='));
});

test('authenticated session via Bearer token allows access to protected routes', async () => {
	const token = auth.createSessionToken('admin');

	const res = await fetch(`${base}/api/monitors`, {
		headers: {
			authorization: `Bearer ${token}`,
		},
	});
	assert.equal(res.status, 200);
	const list = await res.json();
	assert.ok(Array.isArray(list));
});

test('authenticated session via Cookie allows access to protected routes', async () => {
	const token = auth.createSessionToken('admin');

	const res = await fetch(`${base}/api/monitors`, {
		headers: {
			cookie: `np_session=${encodeURIComponent(token)}; other_cookie=123`,
		},
	});
	assert.equal(res.status, 200);
	const list = await res.json();
	assert.ok(Array.isArray(list));
});

test('logout endpoint clears cookie', async () => {
	const res = await fetch(`${base}/api/auth/logout`, {
		method: 'POST',
	});
	assert.equal(res.status, 200);
	const setCookie = res.headers.get('set-cookie');
	assert.ok(setCookie && setCookie.includes('Max-Age=0'));
});
