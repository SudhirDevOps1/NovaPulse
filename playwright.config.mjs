import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration — Darwaza 2 (Heavy PR Gate).
 *
 * Two viewport projects run the same spec file:
 *   desktop-chromium — 1440×900, the primary dashboard target
 *   mobile-chromium  — Pixel 7,  the responsive floor (360px+ layout)
 *
 * The server is started by Playwright itself with an isolated temp data dir so
 * E2E never reads or writes the real `data/monitors.json`.
 */
const PORT = Number(process.env.E2E_PORT || 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false, // one server, one data dir — keep ordering deterministic
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: 45_000,
	expect: { timeout: 8_000 },

	reporter: process.env.CI
		? [['list'], ['html', { open: 'never' }], ['github']]
		: [['list'], ['html', { open: 'never' }]],

	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		actionTimeout: 10_000,
		navigationTimeout: 20_000,
	},

	projects: [
		{
			name: 'desktop-chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
		},
		{
			name: 'mobile-chromium',
			use: { ...devices['Pixel 7'] },
		},
	],

	webServer: {
		command: 'node server.js',
		url: `${BASE_URL}/api/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 45_000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			PORT: String(PORT),
			HOST: '127.0.0.1',
			NODE_ENV: 'test',
			LOG_LEVEL: 'silent',
			LOG_FORMAT: 'json',
			UPTIME_DATA_DIR: './e2e/.tmp-data',
			RATE_LIMIT: 'off',
			// E2E runs headless with no outbound alerting configured.
			TELEGRAM_BOT_TOKEN: '',
			TELEGRAM_CHAT_ID: '',
		},
	},
});
