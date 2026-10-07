export const ICONS = {
	pulse: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
	gauge: '<path d="M12 14 16 9"/><path d="M3.5 18a9 9 0 1 1 17 0"/><circle cx="12" cy="14" r="1.6"/>',
	server:
		'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
	alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	sliders:
		'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
	refresh: '<path d="M21 4v6h-6"/><path d="M20.5 14a8.5 8.5 0 1 1-2-8.6L21 8"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
	close: '<path d="M18 6 6 18M6 6l12 12"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
	pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
	play: '<path d="m7 4 13 8-13 8z"/>',
	trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
	pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
	moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
	download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
	upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5"/><path d="M12 3v12"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 1.9"/>',
	external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
	zap: '<path d="M13 2 3 14h8l-1 8 11-13h-8z"/>',
	inbox:
		'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>',
	shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
	chevron: '<path d="m9 18 6-6-6-6"/>',
	filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
};

export function icon(name, className = 'icon') {
	const body = ICONS[name] || ICONS.pulse;
	return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

/** Same icon, returned as a live DOM element for use as a child node. */
export function iconEl(name, className = 'icon') {
	const holder = document.createElement('span');
	holder.innerHTML = icon(name, className);
	return holder.firstElementChild;
}
