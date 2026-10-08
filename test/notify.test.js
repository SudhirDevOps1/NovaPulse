// notify.js: Slack must behave exactly like the docs claim (README, GETTING_STARTED
// and monitor.yml all promise SLACK_WEBHOOK_URL alerts), and a failing channel
// must never starve the others.
process.env.LOG_LEVEL = 'silent';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { notify, channelStatus } = require('../lib/notify');

const CHANNEL_ENV = [
	'TELEGRAM_BOT_TOKEN',
	'TELEGRAM_CHAT_ID',
	'DISCORD_WEBHOOK_URL',
	'SLACK_WEBHOOK_URL',
	'NTFY_URL',
	'NTFY_TOKEN',
	'WEBHOOK_URL',
	'WEBHOOK_SECRET',
];

const originalFetch = global.fetch;
const savedEnv = Object.fromEntries(CHANNEL_ENV.map((key) => [key, process.env[key]]));

function clearChannels() {
	for (const key of CHANNEL_ENV) delete process.env[key];
}

afterEach(() => {
	clearChannels();
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	global.fetch = originalFetch;
});

test('channelStatus reports slack off until SLACK_WEBHOOK_URL is set', () => {
	clearChannels();
	assert.equal(channelStatus().slack, false);
	process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/X';
	assert.equal(channelStatus().slack, true);
});

test('notify posts a BlockKit payload to the Slack webhook', async () => {
	clearChannels();
	const calls = [];
	global.fetch = /** @type {any} */ (async (url, options) => {
		calls.push({ url, options });
		return { ok: true, status: 200 };
	});
	process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/X';

	await notify('🔴 DOWN: My site', {
		event: 'down',
		monitor: { name: 'My site', url: 'https://example.com' },
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://hooks.slack.com/services/T/B/X');
	assert.equal(calls[0].options.headers['content-type'], 'application/json');
	const payload = JSON.parse(calls[0].options.body);
	assert.match(payload.text, /DOWN/);
	assert.equal(payload.blocks[0].type, 'section');
	assert.equal(payload.blocks[0].text.type, 'mrkdwn');
	assert.match(payload.blocks[1].elements[0].text, /example\.com/);
});

test('a failing channel never blocks the configured ones', async () => {
	clearChannels();
	const delivered = [];
	global.fetch = /** @type {any} */ (async (url) => {
		if (url.includes('telegram')) throw new Error('telegram is down');
		delivered.push(url);
		return { ok: true, status: 200 };
	});
	process.env.TELEGRAM_BOT_TOKEN = 'token';
	process.env.TELEGRAM_CHAT_ID = '42';
	process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/X';

	await notify('🟢 UP: My site', { event: 'up' });

	assert.deepEqual(delivered, ['https://hooks.slack.com/services/T/B/X']);
});
