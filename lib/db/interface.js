/* Database Adapter Interface
 * All storage drivers (Atomic JSON, Cloudflare D1, Turso libSQL, Neon Postgres)
 * implement this common contract.
 */

class DatabaseAdapter {
	/** @returns {Promise<Array<object>>} */
	async list() {
		throw new Error('Not implemented');
	}

	/** @param {string} _id @returns {Promise<any>} */
	async get(_id) {
		throw new Error('Not implemented');
	}

	/** @param {object} _monitor @returns {Promise<any>} */
	async create(_monitor) {
		throw new Error('Not implemented');
	}

	/** @param {string} _id @param {object} _patch @returns {Promise<any>} */
	async update(_id, _patch) {
		throw new Error('Not implemented');
	}

	/** @param {string} _id @returns {Promise<any>} */
	async remove(_id) {
		throw new Error('Not implemented');
	}

	/** @param {string} _id @param {object} _entry @returns {Promise<any>} */
	async addHistory(_id, _entry) {
		throw new Error('Not implemented');
	}

	/** @param {object} _incident @returns {Promise<any>} */
	async pushIncident(_incident) {
		throw new Error('Not implemented');
	}

	/** @param {number} [_limit] @param {object} [_filter] @returns {Promise<any>} */
	async incidents(_limit = 50, _filter = {}) {
		throw new Error('Not implemented');
	}

	/** @param {number} [_now] @returns {Promise<any>} */
	async stats(_now = Date.now()) {
		throw new Error('Not implemented');
	}

	/** @returns {Promise<any>} */
	async getSettings() {
		throw new Error('Not implemented');
	}

	/** @param {object} _patch @returns {Promise<any>} */
	async updateSettings(_patch) {
		throw new Error('Not implemented');
	}
}

module.exports = { DatabaseAdapter };
