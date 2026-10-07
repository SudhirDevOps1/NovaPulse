import { test, expect } from '@playwright/test';

/**
 * Below 900px the sidebar is `position: fixed; transform: translateX(-100%)`,
 * so its links are technically rendered but lie outside the viewport and a
 * click would time out. The hamburger (`#menu-btn`) has to be opened first;
 * the app closes it again on every `.nav a` click.
 */
async function clickNav(page, name) {
	const menuBtn = page.getByRole('button', { name: 'Open navigation' });
	if (await menuBtn.isVisible()) {
		await menuBtn.click();
		await expect(page.locator('#sidebar')).toHaveClass(/open/);
	}
	await page.getByRole('link', { name }).click();
}

/**
 * The topbar button is the only reliable "New monitor" trigger: its label is
 * `display:none` below 640px (so it has no accessible name on mobile) and the
 * empty-state list also renders a button with the same text — both would make
 * a role/label lookup ambiguous or viewport-dependent.
 */
function newMonitorBtn(page) {
	return page.locator('#new-monitor-btn');
}

/**
 * The data dir persists across local runs, so start every spec from zero
 * instead of trusting leftover state. Going through the API keeps the test
 * independent of list rendering (empty state, filters, pagination).
 */
async function resetMonitors(request) {
	const list = await (await request.get('/api/monitors')).json();
	for (const monitor of list) {
		await request.delete(`/api/monitors/${monitor.id}`);
	}
}

/**
 * Dashboard + monitor lifecycle — the flows a real operator performs.
 *
 * The "save shows a notification" spec is a regression guard for a real
 * production bug: the submit button lived in `.modal-foot`, a sibling of the
 * `<form>` in `.modal-body`, and carried no `[form]` id reference. The button
 * therefore belonged to no form, clicking it fired no `submit` event, and the
 * save silently did nothing — no API call, no toast, no monitor.
 */

test.describe('dashboard shell', () => {
	test('loads the overview and reports API connectivity', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveTitle(/NovaPulse/);
		await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
		await expect(page.locator('#api-label')).toHaveText('API connected', { timeout: 15_000 });
	});

	test('navigates between routes and marks the active nav item', async ({ page }) => {
		await page.goto('/');

		await clickNav(page, /Monitors/);
		await expect(page).toHaveURL(/#\/monitors/);
		await expect(page.locator('[data-nav="monitors"]')).toHaveAttribute('aria-current', 'page');
		await expect(page.locator('[data-nav="overview"]')).not.toHaveAttribute('aria-current', 'page');

		await clickNav(page, /Settings/);
		await expect(page).toHaveURL(/#\/settings/);
		await expect(page.locator('[data-nav="settings"]')).toHaveAttribute('aria-current', 'page');
	});

	test('sends hardened security headers', async ({ page }) => {
		const response = await page.goto('/');
		const headers = response?.headers() ?? {};

		expect(headers['content-security-policy']).toContain("default-src 'self'");
		expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['x-frame-options']).toBe('DENY');
		expect(headers['referrer-policy']).toBe('no-referrer');
		expect(headers['x-powered-by']).toBeUndefined();
	});
});

test.describe('monitor lifecycle', () => {
	test.beforeEach(async ({ page, request }) => {
		// start each spec from a clean, known state
		await resetMonitors(request);
		await page.goto('/');
		await clickNav(page, /Monitors/);
		await expect(newMonitorBtn(page)).toBeVisible();
	});

	test('saving a new monitor shows a success notification', async ({ page }) => {
		await page.goto('/');
		await newMonitorBtn(page).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		await dialog.getByLabel('Name', { exact: true }).fill('E2E Probe');
		await dialog.getByLabel('URL').fill('https://example.com');

		// REGRESSION GUARD: the submit button lives in the modal footer, outside
		// the <form>. Clicking it must actually submit the form.
		await dialog.getByRole('button', { name: 'Create monitor' }).click();

		// The notification is the observable proof that save completed.
		const toast = page.locator('.toast').filter({ hasText: 'Monitor created' }).first();
		await expect(toast).toBeVisible({ timeout: 15_000 });
		await expect(toast).toHaveClass(/success/);
		await expect(toast).toContainText('E2E Probe');

		// and the monitor really exists server-side
		await expect(page.locator('#nav-monitors')).toHaveText('1');
	});

	test('validation errors surface inline instead of a silent no-op', async ({ page }) => {
		await page.goto('/');
		await newMonitorBtn(page).click();

		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Name', { exact: true }).fill('');
		await dialog.getByRole('button', { name: 'Create monitor' }).click();

		await expect(dialog.getByText('Name is required')).toBeVisible();
		await expect(page.locator('.modal')).toBeVisible(); // dialog stays open
	});

	test('saving changes to an existing monitor notifies the user', async ({ page }) => {
		await page.goto('/');
		await clickNav(page, /Monitors/);
		await newMonitorBtn(page).click();

		const create = page.getByRole('dialog');
		await create.getByLabel('Name', { exact: true }).fill('Renameable');
		await create.getByLabel('URL').fill('https://example.org');
		await create.getByRole('button', { name: 'Create monitor' }).click();
		await expect(page.locator('.toast').filter({ hasText: 'Monitor created' })).toBeVisible({
			timeout: 15_000,
		});

		await page.getByRole('button', { name: /edit/i }).first().click();
		const edit = page.getByRole('dialog');
		await expect(edit.getByRole('heading', { name: 'Edit monitor' })).toBeVisible();

		await edit.getByLabel('Name', { exact: true }).fill('Renamed monitor');
		await edit.getByRole('button', { name: 'Save changes' }).click();

		const toast = page.locator('.toast').filter({ hasText: 'Monitor updated' }).first();
		await expect(toast).toBeVisible({ timeout: 15_000 });
		await expect(toast).toContainText('Renamed monitor');
	});

	test('a created monitor persists across a page reload', async ({ page }) => {
		await page.goto('/');
		await newMonitorBtn(page).click();

		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Name', { exact: true }).fill('Persistent');
		await dialog.getByLabel('URL').fill('https://example.net');
		await dialog.getByRole('button', { name: 'Create monitor' }).click();
		await expect(page.locator('.toast').filter({ hasText: 'Monitor created' })).toBeVisible({
			timeout: 15_000,
		});

		await page.reload();
		await clickNav(page, /Monitors/);
		await expect(page.getByText('Persistent')).toBeVisible();
	});
});

test.describe('responsive layout', () => {
	test('sidebar collapses into a menu button on narrow viewports', async ({ page, isMobile }) => {
		await page.goto('/');
		const menuButton = page.getByRole('button', { name: 'Open navigation' });

		if (isMobile) {
			await expect(menuButton).toBeVisible();
			await menuButton.click();
			await expect(page.locator('#sidebar')).toHaveClass(/open/);
		} else {
			await expect(page.locator('#sidebar')).toBeVisible();
		}
	});
});
