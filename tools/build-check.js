#!/usr/bin/env node
/* Validates the static Pages bundle produced by `npm run build`.
 *
 * `build:check` used to be a single `fs.accessSync('site/index.html')`, which
 * passed as long as the directory existed — a build that silently dropped the
 * service worker, shipped an app running in the wrong mode, or lost the CSP
 * entirely still went green. This checks the properties the deployment
 * actually depends on and exits non-zero with a named reason.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

/** Files the Pages build must ship verbatim (copied from public/). */
const REQUIRED = [
	'index.html',
	'status.html',
	'style.css',
	'sw.js',
	'favicon.svg',
	'manifest.webmanifest',
	'js/app.js',
	'js/api.js',
	'js/config.js',
	'js/maps.js',
	'js/ui.js',
	'js/views.js',
	'data/state.json',
];

const failures = [];

function check(condition, message) {
	if (!condition) failures.push(message);
}

if (!fs.existsSync(SITE)) {
	console.error(`\n✖ site/ is missing — run \`npm run build\` first.\n`);
	process.exit(1);
}

for (const file of REQUIRED) {
	check(fs.existsSync(path.join(SITE, file)), `site/${file} is missing`);
}

// The whole point of the build: the bundle must run in static (read-only)
// mode, otherwise the UI keeps POSTing to endpoints Pages cannot serve.
try {
	const config = fs.readFileSync(path.join(SITE, 'js', 'config.js'), 'utf8');
	check(
		/export const APP_MODE = 'static'/.test(config),
		`site/js/config.js does not set APP_MODE = 'static' (got: ${config.trim()})`,
	);
} catch (error) {
	failures.push(`site/js/config.js could not be read: ${error.message}`);
}

// Pages sends no CSP header, so the meta tag is the only XSS mitigation the
// static deployment has. Missing it means the bundle is the least defended
// surface in the repo while claiming the same posture as the Express build.
for (const page of ['index.html', 'status.html']) {
	try {
		const html = fs.readFileSync(path.join(SITE, page), 'utf8');
		check(
			html.includes('http-equiv="Content-Security-Policy"'),
			`site/${page} has no Content-Security-Policy meta tag`,
		);
	} catch (error) {
		failures.push(`site/${page} could not be read: ${error.message}`);
	}
}

try {
	const state = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'state.json'), 'utf8'));
	check(Array.isArray(state.monitors), 'site/data/state.json has no monitors[] array');
	check(Boolean(state.generatedAt), 'site/data/state.json has no generatedAt timestamp');
} catch (error) {
	failures.push(`site/data/state.json is not valid JSON: ${error.message}`);
}

if (failures.length) {
	console.error('\n✖ build:check failed\n');
	for (const failure of failures) console.error(`  • ${failure}`);
	console.error('');
	process.exit(1);
}

console.log(`✔ build:check — site/ is complete (${REQUIRED.length} artifacts, CSP present, static mode)`);
