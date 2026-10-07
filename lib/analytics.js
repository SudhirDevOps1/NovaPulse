/* Analytics over hourly rollups (30 days) + raw history (recent window).
 *
 * Data sources:
 *   - monitor.rollups[] : {hour, n, ok, sum, min, max, p50, p95, p99}  (exact per hour)
 *   - monitor.history[] : last 500 checks (raw, used for histograms & drawer lines)
 *
 * Percentiles across hours are merged as n-weighted means of the hourly percentiles —
 * accurate to a few ms and cheap enough to compute on every request.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const RANGES = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

function rangeHours(range) {
	return RANGES[range] || (Number(range) > 0 ? Number(range) : 24);
}

function floorHour(ms) {
	return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function round1(value) {
	return Math.round(value * 10) / 10;
}

function percentileOf(sorted, p) {
	if (!sorted.length) return null;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index];
}

function statsOf(samples) {
	const values = samples.filter((value) => Number.isFinite(value));
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((total, value) => total + value, 0);
	return {
		count: sorted.length,
		avg: Math.round(sum / sorted.length),
		min: sorted[0],
		max: sorted[sorted.length - 1],
		p50: percentileOf(sorted, 50),
		p95: percentileOf(sorted, 95),
		p99: percentileOf(sorted, 99),
	};
}

function rollupsOf(monitor) {
	return monitor && Array.isArray(monitor.rollups) ? monitor.rollups : [];
}

function hasPercentiles(rollup) {
	return Number.isFinite(rollup.p50) || Number.isFinite(rollup.p95) || Number.isFinite(rollup.p99);
}

/**
 * Time series across one or many monitors.
 * hours ≤ 14d → hourly buckets, longer → daily buckets.
 * Returns [{t, checks, ok, uptime, avgMs, p50Ms, p95Ms, p99Ms}] ascending.
 */
function series(monitors, hours, now = Date.now()) {
	const list = Array.isArray(monitors) ? monitors : [monitors];
	const bucketMs = hours > 24 * 14 ? DAY_MS : HOUR_MS;
	const start = Math.floor(now / bucketMs) * bucketMs - hours * HOUR_MS;
	const buckets = new Map();

	for (const monitor of list) {
		for (const rollup of rollupsOf(monitor)) {
			if (rollup.hour < start || rollup.hour > now) continue;
			const key = Math.floor(rollup.hour / bucketMs) * bucketMs;
			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = {
					t: key,
					checks: 0,
					ok: 0,
					sum: 0,
					p50sum: 0,
					p50n: 0,
					p95sum: 0,
					p99sum: 0,
					pn: 0,
				};
				buckets.set(key, bucket);
			}
			bucket.checks += rollup.n || 0;
			bucket.ok += rollup.ok || 0;
			bucket.sum += rollup.sum || 0;
			if (hasPercentiles(rollup)) {
				const weight = rollup.n || 0;
				bucket.pn += weight;
				if (Number.isFinite(rollup.p50)) {
					bucket.p50sum += rollup.p50 * weight;
					bucket.p50n += weight;
				}
				if (Number.isFinite(rollup.p95)) bucket.p95sum += rollup.p95 * weight;
				if (Number.isFinite(rollup.p99)) bucket.p99sum += rollup.p99 * weight;
			}
		}
	}

	const points = [];
	for (const bucket of [...buckets.values()].sort((a, b) => a.t - b.t)) {
		points.push({
			t: bucket.t,
			checks: bucket.checks,
			ok: bucket.ok,
			uptime: bucket.checks ? round1((bucket.ok / bucket.checks) * 100) : null,
			avgMs: bucket.checks ? Math.round(bucket.sum / bucket.checks) : null,
			p50Ms: bucket.p50n ? Math.round(bucket.p50sum / bucket.p50n) : null,
			p95Ms: bucket.pn ? Math.round(bucket.p95sum / bucket.pn) : null,
			p99Ms: bucket.pn ? Math.round(bucket.p99sum / bucket.pn) : null,
		});
	}
	return points;
}

function aggregateSummary(list, hours, now) {
	let checks = 0;
	let ok = 0;
	let sum = 0;
	let wsum = 0;
	let wn = 0;
	let p95sum = 0;
	let p99sum = 0;
	let pn = 0;
	const start = floorHour(now) - hours * HOUR_MS;

	for (const monitor of list) {
		for (const rollup of rollupsOf(monitor)) {
			if (rollup.hour < start || rollup.hour > now) continue;
			checks += rollup.n || 0;
			ok += rollup.ok || 0;
			sum += rollup.sum || 0;
			if (Number.isFinite(rollup.p50)) {
				wsum += rollup.p50 * (rollup.n || 0);
				wn += rollup.n || 0;
			}
			if (Number.isFinite(rollup.p95)) p95sum += rollup.p95 * (rollup.n || 0);
			if (Number.isFinite(rollup.p99)) p99sum += rollup.p99 * (rollup.n || 0);
			if (hasPercentiles(rollup)) pn += rollup.n || 0;
		}
	}

	return {
		range: hours,
		checks,
		ok,
		uptime: checks ? round1((ok / checks) * 100) : null,
		avgMs: checks ? Math.round(sum / checks) : null,
		p50Ms: wn ? Math.round(wsum / wn) : null,
		p95Ms: pn ? Math.round(p95sum / pn) : null,
		p99Ms: pn ? Math.round(p99sum / pn) : null,
	};
}

/** Summary + chart series for one range. */
function summary(monitors, range = '24h', now = Date.now()) {
	const list = Array.isArray(monitors) ? monitors : [monitors];
	const hours = rangeHours(range);
	return { ...aggregateSummary(list, hours, now), series: series(list, hours, now) };
}

function dateKey(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

/** Fixed-length daily uptime buckets (UTC days, oldest first). `uptime` null = no data. */
function dayBuckets(monitors, days = 30, now = Date.now()) {
	const list = Array.isArray(monitors) ? monitors : [monitors];
	const map = new Map();
	const today = Date.parse(dateKey(now));

	for (const monitor of list) {
		for (const rollup of rollupsOf(monitor)) {
			const key = dateKey(rollup.hour);
			let entry = map.get(key);
			if (!entry) {
				entry = { day: key, checks: 0, ok: 0 };
				map.set(key, entry);
			}
			entry.checks += rollup.n || 0;
			entry.ok += rollup.ok || 0;
		}
	}

	const buckets = [];
	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const key = dateKey(today - offset * DAY_MS);
		const entry = map.get(key);
		buckets.push({
			day: key,
			checks: entry ? entry.checks : 0,
			ok: entry ? entry.ok : 0,
			uptime: entry && entry.checks ? round1((entry.ok / entry.checks) * 100) : null,
		});
	}
	return buckets;
}

/** Distribution of recent raw response times. */
function histogram(monitor, buckets = 12) {
	const samples = (monitor.history || [])
		.map((entry) => entry.ms)
		.filter((value) => Number.isFinite(value));
	if (samples.length < 5) return null;
	const min = Math.min(...samples);
	const max = Math.max(...samples);
	if (min === max) return { min, max, bars: [{ from: min, to: max, count: samples.length }] };
	const width = (max - min) / buckets;
	const bars = Array.from({ length: buckets }, (_, index) => ({
		from: Math.round(min + index * width),
		to: Math.round(min + (index + 1) * width),
		count: 0,
	}));
	for (const value of samples) {
		const index = Math.min(buckets - 1, Math.floor((value - min) / width));
		bars[index].count += 1;
	}
	return { min, max, bars };
}

function slaTarget() {
	const value = Number(process.env.SLA_TARGET);
	return Number.isFinite(value) && value >= 50 && value <= 100 ? value : 99.9;
}

/** Pair down→up incidents to compute MTTR over a window. */
function mttrMinutes(incidents, monitorId, since) {
	let openAt = null;
	const durations = [];
	for (const incident of [...incidents].reverse()) {
		if (monitorId && incident.monitorId !== monitorId) continue;
		const at = Date.parse(incident.at);
		if (!Number.isFinite(at) || at < since) continue;
		if (incident.type === 'down') openAt = at;
		if (incident.type === 'up' && openAt) {
			durations.push(Math.max(0, (at - openAt) / 60000));
			openAt = null;
		}
	}
	if (!durations.length) return null;
	return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
}

/**
 * SLA / error-budget report.
 *   error budget allowance = (100 − target) percentage points.
 */
function slaReport({ monitor, monitors, incidents = [], days = 30, now = Date.now() }) {
	const target = slaTarget();
	// Fleet mode passes `monitors` (array); per-monitor passes `monitor`.
	const buckets = dayBuckets(monitor ?? monitors ?? [], days, now);
	let checks = 0;
	let ok = 0;
	for (const bucket of buckets) {
		checks += bucket.checks;
		ok += bucket.ok;
	}
	const uptime = checks ? round1((ok / checks) * 100) : null;
	const since = now - days * DAY_MS;
	const windowIncidents = incidents.filter(
		(incident) => (!monitor || incident.monitorId === monitor.id) && Date.parse(incident.at) >= since
	);
	const allowance = 100 - target;
	const budgetRemaining =
		uptime === null ? null : Math.max(0, Math.min(100, round1(((uptime - target) / allowance) * 100)));

	return {
		days,
		target,
		uptime,
		checks,
		met: uptime === null ? null : uptime >= target,
		errorBudgetPct: budgetRemaining,
		incidents: windowIncidents.length,
		mttrMinutes: mttrMinutes(windowIncidents, monitor ? monitor.id : null, since),
	};
}

/** Public status-page projection (no secrets, no internal ids of disabled monitors). */
function statusProjection({ monitors, incidents, settings, now = Date.now() }) {
	const page = settings && settings.statusPage ? settings.statusPage : { enabled: false };
	const active = monitors.filter((monitor) => monitor.enabled);
	const services = active.map((monitor) => {
		const buckets = dayBuckets(monitor, 30, now);
		let checks = 0;
		let ok = 0;
		for (const bucket of buckets) {
			checks += bucket.checks;
			ok += bucket.ok;
		}
		const last24 = dayBuckets(monitor, 1, now)[0];
		return {
			name: monitor.name,
			url: monitor.type === 'tcp' ? null : monitor.url,
			status: monitor.status === 'degraded' ? 'degraded' : monitor.status,
			intervalSec: monitor.intervalSec,
			tags: Array.isArray(monitor.tags) ? monitor.tags : [],
			uptime30d: checks ? round1((ok / checks) * 100) : null,
			uptime24h: last24 && last24.checks ? round1((last24.ok / last24.checks) * 100) : null,
			days: buckets.map((bucket) => ({ day: bucket.day, uptime: bucket.uptime })),
			responseMs: monitor.lastCheck && Number.isFinite(monitor.lastCheck.ms) ? monitor.lastCheck.ms : null,
		};
	});

	const incidentList = incidents.slice(0, 20).map((incident) => ({
		at: incident.at,
		name: incident.name,
		type: incident.type,
		reason: incident.reason || null,
	}));

	const down = services.filter((service) => service.status === 'down').length;
	const degraded = services.filter((service) => service.status === 'degraded').length;
	const overall = down ? 'outage' : degraded ? 'degraded' : services.length ? 'operational' : 'unknown';

	return {
		enabled: Boolean(page.enabled),
		title: page.title || 'Service status',
		message: page.message || '',
		overall,
		updated: new Date(now).toISOString(),
		services,
		incidents: incidentList,
	};
}

module.exports = {
	RANGES,
	rangeHours,
	statsOf,
	series,
	summary,
	dayBuckets,
	histogram,
	slaReport,
	statusProjection,
	slaTarget,
};
