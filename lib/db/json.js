const { DatabaseAdapter } = require('./interface');
const store = require('../store');

class JsonAdapter extends DatabaseAdapter {
	async list() {
		return store.list();
	}

	async get(id) {
		return store.get(id);
	}

	async create(monitor) {
		return store.create(monitor);
	}

	async update(id, patch) {
		return store.update(id, patch);
	}

	async remove(id) {
		return store.remove(id);
	}

	async addHistory(id, entry) {
		return store.addHistory(id, entry);
	}

	async pushIncident(incident) {
		return store.pushIncident(incident);
	}

	async incidents(limit = 50, filter = {}) {
		return store.incidents(limit, filter);
	}

	async stats(now = Date.now()) {
		return store.stats(now);
	}

	async getSettings() {
		return store.getSettings();
	}

	async updateSettings(patch) {
		return store.updateSettings(patch);
	}
}

module.exports = { JsonAdapter };
