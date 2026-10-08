const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleDowntimeIssue, handleRecoveryIssue } = require('../lib/github-issues');

test('github issues handler is fail-safe when token is absent', async () => {
	const monitor = { id: 'm-1', name: 'Test Target', url: 'https://example.com' };
	const failure = { status: 500, error: 'Internal Server Error', ms: 120 };

	// Must not throw or crash when credentials are empty
	const resDown = await handleDowntimeIssue(monitor, failure, {});
	assert.equal(resDown, null);

	const resUp = await handleRecoveryIssue(monitor, { ms: 45 }, {});
	assert.equal(resUp, null);
});
