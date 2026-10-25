/**
 * Dependency-free fixed-window rate limiter.
 * Disabled with RATE_LIMIT=off (useful behind a platform WAF or in tests).
 *
 * The bucket map is hard-capped (RATE_LIMIT_MAX_BUCKETS, default 10 000): with
 * TRUST_PROXY opened up beyond loopback, `X-Forwarded-For` is caller-controlled,
 * and an attacker rotating it on every request used to mint a fresh Map entry
 * each time — unbounded memory growth. Expired buckets are evicted first, then
 * the oldest window, so honest callers keep their bucket.
 *
 * @param {{windowMs?: number, max?: number, maxBuckets?: number, keyOf?: (req: any) => string}} [options]
 */
function rateLimit({ windowMs = 60_000, max = 180, maxBuckets, keyOf } = {}) {
	// A garbage/negative value would make the "while" below never terminate.
	const bucketCap = Math.max(1, Math.round(Number(maxBuckets ?? process.env.RATE_LIMIT_MAX_BUCKETS) || 10_000));
	const buckets = new Map();

	/** Drop expired buckets first so honest callers never lose their window. */
	function makeRoom(nowMs) {
		const expired = [];
		for (const [key, bucket] of buckets) {
			if (bucket.resetAt <= nowMs) expired.push(key);
		}
		if (expired.length) {
			for (const key of expired) buckets.delete(key);
			return;
		}
		let oldestKey = null;
		let oldestResetAt = Infinity;
		for (const [key, bucket] of buckets) {
			if (bucket.resetAt < oldestResetAt) {
				oldestKey = key;
				oldestResetAt = bucket.resetAt;
			}
		}
		if (oldestKey !== null) buckets.delete(oldestKey);
	}

	setInterval(() => {
		const now = Date.now();
		for (const [key, bucket] of buckets) {
			if (bucket.resetAt <= now) buckets.delete(key);
		}
	}, windowMs).unref();

	function limiter(req, res, next) {
		if (String(process.env.RATE_LIMIT || '').toLowerCase() === 'off') return next();

		const key = keyOf ? keyOf(req) : req.ip || 'unknown';
		const now = Date.now();
		let bucket = buckets.get(key);

		if (!bucket || bucket.resetAt <= now) {
			bucket = { count: 0, resetAt: now + windowMs };
			while (buckets.size >= bucketCap) makeRoom(now);
			buckets.set(key, bucket);
		}

		bucket.count += 1;
		const remaining = Math.max(0, max - bucket.count);

		res.setHeader('X-RateLimit-Limit', String(max));
		res.setHeader('X-RateLimit-Remaining', String(remaining));
		res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

		if (bucket.count > max) {
			res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
			return res.status(429).json({ error: 'Too many requests, slow down.' });
		}

		return next();
	}

	/** Test/ops hook: current number of tracked rate-limit buckets. */
	limiter.size = () => buckets.size;
	return limiter;
}

module.exports = { rateLimit };
