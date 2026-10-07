/* Pure-SVG chart builders. Markup only — no inline style attributes (CSP-safe). */

const W = 600;

function niceCeil(value) {
	if (value <= 0) return 10;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	const normalized = value / magnitude;
	const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
	return step * magnitude;
}

function hourLabel(iso) {
	return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function esc(value) {
	return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Last N checks as a compact bar strip. */
export function sparkline(history, { bars = 40, height = 30 } = {}) {
	const items = history.slice(-bars);
	const viewBox = `0 0 240 ${height}`;
	if (!items.length) {
		return `<svg class="spark" viewBox="${viewBox}" preserveAspectRatio="none" role="img" aria-label="No checks yet"><rect x="0" y="${
			height / 2 - 1
		}" width="240" height="2" class="none" rx="1"/></svg>`;
	}

	const gap = 1.5;
	const barWidth = (240 - gap * (items.length - 1)) / items.length;
	const rects = items
		.map((entry, index) => {
			const x = index * (barWidth + gap);
			const cls = entry.ok ? 'up' : 'bad';
			const h = Math.max(3, Math.min(height, (entry.ok ? 0.45 : 1) * height + (entry.ok ? Math.min(10, entry.ms / 40) : 0)));
			const y = height - h;
			const title = `${hourLabel(entry.at)} · ${entry.ok ? 'up' : 'down'} · ${entry.ms}ms`;
			return `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(
				2,
			)}" height="${h.toFixed(2)}" rx="1.5"><title>${esc(title)}</title></rect>`;
		})
		.join('');

	return `<svg class="spark" viewBox="${viewBox}" preserveAspectRatio="none" role="img" aria-label="Recent checks">${rects}</svg>`;
}

/** Response-time line chart over the monitor's history. */
export function lineChart(history, { height = 200, unit = 'ms' } = {}) {
	const pad = { l: 40, r: 12, t: 14, b: 26 };
	const points = history.filter((entry) => Number.isFinite(entry.ms));
	const viewBox = `0 0 ${W} ${height}`;

	if (points.length < 2) {
		return `<svg class="chart" viewBox="${viewBox}" role="img" aria-label="Not enough data"><text x="${
			W / 2
		}" y="${height / 2}" text-anchor="middle" class="axis-label">Not enough data yet</text></svg>`;
	}

	const values = points.map((p) => p.ms);
	const rawMax = Math.max(...values);
	const rawMin = Math.min(...values);
	const max = niceCeil(rawMax * 1.15);
	const min = rawMin > max * 0.4 ? Math.max(0, niceCeil(rawMin * 0.85)) : 0;

	const plotW = W - pad.l - pad.r;
	const plotH = height - pad.t - pad.b;
	const startTime = Date.parse(points[0].at);
	const endTime = Date.parse(points[points.length - 1].at);
	const span = Math.max(1, endTime - startTime);

	const x = (at) => pad.l + ((Date.parse(at) - startTime) / span) * plotW;
	const y = (ms) => pad.t + plotH - ((ms - min) / Math.max(1, max - min)) * plotH;

	const coords = points.map((p) => ({ x: x(p.at), y: y(p.ms), p }));
	const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
	const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)} ${(
		pad.t + plotH
	).toFixed(1)} L${coords[0].x.toFixed(1)} ${(pad.t + plotH).toFixed(1)} Z`;

	const gridCount = 4;
	const grid = Array.from({ length: gridCount + 1 }, (_, i) => {
		const value = min + ((max - min) / gridCount) * i;
		const gy = y(value);
		return `<line class="grid" x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(
			1,
		)}"/><text class="axis-label" x="${pad.l - 8}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end">${Math.round(
			value,
		)}</text>`;
	}).join('');

	const labels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]]
		.map(
			(p, i) =>
				`<text class="axis-label" x="${x(p.at).toFixed(1)}" y="${height - 8}" text-anchor="${
					i === 0 ? 'start' : i === 2 ? 'end' : 'middle'
				}">${hourLabel(p.at)}</text>`,
		)
		.join('');

	const dotStep = Math.max(1, Math.ceil(coords.length / 60));
	const dots = coords
		.filter((_, i) => i % dotStep === 0)
		.map(
			(c) =>
				`<circle class="point" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3"><title>${esc(
					`${hourLabel(c.p.at)} · ${c.p.ms}${unit}`,
				)}</title></circle>`,
		)
		.join('');

	const gradientId = `chartArea${++gradientSeq}`;
	return `<svg class="chart" viewBox="${viewBox}" role="img" aria-label="Response time chart">
		<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="var(--brand)" stop-opacity="0.32"/>
			<stop offset="1" stop-color="var(--brand)" stop-opacity="0"/>
		</linearGradient></defs>
		${grid}
		<path class="area" d="${areaPath}" fill="url(#${gradientId})"/>
		<path class="line" d="${linePath}"/>
		${dots}
		${labels}
		<text class="axis-label" x="${pad.l - 8}" y="${pad.t - 2}" text-anchor="end">${unit}</text>
	</svg>`;
}

let gradientSeq = 0;

/** Stacked per-bucket check outcome bars (last 24h). */
export function bucketBars(buckets, { height = 200 } = {}) {
	const pad = { l: 34, r: 10, t: 14, b: 26 };
	const viewBox = `0 0 ${W} ${height}`;
	if (!buckets.length) {
		return `<svg class="chart" viewBox="${viewBox}" role="img" aria-label="No checks"><text x="${
			W / 2
		}" y="${height / 2}" text-anchor="middle" class="axis-label">No checks yet</text></svg>`;
	}

	const plotW = W - pad.l - pad.r;
	const plotH = height - pad.t - pad.b;
	const totals = buckets.map((b) => b.up + b.down);
	const max = Math.max(1, ...totals);
	const slot = plotW / buckets.length;
	const barWidth = Math.max(2, slot - Math.min(6, slot * 0.3));

	const grid = Array.from({ length: 3 }, (_, i) => {
		const value = (max / 2) * i;
		const gy = pad.t + plotH - (value / max) * plotH;
		return `<line class="grid" x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(
			1,
		)}"/><text class="axis-label" x="${pad.l - 8}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end">${Math.round(
			value,
		)}</text>`;
	}).join('');

	const bars = buckets
		.map((bucket, index) => {
			const x = pad.l + index * slot + (slot - barWidth) / 2;
			const total = bucket.up + bucket.down;
			if (total === 0) {
				return `<rect class="bar-empty" x="${x.toFixed(1)}" y="${(pad.t + plotH - 3).toFixed(
					1,
				)}" width="${barWidth.toFixed(1)}" height="3" rx="1.5"><title>${esc(
					`${bucket.label} · no checks`,
				)}</title></rect>`;
			}
			const upH = (bucket.up / max) * plotH;
			const downH = (bucket.down / max) * plotH;
			const upY = pad.t + plotH - upH;
			const downY = upY - downH;
			const title = `${bucket.label} · ${bucket.up} up, ${bucket.down} down`;
			return `${bucket.down ? `<rect class="bar-down" x="${x.toFixed(1)}" y="${downY.toFixed(
				1,
			)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, downH).toFixed(1)}" rx="2"><title>${esc(
				title,
			)}</title></rect>` : ''}${
				bucket.up
					? `<rect class="bar-up" x="${x.toFixed(1)}" y="${upY.toFixed(1)}" width="${barWidth.toFixed(
							1,
					  )}" height="${Math.max(1, upH).toFixed(1)}" rx="2"><title>${esc(title)}</title></rect>`
					: ''
			}`;
		})
		.join('');

	const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));
	const labels = buckets
		.map((bucket, index) => {
			if (index % labelEvery !== 0 && index !== buckets.length - 1) return '';
			const lx = pad.l + index * slot + slot / 2;
			return `<text class="axis-label" x="${lx.toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(
				bucket.label,
			)}</text>`;
		})
		.join('');

	return `<svg class="chart" viewBox="${viewBox}" role="img" aria-label="Check outcomes over time">
		${grid}${bars}${labels}
	</svg>`;
}

/** Aggregate monitor history into hourly buckets (local time). */
export function buildBuckets(monitors, windowHours = 24) {
	const now = Date.now();
	const start = now - windowHours * 3600_000;
	const size = (windowHours * 3600_000) / Math.min(windowHours, 24);
	const count = Math.min(windowHours, 24);

	const buckets = Array.from({ length: count }, (_, index) => {
		const from = start + index * size;
		return {
			label: new Date(from).toLocaleTimeString([], { hour: '2-digit' }),
			from,
			to: from + size,
			up: 0,
			down: 0,
		};
	});

	for (const monitor of monitors) {
		for (const entry of monitor.history || []) {
			const at = Date.parse(entry.at);
			if (at < start) continue;
			const index = Math.min(count - 1, Math.floor((at - start) / size));
			if (entry.ok) buckets[index].up += 1;
			else buckets[index].down += 1;
		}
	}

	return buckets;
}

/* ---------------- advanced charts (analytics) ---------------- */

function emptyChart(viewBox, height, message) {
	return `<svg class="chart" viewBox="${viewBox}" role="img" aria-label="${esc(message)}"><text x="${
		W / 2
	}" y="${height / 2}" text-anchor="middle" class="axis-label">${esc(message)}</text></svg>`;
}

function bucketLabel(t, spanMs) {
	const date = new Date(t);
	return spanMs > 3 * 86400000
		? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
		: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** p50 / p95 / p99 percentile lines over an analytics series (hourly or daily). */
export function percentileChart(series, { height = 170 } = {}) {
	const pad = { l: 40, r: 12, t: 14, b: 26 };
	const viewBox = `0 0 ${W} ${height}`;
	if (!series || !series.length) return emptyChart(viewBox, height, 'No data in this range yet');

	const keys = [
		['p50Ms', 'p50'],
		['p95Ms', 'p95'],
		['p99Ms', 'p99'],
	];
	const values = series.flatMap((point) => keys.map(([key]) => point[key]).filter((v) => Number.isFinite(v)));
	if (!values.length) return emptyChart(viewBox, height, 'No latency data yet');

	const max = niceCeil(Math.max(...values) * 1.15) || 10;
	const plotW = W - pad.l - pad.r;
	const plotH = height - pad.t - pad.b;
	const x = (index) => (series.length === 1 ? pad.l + plotW / 2 : pad.l + (index / (series.length - 1)) * plotW);
	const y = (value) => pad.t + plotH - (value / max) * plotH;

	const grid = Array.from({ length: 4 }, (_, i) => {
		const value = (max / 3) * i;
		const gy = y(value);
		return `<line class="grid" x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(
			1,
		)}"/><text class="axis-label" x="${pad.l - 8}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end">${Math.round(
			value,
		)}</text>`;
	}).join('');

	const lines = keys
		.map(([key, name]) => {
			const coords = series
				.map((point, index) => (Number.isFinite(point[key]) ? { x: x(index), y: y(point[key]), v: point[key], t: point.t } : null))
				.filter(Boolean);
			if (coords.length < 2) return '';
			const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
			return `<path class="cline cline-${name}" pathLength="1" d="${d}"/>`;
		})
		.join('');

	// Sampled hover dots on the p95 line (the one people watch).
	const p95Coords = series
		.map((point, index) =>
			Number.isFinite(point.p95Ms) ? { x: x(index), y: y(point.p95Ms), v: point.p95Ms, t: point.t } : null,
		)
		.filter(Boolean);
	const step = Math.max(1, Math.ceil(p95Coords.length / 40));
	const dots = p95Coords
		.filter((_, index) => index % step === 0)
		.map(
			(c) =>
				`<circle class="point" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3"><title>${esc(
					`${bucketLabel(c.t, series[series.length - 1].t - series[0].t)} · p95 ${c.v} ms`,
				)}</title></circle>`,
		)
		.join('');

	const span = series[series.length - 1].t - series[0].t;
	const labelPoints = [series[0], series[Math.floor(series.length / 2)], series[series.length - 1]];
	const labels = labelPoints
		.map(
			(point, index) =>
				`<text class="axis-label" x="${x(series.indexOf(point)).toFixed(1)}" y="${height - 8}" text-anchor="${
					index === 0 ? 'start' : index === 2 ? 'end' : 'middle'
				}">${esc(bucketLabel(point.t, span))}</text>`,
		)
		.join('');

	return `<svg class="chart" viewBox="${viewBox}" role="img" aria-label="Response time percentiles">
		${grid}${lines}${dots}${labels}
		<text class="axis-label" x="${pad.l - 8}" y="${pad.t - 2}" text-anchor="end">ms</text>
	</svg>`;
}

/** Distribution of recent response times. */
export function histogramChart(hist, { height = 130 } = {}) {
	const pad = { l: 34, r: 10, t: 14, b: 24 };
	const viewBox = `0 0 ${W} ${height}`;
	if (!hist || !hist.bars || !hist.bars.length) return emptyChart(viewBox, height, 'Not enough checks yet');

	const plotW = W - pad.l - pad.r;
	const plotH = height - pad.t - pad.b;
	const max = Math.max(1, ...hist.bars.map((bar) => bar.count));
	const slot = plotW / hist.bars.length;
	const barWidth = Math.max(2, slot - 3);

	const grid = Array.from({ length: 3 }, (_, i) => {
		const value = (max / 2) * i;
		const gy = pad.t + plotH - (value / max) * plotH;
		return `<line class="grid" x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(
			1,
		)}"/><text class="axis-label" x="${pad.l - 8}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end">${Math.round(
			value,
		)}</text>`;
	}).join('');

	const bars = hist.bars
		.map((bar, index) => {
			const h = bar.count === 0 ? 2 : Math.max(3, (bar.count / max) * plotH);
			const x = pad.l + index * slot + (slot - barWidth) / 2;
			const y = pad.t + plotH - h;
			return `<rect class="hist-bar${bar.count === 0 ? ' is-empty' : ''}" x="${x.toFixed(
				1,
			)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(
				`${bar.from}–${bar.to} ms · ${bar.count} check(s)`,
			)}</title></rect>`;
		})
		.join('');

	const labels = [
		`<text class="axis-label" x="${pad.l}" y="${height - 8}" text-anchor="start">${Math.round(hist.min)} ms</text>`,
		`<text class="axis-label" x="${W - pad.r}" y="${height - 8}" text-anchor="end">${Math.round(hist.max)} ms</text>`,
	].join('');

	return `<svg class="chart" viewBox="${viewBox}" role="img" aria-label="Response time distribution">
		${grid}${bars}${labels}
	</svg>`;
}

const WATERFALL_PHASES = [
	['dns', 'DNS lookup', 'wf-dns'],
	['connect', 'TCP connect', 'wf-connect'],
	['tls', 'TLS handshake', 'wf-tls'],
	['ttfb', 'Waiting (TTFB)', 'wf-wait'],
	['download', 'Download', 'wf-download'],
];

/** Stacked latency waterfall of one check. Returns '' when no timing data exists. */
export function waterfallChart(timing) {
	if (!timing) return '';
	const present = WATERFALL_PHASES.filter(([key]) => Number.isFinite(timing[key]) && timing[key] >= 0);
	if (!present.length) return '';
	const sum = present.reduce((total, [key]) => total + timing[key], 0) || 1;
	const gap = 2;
	const budget = W - gap * (present.length - 1);

	let offset = 0;
	const rects = present
		.map(([key, label, cls]) => {
			const value = timing[key];
			const width = Math.max(3, (value / sum) * budget);
			const rect = `<rect class="wf-bar ${cls}" x="${offset.toFixed(1)}" y="8" width="${width.toFixed(
				1,
			)}" height="24" rx="4"><title>${esc(`${label}: ${value} ms`)}</title></rect>`;
			offset += width + gap;
			return rect;
		})
		.join('');

	return `<svg class="chart waterfall" viewBox="0 0 ${W} 40" role="img" aria-label="Latency waterfall">${rects}</svg>`;
}
