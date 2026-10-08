/**
 * NovaPulse 2026 — Upptime-Grade GitHub Issues Incident Automation
 *
 * Automatically opens GitHub Issues when a service goes DOWN with diagnostic
 * metadata (status code, 1KB error snippet, headers, screenshot preview).
 * Automatically resolves and closes GitHub Issues when service recovers.
 */

const API_BASE = 'https://api.github.com';

function getHeaders(token) {
	return {
		authorization: `Bearer ${token}`,
		accept: 'application/vnd.github+json',
		'content-type': 'application/json',
		'user-agent': 'novapulse/2026-incident-bot',
	};
}

/**
 * Searches for an open issue for this monitor.
 * @param {string} token
 * @param {string} repo - owner/repo
 * @param {string} monitorName
 * @returns {Promise<any>}
 */
async function findOpenIncidentIssue(token, repo, monitorName) {
	if (!token || !repo) return null;
	try {
		const res = await fetch(`${API_BASE}/repos/${repo}/issues?state=open&labels=incident`, {
			headers: getHeaders(token),
		});
		if (!res.ok) return null;
		const issues = /** @type {Array<any>} */ (await res.json());
		if (!Array.isArray(issues)) return null;
		return (
			issues.find((issue) =>
				issue.title && issue.title.includes(monitorName)
			) || null
		);
	} catch {
		return null;
	}
}

/**
 * Opens a GitHub Issue when downtime is detected.
 * @param {any} monitor - Monitor definition
 * @param {any} [failure] - Failure diagnostic details
 * @param {any} [env] - Environment containing GITHUB_TOKEN & GITHUB_REPOSITORY
 * @returns {Promise<any>}
 */
async function handleDowntimeIssue(monitor, failure = {}, env = process.env) {
	const token = env.GITHUB_TOKEN || env.GH_PAT;
	const repo = env.GITHUB_REPOSITORY;
	if (!token || !repo) return null;

	const existing = await findOpenIncidentIssue(token, repo, monitor.name);
	if (existing) {
		// Post an update comment
		try {
			await fetch(`${API_BASE}/repos/${repo}/issues/${existing.number}/comments`, {
				method: 'POST',
				headers: getHeaders(token),
				body: JSON.stringify({
					body: `⚠️ **Ongoing Outage Update** — ${new Date().toISOString()}\nTarget: \`${monitor.url}\`\nStatus: \`${failure.status || 'Down'}\` · ${failure.error || 'Connection failed'}.`,
				}),
			});
		} catch {
			// ignore
		}
		return existing;
	}

	// Create new issue
	const body = [
		`### 🚨 Outage Detected: ${monitor.name}`,
		'',
		`| Property | Details |`,
		`| :--- | :--- |`,
		`| **Target URL** | \`${monitor.url}\` |`,
		`| **Downtime Started** | \`${new Date().toISOString()}\` |`,
		`| **HTTP Status / Error** | \`${failure.status || 'N/A'}\` — ${failure.error || 'Connection error'} |`,
		`| **Latency** | \`${failure.ms || 0}ms\` |`,
		'',
		failure.responseSnippet
			? `#### 🩺 Diagnostic Error Snippet (Raw Body)\n\`\`\`\n${failure.responseSnippet}\n\`\`\`\n`
			: '',
		failure.screenshotUrl
			? `#### 📸 Visual Snapshot\n![Visual Snapshot](${failure.screenshotUrl})\n`
			: '',
		`*Automated by NovaPulse 2026 Upptime Engine.*`,
	].filter(Boolean).join('\n');

	try {
		const res = await fetch(`${API_BASE}/repos/${repo}/issues`, {
			method: 'POST',
			headers: getHeaders(token),
			body: JSON.stringify({
				title: `🚨 Incident: ${monitor.name} is DOWN`,
				body,
				labels: ['incident', 'downtime', 'automated'],
			}),
		});

		if (res.ok) {
			return await res.json();
		}
	} catch {
		// fail-safe
	}
	return null;
}

/**
 * Closes a GitHub Issue when service recovers.
 * @param {any} monitor - Monitor definition
 * @param {any} [recovery] - Recovery details
 * @param {any} [env] - Environment
 * @returns {Promise<any>}
 */
async function handleRecoveryIssue(monitor, recovery = {}, env = process.env) {
	const token = env.GITHUB_TOKEN || env.GH_PAT;
	const repo = env.GITHUB_REPOSITORY;
	if (!token || !repo) return null;

	const existing = await findOpenIncidentIssue(token, repo, monitor.name);
	if (!existing) return null;

	try {
		// 1. Post resolution comment
		await fetch(`${API_BASE}/repos/${repo}/issues/${existing.number}/comments`, {
			method: 'POST',
			headers: getHeaders(token),
			body: JSON.stringify({
				body: `### 🟢 Service Recovered\n\`${monitor.name}\` (${monitor.url}) has recovered and responded successfully at \`${new Date().toISOString()}\` (${recovery.ms || 0}ms).\n\nClosing incident automatically.`,
			}),
		});

		// 2. Close issue
		const closeRes = await fetch(`${API_BASE}/repos/${repo}/issues/${existing.number}`, {
			method: 'PATCH',
			headers: getHeaders(token),
			body: JSON.stringify({
				state: 'closed',
				state_reason: 'completed',
			}),
		});

		if (closeRes.ok) {
			return await closeRes.json();
		}
	} catch {
		// fail-safe
	}
	return null;
}

module.exports = {
	findOpenIncidentIssue,
	handleDowntimeIssue,
	handleRecoveryIssue,
};
