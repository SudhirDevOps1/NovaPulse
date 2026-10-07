import { api, isStatic } from './api.js';
import { icon, iconEl } from './icons.js';
import { h, fmt, toast, confirmDialog, openModal, closeActiveOverlay } from './ui.js';
import { renderOverview, renderIncidents, renderSettings, openMonitorForm } from './views.js';
import { renderMonitorList, openMonitorDrawer } from './monitors.js';

const VIEWS = {
	overview: { title: 'Overview', sub: 'Fleet health at a glance' },
	monitors: { title: 'Monitors', sub: 'Every endpoint and its current state' },
	incidents: { title: 'Incidents', sub: 'Downtime and recovery timeline' },
	settings: { title: 'Settings', sub: 'Appearance, alerts and data' },
};

const state = {
	route: 'overview',
	monitors: [],
	incidents: [],
	stats: null,
	health: null,
	settings: null,
	fleetRange: '24h',
	fleetAnalytics: null,
	loading: true,
	error: null,
	lastUpdated: null,
	search: '',
	statusFilter: 'all',
	incidentFilter: 'all',
	themeMode: readStore('kestrel.theme', readStore('pulse.theme', 'dark')),
	pollMs: Number(readStore('kestrel.poll', readStore('pulse.poll', '5000'))),
	selectedId: null,
};

let pollTimer = null;
let polling = false;
let activeDrawer = null;
let closingDrawer = false;
let lastRenderedRoute = null;
let routeEnterTimer = null;

/* ---------------- motion ---------------- */

const tileMemory = new Map();

function prefersReducedMotion() {
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

/** Count tile numbers up to their new value; skip when nothing changed. */
function animateCounters(root) {
	if (prefersReducedMotion()) return;
	const tiles = root.querySelectorAll('.tile');
	tiles.forEach((tile, index) => {
		const value = tile.querySelector('.tile-value');
		if (!value) return;
		const label = tile.querySelector('.tile-label')?.textContent?.trim() || `#${index}`;
		const text = value.textContent;
		const previous = tileMemory.get(label);
		tileMemory.set(label, text);
		if (previous === text) return;

		const match = /^(-?[\d.,]+)(.*)$/.exec(text);
		if (!match) return;
		const target = Number(match[1].replace(/,/g, ''));
		if (!Number.isFinite(target)) return;

		const previousNumber = previous === undefined ? 0 : Number(String(previous).replace(/[^\d.-]/g, ''));
		const from = Number.isFinite(previousNumber) ? previousNumber : 0;
		if (from === target) return;

		const decimals = (match[1].split('.')[1] || '').length;
		const suffix = match[2];
		const startedAt = performance.now();
		const duration = 650;

		const frame = (now) => {
			if (!value.isConnected) return; // drawer/view moved on
			const progress = Math.min(1, (now - startedAt) / duration);
			const eased = 1 - (1 - progress) ** 3;
			const current = from + (target - from) * eased;
			value.textContent = `${current.toLocaleString(undefined, {
				minimumFractionDigits: decimals,
				maximumFractionDigits: decimals,
			})}${suffix}`;
			if (progress < 1) requestAnimationFrame(frame);
			else value.textContent = text; // exact final text
		};
		requestAnimationFrame(frame);
	});
}

/* ---------------- storage & theme ---------------- */

function readStore(key, fallback) {
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}

function writeStore(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* storage disabled */
	}
}

const colorScheme = window.matchMedia('(prefers-color-scheme: light)');

function applyTheme() {
	const resolved =
		state.themeMode === 'system' ? (colorScheme.matches ? 'light' : 'dark') : state.themeMode;
	document.documentElement.dataset.theme = resolved;
	const button = document.getElementById('theme-toggle');
	if (button) {
		button.innerHTML = icon(resolved === 'dark' ? 'moon' : 'sun');
		button.setAttribute(
			'aria-label',
			state.themeMode === 'system'
				? `Theme: system (${resolved}). Click to switch`
				: `Theme: ${resolved}. Click to switch`,
		);
	}
}

function setTheme(mode) {
	state.themeMode = mode;
	writeStore('kestrel.theme', mode);
	applyTheme();
}

colorScheme.addEventListener('change', () => {
	if (state.themeMode === 'system') applyTheme();
});

/* ---------------- data ---------------- */

async function loadData() {
	const [monitors, incidents, stats, health, settings, fleetAnalytics] = await Promise.all([
		api.monitors(),
		api.incidents({ limit: 100 }),
		api.stats(),
		api.health(),
		api.settings().catch(() => state.settings),
		api.analytics(state.fleetRange).catch(() => state.fleetAnalytics),
	]);
	state.monitors = monitors;
	state.incidents = incidents;
	state.stats = stats;
	state.health = health;
	if (settings) state.settings = settings;
	if (fleetAnalytics) state.fleetAnalytics = fleetAnalytics;
	state.error = null;
	state.lastUpdated = new Date().toISOString();
	setApiStatus(true, health);
	updateNavCounts();
}

function setApiStatus(ok, health) {
	const el = document.getElementById('api-status');
	const label = document.getElementById('api-label');
	if (!el || !label) return;
	el.classList.toggle('ok', ok);
	el.classList.toggle('error', !ok);
	label.textContent = ok
		? isStatic
			? 'GitHub Pages · live'
			: 'API connected'
		: 'API unreachable';
	if (ok && health?.version) {
		document.getElementById('version-label').textContent = `v${health.version}`;
	}
}

function updateNavCounts() {
	const monitorsCount = document.getElementById('nav-monitors');
	const incidentsCount = document.getElementById('nav-incidents');
	const down = state.monitors.filter((m) => m.status === 'down').length;
	monitorsCount.textContent = String(state.monitors.length);
	monitorsCount.classList.toggle('alert', down > 0);
	incidentsCount.textContent = String(state.incidents.length);
	incidentsCount.classList.toggle(
		'alert',
		state.incidents.some((i) => i.type === 'down' && Date.now() - Date.parse(i.at) < 3600_000),
	);
}

async function refresh({ silent = false } = {}) {
	try {
		await loadData();
		render();
	} catch (error) {
		state.error = error.message;
		setApiStatus(false);
		if (!silent) toast('Refresh failed', { type: 'error', description: error.message });
		render();
	}
}

function startPolling() {
	if (pollTimer) clearInterval(pollTimer);
	if (!state.pollMs) return;
	pollTimer = setInterval(() => {
		if (document.hidden) return;
		if (polling) return;

		// Don't steal focus or clobber in-progress edits.
		const view = document.getElementById('view');
		if (view && view.contains(document.activeElement) && document.activeElement !== view) return;

		polling = true;
		loadData()
			.then(() => {
				render();
			})
			.catch((error) => {
				state.error = error.message;
				setApiStatus(false);
				render();
			})
			.finally(() => {
				polling = false;
			});
	}, state.pollMs);
}

function setPoll(ms) {
	state.pollMs = ms;
	writeStore('kestrel.poll', String(ms));
	startPolling();
	toast(ms ? `Auto refresh: every ${ms / 1000}s` : 'Auto refresh paused', { type: 'info' });
}

/* ---------------- actions ---------------- */

async function checkMonitor(monitor) {
	try {
		const updated = await api.checkMonitor(monitor.id);
		const ok = updated.status !== 'down';
		const outcome = updated.status === 'degraded' ? 'Check slow' : ok ? 'Check passed' : 'Check failed';
		toast(outcome, {
			type: updated.status === 'degraded' ? 'info' : ok ? 'success' : 'error',
			description: `${monitor.name} · ${fmt.ms(updated.lastCheck?.ms)}${
				updated.lastCheck?.error ? ` · ${updated.lastCheck.error}` : ''
			}`,
		});
		await refresh({ silent: true });
		ctx.onMonitorUpdated?.(updated);
		return updated;
	} catch (error) {
		toast('Check failed', { type: 'error', description: error.message });
		return null;
	}
}

async function toggleMonitor(monitor) {
	try {
		const updated = await api.updateMonitor(monitor.id, { enabled: !monitor.enabled });
		toast(updated.enabled ? 'Monitor resumed' : 'Monitor paused', {
			type: 'info',
			description: monitor.name,
		});
		await refresh({ silent: true });
		ctx.onMonitorUpdated?.(updated);
		return updated;
	} catch (error) {
		toast('Could not update monitor', { type: 'error', description: error.message });
		return null;
	}
}

async function removeMonitor(monitor) {
	const ok = await confirmDialog({
		title: 'Delete monitor?',
		message: `<strong>${escapeText(monitor.name)}</strong> and its entire check history will be removed. This cannot be undone.`,
		confirmLabel: 'Delete monitor',
	});
	if (!ok) return false;
	try {
		await api.deleteMonitor(monitor.id);
		toast('Monitor deleted', { type: 'success', description: monitor.name });
		if (state.selectedId === monitor.id) clearSelected();
		await refresh({ silent: true });
		return true;
	} catch (error) {
		toast('Delete failed', { type: 'error', description: error.message });
		return false;
	}
}

function escapeText(value) {
	return String(value).replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
	);
}

function readOnlyToast() {
	toast('Read-only dashboard', {
		type: 'info',
		description: 'Add or edit monitors in config/monitors.json in the repository, then commit.',
	});
}

function submitMonitorForm(payload, monitor) {
	if (monitor) {
		return api.updateMonitor(monitor.id, payload).then((updated) => {
			toast('Monitor updated', { type: 'success', description: updated.name });
			refresh({ silent: true }).then(() => ctx.onMonitorUpdated?.(updated));
		});
	}
	return api.createMonitor(payload).then((created) => {
		toast('Monitor created', {
			type: 'success',
			description: `${created.name} — first check running now`,
		});
		if (state.route !== 'monitors') location.hash = '#/monitors';
		return refresh({ silent: true });
	});
}

function openMonitor(monitor) {
	if (activeDrawer) {
		ctx.onMonitorUpdated = null;
		activeDrawer.close();
		activeDrawer = null;
	}
	activeDrawer = openMonitorDrawer(monitor, ctx);
	state.selectedId = monitor.id;
}

function clearSelected() {
	state.selectedId = null;
	ctx.onMonitorUpdated = null;
	if (activeDrawer && !closingDrawer) {
		closingDrawer = true;
		activeDrawer.close();
		activeDrawer = null;
		setTimeout(() => {
			closingDrawer = false;
		}, 50);
	}
}

/* ---------------- rendering ---------------- */

const ctx = {
	get state() {
		return state;
	},
	readOnly: isStatic,
	refresh,
	check: checkMonitor,
	toggle: toggleMonitor,
	remove: removeMonitor,
	editMonitor: (monitor) => {
		if (isStatic) return readOnlyToast();
		return openMonitorForm({ monitor, onSubmit: submitMonitorForm });
	},
	openMonitorForm: () => {
		if (isStatic) return readOnlyToast();
		return openMonitorForm({ onSubmit: submitMonitorForm });
	},
	openMonitor,
	clearSelected,
	setSearch(value) {
		state.search = value;
		state.restoreSearchFocus = true;
		render();
	},
	setStatusFilter(value) {
		state.statusFilter = value;
		render();
	},
	setIncidentFilter(value) {
		state.incidentFilter = value;
		render();
	},
	setTheme,
	setPoll,
	setFleetRange(value) {
		state.fleetRange = value;
		state.fleetAnalytics = null;
		render();
		api
			.analytics(value)
			.then((data) => {
				state.fleetAnalytics = data;
				if (state.route === 'overview') render();
			})
			.catch((error) => toast('Analytics failed', { type: 'error', description: error.message }));
	},
	saveStatusPage(patch) {
		return api.updateSettings({ statusPage: patch }).then((settings) => {
			state.settings = settings;
			return settings;
		});
	},
	onMonitorUpdated: null,
};

function routeFromHash() {
	const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
	return VIEWS[hash] ? hash : 'overview';
}

function render({ soft = false } = {}) {
	const view = document.getElementById('view');
	const meta = VIEWS[state.route];

	document.getElementById('page-title').textContent = meta.title;
	document.getElementById('page-sub').textContent = meta.sub;
	document.title = `${meta.title} · Kestrel`;

	document.querySelectorAll('[data-nav]').forEach((link) => {
		if (link.dataset.nav === state.route) link.setAttribute('aria-current', 'page');
		else link.removeAttribute('aria-current');
	});

	if (state.loading) return; // initial skeleton already in the markup

	let content;
	if (state.error && !state.monitors.length) {
		content = h('div', { class: 'banner error', role: 'alert' }, [
			iconEl('alert'),
			h('span', { text: `Cannot reach the API: ${state.error}` }),
			h('button', { class: 'btn btn-sm', text: 'Retry', onclick: () => refresh() }),
		]);
	} else if (state.route === 'monitors') {
		content = renderMonitorList({ monitors: state.monitors, ctx });
	} else if (state.route === 'incidents') {
		content = renderIncidents({ incidents: state.incidents, ctx });
	} else if (state.route === 'settings') {
		content = renderSettings({ state, ctx, health: state.health });
	} else {
		content = renderOverview({
			stats: state.stats || emptyStats(),
			monitors: state.monitors,
			incidents: state.incidents,
			analytics: state.fleetAnalytics,
			ctx,
		});
	}

	const parts = [];
	if (isStatic) {
		parts.push(
			h('div', { class: 'banner info' }, [
				iconEl('clock'),
				h('span', {
					text: 'Read-only view — monitors are defined in config/monitors.json (edit it on GitHub and commit). Checks run every few minutes; alerts arrive on Telegram.',
				}),
			]),
		);
	}
	if (state.error && state.monitors.length) {
		parts.push(
			h('div', { class: 'banner error', role: 'alert' }, [
				iconEl('alert'),
				h('span', { text: `Refresh failed: ${state.error} — showing last known data.` }),
				h('button', { class: 'btn btn-sm', text: 'Retry', onclick: () => refresh() }),
			]),
		);
	}
	parts.push(content);

	view.replaceChildren(...parts);

	// Staggered entrance only on route changes — polling renders stay calm.
	if (state.route !== lastRenderedRoute) {
		lastRenderedRoute = state.route;
		view.classList.add('route-enter');
		clearTimeout(routeEnterTimer);
		routeEnterTimer = setTimeout(() => view.classList.remove('route-enter'), 950);
	}
	animateCounters(view);

	if (state.restoreSearchFocus) {
		state.restoreSearchFocus = false;
		const input = view.querySelector('.search input');
		if (input) {
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		}
	}
}

function emptyStats() {
	return {
		totals: { monitors: 0, up: 0, down: 0, degraded: 0, unknown: 0, paused: 0 },
		checks24h: 0,
		uptime24h: null,
		avgResponse24h: null,
		incidents24h: 0,
		lastIncident: null,
	};
}

function updateLastUpdatedTick() {
	const el = document.getElementById('last-updated');
	if (!el) return;
	el.textContent = state.lastUpdated
		? `updated ${fmt.relative(state.lastUpdated)}`
		: 'not loaded yet';
}

/* ---------------- command palette & help ---------------- */

function paletteCommands() {
	const nav = [
		['overview', 'Go to Overview'],
		['monitors', 'Go to Monitors'],
		['incidents', 'Go to Incidents'],
		['settings', 'Go to Settings'],
	].map(([route, label]) => ({
		id: `nav-${route}`,
		label,
		hint: 'nav',
		run: () => {
			location.hash = `#/${route}`;
		},
	}));

	const actions = [
		!isStatic && {
			id: 'new',
			label: 'Create a monitor',
			hint: 'N',
			run: () => ctx.openMonitorForm(),
		},
		{
			id: 'refresh',
			label: 'Refresh data now',
			hint: 'R',
			run: () => refresh(),
		},
		{
			id: 'theme',
			label: 'Switch theme (dark → light → system)',
			run: () => {
				const order = ['dark', 'light', 'system'];
				setTheme(order[(order.indexOf(state.themeMode) + 1) % order.length]);
				toast(`Theme: ${state.themeMode}`, { type: 'info', timeout: 1800 });
			},
		},
		{
			id: 'status',
			label: 'Open public status page',
			run: () => window.open(api.statusPageUrl(), '_blank', 'noopener'),
		},
		{
			id: 'help',
			label: 'Keyboard shortcuts',
			hint: '?',
			run: () => openHelp(),
		},
		{
			id: 'settings-status',
			label: 'Status page & badge settings',
			run: () => {
				location.hash = '#/settings';
			},
		},
	].filter(Boolean);

	const monitors = state.monitors.map((monitor) => ({
		id: `monitor-${monitor.id}`,
		label: `${monitor.name} — ${!monitor.enabled ? 'paused' : monitor.status}`,
		hint: monitor.type === 'tcp' ? 'tcp' : '',
		run: () => {
			if (state.route !== 'monitors') location.hash = '#/monitors';
			openMonitor(monitor);
		},
	}));

	return [...actions, ...nav, ...monitors];
}

function openPalette() {
	const input = h('input', {
		class: 'input palette-input',
		type: 'text',
		placeholder: 'Type a command or monitor name…',
		'aria-label': 'Command palette',
		autocomplete: 'off',
		spellcheck: 'false',
	});
	const list = h('div', { class: 'palette-list', role: 'listbox', 'aria-label': 'Commands' });
	let items = [];
	let active = 0;
	let modal = null;

	const runItem = (command) => {
		modal?.close();
		setTimeout(() => command.run(), 10);
	};

	const setActive = (next) => {
		if (!items.length) return;
		active = (next + items.length) % items.length;
		[...list.children].forEach((child, index) => {
			child.classList.toggle('is-active', index === active);
			child.setAttribute?.('aria-selected', String(index === active));
		});
		list.children[active]?.scrollIntoView({ block: 'nearest' });
	};

	const draw = () => {
		const query = input.value.trim().toLowerCase();
		items = paletteCommands()
			.filter((command) => !query || command.label.toLowerCase().includes(query))
			.slice(0, 24);
		active = 0;
		if (!items.length) {
			list.replaceChildren(h('div', { class: 'palette-empty', text: 'No matching command.' }));
			return;
		}
		list.replaceChildren(
			...items.map((command, index) =>
				h(
					'button',
					{
						class: `palette-item${index === 0 ? ' is-active' : ''}`,
						type: 'button',
						role: 'option',
						'aria-selected': String(index === 0),
						onmousedown: (event) => {
							event.preventDefault();
							runItem(command);
						},
						onmouseenter: () => setActive(index),
					},
					[
						h('span', { class: 'palette-label', text: command.label }),
						command.hint ? h('kbd', { text: command.hint }) : null,
					],
				),
			),
		);
	};

	input.addEventListener('input', draw);
	input.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setActive(active + 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setActive(active - 1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (items[active]) runItem(items[active]);
		} else if (event.key === 'Home' && items.length) {
			event.preventDefault();
			setActive(0);
		} else if (event.key === 'End' && items.length) {
			event.preventDefault();
			setActive(items.length - 1);
		}
	});

	modal = openModal({
		title: 'Command palette',
		body: h('div', { class: 'palette' }, [input, list]),
		footer: h('div', { class: 'palette-foot' }, [
			h('span', {}, [h('kbd', { text: '↑↓' }), ' navigate']),
			h('span', {}, [h('kbd', { text: '↵' }), ' run']),
			h('span', {}, [h('kbd', { text: 'Esc' }), ' close']),
		]),
		closeOnBackdrop: false,
	});
	draw();
	input.focus();
}

function openHelp() {
	const rows = [
		['⌘K / Ctrl+K', 'Command palette'],
		['N', 'New monitor'],
		['/', 'Focus search'],
		['R', 'Refresh now'],
		['?', 'This help'],
		['Esc', 'Close drawer or dialog'],
	];
	openModal({
		title: 'Keyboard shortcuts',
		body: h(
			'div',
			{ class: 'kbd-list' },
			rows.map(([key, description]) =>
				h('div', { class: 'kbd-row' }, [h('kbd', { text: key }), h('span', { text: description })]),
			),
		),
		footer: isStatic
			? h('span', { class: 'muted', text: 'Read-only build — create/edit shortcuts are hidden.' })
			: null,
	});
}

/* ---------------- chrome wiring ---------------- */

function wireChrome() {
	document.getElementById('theme-toggle').addEventListener('click', () => {
		const order = ['dark', 'light', 'system'];
		const next = order[(order.indexOf(state.themeMode) + 1) % order.length];
		setTheme(next);
		toast(`Theme: ${next}`, { type: 'info', timeout: 1800 });
	});

	document.getElementById('refresh-btn').addEventListener('click', () => refresh());
	const newMonitorBtn = document.getElementById('new-monitor-btn');
	if (isStatic) newMonitorBtn.remove();
	else newMonitorBtn.addEventListener('click', () => ctx.openMonitorForm());

	const sidebar = document.getElementById('sidebar');
	const menuBtn = document.getElementById('menu-btn');
	menuBtn.addEventListener('click', () => {
		const open = sidebar.classList.toggle('open');
		menuBtn.setAttribute('aria-expanded', String(open));
	});
	document.addEventListener('click', (event) => {
		if (!sidebar.classList.contains('open')) return;
		if (sidebar.contains(event.target) || menuBtn.contains(event.target)) return;
		sidebar.classList.remove('open');
		menuBtn.setAttribute('aria-expanded', 'false');
	});
	document.querySelectorAll('.nav a, .brand').forEach((link) =>
		link.addEventListener('click', () => {
			sidebar.classList.remove('open');
			menuBtn.setAttribute('aria-expanded', 'false');
		}),
	);

	document.addEventListener('keydown', (event) => {
		// Command palette works everywhere, including inside inputs.
		if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 'k' || event.key === 'K')) {
			event.preventDefault();
			openPalette();
			return;
		}

		const typing =
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			event.target instanceof HTMLSelectElement;
		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

		if (event.key === 'n' || event.key === 'N') {
			event.preventDefault();
			ctx.openMonitorForm();
		} else if (event.key === '/') {
			event.preventDefault();
			if (state.route !== 'monitors') location.hash = '#/monitors';
			setTimeout(() => document.querySelector('.search input')?.focus(), 60);
		} else if (event.key === 'r' || event.key === 'R') {
			event.preventDefault();
			refresh();
		} else if (event.key === '?') {
			event.preventDefault();
			openHelp();
		}
	});

	window.addEventListener('hashchange', () => {
		// Route changes always dismiss an open drawer/modal (nav "back").
		closeActiveOverlay();
		state.route = routeFromHash();
		render();
		document.getElementById('view').focus({ preventScroll: true });
	});
}

/* ---------------- boot ---------------- */

async function boot() {
	applyTheme();
	wireChrome();
	state.route = routeFromHash();

	try {
		await loadData();
		state.loading = false;
		render();
	} catch (error) {
		state.loading = false;
		state.error = error.message;
		setApiStatus(false);
		render();
	}

	startPolling();
	setInterval(updateLastUpdatedTick, 1000);
	updateLastUpdatedTick();

	// PWA: offline-tolerant shell (service worker never caches API/state files).
	if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
		navigator.serviceWorker.register('sw.js').catch(() => {
			/* offline support unavailable — ignore */
		});
	}
}

boot();
