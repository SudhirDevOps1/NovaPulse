#!/usr/bin/env node
/* Builds the static GitHub Pages bundle into ./site.
 *
 *  - copies public/ (same HTML/CSS/JS as the Express build)
 *  - rewrites js/config.js to APP_MODE = 'static' (read-only UI, data from state.json)
 *  - copies gh-state/state.json → site/data/state.json
 *  - writes derived static APIs:
 *      site/data/analytics.json        fleet summaries for 24h/7d/30d
 *      site/data/analytics/<id>.json   per-monitor percentiles, heatmap, SLA, histogram
 *      site/data/status.json           public status-page projection
 *      site/badge/<id>.svg             embeddable status badges
 *
 * Because the mode is baked in at build time there is no runtime detection and
 * no inline script — the strict CSP still holds on Pages.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const STATE_DIR = path.join(ROOT, 'gh-state');
const SITE_DIR = path.join(ROOT, 'site');

function fail(message) {
	console.error(`\n✖ ${message}\n`);
	process.exit(1);
}

const pkg = require('../package.json');
const analytics = require('../lib/analytics');
const { badgeSvg } = require('../lib/badge');

if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
	fail('public/index.html not found');
}

function emptyState() {
	const iso = new Date().toISOString();
	return {
		generatedAt: iso,
		health: {
			ok: true,
			mode: 'static',
			version: pkg.version,
			node: process.version,
			env: 'github-pages',
			uptimeSec: 0,
			monitors: 0,
			telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
			alerts: {},
			storage: 'GitHub repository · gh-state/state.json',
			now: iso,
		},
		stats: {
			totals: { monitors: 0, up: 0, down: 0, degraded: 0, unknown: 0, paused: 0 },
			checks24h: 0,
			uptime24h: null,
			avgResponse24h: null,
			incidents24h: 0,
			lastIncident: null,
		},
		monitors: [],
		incidents: [],
		settings: { statusPage: { enabled: false, title: 'Service status', message: '' } },
	};
}

// gh-state/ is gitignored in main; CI restores it from the `state` branch.
// A first run without any state still has to produce a working dashboard.
const stateFile = path.join(STATE_DIR, 'state.json');
const firstRun = !fs.existsSync(stateFile);
const state = firstRun ? emptyState() : JSON.parse(fs.readFileSync(stateFile, 'utf8'));

// The store file keeps rollups (30-day analytics); state.json strips them.
const storeFile = path.join(STATE_DIR, 'monitors.json');
const stored = fs.existsSync(storeFile)
	? JSON.parse(fs.readFileSync(storeFile, 'utf8'))
	: { monitors: [], incidents: [], settings: null };
const storedMonitors = Array.isArray(stored.monitors) ? stored.monitors : [];
const incidents = Array.isArray(state.incidents) ? state.incidents : [];
const settings =
	state.settings || (stored.settings ? stored.settings : { statusPage: { enabled: false } });

fs.rmSync(SITE_DIR, { recursive: true, force: true });
fs.cpSync(PUBLIC_DIR, SITE_DIR, { recursive: true });

// Static build: data comes from ./data/state.json instead of /api/*.
fs.writeFileSync(
	path.join(SITE_DIR, 'js', 'config.js'),
	'export const APP_MODE = \'static\';\n',
);

fs.mkdirSync(path.join(SITE_DIR, 'data'), { recursive: true });
fs.writeFileSync(path.join(SITE_DIR, 'data', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);

// ---- derived static APIs -------------------------------------------------
const dataDir = path.join(SITE_DIR, 'data');
const analyticsDir = path.join(dataDir, 'analytics');
fs.mkdirSync(analyticsDir, { recursive: true });

const fleet = { ranges: {}, days: analytics.dayBuckets(storedMonitors, 30) };
for (const range of ['24h', '7d', '30d']) {
	fleet.ranges[range] = analytics.summary(storedMonitors, range);
}
fleet.sla = analytics.slaReport({ monitor: null, monitors: storedMonitors, incidents });
fs.writeFileSync(path.join(dataDir, 'analytics.json'), `${JSON.stringify(fleet)}\n`);

const byId = new Map(storedMonitors.map((monitor) => [monitor.id, monitor]));
for (const monitor of state.monitors || []) {
	const storedMonitor = byId.get(monitor.id) || monitor;
	const payload = { ranges: {}, histogram: null, days: null, sla: null };
	for (const range of ['24h', '7d', '30d']) {
		payload.ranges[range] = analytics.summary(storedMonitor, range);
	}
	payload.histogram = analytics.histogram(storedMonitor);
	payload.days = analytics.dayBuckets(storedMonitor, 30);
	payload.sla = analytics.slaReport({ monitor: storedMonitor, incidents });
	fs.writeFileSync(path.join(analyticsDir, `${monitor.id}.json`), `${JSON.stringify(payload)}\n`);
}

// Public status projection (+ its own data file for status.html).
const statusProjection = analytics.statusProjection({
	monitors: storedMonitors,
	incidents,
	settings,
});
fs.writeFileSync(path.join(dataDir, 'status.json'), `${JSON.stringify(statusProjection)}\n`);

// Embeddable badges: one per monitor + a fleet badge.
const badgeDir = path.join(SITE_DIR, 'badge');
fs.mkdirSync(badgeDir, { recursive: true });
const totals = (state.stats && state.stats.totals) || { up: 0, down: 0, degraded: 0 };
const fleetStatus = totals.down ? 'down' : totals.degraded ? 'degraded' : totals.up ? 'up' : 'unknown';
fs.writeFileSync(
	path.join(badgeDir, 'fleet.svg'),
	badgeSvg({ name: 'novapulse', status: fleetStatus, uptime: fleet.ranges['30d'].uptime }),
);
for (const monitor of state.monitors || []) {
	const storedMonitor = byId.get(monitor.id) || monitor;
	const buckets = analytics.dayBuckets(storedMonitor, 30);
	let checks = 0;
	let ok = 0;
	for (const bucket of buckets) {
		checks += bucket.checks;
		ok += bucket.ok;
	}
	fs.writeFileSync(
		path.join(badgeDir, `${monitor.id}.svg`),
		badgeSvg({
			name: monitor.name,
			status: monitor.enabled ? monitor.status : 'paused',
			uptime: checks ? Math.round((ok / checks) * 1000) / 10 : null,
		}),
	);
}

// Stop GitHub Pages from running Jekyll over the bundle.
fs.writeFileSync(path.join(SITE_DIR, '.nojekyll'), '');

const files = fs.readdirSync(SITE_DIR).length;
console.log(
	`✔ site/ built — ${files} entries, mode=static, v${pkg.version}, ` +
		`${state.monitors?.length ?? 0} monitor(s), ` +
		`status=${statusProjection.enabled ? 'on' : 'off'}, ` +
		`generated ${state.generatedAt ?? 'unknown'}` +
		`${firstRun ? ' (first run: empty state)' : ''}\n`,
);
