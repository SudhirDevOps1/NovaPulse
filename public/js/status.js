/* Public status page — works in server mode (/api/public/status)
 * and in the static build (data/status.json), no auth, no secrets. */
import { APP_MODE } from './config.js';
import { h, fmt, statusPill } from './ui.js';

const SOURCE = APP_MODE === 'static' ? 'data/status.json' : '/api/public/status';
const REFRESH_MS = 60_000;

function applyTheme() {
	let mode;
	try {
		// `novapulse.*` is what the dashboard writes today; the legacy keys are
		// read-only migration fallbacks for preferences saved before the rename.
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

function overallLabel(state) {
	return {
		operational: 'All systems operational',
		degraded: 'Degraded performance',
		outage: 'Service disruption',
		unknown: 'Status unavailable',
	}[state] || 'Status unavailable';
}

function dayCell(bucket) {
	const level =
		bucket.uptime === null ? 'nodata' : bucket.uptime >= 99.95 ? 'up' : bucket.uptime > 0 ? 'partial' : 'down';
	const label =
		bucket.uptime === null
			? `${bucket.day}: no data`
			: `${bucket.day}: ${bucket.uptime}% uptime`;
	return h('i', { class: `daycell cell-${level}`, title: label, 'aria-label': label });
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

	return h('div', { class: 'status-row' }, [
		h('div', { class: 'status-row-head' }, [
			title,
			statusPill(service.status),
			h('span', { class: 'status-metrics' }, [
				h('span', { text: service.responseMs === null ? '—' : fmt.ms(service.responseMs) }),
				h('span', { class: 'status-uptime', text: `${fmt.percent(service.uptime30d)} · 30d` }),
			]),
		]),
		bars,
	]);
}

function incidentRow(incident) {
	const down = incident.type === 'down';
	return h('div', { class: `incident-row ${down ? 'is-down' : 'is-up'}` }, [
		h('span', { class: 'incident-mark', 'aria-hidden': 'true' }),
		h('div', { class: 'incident-body' }, [
			h('div', { class: 'incident-title' }, [
				h('strong', { text: incident.name }),
				h('span', { class: 'incident-kind', text: down ? 'down' : 'recovered' }),
			]),
			h('div', { class: 'incident-meta' }, [
				h('span', { text: fmt.relative(incident.at) }),
				incident.reason ? h('span', { text: incident.reason }) : null,
			]),
		]),
	]);
}

function render(data) {
	document.title = `${data.title} · NovaPulse`;
	document.getElementById('status-title').textContent = data.title;

	const message = document.getElementById('status-message');
	if (data.message) {
		message.textContent = data.message;
		message.hidden = false;
	} else {
		message.hidden = true;
	}

	document.getElementById('status-updated').textContent = fmt.relative(data.updated);

	const overall = document.getElementById('status-overall');
	overall.dataset.state = data.overall;
	overall.textContent = overallLabel(data.overall);

	const services = document.getElementById('status-services');
	services.replaceChildren();
	if (!data.services.length) {
		services.append(
			h('p', { class: 'status-empty', text: 'No services are being monitored yet.' }),
		);
	} else {
		services.append(...data.services.map(serviceRow));
	}

	const incidents = document.getElementById('status-incidents');
	incidents.replaceChildren();
	const list = data.incidents || [];
	if (!list.length) {
		incidents.append(
			h('p', { class: 'status-empty', text: 'No incidents recorded in the last 30 days.' }),
		);
	} else {
		incidents.append(...list.map(incidentRow));
	}
}

function renderUnavailable() {
	const overall = document.getElementById('status-overall');
	overall.dataset.state = 'unknown';
	overall.textContent = 'Status page unavailable';
	document.getElementById('status-services').replaceChildren(
		h('p', {
			class: 'status-empty',
			text: 'The status page is turned off. Enable it in Settings → Status page.',
		}),
	);
	document.getElementById('status-incidents').replaceChildren();
}

async function refresh() {
	try {
		const response = await fetch(SOURCE, { headers: { accept: 'application/json' } });
		if (!response.ok) {
			renderUnavailable();
			return;
		}
		const data = await response.json();
		// static build always ships status.json — honour the enabled flag itself.
		if (data && data.enabled === false) {
			renderUnavailable();
			return;
		}
		render(data);
	} catch {
		const overall = document.getElementById('status-overall');
		overall.dataset.state = 'unknown';
		overall.textContent = 'Could not load status';
	}
}

applyTheme();
const statusBadge = /** @type {HTMLImageElement} */ (document.getElementById('status-badge'));
statusBadge.src = APP_MODE === 'static' ? 'badge/fleet.svg' : '/api/badge/fleet.svg';
refresh();
setInterval(() => {
	if (!document.hidden) refresh();
}, REFRESH_MS);
