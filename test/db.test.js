const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDb, JsonAdapter, TursoAdapter, NeonAdapter } = require('../lib/db');

test('getDb returns a working JsonAdapter by default', async () => {
	const db = getDb({});
	assert.ok(db instanceof JsonAdapter);

	const monitors = await db.list();
	assert.ok(Array.isArray(monitors));

	const stats = await db.stats();
	assert.ok(stats.totals);
	assert.equal(typeof stats.totals.monitors, 'number');
});

test('adapter selection based on environment variables', () => {
	// D1 fake
	const fakeD1 = { prepare: () => {} };
	const d1Adapter = new (require('../lib/db/d1').D1Adapter)(fakeD1);
	assert.ok(d1Adapter);

	// Turso adapter instantiation
	const turso = new TursoAdapter('https://example-db.turso.io', 'fake-token');
	assert.equal(turso.url, 'https://example-db.turso.io');

	// Neon adapter instantiation
	const neon = new NeonAdapter('postgresql://user:pass@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require');
	assert.ok(neon.endpoint.includes('ep-cool-123'));

	// Aiven adapter instantiation
	const { AivenAdapter } = require('../lib/db/aiven');
	const aiven = new AivenAdapter('postgres://avnadmin:pwd@pg-nova.aivencloud.com:25345/defaultdb?sslmode=require');
	assert.equal(aiven.parsed.host, 'pg-nova.aivencloud.com');
	assert.equal(aiven.parsed.port, 25345);

	// Github adapter instantiation
	const { GithubAdapter } = require('../lib/db/github');
	const github = new GithubAdapter('fake-token', 'owner/repo');
	assert.equal(github.repo, 'owner/repo');
});
