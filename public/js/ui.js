/* DOM, formatting, modal/drawer/toast primitives. No inline styles (CSP-safe). */
import { icon } from './icons.js';

const SVG_CLOSE =
	'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

let uid = 0;

export function h(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	applyProps(node, props);
	append(node, children);
	return node;
}

export function frag(children = []) {
	const node = document.createDocumentFragment();
	append(node, children);
	return node;
}

function append(node, children) {
	for (const child of children.flat(Infinity)) {
		if (child === null || child === undefined || child === false) continue;
		if (child instanceof Node) {
			node.append(child);
		} else if (typeof child === 'object') {
			const span = document.createElement('span');
			applyProps(span, child);
			node.append(span);
		} else {
			node.append(document.createTextNode(String(child)));
		}
	}
}

function applyProps(node, props) {
	for (const [key, value] of Object.entries(props)) {
		if (value === null || value === undefined || value === false) continue;
		if (key === 'class') node.className = value;
		else if (key === 'text') node.textContent = value;
		else if (key === 'html') node.innerHTML = value; // internal, never user input
		else if (key === 'dataset') Object.assign(node.dataset, value);
		else if (key === 'on') for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
		else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
		else if (value === true) node.setAttribute(key, '');
		else node.setAttribute(key, String(value));
	}
}

/** Insert an SVG/HTML string that contains no user input. */
export function setHTML(node, markup) {
	node.innerHTML = markup;
	return node;
}

/* ---------------- formatting ---------------- */

export const fmt = {
	ms(value) {
		if (value === null || value === undefined || !Number.isFinite(value)) return '—';
		if (value < 1000) return `${Math.round(value)} ms`;
		return `${(value / 1000).toFixed(2)} s`;
	},
	percent(value, digits = 1) {
		if (value === null || value === undefined || !Number.isFinite(value)) return '—';
		return `${value.toFixed(digits).replace(/\.0$/, '')}%`;
	},
	int(value) {
		if (value === null || value === undefined || !Number.isFinite(value)) return '—';
		return new Intl.NumberFormat().format(value);
	},
	relative(iso) {
		if (!iso) return 'never';
		const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
		if (seconds < 5) return 'just now';
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.round(hours / 24);
		if (days < 30) return `${days}d ago`;
		return new Date(iso).toLocaleDateString();
	},
	duration(msValue) {
		const total = Math.max(0, Math.round(msValue / 1000));
		if (total < 60) return `${total}s`;
		const minutes = Math.floor(total / 60);
		if (minutes < 60) return `${minutes}m ${total % 60}s`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ${minutes % 60}m`;
		return `${Math.floor(hours / 24)}d ${hours % 24}h`;
	},
	time(iso) {
		return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	},
	dayLabel(iso) {
		const date = new Date(iso);
		const today = new Date();
		const yesterday = new Date(Date.now() - 86400000);
		const same = (a, b) => a.toDateString() === b.toDateString();
		if (same(date, today)) return 'Today';
		if (same(date, yesterday)) return 'Yesterday';
		return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
	},
	statusLabel(monitor) {
		if (!monitor.enabled) return 'paused';
		return monitor.status || 'unknown';
	},
};

export function statusPill(status) {
	return h('span', { class: `status status-${status}` }, [h('i', { class: 'dot' }), status]);
}

/** 30-cell uptime strip (green = clean day, amber = partial, red = total outage). */
export function dayCells(days, { label = '30-day uptime history' } = {}) {
	return h(
		'div',
		{ class: 'daycells', role: 'img', 'aria-label': label },
		(days || []).map((bucket) => {
			const level =
				bucket.uptime === null || bucket.uptime === undefined
					? 'nodata'
					: bucket.uptime >= 99.95
						? 'up'
						: bucket.uptime > 0
							? 'partial'
							: 'down';
			const title =
				bucket.uptime === null || bucket.uptime === undefined
					? `${bucket.day}: no data`
					: `${bucket.day}: ${bucket.uptime}% uptime`;
			return h('i', { class: `daycell cell-${level}`, title, 'aria-label': title });
		}),
	);
}

export function escapeHtml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
	);
}

/* ---------------- toasts ---------------- */

const toastHost = () => document.getElementById('toasts');

export function toast(title, { type = 'info', description = '', timeout = 4200 } = {}) {
	const host = toastHost();
	if (!host) return;

	const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Dismiss' }, [
		h('span', { text: '×', class: 'mono' }),
	]);

	const node = h('div', { class: `toast ${type}` }, [
		h('div', { class: 'toast-text' }, [
			h('div', { class: 'toast-title', text: title }),
			description ? h('div', { class: 'toast-desc', text: description }) : null,
		]),
		closeBtn,
	]);

	const dismiss = () => {
		node.classList.remove('show');
		setTimeout(() => node.remove(), 300);
	};

	closeBtn.addEventListener('click', dismiss);
	host.append(node);
	requestAnimationFrame(() => node.classList.add('show'));
	if (timeout) setTimeout(dismiss, timeout);
	return { dismiss };
}

/* ---------------- overlay plumbing ---------------- */

let activeOverlay = null;

function focusables(root) {
	return [...root.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
		(el) => el.offsetParent !== null || el === document.activeElement,
	);
}

function trapFocus(root, event) {
	const items = focusables(root);
	if (!items.length) return;
	const first = items[0];
	const last = items[items.length - 1];
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}

function mountOverlay({ root, panel, onClose, closeOnBackdrop = true }) {
	// Replace any overlay that is still mounted (e.g. opening a drawer for
	// another monitor while one is already open).
	if (activeOverlay) activeOverlay.close();

	const previouslyFocused = document.activeElement;
	const backdrop = h('div', { class: 'backdrop' });

	const onKey = (event) => {
		if (event.key === 'Escape') {
			event.stopPropagation();
			close();
		} else if (event.key === 'Tab') {
			trapFocus(panel, event);
		}
	};

	function close() {
		if (activeOverlay?.close === close) activeOverlay = null;
		document.removeEventListener('keydown', onKey, true);
		backdrop.classList.remove('open');
		panel.classList.remove('open');
		setTimeout(() => {
			backdrop.remove();
			panel.remove();
		}, 260);
		if (previouslyFocused?.focus && previouslyFocused.isConnected) previouslyFocused.focus();
		onClose?.();
	}

	if (closeOnBackdrop) backdrop.addEventListener('click', close);

	root.replaceChildren(backdrop, panel);
	document.addEventListener('keydown', onKey, true);
	requestAnimationFrame(() => {
		backdrop.classList.add('open');
		panel.classList.add('open');
		const target = focusables(panel)[0];
		target?.focus();
	});

	activeOverlay = { close };
	return { close, panel };
}

/** Close the currently mounted overlay (drawer/modal), if any. Idempotent. */
export function closeActiveOverlay() {
	if (activeOverlay) activeOverlay.close();
}

/* ---------------- modal ---------------- */

export function openModal({ title, body, footer, onClose, closeOnBackdrop = true }) {
	const root = document.getElementById('modal-root');
	const closeBtn = h('button', {
		class: 'icon-btn bare',
		'aria-label': 'Close dialog',
		onclick: () => close(),
	});
	closeBtn.innerHTML = SVG_CLOSE;

	const panel = h('div', {
		class: 'modal',
		role: 'dialog',
		'aria-modal': 'true',
		'aria-label': title,
	});

	const handle = mountOverlay({ root, panel, onClose, closeOnBackdrop });

	function close() {
		handle.close();
	}

	panel.append(
		h('div', { class: 'modal-head' }, [h('h2', { text: title }), closeBtn]),
		h('div', { class: 'modal-body' }, [body]),
		footer ? h('div', { class: 'modal-foot' }, [footer]) : null,
	);

	return { close, panel };
}

/** Promise-based destructive-action confirmation. */
export function confirmDialog({
	title,
	message,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	danger = true,
} = {}) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		const cancelBtn = h('button', {
			class: 'btn',
			text: cancelLabel,
			onclick: () => {
				finish(false);
				modal.close();
			},
		});
		const confirmBtn = h('button', {
			class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
			text: confirmLabel,
			onclick: () => {
				finish(true);
				modal.close();
			},
		});

		const body = h('div', {}, [
			typeof message === 'string' ? h('p', { class: 'confirm-msg', html: message }) : message,
		]);

		const modal = openModal({
			title,
			body,
			footer: [cancelBtn, confirmBtn],
			onClose: () => finish(false),
		});
	});
}

/* ---------------- drawer ---------------- */

export function openDrawer({ title, subtitle, body, actions = [], onClose }) {
	const root = document.getElementById('drawer-root');
	const closeBtn = h('button', { class: 'icon-btn bare', 'aria-label': 'Close panel' });
	closeBtn.innerHTML = SVG_CLOSE;

	const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
	const head = h('div', { class: 'drawer-head' }, [
		h('div', {}, [h('h2', { text: title }), subtitle ? h('p', { class: 'card-hint', text: subtitle }) : null]),
		h('div', { class: 'foot-row' }, [actions, closeBtn]),
	]);
	const content = h('div', { class: 'drawer-body' }, [body]);

	panel.append(head, content);
	const handle = mountOverlay({ root, panel, onClose });
	closeBtn.addEventListener('click', handle.close);

	return { close: handle.close, panel, content, setBody: (node) => content.replaceChildren(node) };
}

/* ---------------- misc ---------------- */

export function debounce(fn, delay = 250) {
	let timer;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}

export function downloadJSON(filename, data) {
	const blob = new Blob([JSON.stringify(data, null, '\t')], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const anchor = h('a', { href: url, download: filename });
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function nextId() {
	return ++uid;
}
