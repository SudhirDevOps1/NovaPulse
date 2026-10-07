/**
 * Dependency-free fixed-window rate limiter.
 * Disabled with RATE_LIMIT=off (useful behind a platform WAF or in tests).
 */
function rateLimit({ windowMs = 60_000, max = 180, name = 'default', keyOf } = {}) {
	const buckets = new Map();

	setInterval(() => {
		const now = Date.now();
		for (const [key, bucket] of buckets) {
			if (bucket.resetAt <= now) buckets.delete(key);
		}
	}, windowMs).unref();

	return function limiter(req, res, next) {
		if (String(process.env.RATE_LIMIT || '').toLowerCase() === 'off') return next();

		const key = keyOf ? keyOf(req) : req.ip || 'unknown';
		const now = Date.now();
		let bucket = buckets.get(key);

		if (!bucket || bucket.resetAt <= now) {
			bucket = { count: 0, resetAt: now + windowMs };
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
	};
}

module.exports = { rateLimit };
