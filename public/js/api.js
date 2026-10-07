import { APP_MODE } from './config.js';

export class ApiError extends Error {
	constructor(message, { status = 0, errors = [] } = {}) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.errors = errors;
	}
}

/** True when running as the GitHub Pages bundle (built by tools/gh-build.js). */
export const isStatic = APP_MODE === 'static';

async function request(path, options = {}) {
	let response;
	try {
		response = await fetch(path, {
			headers: options.body ? { 'content-type': 'application/json' } : undefined,
			...options,
		});
	} catch {
		throw new ApiError('Network unreachable — server not responding', { status: 0 });
	}

	if (response.status === 204) return null;

	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message = Array.isArray(data.errors)
			? data.errors.join(', ')
			: data.error || `Request failed (${response.status})`;
		throw new ApiError(message, { status: response.status, errors: data.errors || [] });
	}
	return data;
}

/* ---------------- static (GitHub Pages) mode ----------------
 * All reads come from one snapshot file; several api calls happen in the same
 * tick, so the fetch is memoised for a few seconds instead of firing 4×.
 */

const READONLY_HINT =
	'Read-only mode — add or edit monitors in config/monitors.json in the repository and commit. The dashboard refreshes about every 5 minutes.';

function readOnly() {
	return Promise.reject(new ApiError(READONLY_HINT, { status: 0 }));
}

let snapshotCache = null;

function snapshot() {
	const now = Date.now();
	if (!snapshotCache || now - snapshotCache.at > 4000) {
		snapshotCache = { at: now, promise: request('./data/state.json') };
	}
	return snapshotCache.promise;
}

/** Memoised fetch for derived static files (analytics change only on deploy). */
const fileCache = new Map();

function memoFile(path, ttl = 30_000) {
	const now = Date.now();
	const hit = fileCache.get(path);
	if (hit && now - hit.at < ttl) return hit.promise;
	const promise = request(path);
	fileCache.set(path, { at: now, promise });
	promise.catch(() => fileCache.delete(path));
	return promise;
}

function filterIncidents(items, params = {}) {
	let list = items;
	if (params.type) list = list.filter((i) => i.type === params.type);
	if (params.monitorId) list = list.filter((i) => i.monitorId === params.monitorId);
	return params.limit ? list.slice(0, Number(params.limit)) : list;
}

export const api = {
	health: () => (isStatic ? snapshot().then((s) => s.health) : request('/api/health')),
	stats: () => (isStatic ? snapshot().then((s) => s.stats) : request('/api/stats')),
	monitors: () => (isStatic ? snapshot().then((s) => s.monitors) : request('/api/monitors')),
	monitor: (id) =>
		isStatic
			? snapshot().then((s) => s.monitors.find((m) => m.id === id) ?? null)
			: request(`/api/monitors/${encodeURIComponent(id)}`),
	createMonitor: (payload) =>
		isStatic
			? readOnly()
			: request('/api/monitors', { method: 'POST', body: JSON.stringify(payload) }),
	updateMonitor: (id, patch) =>
		isStatic
			? readOnly()
			: request(`/api/monitors/${encodeURIComponent(id)}`, {
					method: 'PATCH',
					body: JSON.stringify(patch),
				}),
	deleteMonitor: (id) =>
		isStatic
			? readOnly()
			: request(`/api/monitors/${encodeURIComponent(id)}`, { method: 'DELETE' }),
	checkMonitor: (id) =>
		isStatic
			? readOnly()
			: request(`/api/monitors/${encodeURIComponent(id)}/check`, { method: 'POST' }),
	incidents: (params = {}) => {
		if (isStatic) return snapshot().then((s) => filterIncidents(s.incidents || [], params));
		const query = new URLSearchParams();
		if (params.limit) query.set('limit', params.limit);
		if (params.type) query.set('type', params.type);
		if (params.monitorId) query.set('monitorId', params.monitorId);
		const suffix = query.toString() ? `?${query}` : '';
		return request(`/api/incidents${suffix}`);
	},
	exportData: () => (isStatic ? snapshot() : request('/api/export')),
	importData: (payload, mode) =>
		isStatic
			? readOnly()
			: request(`/api/import?mode=${mode}`, { method: 'POST', body: JSON.stringify(payload) }),
	settings: () =>
		isStatic
			? snapshot().then(
					(s) => s.settings || { statusPage: { enabled: false, title: 'Service status', message: '' } },
				)
			: request('/api/settings'),
	updateSettings: (patch) =>
		isStatic
			? readOnly()
			: request('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
	/** Fleet summary for a range: {range, checks, uptime, avgMs, p50/p95/p99Ms, series, days, sla} */
	analytics: (range = '24h') => {
		if (isStatic) {
			return memoFile('./data/analytics.json').then((data) => ({
				...(data.ranges?.[range] || data.ranges?.['24h'] || { range: 24, series: [] }),
				days: data.days || [],
				sla: data.sla || null,
			}));
		}
		return request(`/api/analytics?range=${encodeURIComponent(range)}`);
	},
	/** Per-monitor analytics: summary + histogram + 30-day buckets + SLA report. */
	monitorAnalytics: (id, range = '24h') => {
		if (isStatic) {
			return memoFile(`./data/analytics/${encodeURIComponent(id)}.json`).then((data) => ({
				...(data.ranges?.[range] || data.ranges?.['24h'] || { range: 24, series: [] }),
				histogram: data.histogram || null,
				days: data.days || [],
				sla: data.sla || null,
			}));
		}
		return request(`/api/monitors/${encodeURIComponent(id)}/analytics?range=${encodeURIComponent(range)}`);
	},
	/** Where the public status page lives in this mode. */
	statusPageUrl: () => (isStatic ? './status.html' : '/status'),
	badgeUrl: (id = 'fleet') =>
		isStatic ? `./badge/${encodeURIComponent(id)}.svg` : `/api/badge/${encodeURIComponent(id)}.svg`,
};
