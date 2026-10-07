const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { riskCode, collectAlerts, group, renderSummary, main } = require('../tools/zap-policy');

// A faithful slice of the report zaproxy/action-baseline writes to
// report_json.json: an array of sites, each carrying an `alerts` array.
const REPORT = [
	{
		'@programName': 'ZAP',
		alerts: [
			{
				pluginid: '10020',
				alert: 'X-Frame-Options Header Not Set',
				riskcode: '1',
				confidence: '3',
				url: 'http://localhost:3000/',
			},
			{
				pluginid: '10020',
				alert: 'X-Frame-Options Header Not Set',
				riskcode: '1',
				confidence: '3',
				url: 'http://localhost:3000/status',
			},
			{
				pluginid: '10038',
				alert: 'Content Security Policy Header Not Set',
				riskcode: '2',
				confidence: '2',
				url: 'http://localhost:3000/api/health',
			},
		],
	},
	// A second site with an informational finding expressed as `risk`.
	{
		'@programName': 'ZAP',
		alerts: [{ name: 'Timestamp Disclosure', risk: 'Informational', url: 'http://localhost:3000/' }],
	},
];

test('riskCode maps both riskcode strings and risk names to 0-3', () => {
	assert.equal(riskCode({ riskcode: '3' }), 3);
	assert.equal(riskCode({ riskcode: '1' }), 1);
	assert.equal(riskCode({ risk: 'Medium' }), 2);
	assert.equal(riskCode({ risk: 'info' }), 0);
	assert.equal(riskCode({ riskcode: 'nonsense' }), null);
	assert.equal(riskCode({ riskcode: '9' }), null);
	assert.equal(riskCode({}), null);
});

test('collectAlerts walks the whole report and skips non-alerts', () => {
	const alerts = collectAlerts(REPORT);
	assert.equal(alerts.length, 4);
	assert.ok(alerts.every((a) => typeof a.alert === 'string' && Number.isInteger(a.risk)));
	assert.ok(!alerts.some((a) => a.alert === '@programName'));
});

test('group deduplicates repeat findings and sorts by risk', () => {
	const grouped = group(collectAlerts(REPORT));
	assert.equal(grouped.length, 3);
	// Highest risk first.
	assert.equal(grouped[0].alert, 'Content Security Policy Header Not Set');
	assert.equal(grouped[0].risk, 2);
	// The two X-Frame-Options instances collapse into one row with a count.
	const frame = grouped.find((g) => g.risk === 1);
	assert.equal(frame.count, 2);
	assert.equal(frame.url, 'http://localhost:3000/');
	// Informational finding survives with risk 0.
	assert.ok(grouped.some((g) => g.risk === 0 && g.alert === 'Timestamp Disclosure'));
});

test('renderSummary separates blocking findings from informational notices', () => {
	const grouped = group(collectAlerts(REPORT));
	const blocking = grouped.filter((g) => g.risk >= 1);
	const notices = grouped.filter((g) => g.risk === 0);
	const md = renderSummary(grouped, blocking, notices);
	assert.match(md, /blocking findings: \*\*2\*\*/);
	assert.match(md, /informational findings: \*\*1\*\*/);
	assert.match(md, /\| Medium \| Content Security Policy Header Not Set \| 1 \|/);
	assert.match(md, /\| Low \| X-Frame-Options Header Not Set \| 2 \|/);
});

test('main fails when the report is missing or malformed', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-policy-'));
	assert.equal(main(path.join(dir, 'absent.json')), 1);

	const broken = path.join(dir, 'broken.json');
	fs.writeFileSync(broken, '{ not json');
	assert.equal(main(broken), 1);
});

test('main fails the gate on any WARN-level finding and passes on INFO only', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-policy-'));

	const warn = path.join(dir, 'report_json.json');
	fs.writeFileSync(warn, JSON.stringify(REPORT));
	assert.equal(main(warn), 1, 'Medium + Low findings must block');

	const infoOnly = path.join(dir, 'report_json.json');
	fs.writeFileSync(
		infoOnly,
		JSON.stringify([{ alerts: [{ alert: 'Timestamp Disclosure', risk: 'Informational' }] }]),
	);
	assert.equal(main(infoOnly), 0, 'INFO is reported but non-blocking');

	const empty = path.join(dir, 'report_json.json');
	fs.writeFileSync(empty, JSON.stringify([{ alerts: [] }]));
	assert.equal(main(empty), 0, 'a clean report passes');
});
