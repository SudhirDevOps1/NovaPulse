#!/usr/bin/env node
/**
 * Darwaza 2 · ZAP baseline policy.
 *
 * The `zaproxy/action-baseline` action writes `report_json.json` (a ZAP JSON
 * report) into the workspace and uploads it as the `zap_scan` artifact. It
 * does NOT produce the `zap-baseline.conf` file a `-w` style script would —
 * that is why the previous policy step could never evaluate anything: it
 * grepped for a file ZAP never writes, and the step was skipped anyway
 * because the action itself had died filing an issue without `issues: write`.
 *
 * Policy (documented in .github/workflows/e2e-gate.yml):
 *   riskcode 3 (High)      → blocking error
 *   riskcode 2 (Medium)    → blocking error
 *   riskcode 1 (Low)       → blocking error  ("any WARN-level finding fails")
 *   riskcode 0 (Info)      → notice, non-blocking ("INFO is reported")
 *
 * Exit codes: 0 = policy satisfied, 1 = blocking findings (or no report).
 *
 * Usage: node tools/zap-policy.js [path/to/report_json.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RISK_BY_CODE = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'Informational' };
const RISK_BY_NAME = {
	high: 3,
	medium: 2,
	low: 1,
	informational: 0,
	info: 0,
};

/** Normalise whatever the report calls the risk into a 0-3 code, or null. */
function riskCode(alert) {
	if (alert.riskcode !== undefined && alert.riskcode !== null) {
		const n = Number(alert.riskcode);
		return Number.isFinite(n) && n >= 0 && n <= 3 ? n : null;
	}
	if (typeof alert.risk === 'string') {
		const mapped = RISK_BY_NAME[alert.risk.trim().toLowerCase()];
		return mapped === undefined ? null : mapped;
	}
	return null;
}

/** Depth-first walk collecting every alert-shaped object in the report. */
function collectAlerts(node, out) {
	const acc = out || [];
	if (Array.isArray(node)) {
		for (const item of node) collectAlerts(item, acc);
		return acc;
	}
	if (node && typeof node === 'object') {
		const name = typeof node.alert === 'string' ? node.alert : node.name;
		if (typeof name === 'string' && riskCode(node) !== null) {
			acc.push({
				alert: name,
				risk: riskCode(node),
				url: typeof node.url === 'string' ? node.url : '',
				pluginid: node.pluginid === undefined ? '' : String(node.pluginid),
			});
		}
		for (const value of Object.values(node)) collectAlerts(value, acc);
	}
	return acc;
}

/** Group identical findings so one misconfiguration does not repeat xN. */
function group(alerts) {
	const byKey = new Map();
	for (const a of alerts) {
		const key = a.risk + '\u0000' + a.pluginid + '\u0000' + a.alert;
		const entry = byKey.get(key);
		if (entry) {
			entry.count += 1;
			if (!entry.url) entry.url = a.url;
		} else {
			byKey.set(key, { alert: a.alert, risk: a.risk, url: a.url, pluginid: a.pluginid, count: 1 });
		}
	}
	return [...byKey.values()].sort(
		(x, y) => y.risk - x.risk || x.alert.localeCompare(y.alert),
	);
}

/** Markdown block for the workflow step summary. */
function renderSummary(grouped, blocking, notices) {
	const lines = [
		'## ZAP baseline policy',
		'',
		`- blocking findings: **${blocking.length}**`,
		`- informational findings: **${notices.length}**`,
		'',
	];
	if (grouped.length) {
		lines.push('| risk | alert | occurrences | sample url |');
		lines.push('| --- | --- | --- | --- |');
		for (const g of grouped) {
			lines.push(
				`| ${RISK_BY_CODE[g.risk]} | ${g.alert} | ${g.count} | ${g.url || '—'} |`,
			);
		}
	} else {
		lines.push('_No findings — the policy is satisfied._');
	}
	lines.push('');
	return lines.join('\n');
}

function main(reportPathArg) {
	const reportPath = path.resolve(reportPathArg || 'report_json.json');
	if (!fs.existsSync(reportPath)) {
		console.error(
			`::error::ZAP produced no report at ${path.basename(reportPath)} — treating as failure`,
		);
		return 1;
	}

	let report;
	try {
		report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
	} catch (error) {
		console.error(`::error::ZAP report is not valid JSON: ${error.message}`);
		return 1;
	}

	const grouped = group(collectAlerts(report));
	const blocking = grouped.filter((g) => g.risk >= 1);
	const notices = grouped.filter((g) => g.risk === 0);

	console.log(
		`ZAP findings: ${grouped.length} distinct (${blocking.length} blocking, ${notices.length} informational)`,
	);
	for (const g of grouped) {
		console.log(
			`  ${RISK_BY_CODE[g.risk].padEnd(15)} ${g.alert} x${g.count}${g.url ? `  ${g.url}` : ''}`,
		);
	}

	if (process.env.GITHUB_STEP_SUMMARY) {
		fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${renderSummary(grouped, blocking, notices)}\n`);
	}
	if (process.env.GITHUB_ACTIONS) {
		for (const g of blocking) {
			console.error(
				`::error title=ZAP ${RISK_BY_CODE[g.risk]}::${g.alert} x${g.count}${g.url ? ` — ${g.url}` : ''}`,
			);
		}
	}

	if (blocking.length) {
		console.error(`ZAP baseline reported ${blocking.length} blocking finding(s)`);
		return 1;
	}
	return 0;
}

module.exports = { riskCode, collectAlerts, group, renderSummary, main };

if (require.main === module) {
	process.exit(main(process.argv[2]));
}
