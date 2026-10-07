import { icon } from './icons.js';
import { h, fmt, statusPill, openDrawer } from './ui.js';
import { sparkline } from './charts.js';
import { buildMonitorBody, emptyState } from './views.js';

const STATUS_FILTERS = [
	['all', 'All'],
	['down', 'Down'],
	['degraded', 'Slow'],
	['up', 'Up'],
	['paused', 'Paused'],
	['unknown', 'Unchecked'],
];

function matches(monitor, search, filter) {
	const status = !monitor.enabled ? 'paused' : monitor.status;
	if (filter !== 'all' && status !== filter) return false;
	if (!search) return true;
	const needle = search.toLowerCase();
	return (
		monitor.name.toLowerCase().includes(needle) ||
		monitor.url.toLowerCase().includes(needle) ||
		(monitor.tags || []).some((tag) => tag.toLowerCase().includes(needle))
	);
}

export function renderMonitorList({ monitors, ctx }) {
	const { search = '', statusFilter = 'all' } = ctx.state;

	const visible = monitors.filter((m) => matches(m, search, statusFilter));

	const searchInput = h('input', {
		class: 'input',
		type: 'search',
		placeholder: 'Search name or URL…  (press /)',
		value: search,
		'aria-label': 'Search monitors',
		oninput: (event) => ctx.setSearch(event.target.value),
	});

	const searchWrap = h('div', { class: 'search' }, [
		{ html: icon('search') },
		searchInput,
	]);

	const counts = Object.fromEntries(
		STATUS_FILTERS.map(([value]) => [
			value,
			value === 'all'
				? monitors.length
				: monitors.filter((m) => (!m.enabled ? 'paused' : m.status) === value).length,
		]),
	);

	const chips = h(
		'div',
		{ class: 'toolbar', role: 'group', 'aria-label': 'Filter by status' },
		STATUS_FILTERS.map(([value, label]) =>
			h('button', {
				class: 'chip',
				'aria-pressed': String(statusFilter === value),
				onclick: () => ctx.setStatusFilter(value),
			}, [label, ' ', h('span', { class: 'count', text: `(${counts[value]})` })]),
		),
	);

	const toolbar = h('div', { class: 'toolbar' }, [
		searchWrap,
		chips,
		h('span', { class: 'muted', text: `${visible.length} shown` }),
	]);

	if (!monitors.length) {
		return h('div', {}, [
			toolbar,
			h('div', { class: 'card' }, [
				emptyState({
					glyph: 'pulse',
					title: 'No monitors yet',
					message:
						'Add a URL and Kestrel will start checking it immediately — no agent or install required.',
					action: h('button', {
						class: 'btn btn-primary',
						text: 'New monitor',
						onclick: () => ctx.openMonitorForm(),
					}),
				}),
			]),
		]);
	}

	if (!visible.length) {
		return h('div', {}, [
			toolbar,
			h('div', { class: 'card' }, [
				emptyState({
					glyph: 'search',
					title: 'No matches',
					message: 'Try a different search term or clear the status filter.',
					action: h('button', {
						class: 'btn',
						text: 'Clear filters',
						onclick: () => {
							ctx.setSearch('');
							ctx.setStatusFilter('all');
						},
					}),
				}),
			]),
		]);
	}

	const body = h('tbody', {}, visible.map((monitor) => monitorRow(monitor, ctx)));
	const table = h('table', { class: 'rows' }, [
		h('thead', {}, [
			h('tr', {}, [
				h('th', { text: 'Status' }),
				h('th', { text: 'Monitor' }),
				h('th', { class: 'col-spark hide-sm', text: 'Recent checks' }),
				h('th', { class: 'num hide-sm', text: 'Response' }),
				h('th', { class: 'num hide-sm', text: 'Uptime 24h' }),
				h('th', { class: 'hide-sm', text: 'Last check' }),
				h('th', { class: 'col-actions', text: 'Actions' }),
			]),
		]),
		body,
	]);

	return h('div', {}, [toolbar, h('div', { class: 'card table-wrap' }, [table])]);
}

function monitorRow(monitor, ctx) {
	const status = !monitor.enabled ? 'paused' : monitor.status;
	const last = monitor.lastCheck;

	const row = h(
		'tr',
		{
			tabindex: '0',
			role: 'button',
			'aria-label': `Open ${monitor.name}`,
			onclick: (event) => {
				if (event.target.closest('button, a')) return;
				ctx.openMonitor(monitor);
			},
			onkeydown: (event) => {
				if (event.key === 'Enter') ctx.openMonitor(monitor);
			},
		},
		[
			h('td', {}, [statusPill(status)]),
			h('td', {}, [
				h('div', { class: 'name-cell' }, [
					h('b', { text: monitor.name }),
					h('a', {
						href: monitor.url,
						text: monitor.url,
						target: '_blank',
						rel: 'noreferrer',
						onclick: (event) => event.stopPropagation(),
					}),
				]),
			]),
			h('td', { class: 'col-spark hide-sm' }, [spark(monitor.history)]),
			h('td', { class: 'num hide-sm', text: last ? fmt.ms(last.ms) : '—' }),
			h('td', { class: 'num hide-sm', text: fmt.percent(monitor.uptime24h) }),
			h('td', { class: 'hide-sm', text: last ? fmt.relative(last.at) : 'never' }),
			h('td', { class: 'col-actions' }, [
				ctx.readOnly
					? h('div', { class: 'row-actions' }, [
							actionBtn('chevron', 'Open details', (event) => {
								event.stopPropagation();
								ctx.openMonitor(monitor);
							}),
						])
					: h('div', { class: 'row-actions' }, [
							actionBtn('zap', 'Check now', async (event) => {
								event.stopPropagation();
								await ctx.check(monitor, event.currentTarget);
							}),
							actionBtn(monitor.enabled ? 'pause' : 'play', monitor.enabled ? 'Pause' : 'Resume', async (event) => {
								event.stopPropagation();
								await ctx.toggle(monitor);
							}),
							actionBtn('pencil', 'Edit', (event) => {
								event.stopPropagation();
								ctx.editMonitor(monitor);
							}),
							actionBtn('trash', 'Delete', async (event) => {
								event.stopPropagation();
								await ctx.remove(monitor);
							}, true),
						]),
			]),
		],
	);

	return row;
}

function spark(history) {
	const node = h('span', {});
	node.innerHTML = sparkline(history, { bars: 32 });
	return node;
}

function actionBtn(glyph, label, handler, danger = false) {
	const button = h('button', {
		class: `icon-btn bare${danger ? ' danger' : ''}`,
		'aria-label': label,
		title: label,
		onclick: handler,
	});
	button.innerHTML = icon(glyph);
	return button;
}

/* ---------------- drawer ---------------- */

export function openMonitorDrawer(monitor, ctx) {
	const headActions = h('div', { class: 'foot-row' });
	let drawer = null;

	const rebuild = (updated) => drawer?.setBody(buildMonitorBody(updated, ctx));

	if (!ctx.readOnly) {
		const checkBtn = h('button', { class: 'btn btn-sm', 'aria-label': 'Check now' });
		checkBtn.innerHTML = `${icon('zap')}<span>Check now</span>`;
		checkBtn.addEventListener('click', async () => {
			checkBtn.disabled = true;
			try {
				const updated = await ctx.check(monitor);
				if (updated) rebuild(updated);
			} finally {
				checkBtn.disabled = false;
			}
		});

		const toggleBtn = h('button', {
			class: 'btn btn-sm',
			text: monitor.enabled ? 'Pause' : 'Resume',
		});
		toggleBtn.addEventListener('click', async () => {
			const updated = await ctx.toggle(monitor);
			if (updated) {
				toggleBtn.textContent = updated.enabled ? 'Pause' : 'Resume';
				rebuild(updated);
			}
		});

		const editBtn = h('button', { class: 'btn btn-sm', text: 'Edit' });
		editBtn.addEventListener('click', () => ctx.editMonitor(monitor));

		const deleteBtn = h('button', { class: 'btn btn-sm btn-danger', text: 'Delete' });
		deleteBtn.addEventListener('click', async () => {
			const removed = await ctx.remove(monitor);
			if (removed) drawer?.close();
		});

		headActions.append(checkBtn, toggleBtn, editBtn, deleteBtn);
	}

	drawer = openDrawer({
		title: monitor.name,
		subtitle: `${monitor.url} · every ${monitor.intervalSec}s`,
		body: buildMonitorBody(monitor, ctx),
		actions: headActions,
		onClose: () => ctx.clearSelected(),
	});

	ctx.onMonitorUpdated = (updated) => {
		if (updated.id === monitor.id) rebuild(updated);
	};

	return drawer;
}
