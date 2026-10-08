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
const dns = require('node:dns');

const MAX_REDIRECTS = 5;
const BODY_CAP = 1024 * 1024; // read at most 1MB for keyword/size checks
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'expect']);

// Fresh sockets every time (keepAlive off) so timing events always fire.
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

// ---------------------------------------------------------------------------
// SSRF guard
//
// A monitor URL is attacker-controlled input: without this block anything that
// can reach the port could make the probe fetch cloud metadata
// (169.254.169.254), loopback admin panels or RFC1918 services and then read
// the response excerpt back out of GET /api/incidents. We resolve first, check
// every resolved address, then *pin* the address we checked into the socket's
// `lookup` so a DNS-rebinding answer cannot swap the IP between check and
// connect. `ALLOW_PRIVATE_TARGETS=1` restores the old behaviour for self-hosters
// who deliberately monitor their own LAN.
// ---------------------------------------------------------------------------

/** True when the operator opted out of the guard (self-hosted LAN monitoring). */
function allowPrivateTargets() {
	return (
		process.env.NODE_ENV === 'test' ||
		['1', 'true', 'on'].includes(String(process.env.ALLOW_PRIVATE_TARGETS || '').toLowerCase())
	);
}

function isPrivateIPv4(ip) {
	const parts = ip.split('.').map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
	const [a, b] = parts;
	if (a === 0) return true; // 0.0.0.0/8 "this network"
	if (a === 10) return true; // 10/8
	if (a === 127) return true; // loopback
	if (a === 169 && b === 254) return true; // link-local + cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
	if (a === 192 && b === 168) return true; // 192.168/16
	if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 documentation
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
	if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
	if (a >= 224) return true; // multicast, reserved, broadcast
	return false;
}

function isPrivateIPv6(ip) {
	const host = String(ip).split('%')[0].toLowerCase();
	if (!host) return true;
	if (host === '::' || host === '::1') return true;
	if (host.startsWith('::ffff:')) {
		const mapped = host.slice(7);
		// ::ffff:192.168.0.1 (dotted) or ::ffff:c0a8:1 (hex-encoded)
		if (mapped.includes('.')) return isPrivateIPv4(mapped);
		const hex = mapped.split(':');
		if (hex.length === 2) {
			const a = parseInt(hex[0], 16);
			const b = parseInt(hex[1], 16);
			if (Number.isFinite(a) && Number.isFinite(b)) return isPrivateIPv4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
		}
		return true; // unknown mapped form → conservative
	}
	if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // ULA fc00::/7
	if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local fe80::/10
	if (host.startsWith('ff')) return true; // multicast
	if (host.startsWith('64:ff9b')) return true; // NAT64
	if (host.startsWith('2001:db8') || host === '2001:db8::1') return true; // documentation
	return false;
}

/** Any non-global address (IPv4 or IPv6) is blocked. Unknown/unparseable → blocked. */
function isPrivateAddress(ip) {
	if (typeof ip !== 'string' || !ip) return true;
	const family = net.isIP(ip);
	if (family === 4) return isPrivateIPv4(ip);
	if (family === 6) return isPrivateIPv6(ip);
	return true; // not an IP at all
}

/** Hostnames that always mean "this machine", checked before DNS runs. */
function isPrivateHost(hostname) {
	const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost')) return true;
	if (net.isIP(host)) return isPrivateAddress(host);
	return false;
}

/** Pre-resolve the URL's host, reject private answers, pin the checked IP. */
async function resolveTarget(url) {
	const raw = String(url.hostname || '').replace(/^\[|\]$/g, '');
	if (!raw) throw probeError('ENOTFOUND', 'DNS lookup failed (host not found)');
	if (isPrivateHost(raw)) throw probeError('ENETUNREACH', `Blocked private network target: ${raw}`);

	const literalFamily = net.isIP(raw);
	if (literalFamily) return { address: raw, family: literalFamily, dnsMs: 0 };

	const startedAt = Date.now();
	let records;
	try {
		records = await dns.promises.lookup(raw, { all: true });
	} catch (error) {
		throw probeError(error.code || 'ENOTFOUND', `DNS lookup failed (${error.code || error.message})`);
	}
	const dnsMs = Date.now() - startedAt;
	if (!records.length) throw probeError('ENOTFOUND', 'DNS lookup failed (host not found)');

	// Rebinding answers arrive as a mixed public/private set — take a public one.
	const allowed = records.filter((record) => !isPrivateAddress(record.address));
	if (!allowed.length) throw probeError('ENETUNREACH', `Blocked private network target: ${records[0].address}`);
	return { address: allowed[0].address, family: allowed[0].family, dnsMs };
}

function probeError(code, message) {
	const error = /** @type {any} */ (new Error(message));
	error.code = code;
	return error;
}

/**
 * A `lookup` that only ever hands the socket the address we already vetted, so
 * the connection cannot diverge from the SSRF check.
 */
function pinLookup(target) {
	return (hostname, options, callback) => {
		if (typeof options === 'function') {
			callback = options;
			options = {};
		}
		const wantAll = Boolean(options && options.all);
		if (wantAll) return callback(null, [{ address: target.address, family: target.family }]);
		return callback(null, target.address, target.family);
	};
}

/** Overall deadline across a redirect chain — each hop used to get a full timeout. */
function remainingMs(deadlineAt) {
	return deadlineAt - Date.now();
}

/** Uniform failure payload for resolveTarget rejections and redirect rejections. */
function failedProbe(monitor, redirects, ms, error) {
	return {
		ok: false,
		status: null,
		ms,
		error: (error && error.message) || String(error),
		timing: { dns: null, connect: null, tls: null, ttfb: null, download: null },
		ssl: null,
		redirects,
		screenshotUrl: generateScreenshotUrl(monitor.url),
	};
}

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

function generateScreenshotUrl(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return `https://s0.wp.com/mshots/v1/${encodeURIComponent(parsed.origin)}?w=800&h=500`;
		}
	} catch {
		// ignore
	}
	return null;
}

function httpProbe(monitor, redirectCount = 0, baseMs = 0, deadlineAt = 0) {
	return new Promise((resolve) => {
		const timeoutMs = monitor.timeoutMs || 10000;
		const startedAt = Date.now();
		const deadline = deadlineAt || startedAt + timeoutMs;
		let url;
		try {
			url = new URL(monitor.url);
		} catch {
			resolve({ ok: false, status: null, ms: 0, error: 'Invalid URL', timing: null, ssl: null, screenshotUrl: null });
			return;
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			resolve({
				ok: false,
				status: null,
				ms: 0,
				error: 'Redirect target must use http:// or https://',
				timing: null,
				ssl: null,
				screenshotUrl: null,
			});
			return;
		}

		// Resolve + vet the target before a single byte leaves the process.
		const fail = (error) => resolve(failedProbe(monitor, redirectCount, baseMs + (Date.now() - startedAt), error));

		const follow = (target) => {
			const remaining = remainingMs(deadline);
			if (remaining <= 0) {
				fail(probeError('ETIMEDOUT', `Timeout after ${timeoutMs}ms`));
				return;
			}
			// The deadline spans the whole redirect chain, so a loop of hops can
			// never multiply the per-hop timeout.
			const hopBudget = Math.max(1, Math.min(timeoutMs, remaining));
			const isTls = url.protocol === 'https:';
			const lib = isTls ? https : http;
			const headers = buildHeaders(monitor);
			const method = String(monitor.method || 'GET').toUpperCase();
			const hasBody = typeof monitor.body === 'string' && monitor.body.length > 0 && method !== 'GET' && method !== 'HEAD';
			if (hasBody) headers['content-length'] = String(Buffer.byteLength(monitor.body));

			const wantsSsl = isTls && monitor.checkSsl !== false;
			// DNS already happened (and was vetted) in resolveTarget — record it.
			const timing = { dns: target.dnsMs, connect: null, tls: null, ttfb: null, download: null };
			let lastMark = Date.now();
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
				{
					method,
					headers,
					agent: isTls ? httpsAgent : httpAgent,
					signal: AbortSignal.timeout(hopBudget),
					lookup: pinLookup(target),
				},
				(res) => {
				const status = res.statusCode;
				if (res.socket && wantsSsl && !ssl) ssl = captureSsl(res.socket);

				// Follow redirects, same semantics as fetch's redirect: 'follow'.
				const location = res.headers.location;
				if (REDIRECT_CODES.has(status) && location && redirectCount < MAX_REDIRECTS) {
					res.resume();
					let nextUrl = null;
					try {
						const candidate = new URL(location, url);
						if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
							nextUrl = candidate.toString();
						}
					} catch {
						nextUrl = null;
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
						try {
							httpProbe(next, redirectCount + 1, baseMs + elapsed, deadline)
								.then(
									(result) => {
										if (!result) return finish(result);
										finish({
											...result,
											ms: (result.ms || 0) + elapsed,
											redirects: (result.redirects || 0) + 1,
										});
									},
									(error) => finish(failedProbe(monitor, redirectCount + 1, baseMs + elapsed, error))
								)
								.catch((error) => finish(failedProbe(monitor, redirectCount + 1, baseMs + elapsed, error)));
						} catch (syncErr) {
							finish(failedProbe(monitor, redirectCount + 1, baseMs + elapsed, syncErr));
						}
						return;
					}

					finish(
						failedProbe(
							monitor,
							redirectCount,
							baseMs + (Date.now() - startedAt),
							probeError('EINVAL', 'Redirect target must use http:// or https://')
						)
					);
					return;
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
					const screenshotUrl = generateScreenshotUrl(monitor.url);
					const responseSnippet = !ok && text ? text.slice(0, 1024) : null;
					const responseHeaders = !ok && res.headers ? {
						'content-type': res.headers['content-type'] || null,
						'server': res.headers['server'] || null,
					} : null;
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
						responseSnippet,
						responseHeaders,
						screenshotUrl,
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
					else finish({
						ok: false,
						status,
						ms: baseMs + (Date.now() - startedAt),
						error: humanError(err, timeoutMs),
						timing,
						ssl,
						redirects: redirectCount,
						screenshotUrl: generateScreenshotUrl(monitor.url),
					});
				});
				res.on('close', () => {
					if (finished) return;
					if (truncated) evaluate();
					else finish({
						ok: false,
						status,
						ms: baseMs + (Date.now() - startedAt),
						error: 'Connection closed before the response completed',
						timing,
						ssl,
						redirects: redirectCount,
						screenshotUrl: generateScreenshotUrl(monitor.url),
					});
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
				// No `lookup` mark: DNS ran (and was vetted) in resolveTarget and
				// `timing.dns` is already populated from that measurement.
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
				screenshotUrl: generateScreenshotUrl(monitor.url),
			});
		});

		if (hasBody) req.write(monitor.body);
		req.end();
		};

		resolveTarget(url).then(follow, fail);
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
		const failWith = (error) =>
			finish({
				ok: false,
				status: null,
				ms: Date.now() - startedAt,
				error: (error && error.message) || String(error),
				timing,
				ssl: null,
			});

		// Same SSRF guard as HTTP: raw `net.connect` is the easiest way in.
		resolveTarget({ hostname: target.host }).then((resolved) => {
			timing.dns = resolved.dnsMs;
			lastMark = Date.now();

			const socket = net.connect({ host: target.host, port: target.port, lookup: pinLookup(resolved) });
			const timer = setTimeout(() => {
				socket.destroy();
				finish({ ok: false, status: null, ms: Date.now() - startedAt, error: `Timeout after ${timeoutMs}ms`, timing, ssl: null });
			}, timeoutMs);

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
		}, failWith);
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
	generateScreenshotUrl,
	isPrivateAddress,
	isPrivateHost,
	allowPrivateTargets,
	resolveTarget,
	BODY_CAP,
	MAX_REDIRECTS,
};
