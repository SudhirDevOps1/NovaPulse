/* Shields-style SVG status badges — used by /api/badge/:id.svg and the static build. */

const STATUS_COLORS = {
	up: '#10b981',
	down: '#f43f5e',
	degraded: '#f59e0b',
	paused: '#64748b',
	unknown: '#64748b',
};

function escapeXml(value) {
	return String(value).replace(/[&<>"']/g, (char) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&apos;',
	})[char]);
}

function textWidth(text, fontSize, { bold = false, uppercase = false } = {}) {
	const value = uppercase ? text.toUpperCase() : text;
	// Empirical advance width for system sans glyphs.
	return Math.ceil(value.length * fontSize * (bold ? 0.66 : 0.62)) + 14;
}

/**
 * badgeSvg({ name, status, uptime, style })
 *   status: up | down | degraded | paused | unknown
 *   uptime: number | null  (percent, e.g. 99.97)
 *   style:  flat (default) | for-the-badge
 */
function badgeSvg({ name = 'monitor', status = 'unknown', uptime = null, style = 'flat' } = {}) {
	const label = String(name).slice(0, 40);
	const statusKey = STATUS_COLORS[status] ? status : 'unknown';
	const message =
		uptime === null || !Number.isFinite(uptime)
			? statusKey.toUpperCase()
			: `${Math.round(uptime * 10) / 10}% UPTIME`;
	const color = STATUS_COLORS[statusKey];
	const forTheBadge = style === 'for-the-badge';

	const fontSize = forTheBadge ? 11 : 11;
	const height = forTheBadge ? 28 : 20;
	const radius = forTheBadge ? 0 : 3;
	const labelWidth = textWidth(label, fontSize, { bold: forTheBadge, uppercase: forTheBadge });
	const messageWidth = textWidth(message, fontSize, { bold: forTheBadge });
	const width = labelWidth + messageWidth;
	const textY = height / 2 + (forTheBadge ? 4 : 3.75);

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${escapeXml(
			label
		)}: ${escapeXml(message)}">`,
		`<title>${escapeXml(label)}: ${escapeXml(message)}</title>`,
		`<linearGradient id="s" x2="0" y2="100%"><rect width="${width}" height="${height}" rx="${radius}" fill="#374151"/><line x1="${
			labelWidth
		}" x2="${labelWidth}" y1="0" y2="${height}" fill="#00000022"/></linearGradient>`,
		`<clipPath id="c"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></clipPath>`,
		`<g clip-path="url(#c)">`,
		`<rect x="${labelWidth}" width="${messageWidth}" height="${height}" fill="${color}"/>`,
		`</g>`,
		`<g fill="#fff" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" font-size="${fontSize}"${
			forTheBadge ? ' font-weight="700" letter-spacing="0.5"' : ''
		}>`,
		`<text x="${labelWidth / 2}" y="${textY}">${escapeXml(forTheBadge ? label.toUpperCase() : label)}</text>`,
		`<text x="${labelWidth + messageWidth / 2}" y="${textY}">${escapeXml(message)}</text>`,
		`</g>`,
		`</svg>`,
	].join('');
}

module.exports = { badgeSvg, STATUS_COLORS };
