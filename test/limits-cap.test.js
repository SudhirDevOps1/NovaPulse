// limits.js: the bucket map must stay bounded. With TRUST_PROXY opened beyond
// loopback, `X-Forwarded-For` is caller-controlled, and an attacker rotating it
// used to mint a fresh Map entry per request — unbounded memory growth.
process.env.LOG_LEVEL = 'silent';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { rateLimit } = require('../lib/limits');

function fakeReq(ip) {
	return { ip };
}

function fakeRes() {
	return {
		statusCode: 0,
		headers: {},
		setHeader(key, value) {
			this.headers[key] = value;
		},
		status(code) {
			this.statusCode = code;
			return { json() {} };
		},
	};
}

/** Run one limiter turn; returns the status a real router would produce. */
function run(limiter, ip) {
	const res = fakeRes();
	let forwarded = false;
	limiter(fakeReq(ip), res, () => {
		forwarded = true;
	});
	if (forwarded) return 200;
	return res.statusCode;
}

test('same IP shares one bucket and trips 429 past max', () => {
	const limiter = rateLimit({ windowMs: 60_000, max: 2, maxBuckets: 10 });
	assert.equal(run(limiter, 'a'), 200);
	assert.equal(run(limiter, 'a'), 200);
	assert.equal(run(limiter, 'a'), 429);
	assert.equal(limiter.size(), 1);
});

test('distinct IPs with distinct buckets all pass while under the cap', () => {
	const limiter = rateLimit({ windowMs: 60_000, max: 5, maxBuckets: 10 });
	for (let i = 1; i <= 5; i += 1) {
		assert.equal(run(limiter, `ip-${i}`), 200);
	}
	assert.equal(limiter.size(), 5);
});

test('the bucket map is hard-capped at maxBuckets', () => {
	const limiter = rateLimit({ windowMs: 60_000, max: 100, maxBuckets: 3 });
	for (let i = 1; i <= 25; i += 1) {
		assert.equal(run(limiter, `spoofer-${i}`), 200);
	}
	assert.ok(limiter.size() <= 3);
});

test('a garbage/negative maxBuckets value cannot hang the limiter', () => {
	const limiter = rateLimit({ windowMs: 60_000, max: 100, maxBuckets: -5 });
	for (let i = 1; i <= 30; i += 1) {
		const res = fakeRes();
		try {
			limiter(fakeReq(`ip-${i}`), res, () => {});
		} catch {
			// makeRoom on an empty map is a no-op; the loop must still terminate
			break;
		}
	}
	assert.ok(limiter.size() >= 1);
});

test('RATE_LIMIT=off bypasses the limiter entirely', () => {
	process.env.RATE_LIMIT = 'off';
	try {
		const limiter = rateLimit({ windowMs: 60_000, max: 0, maxBuckets: 1 });
		assert.equal(run(limiter, 'a'), 200);
		assert.equal(run(limiter, 'a'), 200);
	} finally {
		delete process.env.RATE_LIMIT;
	}
});
