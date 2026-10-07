import { test, expect } from '@playwright/test';

/**
 * Public status page + badge surface — the only unauthenticated HTML/JSON
 * endpoints the app exposes, and therefore the ones an attacker sees first.
 * Defaults must be fail-closed: disabled ⇒ 404, never a half-rendered page.
 */

test.describe('status page (disabled by default)', () => {
	test('returns 404 while disabled', async ({ page, request }) => {
		const pageResponse = await page.goto('/status');
		expect(pageResponse?.status()).toBe(404);

		const api = await request.get('/api/public/status');
		expect(api.status()).toBe(404);
	});
});

test.describe('status page (enabled)', () => {
	test.beforeAll(async ({ request }) => {
		// The E2E data dir is disposable, so enabling here is safe.
		const res = await request.patch('/api/settings', {
			data: { statusPage: { enabled: true, title: 'NovaPulse status', message: 'All systems normal' } },
		});
		expect(res.ok()).toBeTruthy();
	});

	test.afterAll(async ({ request }) => {
		await request.patch('/api/settings', { data: { statusPage: { enabled: false } } });
	});

	test('renders the public page without leaking internals', async ({ page }) => {
		const response = await page.goto('/status');
		expect(response?.status()).toBe(200);

		await expect(page).toHaveTitle(/status/i);
		await expect(page.getByText('NovaPulse status')).toBeVisible();

		// No secrets, no API-only state, no stack traces in the public payload.
		const body = await page.content();
		expect(body).not.toContain('TELEGRAM_BOT_TOKEN');
		expect(body).not.toContain('WEBHOOK_SECRET');
		expect(body).not.toMatch(/at .+\(server\.js:\d+/);
	});

	test('public projection JSON exposes only allow-listed fields', async ({ request }) => {
		const res = await request.get('/api/public/status');
		expect(res.status()).toBe(200);

		const payload = await res.json();
		expect(payload).toHaveProperty('enabled', true);
		expect(payload).toHaveProperty('title');
		expect(payload).toHaveProperty('services');

		// allow-list: nothing outside this set may appear in a public payload
		const allowed = new Set(['enabled', 'title', 'message', 'overall', 'services', 'updated', 'incidents']);
		for (const key of Object.keys(payload)) {
			expect(allowed.has(key), `unexpected public field: ${key}`).toBeTruthy();
		}
	});
});

test.describe('badges', () => {
	test('fleet badge renders SVG', async ({ request }) => {
		const res = await request.get('/api/badge/fleet.svg?style=for-the-badge');
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain('image/svg');

		const svg = await res.text();
		expect(svg).toContain('<svg');
		expect(svg).toMatch(/UP|UNKNOWN|DOWN/);
	});

	test('unknown monitor badge is a 404, not a 200 with empty data', async ({ request }) => {
		const res = await request.get('/api/badge/does-not-exist.svg');
		expect(res.status()).toBe(404);
	});
});
