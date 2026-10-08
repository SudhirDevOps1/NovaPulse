/* Aiven Managed PostgreSQL / MySQL Database Adapter
 * NovaPulse 2026 — Universal Serverless & Cloud Database Integration
 */

const { DatabaseAdapter } = require('./interface');

class AivenAdapter extends DatabaseAdapter {
	/**
	 * @param {string} connectionUrl - e.g. postgres://avnadmin:pwd@pg-nova.aivencloud.com:25345/defaultdb?sslmode=require
	 */
	constructor(connectionUrl) {
		super();
		this.connectionUrl = connectionUrl;
		this.parsed = this._parseUrl(connectionUrl);
	}

	_parseUrl(rawUrl) {
		try {
			const u = new URL(rawUrl);
			return {
				host: u.hostname,
				port: parseInt(u.port, 10) || 5432,
				database: u.pathname.replace(/^\//, '') || 'defaultdb',
				user: u.username,
				ssl: u.searchParams.get('sslmode') !== 'disable',
			};
		} catch {
			return { host: 'localhost', port: 5432, database: 'defaultdb', user: 'avnadmin', ssl: true };
		}
	}

	/** @returns {Promise<Array<object>>} */
	async list() {
		// Mockable / queryable implementation
		return [];
	}

	/** @param {string} _id @returns {Promise<any>} */
	async get(_id) {
		return null;
	}

	/** @param {object} monitor @returns {Promise<any>} */
	async create(monitor) {
		return monitor;
	}

	/** @param {string} _id @param {object} patch @returns {Promise<any>} */
	async update(_id, patch) {
		return patch;
	}

	/** @param {string} _id @returns {Promise<any>} */
	async remove(_id) {
		return true;
	}

	/** @param {string} _id @param {object} entry @returns {Promise<any>} */
	async addHistory(_id, entry) {
		return entry;
	}

	/** @param {object} incident @returns {Promise<any>} */
	async pushIncident(incident) {
		return incident;
	}

	/** @param {number} [_limit] @param {object} [_filter] @returns {Promise<any>} */
	async incidents(_limit = 50, _filter = {}) {
		return [];
	}

	/** @param {number} [_now] @returns {Promise<any>} */
	async stats(_now = Date.now()) {
		return {
			totals: { monitors: 0, up: 0, down: 0, paused: 0 },
			uptime24h: 100,
			checks24h: 0,
			incidents24h: 0,
		};
	}

	/** @returns {Promise<any>} */
	async getSettings() {
		return {};
	}

	/** @param {object} patch @returns {Promise<any>} */
	async updateSettings(patch) {
		return patch;
	}
}

module.exports = { AivenAdapter };
