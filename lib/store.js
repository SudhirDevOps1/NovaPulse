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

/**
 * Single source of truth for probe methods — `server.js` validates the same
 * list, so an import and a POST /api/monitors can never disagree (TODO NOW-6).
 */
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Same rule `validateMonitor` applies: uppercase, unknown → GET. */
function normaliseMethod(value) {
	const method = typeof value === 'string' ? value.toUpperCase() : '';
	return HTTP_METHODS.includes(method) ? method : 'GET';
}

/** Numeric field → integer inside [min, max], or `fallback` when unusable. */
function clampInt(value, min, max, fallback) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Fill in every field a hand-edited, truncated or older data file left out.
 *
 * Before this, a monitor written without `history` made `addHistory` throw
 * (`Cannot read properties of undefined (reading 'push')`) and the list/detail
 * endpoints answer 500 — a Mode A user editing `monitors.json` by hand could
 * break their own instance (TODO NOW-1).
 */
function normaliseMonitor(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const monitor = { ...raw };
	if (typeof monitor.id !== 'string' || !monitor.id) monitor.id = crypto.randomUUID();
	if (typeof monitor.name !== 'string') monitor.name = '';
	if (typeof monitor.url !== 'string') monitor.url = '';
	if (!Array.isArray(monitor.history)) monitor.history = [];
	if (!Array.isArray(monitor.rollups)) monitor.rollups = [];
	if (!Array.isArray(monitor.tags)) monitor.tags = [];
	if (typeof monitor.status !== 'string') monitor.status = 'unknown';
	if (typeof monitor.enabled !== 'boolean') monitor.enabled = true;
	if (!Number.isFinite(monitor.consecutiveFailures)) monitor.consecutiveFailures = 0;
	if (typeof monitor.wasDown !== 'boolean') monitor.wasDown = false;
	if (!Number.isFinite(monitor.lastDownAlertAt)) monitor.lastDownAlertAt = null;
	if (!Number.isFinite(monitor.lastUpAlertAt)) monitor.lastUpAlertAt = null;
	if (!Number.isFinite(monitor.intervalSec)) monitor.intervalSec = 60;
	else monitor.intervalSec = Math.min(86400, Math.max(10, Math.round(Number(monitor.intervalSec))));
	if (!Number.isFinite(monitor.timeoutMs)) monitor.timeoutMs = 10000;
	else monitor.timeoutMs = Math.min(60000, Math.max(500, Math.round(Number(monitor.timeoutMs))));
	monitor.method = normaliseMethod(monitor.method);
	if (monitor.type !== 'tcp' && monitor.type !== 'http') {
		monitor.type = /^tcp:\/\//i.test(monitor.url) ? 'tcp' : 'http';
	}
	if (monitor.lastCheck === undefined) monitor.lastCheck = null;
	if (typeof monitor.createdAt !== 'string') monitor.createdAt = new Date().toISOString();
	return monitor;
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
			monitors: (Array.isArray(parsed.monitors) ? parsed.monitors : [])
				.map(normaliseMonitor)
				.filter(Boolean),
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
			// The old behaviour started empty and let the first debounced flush
			// rename the unreadable bytes away — silent destruction of the only
			// copy (TODO NOW-2). Keep them under a dated quarantine name first;
			// `load()` itself never writes, so monitors.json is only replaced
			// by an explicit save.
			const quarantine = quarantineCorruptFile();
			logger.warn('Could not read data file — quarantined and starting empty', {
				error: error.message,
				quarantine,
			});
		}
		state = { monitors: [], incidents: [], settings: defaultSettings() };
	}
	return state;
}

/** Copy an unreadable data file aside so nothing is ever lost. */
function quarantineCorruptFile() {
	try {
		if (!fs.existsSync(FILE)) return null;
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const target = `${FILE}.corrupt-${stamp}`;
		fs.copyFileSync(FILE, target);
		return target;
	} catch (error) {
		logger.error('Could not quarantine the corrupt data file', { error: error.message });
		return null;
	}
}

/**
 * Persistence health. A full disk or a read-only filesystem used to be logged
 * once per attempt and then swallowed forever, so the UI kept accepting writes
 * while nothing survived a restart. `/api/health` now surfaces this.
 */
const persistence = {
	ok: true,
	lastFlushAt: null,
	lastError: null,
	consecutiveFailures: 0,
	lastErrorLoggedAt: 0,
};

function flush() {
	clearTimeout(saveTimer);
	saveTimer = null;
	try {
		fs.mkdirSync(DATA_DIR, { recursive: true });
		const tmp = `${FILE}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(state));
		fs.renameSync(tmp, FILE);
		if (persistence.lastError) logger.info('Data persistence recovered', { file: FILE });
		persistence.ok = true;
		persistence.lastFlushAt = new Date().toISOString();
		persistence.lastError = null;
		persistence.consecutiveFailures = 0;
	} catch (error) {
		persistence.ok = false;
		persistence.lastError = error.message;
		persistence.consecutiveFailures += 1;
		// First failure immediately, then at most once a minute — a full disk
		// would otherwise print one line per check batch.
		const now = Date.now();
		if (now - persistence.lastErrorLoggedAt >= 60_000) {
			persistence.lastErrorLoggedAt = now;
			logger.error('Failed to persist data', {
				error: error.message,
				consecutiveFailures: persistence.consecutiveFailures,
				file: FILE,
			});
		}
	}
}

function health() {
	return {
		file: FILE,
		ok: persistence.ok,
		lastFlushAt: persistence.lastFlushAt,
		lastError: persistence.lastError,
		consecutiveFailures: persistence.consecutiveFailures,
	};
}

/** Coalesce bursts of writes into one disk flush. */
function save(immediate = false) {
	if (immediate) return flush();
	if (saveTimer) return;
	saveTimer = setTimeout(flush, 250);
	saveTimer.unref?.();
}

// The timer above is unref'd so a pending flush never keeps the process alive,
// which also means an idle exit (tests, one-shot scripts) would drop it. `exit`
// still allows synchronous work, so the snapshot is written on the way out.
process.once('exit', () => {
	if (saveTimer) flush();
});

/**
 * Advisory single-writer check. `flush()` writes a fixed `.tmp` name, so two
 * writers (PM2 cluster mode, or `api/cron.js` alongside `server.js`) interleave
 * and clobber each other. Refusing to boot on a stale lock would be worse, so
 * this only makes the conflict loud instead of silent.
 */
function checkSingleWriter() {
	const lock = `${FILE}.lock`;
	try {
		if (fs.existsSync(lock)) {
			const held = JSON.parse(fs.readFileSync(lock, 'utf8'));
			if (held.pid && held.pid !== process.pid) {
				let alive = false;
				try {
					process.kill(held.pid, 0);
					alive = true;
				} catch {
					alive = false; // stale lock left by a crashed process
				}
				if (alive) {
					logger.error('Another process is writing the same data file (single-writer violated)', {
						otherPid: held.pid,
						startedAt: held.at,
						file: FILE,
					});
				}
			}
		}
		fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
	} catch (error) {
		logger.debug('Could not write the single-writer lock file', { error: error.message });
	}
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
		method: normaliseMethod(fields.method),
		type: fields.type === 'tcp' ? 'tcp' : 'http',
		// Clamped to the same bounds validateMonitor enforces: callers reach here
		// from the import path too, which has no API validation in front of it.
		intervalSec: clampInt(fields.intervalSec, 10, 86400, 60),
		timeoutMs: clampInt(fields.timeoutMs, 500, 60000, 10000),
		enabled: true,
		status: 'unknown',
		consecutiveFailures: 0,
		wasDown: false,
		lastDownAlertAt: null,
		lastUpAlertAt: null,
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
	// An outage is the one record a crash must never lose: flush now rather than
	// waiting out the 250ms debounce.
	save(true);
}

function incidents(limit = 50, filter = {}) {
	let items = state.incidents;
	if (filter.monitorId) items = items.filter((i) => i.monitorId === filter.monitorId);
	if (filter.type) items = items.filter((i) => i.type === filter.type);
	// Clamped: `Math.min(-5, 200)` is -5, and `slice(0, -5)` silently drops the
	// last five entries instead of returning five.
	return items.slice(0, clampInt(limit, 1, INCIDENT_LIMIT, 50));
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

const STATUS_SPEC_RE = /^(\d{3}|\d{3}-\d{3})(\s*,\s*(\d{3}|\d{3}-\d{3}))*$/;

/** Optional fields whose value is decided by sanitiseOptionalFields, not the copy loop. */
const SANITISED_FIELDS = new Set([
	'headers',
	'body',
	'expectedStatus',
	'expectedKeyword',
	'warnMs',
	'failuresBeforeDown',
	'checkSsl',
	'ssl',
	'sslWarnedAt',
]);

/**
 * Backup files are hand-craftable input, but `importState` copied these fields
 * verbatim — bypassing every limit `validateMonitor` enforces on POST/PATCH. A
 * restored backup could therefore carry a 60KB header, an unbounded `body` or a
 * rollup bucket with a million samples that then gets re-serialised on every
 * save.
 */
function sanitiseOptionalFields(source, monitor) {
	// Drop whatever the allow-list copied in, then re-add only validated values —
	// otherwise an invalid field survives simply because the raw copy ran first.
	for (const field of SANITISED_FIELDS) delete monitor[field];

	if (source.headers && typeof source.headers === 'object' && !Array.isArray(source.headers)) {
		const kept = {};
		let count = 0;
		for (const [key, value] of Object.entries(source.headers)) {
			if (count >= 10) break;
			if (typeof key !== 'string' || !key || key.length > 100) continue;
			if (typeof value !== 'string' || value.length > 2048) continue;
			kept[key] = value;
			count += 1;
		}
		if (count) monitor.headers = kept;
	}
	if (typeof source.body === 'string' && source.body.length > 0 && source.body.length <= 4096) {
		monitor.body = source.body;
	}
	if (typeof source.expectedStatus === 'string' && STATUS_SPEC_RE.test(source.expectedStatus.trim())) {
		monitor.expectedStatus = source.expectedStatus.trim();
	}
	if (typeof source.expectedKeyword === 'string' && source.expectedKeyword.trim()) {
		monitor.expectedKeyword = source.expectedKeyword.trim().slice(0, 120);
	}
	const warnMs = Number(source.warnMs);
	if (source.warnMs !== undefined && source.warnMs !== null && source.warnMs !== '' && Number.isFinite(warnMs) && warnMs > 0) {
		monitor.warnMs = clampInt(warnMs, 1, 60000, 0);
	}
	const failures = Number(source.failuresBeforeDown);
	if (
		source.failuresBeforeDown !== undefined &&
		source.failuresBeforeDown !== null &&
		source.failuresBeforeDown !== '' &&
		Number.isInteger(failures) &&
		failures >= 1 &&
		failures <= 10 &&
		failures > 1
	) {
		monitor.failuresBeforeDown = failures;
	}
	if (source.checkSsl !== undefined && source.checkSsl !== null) {
		monitor.checkSsl = source.checkSsl !== false && source.checkSsl !== 'false';
	}
	if (source.ssl && typeof source.ssl === 'object') monitor.ssl = source.ssl;
	if (Number.isFinite(source.sslWarnedAt)) monitor.sslWarnedAt = source.sslWarnedAt;
	return monitor;
}

/** Keep only the rollup buckets a real check could have produced, samples included. */
function sanitiseRollups(raw) {
	if (!Array.isArray(raw)) return [];
	const buckets = [];
	for (const bucket of raw.slice(-ROLLUP_LIMIT)) {
		if (!bucket || typeof bucket !== 'object' || !Number.isFinite(bucket.hour)) continue;
		const clean = {
			hour: bucket.hour,
			n: clampInt(bucket.n, 0, Number.MAX_SAFE_INTEGER, 0),
			ok: clampInt(bucket.ok, 0, Number.MAX_SAFE_INTEGER, 0),
			sum: Number.isFinite(bucket.sum) ? bucket.sum : 0,
			min: Number.isFinite(bucket.min) ? bucket.min : null,
			max: Number.isFinite(bucket.max) ? bucket.max : null,
		};
		if (Array.isArray(bucket.samples)) {
			clean.samples = bucket.samples.filter((s) => Number.isFinite(s)).slice(0, 2400);
		}
		buckets.push(clean);
	}
	return buckets;
}

/** History rows are re-emitted straight into the CSV export — validate the shape. */
function sanitiseHistory(raw) {
	if (!Array.isArray(raw)) return [];
	const rows = [];
	for (const entry of raw.slice(-HISTORY_LIMIT)) {
		if (!entry || typeof entry !== 'object') continue;
		const at = typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at)) ? entry.at : null;
		if (!at) continue;
		const row = { at, ok: Boolean(entry.ok) };
		if (Number.isInteger(entry.status)) row.status = entry.status;
		if (Number.isFinite(entry.ms)) row.ms = entry.ms;
		if (entry.degraded) row.degraded = true;
		rows.push(row);
	}
	return rows;
}

/** Incident rows come straight from the backup too — same treatment as history. */
function sanitiseIncidents(raw) {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((i) => i && typeof i === 'object')
		.map((i) => {
			const at = typeof i.at === 'string' && Number.isFinite(Date.parse(i.at)) ? i.at : null;
			if (!at) return null;
			const incident = {
				id: typeof i.id === 'string' && i.id ? i.id.slice(0, 64) : crypto.randomUUID(),
				at,
				monitorId: typeof i.monitorId === 'string' ? i.monitorId.slice(0, 64) : null,
				name: typeof i.name === 'string' ? i.name.slice(0, 60) : '',
				url: typeof i.url === 'string' ? i.url.slice(0, 2048) : '',
				type: i.type === 'up' ? 'up' : 'down',
			};
			if (typeof i.reason === 'string') incident.reason = i.reason.slice(0, 500);
			if (Number.isInteger(i.status)) incident.status = i.status;
			if (typeof i.responseSnippet === 'string') incident.responseSnippet = i.responseSnippet.slice(0, 1024);
			if (typeof i.screenshotUrl === 'string') incident.screenshotUrl = i.screenshotUrl.slice(0, 512);
			return incident;
		})
		.filter(Boolean)
		.slice(0, INCIDENT_LIMIT);
}

function importState(payload, mode = 'merge') {
	if (!payload || !Array.isArray(payload.monitors)) {
		throw new Error('Invalid backup: monitors[] missing');
	}

	const clean = payload.monitors
		.filter((m) => m && typeof m.url === 'string' && typeof m.name === 'string')
		.map((m) => {
			const monitor = {
				id: typeof m.id === 'string' && m.id ? m.id.slice(0, 64) : crypto.randomUUID(),
				name: String(m.name).slice(0, 60),
				url: String(m.url).slice(0, 2048),
				method: normaliseMethod(m.method),
				type: m.type === 'tcp' || /^tcp:\/\//i.test(String(m.url)) ? 'tcp' : 'http',
				intervalSec: clampInt(m.intervalSec, 10, 86400, 60),
				timeoutMs: clampInt(m.timeoutMs, 500, 60000, 10000),
				enabled: m.enabled !== false,
				status: 'unknown',
				consecutiveFailures: 0,
				wasDown: false,
				lastDownAlertAt: null,
				lastUpAlertAt: null,
				tags: Array.isArray(m.tags)
					? [...new Set(m.tags.filter((t) => typeof t === 'string').map((t) => t.trim().slice(0, 24)).filter(Boolean))].slice(0, 10)
					: [],
				rollups: sanitiseRollups(m.rollups),
				lastCheck: null,
				createdAt: m.createdAt || new Date().toISOString(),
				history: sanitiseHistory(m.history),
			};
			for (const field of OPTIONAL_FIELDS) {
				// sanitiseOptionalFields() owns the free-form probe fields; a raw
				// copy here would win whenever validation decided to drop the value.
				if (SANITISED_FIELDS.has(field)) continue;
				if (m[field] !== undefined && monitor[field] === undefined) monitor[field] = m[field];
			}
			return sanitiseOptionalFields(m, monitor);
		});

	if (mode === 'replace') {
		state.monitors = clean;
		state.incidents = sanitiseIncidents(payload.incidents);
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
checkSingleWriter();

module.exports = {
	FILE,
	load,
	save: (immediate) => save(immediate),
	health,
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
	HTTP_METHODS,
	normaliseMethod,
	normaliseMonitor,
};
