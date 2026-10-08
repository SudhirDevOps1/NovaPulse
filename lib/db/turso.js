const { DatabaseAdapter } = require('./interface');

class TursoAdapter extends DatabaseAdapter {
	/**
	 * @param {string} url - e.g. "https://[db-name]-[org].turso.io"
	 * @param {string} authToken
	 */
	constructor(url, authToken) {
		super();
		this.url = String(url || '').replace(/\/$/, '');
		this.authToken = authToken;
	}

	async execute(sql, args = []) {
		const endpoint = `${this.url}/v2/pipeline`;
		const statements = [
			{
				type: 'execute',
				stmt: {
					sql,
					args: args.map((arg) => {
						if (arg === null || arg === undefined) return { type: 'null' };
						if (typeof arg === 'number') return { type: 'float', value: arg };
						if (typeof arg === 'boolean') return { type: 'integer', value: arg ? '1' : '0' };
						return { type: 'text', value: String(arg) };
					}),
				},
			},
			{ type: 'close' },
		];

		const res = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.authToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ requests: statements }),
		});

		if (!res.ok) {
			throw new Error(`Turso HTTP query failed with status ${res.status}`);
		}

		const data = await res.json();
		const result = data?.results?.[0]?.response?.result;
		if (!result) return { rows: [] };

		const cols = (result.cols || []).map((c) => c.name);
		const rows = (result.rows || []).map((row) => {
			const obj = {};
			row.forEach((cell, i) => {
				obj[cols[i]] = cell.value !== undefined ? cell.value : null;
			});
			return obj;
		});

		return { rows };
	}

	async list() {
		const { rows } = await this.execute('SELECT * FROM monitors ORDER BY name ASC');
		return rows.map((row) => ({
			...row,
			enabled: row.enabled === '1' || row.enabled === 1,
			intervalSec: Number(row.interval_sec) || 60,
			timeoutMs: Number(row.timeout_ms) || 10000,
			tags: JSON.parse(row.tags || '[]'),
			lastCheck: row.last_check ? JSON.parse(row.last_check) : null,
		}));
	}

	async get(id) {
		const { rows } = await this.execute('SELECT * FROM monitors WHERE id = ?', [id]);
		if (!rows.length) return null;
		const row = rows[0];
		return {
			...row,
			enabled: row.enabled === '1' || row.enabled === 1,
			intervalSec: Number(row.interval_sec) || 60,
			timeoutMs: Number(row.timeout_ms) || 10000,
			tags: JSON.parse(row.tags || '[]'),
			lastCheck: row.last_check ? JSON.parse(row.last_check) : null,
		};
	}

	async create(monitor) {
		const id = monitor.id || `mon-${Date.now().toString(36)}`;
		await this.execute(
			`INSERT INTO monitors (id, name, url, type, method, interval_sec, timeout_ms, enabled, tags, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				monitor.name,
				monitor.url,
				monitor.type || 'http',
				monitor.method || 'GET',
				monitor.intervalSec || 60,
				monitor.timeoutMs || 10000,
				monitor.enabled !== false ? 1 : 0,
				JSON.stringify(monitor.tags || []),
				'unknown',
			]
		);
		return this.get(id);
	}

	async remove(id) {
		await this.execute('DELETE FROM monitors WHERE id = ?', [id]);
		await this.execute('DELETE FROM history WHERE monitor_id = ?', [id]);
		return true;
	}

	async addHistory(id, entry) {
		await this.execute(
			'INSERT INTO history (monitor_id, at, ok, status, ms, degraded) VALUES (?, ?, ?, ?, ?, ?)',
			[id, entry.at, entry.ok ? 1 : 0, entry.status || null, entry.ms || null, entry.degraded ? 1 : 0]
		);
	}

	async pushIncident(incident) {
		const id = incident.id || `inc-${Date.now().toString(36)}`;
		await this.execute(
			`INSERT INTO incidents (id, monitor_id, name, url, type, reason, status, response_snippet, screenshot_url, at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				incident.monitorId,
				incident.name,
				incident.url || null,
				incident.type,
				incident.reason || null,
				incident.status || null,
				incident.responseSnippet || null,
				incident.screenshotUrl || null,
				incident.at || new Date().toISOString(),
			]
		);
	}

	async incidents(limit = 50) {
		const { rows } = await this.execute('SELECT * FROM incidents ORDER BY at DESC LIMIT ?', [limit]);
		return rows.map((r) => ({
			id: r.id,
			monitorId: r.monitor_id,
			name: r.name,
			url: r.url,
			type: r.type,
			reason: r.reason,
			status: r.status ? Number(r.status) : null,
			responseSnippet: r.response_snippet,
			screenshotUrl: r.screenshot_url,
			at: r.at,
		}));
	}

	async stats() {
		const monitors = await this.list();
		const up = monitors.filter((m) => m.status === 'up').length;
		const down = monitors.filter((m) => m.status === 'down').length;
		return {
			totals: { monitors: monitors.length, up, down, paused: monitors.length - (up + down) },
			uptime24h: 100,
			checks24h: 0,
			incidents24h: 0,
		};
	}
}

module.exports = { TursoAdapter };
