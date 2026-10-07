#!/usr/bin/env node
/* GitHub Pages check runner — the "server" half of the serverless (Plan A) build.
 *
 *   config/monitors.json  → source of truth, edited by you (GitHub web/mobile works)
 *   gh-state/monitors.json→ history + incidents (written by this tool, committed by CI)
 *   gh-state/state.json   → dashboard snapshot served as ./data/state.json on Pages
 *
 * Reuses lib/store.js and lib/checker.js (probe, incidents, Telegram alerts), so the
 * GitHub build behaves exactly like the self-hosted app. Runs on bare Node — no deps.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GH_STATE_DIR = path.join(ROOT, 'gh-state');
const CONFIG_FILE = path.join(ROOT, 'config', 'monitors.json');
const STATE_FILE = path.join(GH_STATE_DIR, 'state.json');

// store.js resolves the data directory at require time — set it first.
fs.mkdirSync(GH_STATE_DIR, { recursive: true });
process.env.UPTIME_DATA_DIR = GH_STATE_DIR;

const store = require('../lib/store');
const { checkNow } = require('../lib/checker');
const { parseTcpTarget } = require('../lib/probe');
const { channelStatus } = require('../lib/notify');
const logger = require('../lib/logger');
const pkg = require('../package.json');

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

function fail(message) {
	console.error(`\n✖ ${message}\n`);
	process.exit(1);
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function slugify(value) {
	return (
		String(value)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'monitor'
	);
}

function loadConfig() {
	if (!fs.existsSync(CONFIG_FILE)) {
		fail('Missing config/monitors.json — it defines which monitors to check.');
	}
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
	} catch (error) {
		fail(`config/monitors.json is not valid JSON: ${error.message}`);
	}
	const list = Array.isArray(parsed)
		? parsed
		: Array.isArray(parsed?.monitors)
			? parsed.monitors
			: null;
	if (!list) {
		fail('config/monitors.json must be an array, or { "monitors": [...] }.');
	}
	const statusPage =
		!Array.isArray(parsed) && parsed?.statusPage && typeof parsed.statusPage === 'object'
			? parsed.statusPage
			: null;
	return { list, statusPage };
}

function normalize(raw, index) {
	const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
	const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
	const problems = [];
	const type = raw?.type === 'tcp' || /^tcp:\/\//i.test(url) ? 'tcp' : 'http';
	if (!name) problems.push('"name" is required');
	if (type === 'tcp') {
		if (!parseTcpTarget(url)) problems.push('"url" must look like tcp://host:port');
	} else if (!/^https?:\/\/\S+$/i.test(url)) {
		problems.push('"url" must be a full http(s) or tcp:// address');
	}
	if (problems.length) {
		logger.warn('Skipping invalid monitor', { index: index + 1, problems });
		return null;
	}
	const method = String(raw.method || 'GET').toUpperCase();
	const entry = {
		id: typeof raw.id === 'string' && raw.id.trim() ? slugify(raw.id) : null,
		name,
		url,
		type,
		method: METHODS.has(method) ? method : 'GET',
		intervalSec: Math.round(clamp(Number(raw.intervalSec) || 300, 10, 86400)),
		timeoutMs: Math.round(clamp(Number(raw.timeoutMs) || 10000, 1000, 60000)),
		enabled: raw.enabled !== false,
	};

	// Optional probe assertions — same rules as the server-side validator.
	if (typeof raw.expectedStatus === 'string' && raw.expectedStatus.trim()) {
		entry.expectedStatus = raw.expectedStatus.trim().slice(0, 64);
	}
	if (typeof raw.expectedKeyword === 'string' && raw.expectedKeyword.trim()) {
		entry.expectedKeyword = raw.expectedKeyword.trim().slice(0, 120);
	}
	const warnMs = Number(raw.warnMs);
	if (Number.isFinite(warnMs) && warnMs > 0) entry.warnMs = Math.round(clamp(warnMs, 100, 60000));
	const failures = Number(raw.failuresBeforeDown);
	if (Number.isInteger(failures) && failures > 1) entry.failuresBeforeDown = clamp(failures, 2, 10);
	if (raw.checkSsl === false) entry.checkSsl = false;
	if (typeof raw.body === 'string' && raw.body && entry.method !== 'GET' && entry.method !== 'HEAD') {
		entry.body = raw.body.slice(0, 4096);
	}
	if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
		const headers = {};
		let count = 0;
		for (const [key, value] of Object.entries(raw.headers)) {
			if (count >= 10) break;
			if (typeof value !== 'string') continue;
			if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(key)) continue;
			headers[key] = value.slice(0, 2048);
			count += 1;
		}
		if (count) entry.headers = headers;
	}
	if (Array.isArray(raw.tags)) {
		const tags = raw.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim().slice(0, 24));
		if (tags.length) entry.tags = [...new Set(tags)].slice(0, 10);
	}
	return entry;
}

/** Reconcile stored monitors with the config: create, update, rename, remove. */
function sync(entries) {
	const kept = new Set();
	const usedIds = new Set();

	for (const entry of entries) {
		const base = entry.id || slugify(entry.name);
		let targetId = base;
		let suffix = 2;
		while (usedIds.has(targetId)) targetId = `${base}-${suffix++}`;

		// Match by id first (survives renames), then by URL (survives id changes).
		let monitor = kept.has(targetId) ? null : store.get(targetId);
		if (!monitor) {
			monitor = store.list().find((m) => !kept.has(m.id) && m.url === entry.url) || null;
		}

		if (!monitor) {
			monitor = store.create(entry);
			logger.info('Monitor added', { name: entry.name, url: entry.url });
		}

		// Adopt the stable, human-friendly id when it is still free.
		if (monitor.id !== targetId && !store.get(targetId)) {
			store.update(monitor.id, { id: targetId });
		}
		const id = store.get(targetId) ? targetId : monitor.id;

		const patch = {
			name: entry.name,
			url: entry.url,
			type: entry.type,
			method: entry.method,
			intervalSec: entry.intervalSec,
			timeoutMs: entry.timeoutMs,
			enabled: entry.enabled,
			tags: entry.tags || [],
		};
		for (const field of [
			'expectedStatus',
			'expectedKeyword',
			'warnMs',
			'failuresBeforeDown',
			'checkSsl',
			'body',
			'headers',
		]) {
			patch[field] = entry[field] !== undefined ? entry[field] : undefined;
		}
		store.update(id, patch);
		kept.add(id);
		usedIds.add(id);
	}

	for (const monitor of [...store.list()]) {
		if (!kept.has(monitor.id)) {
			logger.info('Monitor removed (absent from config)', { name: monitor.name });
			store.remove(monitor.id);
		}
	}
}

async function runPool(queue, limit, worker) {
	const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
		let item = queue.shift();
		while (item) {
			await worker(item);
			item = queue.shift();
		}
	});
	await Promise.all(workers);
}

/** intervalSec is a minimum gap; the real cadence follows the Actions cron (5 min). */
async function runChecks(now) {
	const due = store.list().filter((monitor) => {
		if (!monitor.enabled) return false;
		const last = monitor.lastCheck ? Date.parse(monitor.lastCheck.at) : 0;
		return !Number.isFinite(last) || now - last >= Math.max(10, monitor.intervalSec) * 1000;
	});

	if (!due.length) {
		logger.info('No monitors are due yet');
		return { checked: 0, down: 0 };
	}

	logger.info(`Checking ${due.length} monitor(s)`);
	let down = 0;
	await runPool([...due], 5, async (monitor) => {
		const updated = await checkNow(monitor);
		if (updated.status === 'down') down += 1;
	});
	return { checked: due.length, down };
}

function writeSnapshot() {
	const now = Date.now();
	const order = { down: 0, unknown: 1, up: 2 };
	// Rollups are excluded here — gh-build.js writes them to data/analytics/*.json.
	const monitors = store
		.list()
		.map((monitor) => {
			const copy = { ...monitor, uptime24h: store.uptime24h(monitor, now) };
			delete copy.rollups;
			return copy;
		})
		.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name));

	const iso = new Date().toISOString();
	const snapshot = {
		generatedAt: iso,
		health: {
			ok: true,
			mode: 'static',
			version: pkg.version,
			node: process.version,
			env: 'github-pages',
			uptimeSec: Math.round(process.uptime()),
			monitors: monitors.length,
			telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
			alerts: channelStatus(),
			storage: 'GitHub repository · gh-state/state.json',
			now: iso,
		},
		stats: store.stats(now),
		monitors,
		incidents: store.incidents(200),
		settings: store.getSettings(),
	};
	fs.writeFileSync(STATE_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
	return snapshot;
}

async function main() {
	const startedAt = Date.now();
	const { list, statusPage } = loadConfig();
	const entries = list.map(normalize).filter(Boolean);
	if (!entries.length) {
		logger.warn('config/monitors.json has no valid monitors yet');
	}

	sync(entries);
	if (statusPage) store.updateSettings({ statusPage });
	const { checked, down } = await runChecks(Date.now());
	store.save(true); // flush history/incidents to gh-state/monitors.json
	const snapshot = writeSnapshot();

	logger.info('Snapshot written', {
		file: path.relative(ROOT, STATE_FILE),
		monitors: snapshot.monitors.length,
		checked,
		down,
		telegram: snapshot.health.telegram,
		ms: Date.now() - startedAt,
	});
}

main().catch((error) => {
	logger.error('gh-check failed', { error: error.stack || error.message });
	process.exit(1);
});
