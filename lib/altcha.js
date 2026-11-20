const crypto = require('node:crypto');

const HMAC_KEY = process.env.SESSION_SECRET || process.env.ALTCHA_SECRET || 'novapulse-altcha-entropy-seed-2026';
const DEFAULT_MAX_NUMBER = Number(process.env.ALTCHA_MAX_NUMBER) || 35000;
const usedSignatures = new Map(); // signature -> timestamp (TTL 10m)

function purgeExpiredSignatures() {
	const now = Date.now();
	for (const [sig, ts] of usedSignatures.entries()) {
		if (now - ts > 10 * 60 * 1000) {
			usedSignatures.delete(sig);
		}
	}
}

/**
 * Generate a cryptographically signed ALTCHA proof-of-work challenge.
 *
 * @param {{ maxnumber?: number }} [options]
 * @returns {{ algorithm: string, challenge: string, salt: string, signature: string, maxnumber: number }}
 */
function createChallenge({ maxnumber = DEFAULT_MAX_NUMBER } = {}) {
	purgeExpiredSignatures();
	const salt = crypto.randomBytes(12).toString('hex');
	const secretNum = Math.floor(Math.random() * maxnumber) + 1;
	const challenge = crypto.createHash('sha256').update(salt + secretNum).digest('hex');
	const signature = crypto.createHmac('sha256', HMAC_KEY).update(salt + challenge).digest('hex');

	return {
		algorithm: 'SHA-256',
		challenge,
		salt,
		signature,
		maxnumber,
	};
}

/**
 * Verify an ALTCHA proof-of-work solution payload.
 *
 * @param {any} payload
 * @returns {boolean}
 */
function verifySolution(payload) {
	if (!payload) return false;
	try {
		/** @type {any} */
		let data = payload;
		if (typeof payload === 'string') {
			data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
		}
		const { algorithm, challenge, number, salt, signature } = data || {};
		if (algorithm !== 'SHA-256' || typeof challenge !== 'string' || typeof number !== 'number' || typeof salt !== 'string' || typeof signature !== 'string') {
			return false;
		}

		// Replay attack prevention
		purgeExpiredSignatures();
		if (usedSignatures.has(signature)) {
			return false;
		}

		// Verify HMAC signature on salt + challenge
		const expectedSig = crypto.createHmac('sha256', HMAC_KEY).update(salt + challenge).digest('hex');
		const sigBuf = Buffer.from(signature, 'hex');
		const expBuf = Buffer.from(expectedSig, 'hex');
		if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
			return false;
		}

		// Verify Proof of Work
		const computedHash = crypto.createHash('sha256').update(salt + number).digest('hex');
		if (computedHash !== challenge) {
			return false;
		}

		// Mark signature as used
		usedSignatures.set(signature, Date.now());
		return true;
	} catch {
		return false;
	}
}

module.exports = {
	createChallenge,
	verifySolution,
};
