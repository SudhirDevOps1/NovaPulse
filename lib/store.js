const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const logger = require('./logger');

const DATA_DIR = process.env.UPTIME_DATA_DIR
	? path.resolve(process.env.UPTIME_DATA_DIR)
	: path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'monitors.json');

const HISTORY_LIMIT = 500;
const INCIDENT_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ROLLUP_LIMIT = 720; // hourly buckets → 30 days of analytics

const DEFAULT_SETTINGS = {
	statusPage: { enabled: false, title: 'Service status', message: '' },
};

function defaultSettings() {
	return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function floorHour(ms) {
	return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function percentileOf(sorted, p) {
	if (!sorted.length) return null;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index];
}

function recomputePercentiles(bucket) {
	if (!bucket.samples || !bucket.samples.length) return;
	const sorted = [...bucket.samples].sort((a, b) => a - b);
	bucket.p50 = percentileOf(sorted, 50);
	bucket.p95 = percentileOf(sorted, 95);
	bucket.p99 = percentileOf(sorted, 99);
}

function closeRollup(bucket) {
	if (bucket.samples) {
		recomputePercentiles(bucket);
		delete bucket.samples;
	}
}

/** Hourly rollup: {hour, n, ok, sum, min, max, p50, p95, p99[, samples for the open hour]} */
function addRollup(monitor, entry) {
	if (!Array.isArray(monitor.rollups)) monitor.rollups = [];
	const key = floorHour(Date.parse(entry.at));
	let bucket = null;
	for (let i = monitor.rollups.length - 1; i >= 0 && i >= monitor.rollups.length - 5; i -= 1) {
		if (monitor.rollups[i].hour === key) {
			bucket = monitor.rollups[i];
			break;
		}
	}
	if (!bucket) {
		const last = monitor.rollups[monitor.rollups.length - 1];
		if (last) closeRollup(last);
		bucket = { hour: key, n: 0, ok: 0, sum: 0, min: null, max: null, samples: [] };
		monitor.rollups.push(bucket);
	}

	bucket.n += 1;
	if (entry.ok) bucket.ok += 1;
	if (Number.isFinite(entry.ms)) {
		bucket.sum += entry.ms;
		bucket.min = bucket.min === null ? entry.ms : Math.min(bucket.min, entry.ms);
		bucket.max = bucket.max === null ? entry.ms : Math.max(bucket.max, entry.ms);
		if (bucket.samples) {
			bucket.samples.push(entry.ms);
			if (bucket.samples.length > 2400) bucket.samples.shift();
		}
	}
	recomputePercentiles(bucket);

	const cutoff = floorHour(Date.now() - ROLLUP_LIMIT * HOUR_MS);
	while (monitor.rollups.length > 0 && monitor.rollups[0].hour < cutoff) monitor.rollups.shift();
}

let state = { monitors: [], incidents: [], settings: defaultSettings() };
let saveTimer = null;

function load() {
	try {
		const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
		state = {
			monitors: Array.isArray(parsed.monitors) ? parsed.monitors : [],
			incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
			settings: {
				...defaultSettings(),
				...(parsed.settings || {}),
				statusPage: {
					...DEFAULT_SETTINGS.statusPage,
					...((parsed.settings && parsed.settings.statusPage) || {}),
				},
			},
		};
		logger.debug(`Loaded ${state.monitors.length} monitor(s) from ${FILE}`);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			logger.warn('Could not read data file, starting empty', { error: error.message });
		}
		state = { monitors: [], incidents: [], settings: defaultSettings() };
	}
	return state;
}

function flush() {
	clearTimeout(saveTimer);
	saveTimer = null;
	try {
		fs.mkdirSync(DATA_DIR, { recursive: true });
		const tmp = `${FILE}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(state));
		fs.renameSync(tmp, FILE);
	} catch (error) {
		logger.error('Failed to persist data', { error: error.message });
	}
}

/** Coalesce bursts of writes into one disk flush. */
function save(immediate = false) {
	if (immediate) return flush();
	if (saveTimer) return;
	saveTimer = setTimeout(flush, 250);
	saveTimer.unref?.();
}

function list() {
	return state.monitors;
}

function get(id) {
	return state.monitors.find((m) => m.id === id);
}

function create(fields = {}) {
	const monitor = {
		id: crypto.randomUUID(),
		name: fields.name,
		url: fields.url,
		method: fields.method || 'GET',
		type: fields.type === 'tcp' ? 'tcp' : 'http',
		intervalSec: fields.intervalSec > 0 ? fields.intervalSec : 60,
		timeoutMs: fields.timeoutMs > 0 ? fields.timeoutMs : 10000,
		enabled: true,
		status: 'unknown',
		consecutiveFailures: 0,
		wasDown: false,
		tags: Array.isArray(fields.tags) ? fields.tags : [],
		rollups: [],
		lastCheck: null,
		createdAt: new Date().toISOString(),
		history: [],
	};
	for (const key of ['headers', 'body', 'expectedStatus', 'expectedKeyword', 'warnMs', 'failuresBeforeDown', 'checkSsl']) {
		if (fields[key] !== undefined) monitor[key] = fields[key];
	}
	state.monitors.push(monitor);
	save();
	return monitor;
}

function update(id, patch) {
	const monitor = get(id);
	if (!monitor) return null;
	Object.assign(monitor, patch);
	save();
	return monitor;
}

function remove(id) {
	const index = state.monitors.findIndex((m) => m.id === id);
	if (index === -1) return false;
	state.monitors.splice(index, 1);
	save(true);
	return true;
}

function addHistory(id, entry) {
	const monitor = get(id);
	if (!monitor) return;
	monitor.history.push(entry);
	if (monitor.history.length > HISTORY_LIMIT) {
		monitor.history.splice(0, monitor.history.length - HISTORY_LIMIT);
	}
	addRollup(monitor, entry);
	save();
}

function pushIncident(incident) {
	state.incidents.unshift({
		id: crypto.randomUUID(),
		at: new Date().toISOString(),
		...incident,
	});
	if (state.incidents.length > INCIDENT_LIMIT) {
		state.incidents.length = INCIDENT_LIMIT;
	}
	save();
}

function incidents(limit = 50, filter = {}) {
	let items = state.incidents;
	if (filter.monitorId) items = items.filter((i) => i.monitorId === filter.monitorId);
	if (filter.type) items = items.filter((i) => i.type === filter.type);
	return items.slice(0, limit);
}

function uptime24h(monitor, now = Date.now()) {
	const cutoff = now - DAY_MS;
	const recent = monitor.history.filter((h) => Date.parse(h.at) >= cutoff);
	if (recent.length === 0) return null;
	const up = recent.filter((h) => h.ok).length;
	return Math.round((up / recent.length) * 1000) / 10;
}

function stats(now = Date.now()) {
	const monitors = state.monitors;
	const checks = monitors.flatMap((m) => m.history.filter((h) => Date.parse(h.at) >= now - DAY_MS));
	const responded = checks.filter((c) => Number.isFinite(c.ms));

	const up = monitors.filter((m) => m.status === 'up' || m.status === 'degraded').length;
	const down = monitors.filter((m) => m.status === 'down').length;
	const degraded = monitors.filter((m) => m.status === 'degraded').length;
	const paused = monitors.filter((m) => !m.enabled).length;

	return {
		totals: {
			monitors: monitors.length,
			up,
			down,
			degraded,
			unknown: monitors.length - up - down,
			paused,
		},
		checks24h: checks.length,
		uptime24h:
			checks.length === 0
				? null
				: Math.round((checks.filter((c) => c.ok).length / checks.length) * 1000) / 10,
		avgResponse24h:
			responded.length === 0
				? null
				: Math.round(responded.reduce((sum, c) => sum + c.ms, 0) / responded.length),
		incidents24h: state.incidents.filter((i) => Date.parse(i.at) >= now - DAY_MS).length,
		lastIncident: state.incidents[0] || null,
	};
}

function getSettings() {
	return state.settings;
}

function updateSettings(patch = {}) {
	const next = state.settings;
	if (patch.statusPage && typeof patch.statusPage === 'object') {
		next.statusPage = { ...next.statusPage, ...pickStatusPage(patch.statusPage) };
	}
	save();
	return next;
}

function pickStatusPage(input) {
	const allowed = {};
	if (typeof input.title === 'string') allowed.title = input.title.slice(0, 80);
	if (typeof input.message === 'string') allowed.message = input.message.slice(0, 300);
	if (typeof input.enabled === 'boolean') allowed.enabled = input.enabled;
	return allowed;
}

function exportState() {
	return {
		version: 2,
		exportedAt: new Date().toISOString(),
		monitors: state.monitors,
		incidents: state.incidents,
		settings: state.settings,
	};
}

const OPTIONAL_FIELDS = [
	'type',
	'headers',
	'body',
	'expectedStatus',
	'expectedKeyword',
	'warnMs',
	'failuresBeforeDown',
	'checkSsl',
	'tags',
	'rollups',
	'ssl',
	'sslWarnedAt',
	'wasDown',
];

function importState(payload, mode = 'merge') {
	if (!payload || !Array.isArray(payload.monitors)) {
		throw new Error('Invalid backup: monitors[] missing');
	}

	const clean = payload.monitors
		.filter((m) => m && typeof m.url === 'string' && typeof m.name === 'string')
		.map((m) => {
			const monitor = {
				id: typeof m.id === 'string' ? m.id : crypto.randomUUID(),
				name: String(m.name).slice(0, 60),
				url: String(m.url),
				method: m.method === 'POST' ? 'POST' : 'GET',
				intervalSec: Number(m.intervalSec) > 0 ? Number(m.intervalSec) : 60,
				timeoutMs: Number(m.timeoutMs) > 0 ? Number(m.timeoutMs) : 10000,
				enabled: m.enabled !== false,
				status: 'unknown',
				consecutiveFailures: 0,
				wasDown: false,
				tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
				rollups: Array.isArray(m.rollups) ? m.rollups.slice(-ROLLUP_LIMIT) : [],
				lastCheck: null,
				createdAt: m.createdAt || new Date().toISOString(),
				history: Array.isArray(m.history) ? m.history.slice(-HISTORY_LIMIT) : [],
			};
			for (const field of OPTIONAL_FIELDS) {
				if (m[field] !== undefined && monitor[field] === undefined) monitor[field] = m[field];
			}
			return monitor;
		});

	if (mode === 'replace') {
		state.monitors = clean;
		state.incidents = Array.isArray(payload.incidents) ? payload.incidents.slice(0, INCIDENT_LIMIT) : [];
	} else {
		for (const monitor of clean) {
			const index = state.monitors.findIndex((m) => m.id === monitor.id);
			if (index === -1) state.monitors.push(monitor);
			else state.monitors[index] = { ...state.monitors[index], ...monitor, status: 'unknown' };
		}
	}

	if (payload.settings && typeof payload.settings === 'object') {
		state.settings = {
			...defaultSettings(),
			...payload.settings,
			statusPage: { ...DEFAULT_SETTINGS.statusPage, ...(payload.settings.statusPage || {}) },
		};
	}

	save(true);
	return { imported: clean.length, total: state.monitors.length };
}

load();

module.exports = {
	FILE,
	load,
	save: (immediate) => save(immediate),
	list,
	get,
	create,
	update,
	remove,
	addHistory,
	pushIncident,
	incidents,
	uptime24h,
	stats,
	getSettings,
	updateSettings,
	exportState,
	importState,
	ROLLUP_LIMIT,
};
