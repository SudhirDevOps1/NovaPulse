/* Public status page — works in server mode (/api/public/status)
 * and in the static build (data/status.json), zero auth, zero secrets. */
import { APP_MODE } from './config.js';
import { h, fmt, statusPill, escapeHtml } from './ui.js';
import { initTelemetryMap } from './maps.js';

const SOURCE = APP_MODE === 'static' ? 'data/status.json' : '/api/public/status';
const REFRESH_INTERVAL_SEC = 60;
let countdownSec = REFRESH_INTERVAL_SEC;
let countdownTimer = null;

function applyTheme() {
	let mode;
	try {
		mode =
			localStorage.getItem('novapulse.theme') ||
			localStorage.getItem('kestrel.theme') ||
			localStorage.getItem('pulse.theme');
	} catch {
		mode = null;
	}
	if (mode !== 'light' && mode !== 'dark') {
		mode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
	}
	document.documentElement.dataset.theme = mode;
}

function toggleTheme() {
	const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
	const next = current === 'light' ? 'dark' : 'light';
	document.documentElement.dataset.theme = next;
	try {
		localStorage.setItem('novapulse.theme', next);
	} catch {
		// quota or private mode
	}
}

function overallMeta(state) {
	return {
		operational: {
			title: 'All Systems Operational',
			subtitle: 'All monitored edge endpoints are operating normally with optimal latency.',
			badge: 'Operational',
			icon: `
				<svg class="hero-status-icon is-good" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
					<polyline points="22 4 12 14.01 9 11.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			`,
		},
		degraded: {
			title: 'Degraded Service Performance',
			subtitle: 'Some endpoints are experiencing elevated latency or transient packet loss.',
			badge: 'Degraded',
			icon: `
				<svg class="hero-status-icon is-warn" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
					<line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
					<line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
				</svg>
			`,
		},
		outage: {
			title: 'Major Service Disruption',
			subtitle: 'One or more critical services are currently unavailable. Probing failovers.',
			badge: 'Service Outage',
			icon: `
				<svg class="hero-status-icon is-bad" viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/>
					<line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
					<line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
				</svg>
			`,
		},
		unknown: {
			title: 'Telemetry Status Unavailable',
			subtitle: 'Could not connect to the telemetry backend. Retrying in background…',
			badge: 'Unavailable',
			icon: `
				<svg class="hero-status-icon is-idle" viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/>
					<line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
					<line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
				</svg>
			`,
		},
	}[state] || {
		title: 'Checking Service Status',
		subtitle: 'Collecting telemetry across edge vantage nodes…',
		badge: 'Checking…',
		icon: '',
	};
}

function dayCell(bucket) {
	const level =
		bucket.uptime === null ? 'nodata' : bucket.uptime >= 99.95 ? 'up' : bucket.uptime > 0 ? 'partial' : 'down';
	const label =
		bucket.uptime === null
			? `${bucket.day}: no data`
			: `${bucket.day}: ${bucket.uptime}% uptime`;
	return h('i', {
		class: `daycell cell-${level}`,
		title: label,
		'aria-label': label,
		tabindex: '0',
	});
}

function serviceRow(service) {
	const bars = h(
		'div',
		{ class: 'daycells', role: 'img', 'aria-label': '30-day uptime history' },
		(service.days || []).map(dayCell),
	);

	const title = service.url
		? h('a', { class: 'status-name', href: service.url, rel: 'noopener nofollow', target: '_blank', text: service.name })
		: h('span', { class: 'status-name', text: service.name });

	const dayLegend = h('div', { class: 'daycells-legend' }, [
		h('span', { class: 'text-xs text-muted', text: '30 days ago' }),
		h('span', { class: 'daycells-divider' }),
		h('span', { class: 'text-xs text-muted', text: `Today (${service.uptime24h !== null && service.uptime24h !== undefined ? `${service.uptime24h}%` : '100%'})` }),
	]);

	return h('div', { class: 'status-row' }, [
		h('div', { class: 'status-row-head' }, [
			h('div', { class: 'status-row-title-wrap' }, [
				title,
				statusPill(service.status),
			]),
			h('div', { class: 'status-metrics' }, [
				h('span', { class: 'status-metric-chip latency', text: service.responseMs === null ? '—' : fmt.ms(service.responseMs) }),
				h('span', { class: 'status-metric-chip uptime', text: `${fmt.percent(service.uptime30d)} 30d` }),
			]),
		]),
		bars,
		dayLegend,
	]);
}

function incidentRow(incident) {
	const down = incident.type === 'down';
	return h('div', { class: `incident-row ${down ? 'is-down' : 'is-up'}` }, [
		h('span', { class: 'incident-mark', 'aria-hidden': 'true' }),
		h('div', { class: 'incident-body' }, [
			h('div', { class: 'incident-title' }, [
				h('strong', { text: incident.name }),
				h('span', { class: `incident-badge ${down ? 'down' : 'up'}`, text: down ? 'Service Outage' : 'Resolved & Restored' }),
			]),
			h('div', { class: 'incident-meta' }, [
				h('span', { class: 'incident-time', text: fmt.relative(incident.at) }),
				incident.reason ? h('span', { class: 'incident-reason', text: incident.reason }) : null,
			]),
		]),
	]);
}

function render(data) {
	const titleText = data.title || 'Service status';
	document.title = `${titleText} · NovaPulse`;

	const meta = overallMeta(data.overall);

	// 1. Hero Status Banner
	const heroEl = document.getElementById('status-hero');
	if (heroEl) {
		heroEl.dataset.state = data.overall;
	}

	const iconWrap = document.getElementById('status-icon-wrap');
	if (iconWrap && meta.icon) {
		iconWrap.innerHTML = meta.icon;
	}

	const titleEl = document.getElementById('status-title');
	if (titleEl) {
		titleEl.textContent = data.title || meta.title;
	}

	const subtitleEl = document.getElementById('status-subtitle');
	if (subtitleEl) {
		const total = (data.services || []).length;
		const up = (data.services || []).filter((s) => s.status === 'up').length;
		subtitleEl.textContent = total > 0
			? `${meta.title} · ${up} of ${total} service(s) operational · Monitored across global edge vantage nodes.`
			: (data.title ? `${meta.title} · ${meta.subtitle}` : meta.subtitle);
	}

	const message = document.getElementById('status-message');
	if (message) {
		if (data.message) {
			message.innerHTML = `<strong>Notice:</strong> ${escapeHtml(data.message)}`;
			message.hidden = false;
		} else {
			message.hidden = true;
		}
	}

	const updatedEl = document.getElementById('status-updated');
	if (updatedEl) {
		updatedEl.textContent = fmt.relative(data.updated);
	}

	const overall = document.getElementById('status-overall');
	if (overall) {
		overall.dataset.state = data.overall;
		overall.textContent = meta.badge;
	}

	// 2. 4-Card Telemetry KPI Summary Grid
	const services = data.services || [];
	let avgUptime = 100;
	let validUptimes = 0;
	let totalMs = 0;
	let validMsCount = 0;

	services.forEach((s) => {
		if (typeof s.uptime30d === 'number') {
			avgUptime += s.uptime30d;
			validUptimes++;
		}
		if (typeof s.responseMs === 'number' && s.responseMs > 0) {
			totalMs += s.responseMs;
			validMsCount++;
		}
	});

	const fleetUptimeVal = validUptimes > 0 ? (avgUptime - 100) / validUptimes : 100;
	const avgLatencyVal = validMsCount > 0 ? Math.round(totalMs / validMsCount) : null;
	const upCount = services.filter((s) => s.status === 'up').length;

	const kpiUptime = document.getElementById('kpi-uptime');
	if (kpiUptime) kpiUptime.textContent = `${fleetUptimeVal.toFixed(2)}%`;

	const kpiServices = document.getElementById('kpi-services');
	if (kpiServices) kpiServices.textContent = `${upCount} / ${services.length}`;

	const kpiServicesSub = document.getElementById('kpi-services-sub');
	if (kpiServicesSub) kpiServicesSub.textContent = upCount === services.length ? '100% Operational' : `${services.length - upCount} Disrupted`;

	const kpiLatency = document.getElementById('kpi-latency');
	if (kpiLatency) kpiLatency.textContent = avgLatencyVal ? `${avgLatencyVal} ms` : '—';

	const incidents = data.incidents || [];
	const kpiStreak = document.getElementById('kpi-streak');
	if (kpiStreak) {
		if (!incidents.some((inc) => inc.type === 'down')) {
			kpiStreak.textContent = '30 Days';
		} else {
			kpiStreak.textContent = 'Active Recovery';
		}
	}

	// 3. Monitored Services List
	const countBadge = document.getElementById('status-services-count');
	if (countBadge) countBadge.textContent = `${services.length} Monitored`;

	const servicesContainer = document.getElementById('status-services');
	if (servicesContainer) {
		servicesContainer.replaceChildren();
		if (!services.length) {
			servicesContainer.append(
				h('p', { class: 'status-empty', text: 'No services are currently configured for public monitoring.' }),
			);
		} else {
			servicesContainer.append(...services.map(serviceRow));
		}
	}

	// 4. Embedded 100% Free Cyber Telemetry Map
	const mapContainer = document.getElementById('status-map-container');
	if (mapContainer && !mapContainer.dataset.initialized) {
		mapContainer.dataset.initialized = 'true';
		initTelemetryMap(mapContainer, { monitors: services });
	}

	// 5. Recent Incidents List
	const incidentsContainer = document.getElementById('status-incidents');
	if (incidentsContainer) {
		incidentsContainer.replaceChildren();
		if (!incidents.length) {
			const emptyCard = h('div', { class: 'incident-empty-card' }, [
				h('div', { class: 'incident-shield-icon', text: '🛡️' }),
				h('div', { class: 'incident-empty-text' }, [
					h('strong', { text: 'All Systems Running Smoothly' }),
					h('p', { class: 'text-sm text-muted', text: 'Zero outages, downtime, or security incidents reported in the last 30 days.' }),
				]),
			]);
			incidentsContainer.append(emptyCard);
		} else {
			incidentsContainer.append(...incidents.map(incidentRow));
		}
	}
}

function renderUnavailable() {
	const overall = document.getElementById('status-overall');
	if (overall) {
		overall.dataset.state = 'unknown';
		overall.textContent = 'Status page unavailable';
	}
	const heroEl = document.getElementById('status-hero');
	if (heroEl) heroEl.dataset.state = 'unknown';

	const titleEl = document.getElementById('status-title');
	if (titleEl) titleEl.textContent = 'Status Page Offline';

	const subEl = document.getElementById('status-subtitle');
	if (subEl) subEl.textContent = 'The status page is disabled. Enable it in Settings → Status page.';

	document.getElementById('status-services')?.replaceChildren(
		h('p', {
			class: 'status-empty',
			text: 'The status page is turned off. Enable it in Settings → Status page.',
		}),
	);
	document.getElementById('status-incidents')?.replaceChildren();
}

async function refresh() {
	countdownSec = REFRESH_INTERVAL_SEC;
	updateCountdownDisplay();
	try {
		const response = await fetch(SOURCE, { headers: { accept: 'application/json' } });
		if (!response.ok) {
			renderUnavailable();
			return;
		}
		const data = await response.json();
		if (data && data.enabled === false) {
			renderUnavailable();
			return;
		}
		render(data);
	} catch {
		const overall = document.getElementById('status-overall');
		if (overall) {
			overall.dataset.state = 'unknown';
			overall.textContent = 'Could not load status';
		}
	}
}

function updateCountdownDisplay() {
	const countdownEl = document.getElementById('status-countdown');
	if (countdownEl) {
		countdownEl.textContent = `${countdownSec}s`;
	}
}

function startCountdown() {
	if (countdownTimer) clearInterval(countdownTimer);
	countdownTimer = setInterval(() => {
		countdownSec--;
		if (countdownSec <= 0) {
			refresh();
		} else {
			updateCountdownDisplay();
		}
	}, 1000);
}

// Setup event listeners
applyTheme();
document.getElementById('status-theme-btn')?.addEventListener('click', toggleTheme);
document.getElementById('status-refresh-btn')?.addEventListener('click', () => refresh());

const statusBadge = /** @type {HTMLImageElement} */ (document.getElementById('status-badge'));
if (statusBadge) {
	statusBadge.src = APP_MODE === 'static' ? 'badge/fleet.svg' : '/api/badge/fleet.svg';
}

function connectStatusSse() {
	if (APP_MODE === 'static' || typeof EventSource === 'undefined') return;
	try {
		const sse = new EventSource('/api/stream');
		sse.addEventListener('check', () => {
			refresh();
		});
	} catch {
		// EventSource not supported or blocked
	}
}

refresh();
startCountdown();
connectStatusSse();
