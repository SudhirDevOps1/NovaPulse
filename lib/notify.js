/* Notification fan-out — every configured channel gets every alert.
 * All channels are plain HTTP calls, zero dependencies.
 *
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  → Telegram bot
 *   DISCORD_WEBHOOK_URL                    → Discord webhook
 *   NTFY_URL (+ optional NTFY_TOKEN)       → ntfy.sh / self-hosted ntfy topic
 *   WEBHOOK_URL (+ optional WEBHOOK_SECRET)→ generic JSON webhook
 */
const logger = require('./logger');

const TIMEOUT_MS = 5000;

function enabled() {
	return {
		telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
		discord: Boolean(process.env.DISCORD_WEBHOOK_URL),
		ntfy: Boolean(process.env.NTFY_URL),
		webhook: Boolean(process.env.WEBHOOK_URL),
	};
}

/**
 * POST/GET helper with a hard timeout. Rejects with an Error carrying `.status`
 * so callers can classify rate-limits vs. outages.
 *
 * @param {string} url
 * @param {{method?: string, headers?: Record<string, string>, body?: string}} [options]
 * @returns {Promise<Response>}
 */
async function post(url, { method = 'POST', headers = {}, body } = {}) {
	const response = await fetch(url, {
		method,
		headers,
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) {
		const status = response.status;
		const error = /** @type {Error & {status?: number}} */ (new Error(`HTTP ${status}`));
		error.status = status;
		throw error;
	}
	return response;
}

function channelSenders(text, meta = {}) {
	const senders = [];
	const state = enabled();

	if (state.telegram) {
		senders.push({
			name: 'telegram',
			send: () =>
				post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						chat_id: process.env.TELEGRAM_CHAT_ID,
						text,
						disable_web_page_preview: true,
					}),
				}),
		});
	}

	if (state.discord) {
		senders.push({
			name: 'discord',
			send: () =>
				post(process.env.DISCORD_WEBHOOK_URL, {
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ content: text.slice(0, 2000), username: 'NovaPulse' }),
				}),
		});
	}

	if (state.ntfy) {
		senders.push({
			name: 'ntfy',
			send: () => {
				const headers = {
					Title: meta.title || 'NovaPulse alert',
					Tags: meta.event === 'down' ? 'rotating_light' : meta.event === 'up' ? 'white_check_mark' : 'hourglass',
				};
				if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
				return post(process.env.NTFY_URL, { headers, body: text });
			},
		});
	}

	if (state.webhook) {
		senders.push({
			name: 'webhook',
			send: () => {
				const headers = { 'content-type': 'application/json' };
				if (process.env.WEBHOOK_SECRET) headers['x-novapulse-secret'] = process.env.WEBHOOK_SECRET;
				return post(process.env.WEBHOOK_URL, {
					headers,
					body: JSON.stringify({
						text,
						event: meta.event || 'info',
						title: meta.title || null,
						monitor: meta.monitor ? { name: meta.monitor.name, url: meta.monitor.url } : null,
						at: new Date().toISOString(),
					}),
				});
			},
		});
	}

	return senders;
}

/** Fire the alert on every configured channel; failures are logged, never thrown. */
async function notify(text, meta = {}) {
	const senders = channelSenders(text, meta);
	if (!senders.length) return;
	const results = await Promise.allSettled(senders.map((channel) => channel.send()));
	results.forEach((result, index) => {
		if (result.status === 'rejected') {
			logger.warn('Notification failed', {
				channel: senders[index].name,
				error: result.reason?.message || String(result.reason),
			});
		}
	});
}

/** For the Settings page / health endpoint. */
function channelStatus() {
	return enabled();
}

module.exports = { notify, channelStatus, enabled };
