const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Boot against an unreadable data file: what used to happen is that the first
// debounced flush renamed the corrupt bytes away and the only copy was lost
// (TODO NOW-2).
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-quarantine-'));
const FILE = path.join(DATA_DIR, 'monitors.json');
const CORRUPT = '{"monitors": [{"id": "lost-1", "name": "truncated",';
process.env.UPTIME_DATA_DIR = DATA_DIR;
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
fs.writeFileSync(FILE, CORRUPT);

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Capture the boot warning: lib/logger is already resolved by the time
// store loads, so patching the shared object is what makes this observable.
const logger = require('../lib/logger');
const warnings = [];
logger.warn = (message, meta) => warnings.push({ message, meta });

const store = require('../lib/store'); // load() runs here

const quarantined = () =>
	fs.readdirSync(DATA_DIR).filter((file) => file.startsWith('monitors.json.corrupt-'));

test('a corrupt data file is quarantined instead of being overwritten', () => {
	const copies = quarantined();
	assert.equal(copies.length, 1, 'exactly one quarantine copy is written');
	assert.equal(fs.readFileSync(path.join(DATA_DIR, copies[0]), 'utf8'), CORRUPT, 'bytes preserved');
	assert.deepEqual(store.list(), [], 'the app boots empty');
	assert.equal(fs.readFileSync(FILE, 'utf8'), CORRUPT, 'load() itself never writes');
});

test('the boot warning names the quarantine path', () => {
	const warning = warnings.find((entry) => /quarantin/i.test(entry.message));
	assert.ok(warning, 'a quarantine warning was logged');
	assert.match(String(warning.meta.quarantine), /monitors\.json\.corrupt-/);
	assert.ok(warning.meta.error, 'the parse error is reported alongside it');
});

test('monitors.json is replaced only by an explicit save', () => {
	store.create({ name: 'Fresh', url: 'https://example.com' });
	store.save(true);

	const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
	assert.equal(saved.monitors.length, 1);
	assert.equal(saved.monitors[0].name, 'Fresh');

	const copies = quarantined();
	assert.equal(copies.length, 1, 'the quarantine copy is kept');
	assert.equal(fs.readFileSync(path.join(DATA_DIR, copies[0]), 'utf8'), CORRUPT);
});
