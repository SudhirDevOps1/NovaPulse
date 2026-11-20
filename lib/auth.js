/**
 * Zero-dependency Role-Based Authentication & Session Management.
 *
 * Configured via environment:
 *   ADMIN_USER     - Allowed username or email (default: 'admin')
 *   ADMIN_PASSWORD - Master admin password. If unset, operates in open dev mode.
 *   SESSION_SECRET - Optional HMAC secret. Auto-generates per-process if omitted.
 */
const crypto = require('node:crypto');

const DEFAULT_SECRET = crypto.randomBytes(32).toString('hex');

function getSecret() {
	return process.env.SESSION_SECRET || DEFAULT_SECRET;
}

function isAuthRequired() {
	return Boolean(process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD).trim().length > 0);
}

function getAdminUser() {
	return (process.env.ADMIN_USER && String(process.env.ADMIN_USER).trim()) || 'admin';
}

function timingSafeMatch(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates credentials against environment configuration.
 *
 * @param {string} usernameOrEmail
 * @param {string} password
 * @returns {boolean}
 */
function verifyCredentials(usernameOrEmail, password) {
	if (!isAuthRequired()) return true;
	const expectedUser = getAdminUser().toLowerCase();
	const givenUser = String(usernameOrEmail || '').trim().toLowerCase();
	const expectedPass = String(process.env.ADMIN_PASSWORD || '');
	const givenPass = String(password || '');

	const userMatches = timingSafeMatch(expectedUser, givenUser);
	const passMatches = timingSafeMatch(expectedPass, givenPass);

	return userMatches && passMatches;
}

/**
 * Creates an HMAC-SHA256 signed session token.
 * Token format: Base64Url(JSON({user, exp})) + '.' + Signature
 *
 * @param {string} user
 * @param {number} [durationMs] 7 days default
 * @returns {string}
 */
function createSessionToken(user, durationMs = 7 * 24 * 60 * 60 * 1000) {
	const payload = {
		user,
		exp: Date.now() + durationMs,
	};
	const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const signature = crypto.createHmac('sha256', getSecret()).update(payloadStr).digest('base64url');
	return `${payloadStr}.${signature}`;
}

/**
 * Verifies a signed session token.
 *
 * @param {string} token
 * @returns {{user: string, exp: number}|null}
 */
function verifySessionToken(token) {
	if (!token || typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 2) return null;
	const [payloadStr, signature] = parts;

	const expectedSignature = crypto.createHmac('sha256', getSecret()).update(payloadStr).digest('base64url');
	if (!timingSafeMatch(signature, expectedSignature)) return null;

	try {
		const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
		if (!payload || typeof payload !== 'object') return null;
		if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
		return payload;
	} catch {
		return null;
	}
}

/**
 * Lightweight cookie parser for `Cookie` header.
 *
 * @param {string} [cookieHeader]
 * @returns {Record<string, string>}
 */
function parseCookies(cookieHeader) {
	const cookies = {};
	if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
	for (const pair of cookieHeader.split(';')) {
		const idx = pair.indexOf('=');
		if (idx > 0) {
			const key = pair.slice(0, idx).trim();
			const val = pair.slice(idx + 1).trim();
			try {
				cookies[key] = decodeURIComponent(val);
			} catch {
				cookies[key] = val;
			}
		}
	}
	return cookies;
}

/**
 * Express middleware to enforce authentication on protected endpoints.
 */
function requireAuth(req, res, next) {
	if (!isAuthRequired()) {
		req.user = 'admin';
		return next();
	}

	// 1. Check Authorization: Bearer <token>
	const authHeader = req.headers['authorization'];
	let token = null;
	if (authHeader && authHeader.startsWith('Bearer ')) {
		token = authHeader.slice(7).trim();
	}

	// 2. Check HTTP-only cookie
	if (!token) {
		const cookies = parseCookies(req.headers['cookie']);
		token = cookies['np_session'] || null;
	}

	const session = verifySessionToken(token);
	if (!session) {
		return res.status(401).json({ error: 'Authentication required. Please log in.' });
	}

	req.user = session.user;
	return next();
}

/**
 * Public auth status object.
 */
function authStatus(req) {
	const required = isAuthRequired();
	if (!required) {
		return { authRequired: false, authenticated: true, user: 'admin' };
	}

	const authHeader = req?.headers?.['authorization'];
	let token = null;
	if (authHeader && authHeader.startsWith('Bearer ')) {
		token = authHeader.slice(7).trim();
	}
	if (!token && req?.headers?.['cookie']) {
		const cookies = parseCookies(req.headers['cookie']);
		token = cookies['np_session'] || null;
	}

	const session = verifySessionToken(token);
	return {
		authRequired: true,
		authenticated: Boolean(session),
		user: session?.user || null,
	};
}

module.exports = {
	isAuthRequired,
	getAdminUser,
	verifyCredentials,
	createSessionToken,
	verifySessionToken,
	parseCookies,
	requireAuth,
	authStatus,
};
