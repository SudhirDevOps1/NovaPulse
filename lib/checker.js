const store = require('./store');
const logger = require('./logger');
const { probe } = require('./probe');
const { notify } = require('./notify');
const { handleDowntimeIssue, handleRecoveryIssue } = require('./github-issues');

const DAY_MS = 24 * 60 * 60 * 1000;

function sslWarnDays() {
	const value = Number(process.env.SSL_WARN_DAYS);
	return Number.isFinite(value) && value >= 0 ? value : 14;
}

function alertOnDegraded() {
	return ['1', 'true', 'on'].includes(String(process.env.ALERT_ON_DEGRADED || '').toLowerCase());
}

/**
 * Minimum gap between two notifications for the *same* monitor and the *same*
 * direction. Without it a marginal endpoint with `failuresBeforeDown: 1` emits a
 * DOWN+UP pair (each fanned out to every configured channel) on every check —
 * i.e. an alert storm for an endpoint that never really goes down. Set
 * `ALERT_COOLDOWN_MS=0` to restore unthrottled alerting.
 */
function alertCooldownMs() {
	const value = Number(process.env.ALERT_COOLDOWN_MS);
	return Number.isFinite(value) && value >= 0 ? value : 5 * 60 * 1000;
}

function withinCooldown(lastAlertAt) {
	if (!lastAlertAt) return false;
	return Date.now() - lastAlertAt < alertCooldownMs();
}

/** True only when a notification should actually leave the process. */
function gateAlert(monitor, key) {
	if (withinCooldown(monitor[key])) {
		logger.debug('Alert suppressed by cooldown', { name: monitor.name, cooldownMs: alertCooldownMs() });
		return false;
	}
	monitor[key] = Date.now();
	return true;
}

function record(monitor, result) {
	// The monitor can be deleted while its probe is still in flight. Writing now
	// would push an orphan incident and notify about something that no longer
	// exists (`store.addHistory` bails out, but everything below did not).
	if (!store.get(monitor.id)) return monitor;

	const at = new Date().toISOString();
	const previousStatus = monitor.status;
	monitor.lastCheck = { at, ...result };
	monitor.status = result.ok ? (result.degraded ? 'degraded' : 'up') : 'down';

	const historyEntry = { at, ok: result.ok, status: result.status, ms: result.ms };
	if (result.degraded) historyEntry.degraded = true;
	store.addHistory(monitor.id, historyEntry);

	// Certificate tracking + daily expiry reminder.
	if (result.ssl) {
		monitor.ssl = { validTo: result.ssl.validTo, daysLeft: result.ssl.daysLeft, issuer: result.ssl.issuer };
		if (result.ssl.daysLeft <= sslWarnDays()) {
			if (!monitor.sslWarnedAt || Date.now() - monitor.sslWarnedAt > DAY_MS) {
				monitor.sslWarnedAt = Date.now();
				logger.warn('SSL certificate expiring', { name: monitor.name, daysLeft: result.ssl.daysLeft });
				notify(
					`🟡 SSL EXPIRING: ${monitor.name}\ncertificate valid until ${result.ssl.validTo} (${result.ssl.daysLeft} day(s) left)`,
					{ event: 'ssl', title: 'Certificate expiring', monitor }
				);
			}
		} else {
			monitor.sslWarnedAt = null;
		}
	}

	// Grace period: an outage is declared only after N consecutive failures.
	const threshold = Math.max(1, Number(monitor.failuresBeforeDown) || 1);

	if (!result.ok) {
		monitor.consecutiveFailures += 1;
		// `>=` rather than `===`: if `failuresBeforeDown` is lowered while an
		// outage is already past the new threshold the equality never matched and
		// no DOWN alert was ever sent. `wasDown` keeps it to one alert per outage.
		if (monitor.consecutiveFailures >= threshold && !monitor.wasDown) {
			monitor.wasDown = true;
			store.pushIncident({
				monitorId: monitor.id,
				name: monitor.name,
				url: monitor.url,
				type: 'down',
				reason: result.error,
				status: result.status,
				responseSnippet: result.responseSnippet || null,
				responseHeaders: result.responseHeaders || null,
				screenshotUrl: result.screenshotUrl || null,
			});
			logger.warn('Monitor down', { name: monitor.name, error: result.error });
			if (gateAlert(monitor, 'lastDownAlertAt')) {
				notify(`🔴 DOWN: ${monitor.name}\n${monitor.url}\n${result.error}${result.responseSnippet ? `\n\nPreview:\n${result.responseSnippet.slice(0, 200)}...` : ''}`, {
					event: 'down',
					title: 'Monitor down',
					monitor,
					incident: {
						reason: result.error,
						status: result.status,
						responseSnippet: result.responseSnippet,
						screenshotUrl: result.screenshotUrl,
					},
				});
			}
			handleDowntimeIssue(monitor, result).catch(() => {});
		}
	} else {
		if (monitor.wasDown) {
			const downIncident = findDownIncident(monitor.id);
			const minutes = downIncident
				? Math.max(1, Math.round((Date.now() - Date.parse(downIncident.at)) / 60000))
				: null;
			store.pushIncident({
				monitorId: monitor.id,
				name: monitor.name,
				url: monitor.url,
				type: 'up',
				reason: minutes ? `Recovered after ~${minutes} min` : 'Recovered',
			});
			monitor.wasDown = false;
			logger.info('Monitor recovered', { name: monitor.name, downtimeMinutes: minutes });
			if (gateAlert(monitor, 'lastUpAlertAt')) {
				notify(`🟢 UP: ${monitor.name}\n${monitor.url} is back online.`, {
					event: 'up',
					title: 'Monitor recovered',
					monitor,
				});
			}
			handleRecoveryIssue(monitor, result).catch(() => {});
		}
		monitor.consecutiveFailures = 0;

		if (result.degraded && previousStatus !== 'degraded' && alertOnDegraded()) {
			logger.warn('Monitor degraded', { name: monitor.name, ms: result.ms, warnMs: monitor.warnMs });
			notify(`🟠 SLOW: ${monitor.name}\n${monitor.url}\n${result.ms}ms (threshold ${monitor.warnMs}ms)`, {
				event: 'degraded',
				title: 'Monitor slow',
				monitor,
			});
		}
	}

	store.save();
	return monitor;
}

function findDownIncident(monitorId) {
	return store.incidents(10, { monitorId, type: 'down' })[0];
}

async function checkNow(monitor) {
	const result = await probe(monitor);
	logger.debug('Checked', {
		name: monitor.name,
		ok: result.ok,
		status: result.status,
		ms: result.ms,
		degraded: Boolean(result.degraded),
	});
	return record(monitor, result);
}

/**
 * Shared scheduler: fires due checks, never overlaps a monitor's own checks,
 * and staggers start times to avoid a burst after restart.
 *
 * `run()` is the single entry point for *every* check — the ticker, the
 * create-triggered check and POST /api/monitors/:id/check. Before it existed
 * the manual paths bypassed `inFlight`, so a hand-triggered check raced the
 * scheduler and an older in-flight result could overwrite a newer one.
 */
function createScheduler(storeRef) {
	const inFlight = new Map();
	const lastRun = new Map();

	/** Run a check, or join the one already running for this monitor. */
	function run(monitor) {
		const existing = inFlight.get(monitor.id);
		if (existing) return existing;
		lastRun.set(monitor.id, Date.now());
		const promise = checkNow(monitor).finally(() => inFlight.delete(monitor.id));
		inFlight.set(monitor.id, promise);
		return promise;
	}

	function tick() {
		const now = Date.now();
		for (const monitor of storeRef.list()) {
			if (!monitor.enabled) continue;
			const intervalMs = Math.max(10, monitor.intervalSec) * 1000;
			const previous = lastRun.get(monitor.id) ?? 0;
			if (now - previous < intervalMs) continue;
			if (inFlight.has(monitor.id)) continue;
			run(monitor).catch((error) => logger.error('Check crashed', { error: error.message }));
		}
	}

	function forget(id) {
		lastRun.delete(id);
		inFlight.delete(id);
	}

	function start(intervalMs = 5000) {
		for (const monitor of storeRef.list()) {
			const jitter = Math.floor(Math.random() * Math.min(5000, monitor.intervalSec * 1000));
			lastRun.set(monitor.id, Date.now() - jitter);
		}
		const timer = setInterval(tick, intervalMs);
		tick();
		return timer;
	}

	return { run, tick, forget, start };
}

module.exports = { probe, checkNow, createScheduler };
