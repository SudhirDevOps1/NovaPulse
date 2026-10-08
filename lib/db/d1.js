const { DatabaseAdapter } = require('./interface');

class D1Adapter extends DatabaseAdapter {
	/** @param {any} d1Binding */
	constructor(d1Binding) {
		super();
		this.db = d1Binding;
	}

	async list() {
		const res = await this.db.prepare('SELECT * FROM monitors ORDER BY name ASC').all();
		return (res.results || []).map((row) => ({
			...row,
			enabled: Boolean(row.enabled),
			checkSsl: Boolean(row.check_ssl),
			intervalSec: row.interval_sec,
			timeoutMs: row.timeout_ms,
			warnMs: row.warn_ms,
			failuresBeforeDown: row.failures_before_down,
			expectedStatus: row.expected_status,
			expectedKeyword: row.expected_keyword,
			tags: JSON.parse(row.tags || '[]'),
			headers: row.headers ? JSON.parse(row.headers) : null,
			lastCheck: row.last_check ? JSON.parse(row.last_check) : null,
			ssl: row.ssl ? JSON.parse(row.ssl) : null,
		}));
	}

	async get(id) {
		const row = await this.db.prepare('SELECT * FROM monitors WHERE id = ?').bind(id).first();
		if (!row) return null;
		return {
			...row,
			enabled: Boolean(row.enabled),
			checkSsl: Boolean(row.check_ssl),
			intervalSec: row.interval_sec,
			timeoutMs: row.timeout_ms,
			warnMs: row.warn_ms,
			failuresBeforeDown: row.failures_before_down,
			expectedStatus: row.expected_status,
			expectedKeyword: row.expected_keyword,
			tags: JSON.parse(row.tags || '[]'),
			headers: row.headers ? JSON.parse(row.headers) : null,
			lastCheck: row.last_check ? JSON.parse(row.last_check) : null,
			ssl: row.ssl ? JSON.parse(row.ssl) : null,
		};
	}

	async create(monitor) {
		const id = monitor.id || `mon-${Date.now().toString(36)}`;
		await this.db
			.prepare(
				`INSERT INTO monitors (id, name, url, type, method, interval_sec, timeout_ms, enabled, expected_status, expected_keyword, warn_ms, failures_before_down, check_ssl, body, headers, tags, status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				id,
				monitor.name,
				monitor.url,
				monitor.type || 'http',
				monitor.method || 'GET',
				monitor.intervalSec || 60,
				monitor.timeoutMs || 10000,
				monitor.enabled !== false ? 1 : 0,
				monitor.expectedStatus || null,
				monitor.expectedKeyword || null,
				monitor.warnMs || 0,
				monitor.failuresBeforeDown || 1,
				monitor.checkSsl !== false ? 1 : 0,
				monitor.body || null,
				monitor.headers ? JSON.stringify(monitor.headers) : null,
				JSON.stringify(monitor.tags || []),
				'unknown'
			)
			.run();
		return this.get(id);
	}

	async update(id, patch) {
		const existing = await this.get(id);
		if (!existing) return null;
		const merged = { ...existing, ...patch };
		await this.db
			.prepare(
				`UPDATE monitors SET name = ?, url = ?, type = ?, method = ?, interval_sec = ?, timeout_ms = ?, enabled = ?, expected_status = ?, expected_keyword = ?, warn_ms = ?, failures_before_down = ?, check_ssl = ?, body = ?, headers = ?, tags = ?, status = ?, last_check = ?, ssl = ?
				 WHERE id = ?`
			)
			.bind(
				merged.name,
				merged.url,
				merged.type || 'http',
				merged.method || 'GET',
				merged.intervalSec,
				merged.timeoutMs,
				merged.enabled ? 1 : 0,
				merged.expectedStatus || null,
				merged.expectedKeyword || null,
				merged.warnMs || 0,
				merged.failuresBeforeDown || 1,
				merged.checkSsl ? 1 : 0,
				merged.body || null,
				merged.headers ? JSON.stringify(merged.headers) : null,
				JSON.stringify(merged.tags || []),
				merged.status || 'unknown',
				merged.lastCheck ? JSON.stringify(merged.lastCheck) : null,
				merged.ssl ? JSON.stringify(merged.ssl) : null,
				id
			)
			.run();
		return this.get(id);
	}

	async remove(id) {
		await this.db.prepare('DELETE FROM monitors WHERE id = ?').bind(id).run();
		await this.db.prepare('DELETE FROM history WHERE monitor_id = ?').bind(id).run();
		return true;
	}

	async addHistory(id, entry) {
		await this.db
			.prepare(
				'INSERT INTO history (monitor_id, at, ok, status, ms, degraded) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.bind(
				id,
				entry.at,
				entry.ok ? 1 : 0,
				entry.status || null,
				entry.ms || null,
				entry.degraded ? 1 : 0
			)
			.run();
	}

	async pushIncident(incident) {
		const id = incident.id || `inc-${Date.now().toString(36)}`;
		await this.db
			.prepare(
				`INSERT INTO incidents (id, monitor_id, name, url, type, reason, status, response_snippet, screenshot_url, at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				id,
				incident.monitorId,
				incident.name,
				incident.url || null,
				incident.type,
				incident.reason || null,
				incident.status || null,
				incident.responseSnippet || null,
				incident.screenshotUrl || null,
				incident.at || new Date().toISOString()
			)
			.run();
	}

	async incidents(limit = 50, filter = {}) {
		let query = 'SELECT * FROM incidents';
		const params = [];
		if (filter.monitorId) {
			query += ' WHERE monitor_id = ?';
			params.push(filter.monitorId);
		} else if (filter.type) {
			query += ' WHERE type = ?';
			params.push(filter.type);
		}
		query += ' ORDER BY at DESC LIMIT ?';
		params.push(limit);
		const stmt = this.db.prepare(query);
		const res = await (params.length ? stmt.bind(...params) : stmt).all();
		return (res.results || []).map((row) => ({
			id: row.id,
			monitorId: row.monitor_id,
			name: row.name,
			url: row.url,
			type: row.type,
			reason: row.reason,
			status: row.status,
			responseSnippet: row.response_snippet,
			screenshotUrl: row.screenshot_url,
			at: row.at,
		}));
	}

	async stats(_now = Date.now()) {
		const monitors = await this.list();
		const up = monitors.filter((m) => m.status === 'up' || m.status === 'degraded').length;
		const down = monitors.filter((m) => m.status === 'down').length;
		const paused = monitors.filter((m) => !m.enabled).length;
		return {
			totals: { monitors: monitors.length, up, down, paused },
			uptime24h: 100,
			avgResponse24h: 0,
			checks24h: 0,
			incidents24h: 0,
			lastIncident: null,
		};
	}

	async getSettings() {
		const res = await this.db.prepare('SELECT * FROM settings').all();
		const settings = {};
		for (const row of res.results || []) {
			try {
				settings[row.key] = JSON.parse(row.value);
			} catch {
				settings[row.key] = row.value;
			}
		}
		return settings;
	}

	async updateSettings(patch) {
		for (const [key, val] of Object.entries(patch)) {
			await this.db
				.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
				.bind(key, JSON.stringify(val))
				.run();
		}
		return this.getSettings();
	}
}

module.exports = { D1Adapter };
