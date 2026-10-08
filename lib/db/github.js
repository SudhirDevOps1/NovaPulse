/* Upptime-Style GitHub Repository Storage Adapter
 * NovaPulse 2026 — Git Commits as Database via GitHub REST API
 */

const { DatabaseAdapter } = require('./interface');

class GithubAdapter extends DatabaseAdapter {
	/**
	 * @param {string} token - GitHub Personal Access Token or GITHUB_TOKEN
	 * @param {string} repo - owner/repo string (e.g. "SudhirDevOps1/NovaPulse")
	 * @param {string} [branch] - Branch to read/write state (default: "main")
	 */
	constructor(token, repo, branch = 'main') {
		super();
		this.token = token;
		this.repo = repo;
		this.branch = branch;
		this.apiBase = 'https://api.github.com';
		this._cache = null;
		this._sha = null;
	}

	async _fetchFile(path) {
		if (!this.token || !this.repo) return null;
		const res = await fetch(`${this.apiBase}/repos/${this.repo}/contents/${path}?ref=${this.branch}`, {
			headers: {
				authorization: `Bearer ${this.token}`,
				accept: 'application/vnd.github+json',
				'user-agent': 'novapulse/2026-upptime-adapter',
			},
		});

		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);

		const data = await res.json();
		this._sha = data.sha;
		const content = Buffer.from(data.content, 'base64').toString('utf8');
		return JSON.parse(content);
	}

	async _saveFile(path, contentObj, message) {
		if (!this.token || !this.repo) return false;
		const body = {
			message,
			content: Buffer.from(JSON.stringify(contentObj, null, 2)).toString('base64'),
			branch: this.branch,
			...(this._sha ? { sha: this._sha } : {}),
		};

		const res = await fetch(`${this.apiBase}/repos/${this.repo}/contents/${path}`, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${this.token}`,
				accept: 'application/vnd.github+json',
				'content-type': 'application/json',
				'user-agent': 'novapulse/2026-upptime-adapter',
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) throw new Error(`GitHub save error: ${res.status} ${await res.text()}`);
		const result = await res.json();
		this._sha = result.content?.sha;
		return true;
	}

	/** @returns {Promise<Array<object>>} */
	async list() {
		if (this._cache) return this._cache;
		try {
			const data = await this._fetchFile('data/monitors.json');
			this._cache = Array.isArray(data) ? data : [];
		} catch {
			this._cache = [];
		}
		return this._cache;
	}

	/** @param {string} id @returns {Promise<any>} */
	async get(id) {
		const list = /** @type {Array<any>} */ (await this.list());
		return list.find((m) => m.id === id) || null;
	}

	/** @param {any} monitor @returns {Promise<any>} */
	async create(monitor) {
		const list = /** @type {Array<any>} */ (await this.list());
		const entry = {
			...monitor,
			id: monitor.id || `m-${Date.now()}`,
			history: [],
		};
		list.push(entry);
		this._cache = list;
		await this._saveFile('data/monitors.json', list, `chore(store): add monitor ${entry.name} [skip ci]`);
		return entry;
	}

	/** @param {string} id @param {object} patch @returns {Promise<any>} */
	async update(id, patch) {
		const list = /** @type {Array<any>} */ (await this.list());
		const idx = list.findIndex((m) => m.id === id);
		if (idx === -1) return null;
		list[idx] = { ...list[idx], ...patch };
		this._cache = list;
		await this._saveFile('data/monitors.json', list, `chore(store): update monitor ${id} [skip ci]`);
		return list[idx];
	}

	/** @param {string} id @returns {Promise<any>} */
	async remove(id) {
		const list = /** @type {Array<any>} */ (await this.list());
		const filtered = list.filter((m) => m.id !== id);
		this._cache = filtered;
		await this._saveFile('data/monitors.json', filtered, `chore(store): remove monitor ${id} [skip ci]`);
		return true;
	}

	/** @param {string} id @param {object} entry @returns {Promise<any>} */
	async addHistory(id, entry) {
		const list = /** @type {Array<any>} */ (await this.list());
		const item = list.find((m) => m.id === id);
		if (item) {
			item.history = (item.history || []).slice(-99);
			item.history.push(entry);
		}
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
		const list = /** @type {Array<any>} */ (await this.list());
		const up = list.filter((m) => m.status === 'up').length;
		const down = list.filter((m) => m.status === 'down').length;
		return {
			totals: { monitors: list.length, up, down, paused: 0 },
			uptime24h: 100,
			avgResponse24h: 0,
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

module.exports = { GithubAdapter };
