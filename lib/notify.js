/* Notification fan-out — every configured channel gets every alert.
 * All channels are plain HTTP calls, zero dependencies.
 *
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  → Telegram bot
 *   DISCORD_WEBHOOK_URL                    → Discord webhook
 *   SLACK_WEBHOOK_URL                      → Slack incoming webhook (BlockKit)
 *   NTFY_URL (+ optional NTFY_TOKEN)       → ntfy.sh / self-hosted ntfy topic
 *   WEBHOOK_URL (+ optional WEBHOOK_SECRET)→ generic JSON webhook
 */
const logger = require('./logger');

const TIMEOUT_MS = 5000;

function enabled() {
	return {
		telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
		discord: Boolean(process.env.DISCORD_WEBHOOK_URL),
		slack: Boolean(process.env.SLACK_WEBHOOK_URL),
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
						// Telegram rejects >4096 chars with a 400, which would drop
						// the alert entirely — truncate instead.
						text: String(text).slice(0, 4096),
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

	if (state.slack) {
		senders.push({
			name: 'slack',
			send: () => {
				const blocks = /** @type {Array<Record<string, unknown>>} */ ([
					{ type: 'section', text: { type: 'mrkdwn', text: String(text).slice(0, 2900) } },
				]);
				if (meta.monitor?.url) {
					blocks.push({
						type: 'context',
						elements: [{ type: 'mrkdwn', text: `\`${meta.monitor.url}\` · ${meta.event || 'info'}` }],
					});
				}
				return post(process.env.SLACK_WEBHOOK_URL, {
					headers: { 'content-type': 'application/json' },
					// `text` is the push-notification fallback; blocks render the alert.
					body: JSON.stringify({ text: String(text).slice(0, 1500), blocks }),
				});
			},
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

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

/** 4xx (other than 429) will fail identically on the next attempt — don't retry. */
function isRetryable(error) {
	const status = error?.status;
	if (!status) return true; // network error / timeout
	return status === 429 || status >= 500;
}

/**
 * One channel, up to RETRY_ATTEMPTS tries with exponential backoff. A single
 * attempt meant a momentary webhook blip permanently lost the alert: nothing
 * re-sent it because the state machine had already moved on.
 *
 * @returns {Promise<Error|null>} the last error, or null on success.
 */
async function sendWithRetry(send, attempts = RETRY_ATTEMPTS) {
	let lastError = null;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			await send();
			return null;
		} catch (error) {
			lastError = error;
			if (!isRetryable(error) || attempt === attempts - 1) break;
			await new Promise((resolve) => {
				setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt);
			});
		}
	}
	return lastError;
}

/** Fire the alert on every configured channel; failures are logged, never thrown. */
async function notify(text, meta = {}) {
	const senders = channelSenders(text, meta);
	if (!senders.length) return;
	const failures = await Promise.all(senders.map((channel) => sendWithRetry(() => channel.send())));
	failures.forEach((error, index) => {
		if (error) {
			logger.warn('Notification failed', {
				channel: senders[index].name,
				attempts: RETRY_ATTEMPTS,
				error: error.message || String(error),
			});
		}
	});
}

/** For the Settings page / health endpoint. */
function channelStatus() {
	return enabled();
}

module.exports = { notify, channelStatus, enabled };
