const { JsonAdapter } = require('./json');
const { D1Adapter } = require('./d1');
const { TursoAdapter } = require('./turso');
const { NeonAdapter } = require('./neon');
const { AivenAdapter } = require('./aiven');
const { GithubAdapter } = require('./github');

let activeDb = null;

function getDb(env = process.env) {
	if (activeDb) return activeDb;

	const e = /** @type {any} */ (env);
	if (e.DB && typeof e.DB.prepare === 'function') {
		activeDb = new D1Adapter(e.DB);
	} else if (e.TURSO_DATABASE_URL && e.TURSO_AUTH_TOKEN) {
		activeDb = new TursoAdapter(e.TURSO_DATABASE_URL, e.TURSO_AUTH_TOKEN);
	} else if (e.NEON_DATABASE_URL) {
		activeDb = new NeonAdapter(e.NEON_DATABASE_URL);
	} else if (e.AIVEN_DATABASE_URL) {
		activeDb = new AivenAdapter(e.AIVEN_DATABASE_URL);
	} else if (e.GITHUB_STORAGE === 'true' && e.GITHUB_TOKEN && e.GITHUB_REPOSITORY) {
		activeDb = new GithubAdapter(e.GITHUB_TOKEN, e.GITHUB_REPOSITORY);
	} else {
		activeDb = new JsonAdapter();
	}

	return activeDb;
}

module.exports = {
	getDb,
	JsonAdapter,
	D1Adapter,
	TursoAdapter,
	NeonAdapter,
	AivenAdapter,
	GithubAdapter,
};
