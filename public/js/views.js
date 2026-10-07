import { api } from './api.js';
import { iconEl } from './icons.js';
import {
	h,
	fmt,
	toast,
	statusPill,
	dayCells,
	openModal,
	confirmDialog,
	downloadJSON,
	closeActiveOverlay,
} from './ui.js';
import {
	bucketBars,
	lineChart,
	buildBuckets,
	percentileChart,
	histogramChart,
	waterfallChart,
} from './charts.js';

const RANGE_LABELS = { '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' };

/* ---------------- shared bits ---------------- */

export function tile({ label, value, sub, tone = '', glyph = '' }) {
	return h('div', { class: `card tile ${tone}` }, [
		h('div', { class: 'tile-label' }, [glyph ? iconEl(glyph) : null, label]),
		h('div', { class: 'tile-value', text: value }),
		h('div', { class: 'tile-sub', text: sub }),
		h('div', { class: 'tile-accent' }),
	]);
}

function sectionCard({ title, hint, actions, body }) {
	return h('section', { class: 'card' }, [
		h('div', { class: 'card-head' }, [
			h('div', {}, [
				h('div', { class: 'card-title', text: title }),
				hint ? h('div', { class: 'card-hint', text: hint }) : null,
			]),
			actions || null,
		]),
		h('div', { class: 'card-body' }, [body]),
	]);
}

function emptyState({ glyph = 'inbox', title, message, action }) {
	return h('div', { class: 'empty' }, [
		h('div', { class: 'glyph' }, [iconEl(glyph, 'icon icon-lg')]),
		h('h3', { text: title }),
		h('p', { text: message }),
		action || null,
	]);
}

/* ---------------- overview ---------------- */

export function renderOverview({ stats, monitors, incidents, ctx, analytics }) {
	if (!monitors.length && stats.totals.monitors === 0) {
		return h('div', {}, [
			sectionCard({
				title: 'Welcome to Kestrel',
				hint: 'Start monitoring in under a minute',
				body: emptyState({
					glyph: 'pulse',
					title: 'No monitors yet',
					message: ctx.readOnly
						? 'Add endpoints to config/monitors.json in the repository and commit — the next check run picks them up automatically.'
						: 'Add your first endpoint — an API, a website, a health check — and Kestrel will poll it on your schedule.',
					action: ctx.readOnly
						? null
						: h('button', {
								class: 'btn btn-primary',
								text: 'Create your first monitor',
								onclick: () => ctx.openMonitorForm(),
							}),
				}),
			}),
		]);
	}

	const { totals } = stats;
	const downMonitors = monitors.filter((m) => m.status === 'down');

	const tiles = h('div', { class: 'tiles' }, [
		tile({
			label: 'Services up',
			value: `${totals.up}/${totals.monitors}`,
			sub: totals.down
				? `${totals.down} down · needs attention`
				: totals.paused
					? `${totals.paused} paused`
					: 'all systems operational',
			tone: totals.down ? 'bad' : 'good',
			glyph: 'shield',
		}),
		tile({
			label: 'Uptime · 24h',
			value: fmt.percent(stats.uptime24h),
			sub: `${fmt.int(stats.checks24h)} checks recorded`,
			tone: stats.uptime24h !== null && stats.uptime24h >= 99.5 ? 'good' : '',
			glyph: 'gauge',
		}),
		tile({
			label: 'Avg response',
			value: fmt.ms(stats.avgResponse24h),
			sub: 'across all monitors · 24h',
			glyph: 'zap',
		}),
		tile({
			label: 'Incidents · 24h',
			value: fmt.int(stats.incidents24h),
			sub: stats.lastIncident
				? `last: ${stats.lastIncident.type} · ${fmt.relative(stats.lastIncident.at)}`
				: 'no incidents recorded',
			tone: stats.incidents24h > 0 ? 'bad' : 'good',
			glyph: 'alert',
		}),
	]);

	const buckets = buildBuckets(monitors, 24);
	const chartBody = h('div', {});
	chartBody.innerHTML = bucketBars(buckets);
	const chartCard = sectionCard({
		title: 'Check outcomes',
		hint: 'last 24 hours · aggregated across every monitor',
		actions: h('div', { class: 'legend' }, [
			h('span', {}, [h('i', { class: 'legend-up' }), 'passed']),
			h('span', {}, [h('i', { class: 'legend-down' }), 'failed']),
			h('span', {}, [h('i', { class: 'legend-none' }), 'no checks']),
		]),
		body: chartBody,
	});

	const fleetRows = monitors.map((monitor) =>
		h('div', {
			class: 'list-item clickable',
			role: 'button',
			tabindex: '0',
			onclick: () => ctx.openMonitor(monitor),
			onkeydown: (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					ctx.openMonitor(monitor);
				}
			},
		}, [
			statusPill(monitor.enabled ? monitor.status : 'paused'),
			h('div', { class: 'list-main' }, [
				h('b', { text: monitor.name }),
				h('span', { text: monitor.lastCheck ? `${fmt.ms(monitor.lastCheck.ms)} · ${fmt.relative(monitor.lastCheck.at)}` : 'no checks yet' }),
			]),
			h('div', { class: 'list-end' }, [
				h('b', { text: fmt.percent(monitor.uptime24h) }),
				h('div', { text: '24h uptime' }),
			]),
		]),
	);

	const fleetCard = sectionCard({
		title: 'Fleet',
		hint: `${totals.up} up · ${totals.down} down · ${totals.paused} paused`,
		actions: h('a', { class: 'btn btn-sm', href: '#/monitors', text: 'View all' }),
		body: monitors.length
			? h('div', { class: 'list' }, fleetRows)
			: emptyState({ title: 'Nothing to show', message: 'Monitors appear here as soon as you add them.' }),
	});

	const incidentCard = sectionCard({
		title: 'Recent incidents',
		hint: 'newest first',
		actions: h('a', { class: 'btn btn-sm', href: '#/incidents', text: 'History' }),
		body: incidents.length
			? h(
					'div',
					{ class: 'list' },
					incidents.slice(0, 5).map((incident) => incidentRow(incident)),
			  )
			: emptyState({
					glyph: 'checkCircle',
					title: 'All quiet',
					message: 'No incidents recorded yet. Downtime and recoveries will show up here.',
			  }),
	});

	/* ---- advanced analytics: percentiles + SLA ---- */
	const range = ctx.state.fleetRange || '24h';
	const series = analytics?.series || [];

	const pctBody = h('div', { class: 'chart-stack' });
	if (series.length) {
		const chart = h('div', {});
		chart.innerHTML = percentileChart(series);
		pctBody.append(
			chart,
			h('div', { class: 'legend pct-legend' }, [
				h('span', {}, [h('i', { class: 'legend-p50' }), 'p50 median']),
				h('span', {}, [h('i', { class: 'legend-p95' }), 'p95']),
				h('span', {}, [h('i', { class: 'legend-p99' }), 'p99']),
			]),
		);
	} else {
		pctBody.append(
			h('p', {
				class: 'muted',
				text: `No latency data in the ${RANGE_LABELS[range]} yet — percentiles appear once checks land in this window.`,
			}),
		);
	}

	const pctHead = h('div', { class: 'stat-chips' }, [
		chip('Avg', fmt.ms(analytics?.avgMs)),
		chip('p95', fmt.ms(analytics?.p95Ms)),
		chip('p99', fmt.ms(analytics?.p99Ms)),
		chip('Checks', fmt.int(analytics?.checks)),
	]);

	const percentileCard = sectionCard({
		title: 'Latency percentiles',
		hint: `${RANGE_LABELS[range]} · hourly buckets`,
		actions: segmented(
			[
				['24h', '24h'],
				['7d', '7d'],
				['30d', '30d'],
			],
			range,
			(value) => ctx.setFleetRange(value),
		),
		body: h('div', {}, [pctHead, pctBody]),
	});

	const sla = analytics?.sla;
	const budgetValue = sla && sla.errorBudgetPct !== null ? sla.errorBudgetPct : 0;
	const slaCard = sectionCard({
		title: 'SLA · 30 days',
		hint: sla ? `${sla.uptime === null ? 'no data' : fmt.percent(sla.uptime)} uptime vs ${sla.target}% target` : 'target 99.9%',
		body: h('div', { class: 'sla-body' }, [
			h('div', { class: 'kv' }, [
				cell('Uptime', fmt.percent(sla?.uptime)),
				cell('Error budget left', sla?.errorBudgetPct === null || sla?.errorBudgetPct === undefined ? '—' : `${sla.errorBudgetPct}%`),
				cell('Incidents', fmt.int(sla?.incidents ?? 0)),
				cell('MTTR', sla?.mttrMinutes === null || sla?.mttrMinutes === undefined ? '—' : `${sla.mttrMinutes} min`),
			]),
			h('div', { class: 'budget' }, [
				h('progress', { class: 'budget-bar', max: '100', value: String(Math.round(budgetValue)) }),
				h('span', {
					class: `budget-label ${sla?.met ? 'is-good' : sla && sla.met === false ? 'is-bad' : ''}`,
					text: sla?.met === false ? 'below target' : sla ? 'on target' : 'no data yet',
				}),
			]),
			analytics?.days?.length ? dayCells(analytics.days, { label: 'Fleet uptime, last 30 days' }) : null,
		]),
	});

	return h('div', {}, [
		downMonitors.length
			? h('div', { class: 'banner error', role: 'alert' }, [
					iconEl('alert'),
					h('div', {}, [
						h('b', { text: `${downMonitors.length} monitor(s) down: ` }),
						downMonitors.map((m) => m.name).join(', '),
					]),
					h('button', {
						class: 'btn btn-sm btn-danger',
						text: 'Open',
						onclick: () => ctx.openMonitor(downMonitors[0]),
					}),
			  ])
			: null,
		tiles,
		chartCard,
		h('div', { class: 'grid-2' }, [percentileCard, slaCard]),
		h('div', { class: 'grid-2' }, [fleetCard, incidentCard]),
	]);
}

function chip(label, value) {
	return h('span', { class: 'chip stat-chip' }, [h('span', { class: 'chip-label', text: label }), h('b', { text: value })]);
}

function incidentRow(incident, { withName = true } = {}) {
	return h('div', { class: 'list-item' }, [
		h('span', {
			class: `status status-${incident.type === 'down' ? 'down' : 'up'}`,
		}, [h('i', { class: 'dot' }), incident.type === 'down' ? 'down' : 'recovered']),
		h('div', { class: 'list-main' }, [
			h('b', { text: withName ? incident.name : incident.reason || '—' }),
			h('span', { text: withName ? incident.reason || '' : incident.name }),
		]),
		h('div', { class: 'list-end' }, [
			h('div', { text: fmt.relative(incident.at) }),
			h('div', { text: fmt.time(incident.at) }),
		]),
	]);
}

/* ---------------- incidents ---------------- */

export function renderIncidents({ incidents, ctx }) {
	const filter = ctx.state.incidentFilter || 'all';
	const filtered = filter === 'all' ? incidents : incidents.filter((i) => i.type === filter);

	const chips = h(
		'div',
		{ class: 'toolbar', role: 'group', 'aria-label': 'Filter incidents' },
		[
			['all', 'All', incidents.length],
			['down', 'Downtime', incidents.filter((i) => i.type === 'down').length],
			['up', 'Recoveries', incidents.filter((i) => i.type === 'up').length],
		].map(([value, label, count]) =>
			h('button', {
				class: 'chip',
				'aria-pressed': String(filter === value),
				text: `${label} (${count})`,
				onclick: () => {
					ctx.setIncidentFilter(value);
				},
			}),
		),
	);

	if (!filtered.length) {
		return h('div', {}, [
			chips,
			sectionCard({
				title: 'Incident history',
				hint: 'downtime and recoveries, newest first',
				body: emptyState({
					glyph: 'checkCircle',
					title: incidents.length ? 'Nothing matches this filter' : 'No incidents yet',
					message: incidents.length
						? 'Switch the filter to see other events.'
						: 'When a monitor fails you will see the event, cause and duration here.',
				}),
			}),
		]);
	}

	// group by calendar day
	const groups = new Map();
	for (const incident of filtered) {
		const key = fmt.dayLabel(incident.at);
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(incident);
	}

	// Header lives inside the card so it reads as one panel at every width.
	const list = h('div', { class: 'card' }, [
		h('div', { class: 'card-head' }, [
			h('div', {}, [
				h('div', { class: 'card-title', text: 'Incident history' }),
				h('div', { class: 'card-hint', text: 'downtime and recoveries, newest first' }),
			]),
		]),
	]);
	for (const [day, items] of groups) {
		list.append(h('div', { class: 'timeline-day', text: `${day} · ${items.length}` }));
		for (const incident of items) list.append(incidentRow(incident));
	}

	return h('div', {}, [chips, list]);
}

/* ---------------- monitor detail drawer ---------------- */

/* Drawer analytics survive rebuilds (poll/refetch) within a session. */
let drawerRange = '24h';

function timingLegend(timing) {
	if (!timing) return null;
	const phases = [
		['dns', 'DNS'],
		['connect', 'Connect'],
		['tls', 'TLS'],
		['ttfb', 'Wait'],
		['download', 'Download'],
	];
	const present = phases.filter(([key]) => Number.isFinite(timing[key]));
	if (!present.length) return null;
	return h(
		'div',
		{ class: 'wf-legend' },
		present.map(([key, label]) =>
			h('span', { class: 'wf-chip' }, [h('i', { class: `wf-dot wf-dot-${key}` }), `${label} ${timing[key]} ms`]),
		),
	);
}

function analyticsPayloadSection(monitor, data, ctx, onRange) {
	const series = data.series || [];
	const chartBox = h('div', {});
	if (series.length) chartBox.innerHTML = percentileChart(series);
	else
		chartBox.append(
			h('p', {
				class: 'muted',
				text: `No checks in the ${RANGE_LABELS[drawerRange]} yet — percentiles appear after the first ones land.`,
			}),
		);

	const histBox = h('div', {});
	if (data.histogram) {
		histBox.innerHTML = histogramChart(data.histogram);
	} else {
		histBox.append(h('p', { class: 'muted', text: 'Not enough recent checks for a distribution yet.' }));
	}

	const sla = data.sla;
	const budgetValue = sla && sla.errorBudgetPct !== null ? sla.errorBudgetPct : 0;

	return [
		h('div', { class: 'drawer-section' }, [
			h('div', { class: 'drawer-section-head' }, [
				h('h3', { text: 'Latency percentiles' }),
				segmented(
					[
						['24h', '24h'],
						['7d', '7d'],
						['30d', '30d'],
					],
					drawerRange,
					onRange,
				),
			]),
			h('div', { class: 'stat-chips' }, [
				chip('Uptime', fmt.percent(data.uptime)),
				chip('Avg', fmt.ms(data.avgMs)),
				chip('p95', fmt.ms(data.p95Ms)),
				chip('p99', fmt.ms(data.p99Ms)),
				chip('Checks', fmt.int(data.checks)),
			]),
			chartBox,
			h('div', { class: 'legend pct-legend' }, [
				h('span', {}, [h('i', { class: 'legend-p50' }), 'p50 median']),
				h('span', {}, [h('i', { class: 'legend-p95' }), 'p95']),
				h('span', {}, [h('i', { class: 'legend-p99' }), 'p99']),
			]),
		]),
		h('div', { class: 'drawer-section' }, [
			h('div', { class: 'drawer-section-head' }, [
				h('h3', { text: 'Uptime · 30 days' }),
				h('span', { class: 'muted', text: sla ? `${sla.target}% target` : '' }),
			]),
			data.days?.length ? dayCells(data.days, { label: `${monitor.name} uptime, last 30 days` }) : null,
			h('div', { class: 'kv' }, [
				cell('Uptime', fmt.percent(sla?.uptime)),
				cell('Incidents', fmt.int(sla?.incidents ?? 0)),
				cell('MTTR', sla?.mttrMinutes === null || sla?.mttrMinutes === undefined ? '—' : `${sla.mttrMinutes} min`),
				cell('Budget left', sla?.errorBudgetPct === null || sla?.errorBudgetPct === undefined ? '—' : `${sla.errorBudgetPct}%`),
			]),
			h('div', { class: 'budget' }, [
				h('progress', { class: 'budget-bar', max: '100', value: String(Math.round(budgetValue)) }),
				h('span', {
					class: `budget-label ${sla?.met ? 'is-good' : sla && sla.met === false ? 'is-bad' : ''}`,
					text: sla?.met === false ? 'below target' : sla ? 'on target' : 'no data yet',
				}),
			]),
		]),
		h('div', { class: 'drawer-section' }, [
			h('h3', { text: 'Response distribution' }),
			histBox,
			h('p', {
				class: 'hint',
				text: 'Buckets of the most recent checks — flat means consistent, a long tail means jitter.',
			}),
		]),
	];
}

function loadMonitorAnalytics(monitor, mount, ctx) {
	const render = () => {
		mount.dataset.monitor = monitor.id;
		mount.replaceChildren(
			h('div', { class: 'analytics-loading' }, [
				h('div', { class: 'skeleton skeleton-block' }),
				h('div', { class: 'skeleton skeleton-block short' }),
			]),
		);
		api
			.monitorAnalytics(monitor.id, drawerRange)
			.then((data) => {
				if (mount.dataset.monitor !== monitor.id) return; // drawer moved on
				mount.replaceChildren(
					...analyticsPayloadSection(monitor, data, ctx, (value) => {
						drawerRange = value;
						loadMonitorAnalytics(monitor, mount, ctx);
					}),
				);
			})
			.catch((error) => {
				if (mount.dataset.monitor !== monitor.id) return;
				mount.replaceChildren(
					h('p', { class: 'muted', text: `Analytics unavailable — ${error.message}` }),
				);
			});
	};
	render();
}

export function buildMonitorBody(monitor, ctx) {
	const history = monitor.history || [];
	const last = monitor.lastCheck;
	const isHttps = /^https:/i.test(monitor.url);

	const stats = h('div', { class: 'kv' }, [
		cell('Status', monitor.enabled ? monitor.status : 'paused'),
		cell('Uptime · 24h', fmt.percent(monitor.uptime24h)),
		cell('Last response', fmt.ms(last?.ms)),
		cell('Last check', last ? fmt.relative(last.at) : 'never'),
		cell('Interval', `${monitor.intervalSec}s`),
		cell('Timeout', `${monitor.timeoutMs} ms`),
		cell('Check type', monitor.type === 'tcp' ? 'TCP port' : isHttps ? 'HTTPS' : 'HTTP'),
		monitor.type !== 'tcp' && Number.isFinite(last?.bytes)
			? cell('Response size', last.bytes >= 1024 ? `${(last.bytes / 1024).toFixed(1)} KB` : `${last.bytes} B`)
			: null,
		monitor.ssl
			? cell('Certificate', `${monitor.ssl.daysLeft} day(s) left`)
			: isHttps
				? cell('Certificate', 'not tracked yet')
				: null,
	]);

	const tagRow = monitor.tags?.length
		? h('div', { class: 'tag-row' }, monitor.tags.map((tag) => h('span', { class: 'chip', text: tag })))
		: null;

	const analyticsMount = h('div', { class: 'analytics-mount' });
	loadMonitorAnalytics(monitor, analyticsMount, ctx);

	const waterfall = last?.timing ? waterfallChart(last.timing) : '';
	const waterfallSection = waterfall
		? h('div', { class: 'drawer-section' }, [
				h('div', { class: 'drawer-section-head' }, [
					h('h3', { text: 'Last check breakdown' }),
					h('span', { class: 'muted', text: fmt.ms(last.ms) }),
				]),
				h('div', { html: waterfall }),
				timingLegend(last.timing),
				last.redirects ? h('p', { class: 'hint', text: `${last.redirects} redirect(s) followed.` }) : null,
		  ])
		: null;

	const chartWrap = h('div', {});
	chartWrap.innerHTML = lineChart(history);

	const recent = history.slice(-12).reverse();

	const checksList = h(
		'div',
		{ class: 'list' },
		recent.length
			? recent.map((entry) =>
					h('div', { class: 'list-item' }, [
						h('span', { class: `status status-${entry.ok ? (entry.degraded ? 'degraded' : 'up') : 'down'}` }, [
							h('i', { class: 'dot' }),
							entry.ok ? (entry.degraded ? 'slow' : 'ok') : 'fail',
						]),
						h('div', { class: 'list-main' }, [
							h('b', {
								text: entry.ok
									? `${entry.status || (monitor.type === 'tcp' ? 'open' : 200)} · ${fmt.ms(entry.ms)}`
									: 'check failed',
							}),
							h('span', { text: fmt.time(entry.at) }),
						]),
						h('div', { class: 'list-end', text: fmt.relative(entry.at) }),
					]),
			  )
			: [h('p', { class: 'muted', text: 'No checks recorded yet.' })],
	);

	const sslWarn =
		monitor.ssl && monitor.ssl.daysLeft <= 14
			? h('div', { class: 'banner warn', role: 'status' }, [
					iconEl('alert'),
					h('span', { text: `TLS certificate expires in ${monitor.ssl.daysLeft} day(s) — ${monitor.ssl.validTo}` }),
			  ])
			: null;

	// NB: never reuse the id="drawer-root" class here — that class is the
	// fixed full-screen overlay container (position:fixed; inset:0).
	return h('div', { class: 'monitor-detail' }, [
		h('button', { class: 'btn btn-sm drawer-back', type: 'button', onclick: () => {
				closeActiveOverlay();
				if (location.hash !== '#/monitors') location.hash = '#/monitors';
			} }, [
			h('span', { class: 'drawer-back-arrow', text: '←' }),
			h('span', { text: 'Back to monitors' }),
		]),
		monitor.lastCheck?.error && monitor.status === 'down'
			? h('div', { class: 'banner error', role: 'alert' }, [
					iconEl('alert'),
					h('span', { text: monitor.lastCheck.error }),
			  ])
			: null,
		monitor.status === 'degraded'
			? h('div', { class: 'banner warn', role: 'status' }, [
					iconEl('clock'),
					h('span', {
						text: `Responding slowly: ${fmt.ms(last?.ms)} (threshold ${monitor.warnMs} ms)`,
					}),
			  ])
			: null,
		sslWarn,
		h('div', { class: 'drawer-section' }, [
			h('h3', { text: 'Key metrics' }),
			stats,
			tagRow,
		]),
		analyticsMount,
		waterfallSection,
		h('div', { class: 'drawer-section' }, [
			h('h3', { text: 'Response time' }),
			h('p', { class: 'hint', text: 'Raw checks kept locally — last 500.' }),
			h('div', {}, [chartWrap.firstChild || chartWrap]),
		]),
		h('div', { class: 'drawer-section' }, [
			h('h3', { text: 'Recent checks' }),
			checksList,
		]),
	]);
}

function cell(label, value) {
	return h('div', { class: 'cell' }, [h('span', { text: label }), h('b', { text: value })]);
}

/* ---------------- monitor form ---------------- */

export function openMonitorForm({ monitor, onSubmit }) {
	const editing = Boolean(monitor);
	const inferredType =
		monitor?.type === 'tcp' || /^tcp:\/\//i.test(monitor?.url || '') ? 'tcp' : 'http';
	const headersText = (monitor?.headers && typeof monitor.headers === 'object'
		? Object.entries(monitor.headers)
		: []
	)
		.map(([key, value]) => `${key}: ${value}`)
		.join('\n');

	const nameInput = input('text', 'Name', monitor?.name || '', 'My API');
	const urlInput = input('url', 'URL', monitor?.url || '', 'https://example.com/health');
	const intervalInput = input('number', 'Interval (sec)', monitor?.intervalSec || 60, '60');
	const timeoutInput = input('number', 'Timeout (ms)', monitor?.timeoutMs || 10000, '10000');

	const typeSelect = h(
		'select',
		{ class: 'select', name: 'type' },
		[
			h('option', { value: 'http', text: 'HTTP(S) request' }),
			h('option', { value: 'tcp', text: 'TCP port' }),
		],
	);
	typeSelect.value = inferredType;

	const methodSelect = h(
		'select',
		{ class: 'select', name: 'method' },
		['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => h('option', { value: m, text: m })),
	);
	methodSelect.value = monitor?.method || 'GET';

	const statusInput = input('text', 'Expected status', monitor?.expectedStatus || '', '200-299');
	const keywordInput = input('text', 'Keyword', monitor?.expectedKeyword || '', 'healthy');
	const warnInput = input('number', 'Warn after (ms)', monitor?.warnMs || 0, '0');
	const failuresInput = input('number', 'Failures before down', monitor?.failuresBeforeDown || 1, '1');
	const tagsInput = input('text', 'Tags', (monitor?.tags || []).join(', '), 'prod, api');
	const sslInput = h('input', {
		type: 'checkbox',
		name: 'checkssl',
		checked: monitor?.checkSsl !== false,
	});
	const headersArea = h('textarea', {
		class: 'input textarea',
		name: 'headers',
		rows: '3',
		placeholder: 'Authorization: Bearer token\nX-Environment: prod',
		text: headersText,
	});
	const bodyArea = h('textarea', {
		class: 'input textarea',
		name: 'body',
		rows: '3',
		placeholder: '{"probe": true}',
		text: monitor?.body || '',
	});

	intervalInput.min = '10';
	intervalInput.max = '86400';
	timeoutInput.min = '500';
	timeoutInput.max = '60000';
	warnInput.min = '0';
	warnInput.max = '60000';
	failuresInput.min = '1';
	failuresInput.max = '10';

	const nameError = h('p', { class: 'field-error' });
	const urlError = h('p', { class: 'field-error' });
	const intervalError = h('p', { class: 'field-error' });
	const timeoutError = h('p', { class: 'field-error' });
	const statusError = h('p', { class: 'field-error' });
	const headersError = h('p', { class: 'field-error' });
	const allErrors = [nameError, urlError, intervalError, timeoutError, statusError, headersError];

	typeSelect.addEventListener('change', () => {
		urlInput.value = '';
		urlInput.placeholder = typeSelect.value === 'tcp' ? 'tcp://db.internal:5432' : 'https://example.com/health';
		urlError.textContent = '';
	});

	const form = h('form', { class: 'form-grid', novalidate: true }, [
		h('label', { class: 'field span-2' }, [h('span', { text: 'Name' }), nameInput, nameError]),
		h('label', { class: 'field' }, [h('span', { text: 'Check type' }), typeSelect]),
		h('label', { class: 'field' }, [h('span', { text: 'Method' }), methodSelect]),
		h('label', { class: 'field span-2' }, [
			h('span', { text: typeSelect.value === 'tcp' ? 'Target' : 'URL' }),
			urlInput,
			h('span', {
				class: 'hint',
				text:
					typeSelect.value === 'tcp'
						? 'host:port — the check passes when the port accepts a connection.'
						: 'Full URL including https:// — http and https are supported.',
			}),
			urlError,
		]),
		h('label', { class: 'field' }, [h('span', { text: 'Interval (sec)' }), intervalInput, intervalError]),
		h('label', { class: 'field' }, [h('span', { text: 'Timeout (ms)' }), timeoutInput, timeoutError]),
		h('details', { class: 'advanced span-2' }, [
			h('summary', { text: 'Advanced checks' }),
			h('div', { class: 'form-grid advanced-grid' }, [
				h('label', { class: 'field' }, [
					h('span', { text: 'Expected status' }),
					statusInput,
					h('span', { class: 'hint', text: 'Default 200-399. Try 200-299 or 200,204,304.' }),
					statusError,
				]),
				h('label', { class: 'field' }, [
					h('span', { text: 'Keyword in body' }),
					keywordInput,
					h('span', { class: 'hint', text: 'Fails when the response body does not contain it.' }),
				]),
				h('label', { class: 'field' }, [
					h('span', { text: 'Warn threshold (ms)' }),
					warnInput,
					h('span', { class: 'hint', text: '0 = off. Above this the monitor shows as degraded.' }),
				]),
				h('label', { class: 'field' }, [
					h('span', { text: 'Failures before down' }),
					failuresInput,
					h('span', { class: 'hint', text: 'Grace period — 1 means instant outage.' }),
				]),
				h('label', { class: 'field span-2' }, [
					h('span', { text: 'Tags' }),
					tagsInput,
					h('span', { class: 'hint', text: 'Comma separated — used for grouping and search.' }),
				]),
				h('label', { class: 'field span-2' }, [
					h('span', { text: 'Custom headers' }),
					headersArea,
					h('span', { class: 'hint', text: 'One "Name: value" per line, up to 10 headers.' }),
					headersError,
				]),
				h('label', { class: 'field span-2' }, [
					h('span', { text: 'Request body' }),
					bodyArea,
					h('span', { class: 'hint', text: 'Sent with POST/PUT/PATCH/DELETE (max 4 KB).' }),
				]),
				h('label', { class: 'field checkbox-field' }, [
					h('span', { text: 'TLS certificate watch' }),
					h('label', { class: 'checkbox-row' }, [
						sslInput,
						h('span', { text: 'Track certificate expiry and alert 14 days out (https only).' }),
					]),
				]),
			]),
		]),
	]);

	const cancelBtn = h('button', { class: 'btn', type: 'button', text: 'Cancel' });
	const saveBtn = h('button', {
		class: 'btn btn-primary',
		type: 'submit',
		text: editing ? 'Save changes' : 'Create monitor',
	});

	const modal = openModal({
		title: editing ? 'Edit monitor' : 'New monitor',
		body: form,
		footer: [cancelBtn, saveBtn],
	});
	cancelBtn.addEventListener('click', modal.close);

	function parseHeaders(text) {
		const headers = {};
		const lines = String(text || '')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		for (const line of lines) {
			const idx = line.indexOf(':');
			if (idx <= 0) return { error: `Not a "Name: value" line: ${line.slice(0, 40)}` };
			const key = line.slice(0, idx).trim();
			const value = line.slice(idx + 1).trim();
			if (!key || !value) return { error: `Not a "Name: value" line: ${line.slice(0, 40)}` };
			if (Object.keys(headers).length >= 10) return { error: 'At most 10 headers.' };
			headers[key] = value;
		}
		return { headers };
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		allErrors.forEach((el) => (el.textContent = ''));
		[nameInput, urlInput, intervalInput, timeoutInput, statusInput, headersArea].forEach((el) =>
			el.removeAttribute('aria-invalid'),
		);

		const type = typeSelect.value;
		const payload = {
			name: nameInput.value.trim(),
			url: urlInput.value.trim(),
			type,
			method: methodSelect.value,
			intervalSec: Number(intervalInput.value),
			timeoutMs: Number(timeoutInput.value),
			expectedStatus: statusInput.value.trim(),
			expectedKeyword: keywordInput.value.trim(),
			warnMs: Number(warnInput.value) || 0,
			failuresBeforeDown: Number(failuresInput.value) || 1,
			tags: tagsInput.value
				.split(',')
				.map((tag) => tag.trim())
				.filter(Boolean),
			checkSsl: sslInput.checked,
			body: bodyArea.value.trim(),
		};
		if (payload.method === 'GET' || payload.method === 'HEAD') delete payload.body;

		let valid = true;
		if (!payload.name) {
			nameError.textContent = 'Name is required';
			nameInput.setAttribute('aria-invalid', 'true');
			valid = false;
		}
		if (!payload.url) {
			urlError.textContent = type === 'tcp' ? 'Target is required' : 'URL is required';
			urlInput.setAttribute('aria-invalid', 'true');
			valid = false;
		} else if (type === 'tcp') {
			const target = payload.url.replace(/^tcp:\/\//i, '');
			if (!/^[^\s:]+:\d{1,5}$/.test(target) || Number(target.split(':')[1]) > 65535) {
				urlError.textContent = 'Enter host:port, e.g. tcp://db.internal:5432';
				urlInput.setAttribute('aria-invalid', 'true');
				valid = false;
			}
		} else {
			try {
				const parsed = new URL(payload.url);
				if (!/^https?:$/.test(parsed.protocol)) throw new Error();
			} catch {
				urlError.textContent = 'Enter a valid http(s) URL, e.g. https://example.com';
				urlInput.setAttribute('aria-invalid', 'true');
				valid = false;
			}
		}
		if (!Number.isFinite(payload.intervalSec) || payload.intervalSec < 10 || payload.intervalSec > 86400) {
			intervalError.textContent = '10 – 86400';
			intervalInput.setAttribute('aria-invalid', 'true');
			valid = false;
		}
		if (!Number.isFinite(payload.timeoutMs) || payload.timeoutMs < 500 || payload.timeoutMs > 60000) {
			timeoutError.textContent = '500 – 60000';
			timeoutInput.setAttribute('aria-invalid', 'true');
			valid = false;
		}
		if (payload.expectedStatus && !/^(\d{3}|\d{3}-\d{3})(\s*,\s*(\d{3}|\d{3}-\d{3}))*$/.test(payload.expectedStatus)) {
			statusError.textContent = 'Use 200-299, or comma lists like 200,204,304';
			statusInput.setAttribute('aria-invalid', 'true');
			valid = false;
		}
		const parsedHeaders = parseHeaders(headersArea.value);
		if (parsedHeaders.error) {
			headersError.textContent = parsedHeaders.error;
			headersArea.setAttribute('aria-invalid', 'true');
			valid = false;
		} else {
			payload.headers = parsedHeaders.headers;
		}
		if (!valid) return;

		saveBtn.disabled = true;
		saveBtn.textContent = 'Saving…';
		try {
			await onSubmit(payload, monitor);
			modal.close();
		} catch (error) {
			toast('Could not save monitor', { type: 'error', description: error.message });
			saveBtn.disabled = false;
			saveBtn.textContent = editing ? 'Save changes' : 'Create monitor';
		}
	});
}

function input(type, label, value, placeholder) {
	return h('input', {
		class: 'input',
		type,
		name: label.toLowerCase(),
		value: String(value ?? ''),
		placeholder,
		autocomplete: 'off',
		spellcheck: 'false',
	});
}

/* ---------------- settings ---------------- */

export function renderSettings({ state, ctx, health }) {
	const appearanceCard = sectionCard({
		title: 'Appearance',
		hint: 'stored in your browser',
		body: h('div', {}, [
			h('div', { class: 'setting-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Theme' }),
					h('span', { text: 'Dark is default; system follows your OS.' }),
				]),
				segmented(
					[
						['dark', 'Dark'],
						['light', 'Light'],
						['system', 'System'],
					],
					state.themeMode,
					(value) => ctx.setTheme(value),
				),
			]),
			h('div', { class: 'setting-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Auto refresh' }),
					h('span', { text: 'How often the dashboard polls for new results.' }),
				]),
				segmented(
					[
						[5000, '5s'],
						[10000, '10s'],
						[30000, '30s'],
						[0, 'Off'],
					],
					state.pollMs,
					(value) => ctx.setPoll(value),
				),
			]),
		]),
	});

	const channelRows = [
		['telegram', 'Telegram bot', 'TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID'],
		['discord', 'Discord webhook', 'DISCORD_WEBHOOK_URL'],
		['ntfy', 'ntfy.sh push (phones)', 'NTFY_URL (+ NTFY_TOKEN)'],
		['webhook', 'Generic JSON webhook', 'WEBHOOK_URL (+ WEBHOOK_SECRET)'],
	];
	const alerts = health?.alerts || { telegram: Boolean(health?.telegram) };

	const alertsCard = sectionCard({
		title: 'Alert channels',
		hint: 'every configured channel receives down, recovery, SSL and (optional) slow-response alerts',
		body: h('div', {}, [
			...channelRows.map(([key, label, env]) =>
				h('div', { class: 'setting-row' }, [
					h('div', { class: 'setting-text' }, [
						h('b', { text: label }),
						h('span', {
							text: alerts[key]
								? 'Configured and enabled on this instance.'
								: `Not configured — set ${env}${ctx.readOnly ? ' as repository secrets' : ' on the server'}.`,
						}),
					]),
					h('span', { class: `status status-${alerts[key] ? 'up' : 'unknown'}` }, [
						h('i', { class: 'dot' }),
						alerts[key] ? 'enabled' : 'disabled',
					]),
				]),
			),
			h('div', { class: 'setting-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Outage grace period' }),
					h('span', {
						text: 'Each monitor decides how many consecutive failures before it counts as down (default 1) — one alert per incident.',
					}),
				]),
			]),
			h('div', { class: 'setting-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Slow-response alerts' }),
					h('span', { text: 'Set ALERT_ON_DEGRADED=1 to also alert when a check passes its warn threshold.' }),
				]),
			]),
			h('div', { class: 'setting-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Certificate expiry' }),
					h('span', { text: 'One reminder a day once an HTTPS cert is inside SSL_WARN_DAYS (default 14).' }),
				]),
			]),
		]),
	});

	const dataCard = sectionCard({
		title: 'Data',
		hint: ctx.readOnly
			? 'monitors live in the repository; check results are committed as JSON'
			: 'everything lives in a single JSON file on the server',
		body: h('div', {}, [
			h('div', { class: 'setting-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Export backup' }),
					h('span', { text: 'Download all monitors, history and incidents.' }),
				]),
				h('button', {
					class: 'btn btn-sm',
					text: 'Export',
					onclick: async () => {
						try {
							const data = await api.exportData();
							downloadJSON(`kestrel-${new Date().toISOString().slice(0, 10)}.json`, data);
							toast('Backup downloaded', { type: 'success' });
						} catch (error) {
							toast('Export failed', { type: 'error', description: error.message });
						}
					},
				}),
			]),
			ctx.readOnly ? null : importRow(ctx),
			ctx.readOnly
				? null
				: h('div', { class: 'setting-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Reset' }),
					h('span', { text: 'Delete every monitor and its history.' }),
				]),
				h('button', {
					class: 'btn btn-sm btn-danger',
					text: 'Delete all',
					onclick: async () => {
						const ok = await confirmDialog({
							title: 'Delete all monitors?',
							message:
								'This removes every monitor, its check history and the incident log. This cannot be undone.',
							confirmLabel: 'Delete everything',
						});
						if (!ok) return;
						try {
							for (const m of state.monitors) await api.deleteMonitor(m.id);
							toast('All monitors deleted', { type: 'success' });
							ctx.refresh({ silent: true });
						} catch (error) {
							toast('Reset failed', { type: 'error', description: error.message });
						}
					},
				}),
			]),
		]),
	});

	/* ---- public status page ---- */
	const pageSettings = state.settings?.statusPage || {
		enabled: false,
		title: 'Service status',
		message: '',
	};
	const statusUrl = api.statusPageUrl();
	const statusHref = new URL(statusUrl, location.href).href;
	const badgeHref = new URL(api.badgeUrl('fleet'), location.href).href;
	const badgeMarkdown = `![Kestrel status](${badgeHref})`;

	const copyRow = (label, text, buttonLabel) =>
		h('div', { class: 'setting-row' }, [
			h('div', { class: 'setting-text' }, [
				h('b', { text: label }),
				h('code', { class: 'copy-text', text }),
			]),
			h('button', {
				class: 'btn btn-sm',
				text: buttonLabel,
				onclick: async () => {
					try {
						await navigator.clipboard.writeText(text);
						toast(`${label} copied`, { type: 'success' });
					} catch {
						toast('Clipboard unavailable — select the text and copy it', { type: 'error' });
					}
				},
			}),
		]);

	const statusPageCard = sectionCard({
		title: 'Status page',
		hint: ctx.readOnly
			? 'public uptime page for your visitors — enabled from config/monitors.json'
			: 'shareable uptime page for your visitors — no login required',
		body: h('div', {}, [
			ctx.readOnly
				? h('div', { class: 'setting-row' }, [
						h('div', { class: 'setting-text' }, [
							h('b', { text: pageSettings.enabled ? 'Enabled' : 'Disabled' }),
							h('span', {
								text: pageSettings.enabled
									? `Titled "${pageSettings.title}" — flip it in config/monitors.json (statusPage.enabled).`
									: 'Add a statusPage block to config/monitors.json to turn it on.',
							}),
						]),
						h('span', {
							class: `status status-${pageSettings.enabled ? 'up' : 'unknown'}`,
						}, [h('i', { class: 'dot' }), pageSettings.enabled ? 'live' : 'off']),
				  ])
				: (() => {
						const enableInput = h('input', { type: 'checkbox', checked: pageSettings.enabled });
						const titleInput = input('text', 'statuspage-title', pageSettings.title, 'Service status');
						const messageInput = input('text', 'statuspage-message', pageSettings.message, 'Optional note for visitors');
						const saveBtn = h('button', { class: 'btn btn-sm btn-primary', text: 'Save status page' });
						saveBtn.addEventListener('click', async () => {
							saveBtn.disabled = true;
							try {
								await ctx.saveStatusPage({
									enabled: enableInput.checked,
									title: titleInput.value.trim().slice(0, 80),
									message: messageInput.value.trim().slice(0, 300),
								});
								toast('Status page updated', { type: 'success' });
							} catch (error) {
								toast('Could not save', { type: 'error', description: error.message });
							} finally {
								saveBtn.disabled = false;
							}
						});
						return h('div', { class: 'status-page-form' }, [
							h('label', { class: 'checkbox-row' }, [
								enableInput,
								h('span', { text: 'Publish the status page' }),
							]),
							h('label', { class: 'field' }, [h('span', { text: 'Page title' }), titleInput]),
							h('label', { class: 'field' }, [h('span', { text: 'Visitor message' }), messageInput]),
							h('div', { class: 'foot-row' }, [saveBtn]),
						]);
				  })(),
			h('div', { class: 'setting-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Public URL' }),
					h('a', { href: statusHref, target: '_blank', rel: 'noopener', text: statusHref }),
				]),
				h('a', { class: 'btn btn-sm', href: statusHref, target: '_blank', rel: 'noopener', text: 'Open' }),
			]),
			copyRow('Badge markdown', badgeMarkdown, 'Copy'),
			h('div', { class: 'setting-row badge-row' }, [
				h('div', { class: 'setting-text' }, [
					h('b', { text: 'Badge preview' }),
					h('span', { text: 'Embed in your README — updates every deploy / check cycle.' }),
				]),
				h('img', { class: 'badge-preview', src: badgeHref, alt: 'Fleet uptime badge', width: '150', height: '20' }),
			]),
		]),
	});

	const aboutCard = sectionCard({
		title: 'About',
		hint: health?.mode === 'static' ? 'this build' : 'this instance',
		body: h('div', { class: 'list' }, [
			infoRow('Version', health?.version ? `v${health.version}` : '—'),
			infoRow('Runtime', health?.node || '—'),
			infoRow('Environment', health?.env || '—'),
			health?.mode === 'static'
				? infoRow('Last refresh', health?.now ? fmt.relative(health.now) : '—')
				: infoRow('Server uptime', health ? fmt.duration(health.uptimeSec * 1000) : '—'),
			infoRow('Storage', health?.storage || 'data/monitors.json'),
		]),
	});

	return h('div', { class: 'settings-grid' }, [
		appearanceCard,
		statusPageCard,
		alertsCard,
		dataCard,
		aboutCard,
	]);
}

function infoRow(label, value) {
	return h('div', { class: 'list-item' }, [
		h('div', { class: 'list-main' }, [h('b', { text: label })]),
		h('div', { class: 'list-end', text: value }),
	]);
}

function importRow(ctx) {
	const fileInput = h('input', { class: 'visually-hidden', type: 'file', accept: 'application/json' });
	const modeSelect = h('select', { class: 'select' }, [
		h('option', { value: 'merge', text: 'Merge into existing' }),
		h('option', { value: 'replace', text: 'Replace everything' }),
	]);

	fileInput.addEventListener('change', async () => {
		const file = fileInput.files?.[0];
		if (!file) return;
		try {
			const payload = JSON.parse(await file.text());
			const result = await api.importData(payload, modeSelect.value);
			toast('Backup imported', {
				type: 'success',
				description: `${result.imported} monitor(s) · ${result.total} total`,
			});
			ctx.refresh({ silent: true });
		} catch (error) {
			toast('Import failed', { type: 'error', description: error.message });
		} finally {
			fileInput.value = '';
		}
	});

	return h('div', { class: 'setting-row' }, [
		h('div', { class: 'setting-text' }, [
			h('b', { text: 'Import backup' }),
			h('span', { text: 'Restore from a previously exported JSON file.' }),
		]),
		h('div', { class: 'foot-row' }, [
			modeSelect,
			h('button', {
				class: 'btn btn-sm',
				text: 'Choose file',
				onclick: () => fileInput.click(),
			}),
			fileInput,
		]),
	]);
}

function segmented(options, current, onChange) {
	const wrap = h('div', { class: 'seg', role: 'group' });
	const buttons = options.map(([value, label]) => {
		const button = h('button', {
			type: 'button',
			text: label,
			'aria-pressed': String(value === current),
			onclick: () => {
				buttons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
				button.setAttribute('aria-pressed', 'true');
				onChange(value);
			},
		});
		return button;
	});
	buttons.forEach((b) => wrap.append(b));
	return wrap;
}

export { emptyState, sectionCard };
