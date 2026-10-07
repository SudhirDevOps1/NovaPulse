const monitorsEl = document.getElementById('monitors');
const incidentsEl = document.getElementById('incidents');
const summaryEl = document.getElementById('summary');
const healthEl = document.getElementById('health');
const formEl = document.getElementById('add-form');
const formErrorEl = document.getElementById('form-error');

const STATUS_LABEL = { up: 'UP', down: 'DOWN', unknown: 'UNCHECKED' };

function el(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (key === 'class') node.className = value;
		else if (key === 'text') node.textContent = value;
		else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
		else node.setAttribute(key, value);
	}
	for (const child of children) node.append(child);
	return node;
}

async function api(path, options) {
	const response = await fetch(path, options);
	if (response.status === 204) return null;
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message = Array.isArray(data.errors) ? data.errors.join(', ') : data.error;
		throw new Error(message || `Request failed (${response.status})`);
	}
	return data;
}

function relativeTime(iso) {
	if (!iso) return 'never';
	const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
	if (seconds < 5) return 'just now';
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

function sparkline(history) {
	const bars = history.slice(-40);
	return el(
		'div',
		{ class: 'spark' },
		bars.map((h) =>
			el('i', {
				class: h.ok ? '' : 'bad',
				title: `${new Date(h.at).toLocaleTimeString()} · ${h.ok ? 'up' : 'down'} · ${h.ms}ms`,
				style: `height:${Math.max(15, Math.min(100, 100 - h.ms / 100))}%`,
			}),
		),
	);
}

function stat(value, label) {
	return el('div', { class: 'stat' }, [
		el('b', { text: value }),
		el('span', { text: label }),
	]);
}

async function refresh() {
	const [monitors, incidents] = await Promise.all([
		api('/api/monitors'),
		api('/api/incidents?limit=30'),
	]);
	renderMonitors(monitors);
	renderIncidents(incidents);

	const up = monitors.filter((m) => m.status === 'up').length;
	const down = monitors.filter((m) => m.status === 'down').length;
	summaryEl.textContent = monitors.length ? `${up} up · ${down} down` : 'no monitors yet';
	healthEl.textContent = `API ok · ${monitors.length} monitor(s)`;
}

function renderMonitors(monitors) {
	monitorsEl.textContent = '';
	if (!monitors.length) {
		monitorsEl.append(el('p', { class: 'muted', text: 'Koi monitor nahi hai — upar se add karo.' }));
		return;
	}

	for (const monitor of monitors) {
		const last = monitor.lastCheck;
		const card = el('article', { class: `card ${monitor.status}` });

		const head = el('div', { class: 'card-head' }, [
			el('span', { class: 'name', text: monitor.name }),
			el('span', { class: `dot ${monitor.status}`, title: STATUS_LABEL[monitor.status] }),
		]);

		const link = el('a', {
			class: 'url',
			href: monitor.url,
			text: monitor.url,
			target: '_blank',
			rel: 'noreferrer',
		});

		const stats = el('div', { class: 'stats' }, [
			stat(last ? `${last.ms} ms` : '—', 'Response'),
			stat(monitor.uptime24h === null ? '—' : `${monitor.uptime24h}%`, '24h uptime'),
			stat(STATUS_LABEL[monitor.status], 'Status'),
		]);

		const meta = el('p', {
			class: 'muted',
			text: `every ${monitor.intervalSec}s · last check ${relativeTime(last?.at)}${
				monitor.enabled ? '' : ' · paused'
			}`,
		});

		const actions = el('div', { class: 'card-actions' }, [
			el('button', {
				class: 'ghost',
				text: 'Check now',
				onclick: async (event) => {
					event.target.disabled = true;
					try {
						await api(`/api/monitors/${monitor.id}/check`, { method: 'POST' });
						await refresh();
					} catch (error) {
						alert(error.message);
					} finally {
						event.target.disabled = false;
					}
				},
			}),
			el('button', {
				class: 'ghost',
				text: monitor.enabled ? 'Pause' : 'Resume',
				onclick: async () => {
					await api(`/api/monitors/${monitor.id}`, {
						method: 'PATCH',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ enabled: !monitor.enabled }),
					});
					await refresh();
				},
			}),
			el('button', {
				class: 'ghost danger',
				text: 'Delete',
				onclick: async () => {
					if (!confirm(`Delete "${monitor.name}"?`)) return;
					await api(`/api/monitors/${monitor.id}`, { method: 'DELETE' });
					await refresh();
				},
			}),
		]);

		card.append(head, link, stats, sparkline(monitor.history), meta);
		if (monitor.status === 'down' && last?.error) {
			card.append(el('p', { class: 'error-line', text: last.error }));
		}
		card.append(actions);
		monitorsEl.append(card);
	}
}

function renderIncidents(incidents) {
	incidentsEl.textContent = '';
	if (!incidents.length) {
		incidentsEl.append(el('p', { class: 'muted', text: 'No incidents 🎉' }));
		return;
	}
	for (const incident of incidents) {
		const icon = incident.type === 'down' ? '🔴' : '🟢';
		incidentsEl.append(
			el('div', { class: 'incident' }, [
				el('span', { text: icon }),
				el('b', { text: incident.name }),
				el('span', {
					class: 'muted',
					text: `${incident.type.toUpperCase()} · ${incident.reason || ''}`,
				}),
				el('span', { class: 'when', text: relativeTime(incident.at) }),
			]),
		);
	}
}

formEl.addEventListener('submit', async (event) => {
	event.preventDefault();
	formErrorEl.hidden = true;
	const data = new FormData(formEl);
	try {
		await api('/api/monitors', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: data.get('name'),
				url: data.get('url'),
				intervalSec: Number(data.get('intervalSec')),
				timeoutMs: Number(data.get('timeoutMs')),
			}),
		});
		formEl.reset();
		await refresh();
	} catch (error) {
		formErrorEl.textContent = error.message;
		formErrorEl.hidden = false;
	}
});

let polling = false;
async function poll() {
	if (polling || document.hidden) return;
	polling = true;
	try {
		await refresh();
	} catch (error) {
		healthEl.textContent = `API error: ${error.message}`;
	} finally {
		polling = false;
	}
}

refresh().catch((error) => {
	monitorsEl.textContent = '';
	monitorsEl.append(el('p', { class: 'error-line', text: error.message }));
});
setInterval(poll, 5000);
setInterval(() => refresh().catch(() => {}), 15000);
