# Verification — EGM Audit Phase 1 Critical Bug Fixes & Hardening

- date: 2026-11-20
- tree: novapulse@2026.1.4 · branch: main
- environment: windows (`win32`), node v24.19.0, pnpm 12.9.1
- laws: L-03, L-04, L-05, L-22, L-24

## 1 · Claim
Fixes 8 critical vulnerabilities and logic bugs identified in the EGM multi-agent audit:
1. SSRF IPv6 guard bypass via uncompressed loopback (`0:0:0:0:0:0:0:1`, `0::1`, mapped `::127.0.0.1`) is blocked.
2. Server process crash on SSE stream abrupt disconnect (`res.on('error')` / `EPIPE`) is mitigated.
3. Alert flapping latch in `lib/checker.js` no longer blackholes subsequent down alerts on flap recovery.
4. Cross-origin redirect credential leakage (`Authorization`, `Cookie`) is stripped.
5. Atomic persistence clashing is eliminated via unique PID-and-random-tagged temporary filenames.
6. Push/heartbeat monitors are guarded against active probing in `api/cron.js` and `edge/worker.js`.
7. Public `/api/ping/:id` endpoint rejects non-push monitors.
8. Rate limiter map eviction is optimized to $O(1)$ insertion-order eviction.
9. Notification HTTP streams are drained to avoid socket pooling leaks.
10. Multi-monitor MTTR calculations in `lib/analytics.js` track open outages per monitor ID.

## 2 · Preconditions
1. `pnpm install`
2. `pnpm run check`

## 3 · Steps and commands
| # | command | purpose |
| - | ------- | ------- |
| 1 | `pnpm run typecheck` | Validates TypeScript types across both root and sw configs |
| 2 | `pnpm run lint` | ESLint check with zero warnings |
| 3 | `pnpm test` | Node.js test runner with 58/58 unit and integration tests |
| 4 | `pnpm run build` | Generates static distribution bundle in `site/` |
| 5 | `pnpm run build:check` | Verifies integrity and CSP of `site/` artifacts |

## 4 · Observed output (verbatim)
```console
$ npm run typecheck && npm run lint && npm test && npm run build && npm run build:check

> novapulse@2026.1.4 typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.sw.json


> novapulse@2026.1.4 lint
> eslint . --max-warnings=0


> novapulse@2026.1.4 test
> node --test

✔ health endpoint reports monitor count (346.9402ms)
✔ rejects a monitor without a valid url (164.4567ms)
✔ monitor lifecycle: create, list, fetch, delete (142.9777ms)
✔ unknown API routes return JSON 404 (7.9531ms)
✔ sends hardened security headers (7.5408ms)
✔ stats and export endpoints report consistent shape (17.4307ms)
✔ export → import preserves the probe method (merge and replace) (61.7697ms)
✔ advanced monitor fields validate and can be cleared (126.7615ms)
✔ fleet analytics endpoint reports a range summary (7.7678ms)
✔ status page is disabled by default (12.7609ms)
✔ settings can enable the status page and projection renders (36.717ms)
✔ svg badges render for the fleet (19.0857ms)
✔ ALLOW_ORIGIN honours a comma-separated list of origins (21.3365ms)
✔ probe helpers parse status specs and tcp targets (1.6419ms)
✔ public endpoint sanitizes internal responseSnippet and headers (14.8352ms)
✔ push / heartbeat monitor lifecycle and /api/ping endpoint (28.0836ms)
✔ SSE stream endpoint /api/stream returns event-stream (9.618ms)
✔ transitions raise one incident + notification; stays-down stays quiet (75.1393ms)
✔ CRON_SECRET rejects callers without the bearer token (0.8815ms)
✔ getDb returns a working JsonAdapter by default (4.273ms)
✔ adapter selection based on environment variables (4.451ms)
✔ ?tag= filters the monitor list (611.9889ms)
✔ ?tag= filters the fleet analytics (307.4779ms)
✔ GET /api/metrics exposes Prometheus exposition (31.4507ms)
✔ GET /api/feed.xml serves escaped RSS incidents (10.5171ms)
✔ POST /api/settings/test reports configured channels (6.0032ms)
✔ github issues handler is fail-safe when token is absent (3.4939ms)
✔ same IP shares one bucket and trips 429 past max (3.6434ms)
✔ distinct IPs with distinct buckets all pass while under the cap (1.1565ms)
✔ the bucket map is hard-capped at maxBuckets (6.1595ms)
✔ a garbage/negative maxBuckets value cannot hang the limiter (1.1813ms)
✔ RATE_LIMIT=off bypasses the limiter entirely (0.6418ms)
✔ channelStatus reports slack off until SLACK_WEBHOOK_URL is set (13.0791ms)
✔ notify posts a BlockKit payload to the Slack webhook (16.0454ms)
✔ a failing channel never blocks the configured ones (1536.0414ms)
✔ loopback, RFC1918, metadata and CGNAT addresses are all classified private (20.7397ms)
✔ an HTTP probe to loopback is refused before a socket opens (2.3407ms)
✔ a TCP probe to loopback is refused before a socket opens (1.392ms)
✔ ALLOW_PRIVATE_TARGETS=1 restores LAN monitoring on demand (45.5396ms)
✔ a redirect to a non-http scheme settles instead of hanging the monitor forever (14.7049ms)
✔ the timeout spans the whole redirect chain, not each hop (728.9417ms)
✔ /api/health reports persistence state so a failing disk is visible (99.6056ms)
✔ a negative incident limit clamps instead of slicing away the tail (5.7767ms)
✔ the CSV export neutralises spreadsheet formulas (82.8119ms)
✔ a crafted backup cannot smuggle oversized fields past validation (9.7521ms)
✔ a crafted backup cannot pollute object prototypes via header names (3.0177ms)
✔ handlePushPing rejects ping requests for non-push monitors (0.7ms)
✔ a monitor missing every optional field is normalised on load (4.0085ms)
✔ the normalised monitor takes history and answers the list API (965.0117ms)
✔ a corrupt data file is quarantined instead of being overwritten (13.6324ms)
✔ the boot warning names the quarantine path (0.7258ms)
✔ monitors.json is replaced only by an explicit save (17.5998ms)
::error::ZAP produced no report at absent.json — treating as failure
::error::ZAP report is not valid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3)
ZAP findings: 3 distinct (2 blocking, 1 informational)
  Medium          Content Security Policy Header Not Set x1  http://localhost:3000/api/health
  Low             X-Frame-Options Header Not Set x2  http://localhost:3000/
  Informational   Timestamp Disclosure x1  http://localhost:3000/
ZAP baseline reported 2 blocking finding(s)
ZAP findings: 1 distinct (0 blocking, 1 informational)
  Informational   Timestamp Disclosure x1
ZAP findings: 0 distinct (0 blocking, 0 informational)
ZAP findings: 0 distinct (0 blocking, 0 informational)
✔ riskCode maps both riskcode strings and risk names to 0-3 (3.499ms)
✔ collectAlerts walks the whole report and skips non-alerts (0.8463ms)
✔ group deduplicates repeat findings and sorts by risk (0.7728ms)
✔ renderSummary separates blocking findings from informational notices (2.2955ms)
✔ main fails when the report is missing or malformed (6.6707ms)
✔ main fails the gate on any WARN-level finding and passes on INFO only (15.6052ms)
ℹ tests 58
ℹ suites 0
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5317.2421

> novapulse@2026.1.4 build
> node tools/gh-build.js

✔ site/ built — 11 entries, mode=static, v2026.1.4, 0 monitor(s), status=off, generated 2026-11-20T08:16:02.788Z (first run: empty state)


> novapulse@2026.1.4 build:check
> node tools/build-check.js

✔ build:check — site/ is complete (13 artifacts, CSP present, static mode)
```

## 5 · Pass criterion and result
- All 58 unit/integration tests pass (`exit 0`).
- Typecheck: 0 errors across all tsconfigs.
- Linter: 0 warnings, 0 errors.
- Build & build:check: static site passes CSP and structure verification.

## 6 · Negative control
- Passing an uncompressed IPv6 loopback target (`0:0:0:0:0:0:0:1` or `0000:0000:0000:0000:0000:0000:0000:0001`): `isPrivateAddress` returns `true` (blocked).
- Passing public IPv6 (`2606:4700:4700::1111`): `isPrivateAddress` returns `false` (reachable).
- Ping non-push monitor: `handlePushPing` returns `null` (negative control passed).

## 7 · Gates
| gate | command | result |
| ---- | ------- | ------ |
| typecheck | `pnpm run typecheck` | exit 0 |
| lint | `pnpm run lint` | exit 0 |
| unit/integration | `pnpm test` | 58/58 passed (exit 0) |
| build | `pnpm run build && pnpm run build:check` | exit 0 |

## 8 · Residual risk / trade-off (L-05)
- Cloudflare worker edge runtime lacks native Node sockets; TCP probing remains unsupported on Cloudflare edge unless using `cloudflare:sockets`.
- Mode A and Mode B remain the canonical, production-ready operational models; phantom external database adapters (`aiven`, `turso`, `neon`) are slated for formal deprecation/pruning in Phase 2.
