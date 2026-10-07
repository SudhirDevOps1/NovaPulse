/* Probe engine — HTTP(S) with timing waterfall + TCP.
 *
 * One probe returns:
 *   { ok, status, ms, error, degraded, bytes, timing: {dns, connect, tls, ttfb, download},
 *     ssl: {validTo, daysLeft, issuer, protocol}, redirects }
 *
 * Uses node:http/https directly (not fetch) so every phase of the connection can be
 * measured: DNS → TCP connect → TLS handshake → time-to-first-byte → download.
 */
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const MAX_REDIRECTS = 5;
const BODY_CAP = 1024 * 1024; // read at most 1MB for keyword/size checks
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'expect']);

// Fresh sockets every time (keepAlive off) so timing events always fire.
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

function humanError(err, timeoutMs) {
	const name = err?.name || '';
	if (name === 'TimeoutError' || name === 'AbortError') return `Timeout after ${timeoutMs}ms`;
	const code = err?.cause?.code || err?.code;
	const codes = {
		ENOTFOUND: 'DNS lookup failed (host not found)',
		ECONNREFUSED: 'Connection refused',
		ECONNRESET: 'Connection reset by peer',
		EHOSTUNREACH: 'Host unreachable',
		ENETUNREACH: 'Network unreachable',
		EAI_AGAIN: 'DNS lookup failed (temporary)',
		ETIMEDOUT: 'Connection timed out',
		ECONNABORTED: 'Connection aborted',
		CERT_HAS_EXPIRED: 'TLS certificate expired',
		CERT_NOT_YET_VALID: 'TLS certificate not yet valid',
		DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed TLS certificate',
		SELF_SIGNED_CERT_IN_CHAIN: 'Self-signed certificate in chain',
		UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Unable to verify certificate signature',
	};
	if (code && codes[code]) return `${codes[code]} (${code})`;
	if (code) return `Network error (${code})`;
	return err?.message || 'Unknown error';
}

/** "200-299,304" → [[200,299],[304,304]]. Invalid input falls back to the default 200-399. */
function parseStatusSpec(spec) {
	if (!spec || typeof spec !== 'string') return [[200, 399]];
	const ranges = [];
	for (const raw of spec.split(',')) {
		const token = raw.trim();
		if (!token) continue;
		const single = /^(\d{3})$/.exec(token);
		const range = /^(\d{3})-(\d{3})$/.exec(token);
		if (single) {
			ranges.push([Number(single[1]), Number(single[1])]);
		} else if (range) {
			const lo = Number(range[1]);
			const hi = Number(range[2]);
			if (lo <= hi) ranges.push([lo, hi]);
		} else {
			return [[200, 399]]; // malformed → default, validation rejects it at save time
		}
	}
	return ranges.length ? ranges : [[200, 399]];
}

function statusMatches(status, ranges) {
	return ranges.some(([lo, hi]) => status >= lo && status <= hi);
}

/** "tcp://host:443" or "host:443" → {host, port} | null */
function parseTcpTarget(raw) {
	let text = String(raw || '').trim();
	if (/^tcp:\/\//i.test(text)) text = text.slice(6);
	const idx = text.lastIndexOf(':');
	if (idx <= 0) return null;
	const host = text.slice(0, idx);
	const port = Number(text.slice(idx + 1));
	if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
	return { host, port };
}

function buildHeaders(monitor) {
	const headers = {
		'user-agent': 'novapulse/2026',
		accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
	};
	const extra = monitor.headers;
	if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
		let count = 0;
		for (const [rawKey, rawValue] of Object.entries(extra)) {
			if (count >= 10) break;
			const key = String(rawKey).toLowerCase().trim();
			if (!key || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) continue;
			if (FORBIDDEN_HEADERS.has(key)) continue;
			if (typeof rawValue !== 'string') continue;
			headers[key] = rawValue.slice(0, 2048);
			count += 1;
		}
	}
	return headers;
}

function captureSsl(socket) {
	try {
		const cert = typeof socket.getPeerCertificate === 'function' ? socket.getPeerCertificate() : null;
		if (!cert || !cert.valid_to) return null;
		const daysLeft = Math.ceil((Date.parse(cert.valid_to) - Date.now()) / 86400000);
		const issuer = (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || null;
		return { validTo: cert.valid_to, daysLeft, issuer, protocol: socket.getProtocol?.() || null };
	} catch {
		return null;
	}
}

function httpProbe(monitor, redirectCount = 0, baseMs = 0) {
	return new Promise((resolve) => {
		const timeoutMs = monitor.timeoutMs || 10000;
		const startedAt = Date.now();
		let url;
		try {
			url = new URL(monitor.url);
		} catch {
			resolve({ ok: false, status: null, ms: 0, error: 'Invalid URL', timing: null, ssl: null });
			return;
		}

		const isTls = url.protocol === 'https:';
		const lib = isTls ? https : http;
		const headers = buildHeaders(monitor);
		const method = String(monitor.method || 'GET').toUpperCase();
		const hasBody = typeof monitor.body === 'string' && monitor.body.length > 0 && method !== 'GET' && method !== 'HEAD';
		if (hasBody) headers['content-length'] = String(Buffer.byteLength(monitor.body));

		const wantsSsl = isTls && monitor.checkSsl !== false;
		const timing = { dns: null, connect: null, tls: null, ttfb: null, download: null };
		let lastMark = startedAt;
		let responseAt = null;
		let ssl = null;
		let finished = false;

		const finish = (value) => {
			if (finished) return;
			finished = true;
			resolve(value);
		};

		const req = lib.request(
			url,
			{ method, headers, agent: isTls ? httpsAgent : httpAgent, signal: AbortSignal.timeout(timeoutMs) },
			(res) => {
				const status = res.statusCode;
				if (res.socket && wantsSsl && !ssl) ssl = captureSsl(res.socket);

				// Follow redirects, same semantics as fetch's redirect: 'follow'.
				const location = res.headers.location;
				if (REDIRECT_CODES.has(status) && location && redirectCount < MAX_REDIRECTS) {
					res.resume();
					let nextUrl;
					try {
						nextUrl = new URL(location, url).toString();
					} catch {
						nextUrl = null; // unparseable Location — stop following redirects
					}
					if (nextUrl) {
						const elapsed = Date.now() - startedAt;
						const nextMethod =
							status === 303 || ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD')
								? 'GET'
								: method;
						const next = { ...monitor, url: nextUrl, method: nextMethod };
						if (nextMethod === 'GET') delete next.body;
						finished = true; // this hop's handlers must not resolve
						httpProbe(next, redirectCount + 1, baseMs + elapsed).then((result) => {
							if (!result) return resolve(result);
							resolve({
								...result,
								ms: (result.ms || 0) + elapsed,
								redirects: (result.redirects || 0) + 1,
							});
						});
						return;
					}
				}

				responseAt = Date.now();
				timing.ttfb = responseAt - lastMark;

				let bytes = 0;
				let stored = 0;
				let truncated = false;
				const chunks = [];

				const evaluate = () => {
					const ms = baseMs + (Date.now() - startedAt);
					timing.download = responseAt ? Date.now() - responseAt : null;
					const text = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
					const ranges = parseStatusSpec(monitor.expectedStatus);
					let ok = statusMatches(status, ranges);
					let error = ok ? null : `Unexpected status ${status}`;
					if (error && monitor.expectedStatus) error += ` (expected ${monitor.expectedStatus})`;
					if (ok && monitor.expectedKeyword) {
						const needle = String(monitor.expectedKeyword).toLowerCase();
						if (!text.toLowerCase().includes(needle)) {
							ok = false;
							error = `Keyword not found in response: "${monitor.expectedKeyword}"`;
						}
					}
					const warnMs = Number(monitor.warnMs) || 0;
					const degraded = ok && warnMs > 0 && ms >= warnMs;
					finish({
						ok,
						status,
						ms,
						error,
						degraded,
						bytes,
						timing,
						ssl,
						redirects: redirectCount,
						truncated,
					});
				};

				res.on('data', (chunk) => {
					bytes += chunk.length;
					if (truncated) return;
					const room = BODY_CAP - stored;
					if (room > 0) {
						chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
						stored += Math.min(chunk.length, room);
					}
					if (stored >= BODY_CAP) {
						truncated = true;
						res.destroy(); // stop pulling a potentially huge body
					}
				});
				res.on('end', evaluate);
				res.on('error', (err) => {
					if (truncated) evaluate();
					else finish({ ok: false, status, ms: baseMs + (Date.now() - startedAt), error: humanError(err, timeoutMs), timing, ssl, redirects: redirectCount });
				});
				res.on('close', () => {
					if (finished) return;
					if (truncated) evaluate();
					else finish({ ok: false, status, ms: baseMs + (Date.now() - startedAt), error: 'Connection closed before the response completed', timing, ssl, redirects: redirectCount });
				});
			}
		);

		req.on('socket', (socket) => {
			const mark = (key) => {
				const now = Date.now();
				timing[key] = now - lastMark;
				lastMark = now;
			};
			if (socket.connecting) {
				socket.once('lookup', () => mark('dns'));
				socket.once('connect', () => mark('connect'));
				socket.once('secureConnect', () => {
					mark('tls');
					if (wantsSsl) ssl = captureSsl(socket);
				});
			} else if (wantsSsl && typeof /** @type {any} */ (socket).getPeerCertificate === 'function') {
				ssl = captureSsl(socket);
			}
		});

		req.on('error', (err) => {
			finish({
				ok: false,
				status: null,
				ms: baseMs + (Date.now() - startedAt),
				error: humanError(err, timeoutMs),
				timing,
				ssl,
				redirects: redirectCount,
			});
		});

		if (hasBody) req.write(monitor.body);
		req.end();
	});
}

function tcpProbe(monitor) {
	return new Promise((resolve) => {
		const timeoutMs = monitor.timeoutMs || 10000;
		const target = parseTcpTarget(monitor.url);
		if (!target) {
			resolve({ ok: false, status: null, ms: 0, error: 'Invalid tcp://host:port target', timing: null, ssl: null });
			return;
		}
		const startedAt = Date.now();
		const timing = { dns: null, connect: null, tls: null, ttfb: null, download: null };
		let lastMark = startedAt;
		let done = false;
		const finish = (value) => {
			if (done) return;
			done = true;
			resolve(value);
		};

		const socket = net.connect({ host: target.host, port: target.port });
		const timer = setTimeout(() => {
			socket.destroy();
			finish({ ok: false, status: null, ms: Date.now() - startedAt, error: `Timeout after ${timeoutMs}ms`, timing, ssl: null });
		}, timeoutMs);

		socket.on('lookup', () => {
			const now = Date.now();
			timing.dns = now - lastMark;
			lastMark = now;
		});
		socket.on('connect', () => {
			const now = Date.now();
			timing.connect = now - lastMark;
			lastMark = now;
			clearTimeout(timer);
			socket.destroy();
			finish({ ok: true, status: null, ms: now - startedAt, error: null, timing, ssl: null });
		});
		socket.on('error', (err) => {
			clearTimeout(timer);
			finish({ ok: false, status: null, ms: Date.now() - startedAt, error: humanError(err, timeoutMs), timing, ssl: null });
		});
	});
}

async function probe(monitor) {
	const raw = String(monitor.url || '');
	if (monitor.type === 'tcp' || /^tcp:/i.test(raw)) return tcpProbe(monitor);
	if (!/^https?:\/\//i.test(raw)) {
		return { ok: false, status: null, ms: 0, error: 'URL must use http://, https:// or tcp://', timing: null, ssl: null };
	}
	return httpProbe(monitor);
}

module.exports = {
	probe,
	humanError,
	parseStatusSpec,
	statusMatches,
	parseTcpTarget,
	buildHeaders,
	BODY_CAP,
	MAX_REDIRECTS,
};
