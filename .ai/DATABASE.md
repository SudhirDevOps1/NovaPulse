# 🗄️ NovaPulse — Persistence Model (No Database)

> What is stored, where, how it is written, what the caps are, what happens when
> the file is broken, and how big it gets. Every number here comes from
> `lib/store.js`, `server.js`, or a measured run recorded in §10 — re-derive them
> with the commands shown.
>
> Laws that govern this file: **L-35** (zero data loss), **L-36** (auto-migrating
> reads), **L-37** (non-destructive migrations), **L-38** (isolated failure per
> statement), **L-39** (single writer), **L-24** (bounded retention).
> See [`RULES.md`](RULES.md) · design rationale in
> [`DECISIONS.md`](DECISIONS.md) → ADR-0001 · shape in
> [`ARCHITECTURE.md`](ARCHITECTURE.md) → L1.

---

## 1 · The one-sentence answer

There is **no database**. All state is one JSON document — `data/monitors.json` —
held in memory by a single Node process and written back with an atomic
temp-file + rename. Backup is `GET /api/export`; restore is `POST /api/import`
or copying the file back.

---

## 2 · Where state lives

| property | value | source |
| --- | --- | --- |
| directory | `UPTIME_DATA_DIR` if set, else `<repo>/data` | `lib/store.js` → `DATA_DIR` |
| file | `monitors.json` inside that directory | `lib/store.js` → `FILE` |
| created | `fs.mkdirSync(dir, { recursive: true })` on first flush | `flush()` |
| writer | exactly one process | `ecosystem.config.js` → `instances: 1` |
| in-memory state | `{ monitors[], incidents[], settings }` | `lib/store.js` → `state` |
| read timing | at `require('./lib/store')` time, i.e. at boot | `load()` runs on module load |
| writers outside the API | none — `lib/store` is the only module that touches disk | `ARCHITECTURE.md` §2 (L1) |

**Document shape (the whole file):**

```jsonc
{
  "monitors": [ /* monitor objects, §7 */ ],
  "incidents": [ /* newest-first, cap 500 */ ],
  "settings": { "statusPage": { "enabled": false, "title": "Service status", "message": "" } }
}
```

**Single-writer discipline (L-39).** Two processes writing the same directory
interleave `*.tmp` writes and lose each other's renames. This is why
`ecosystem.config.js` pins `instances: 1`, why the Docker image runs one
`node server.js`, and why `e2e` gets its own `UPTIME_DATA_DIR`
(`./e2e/.tmp-data`). Never point two instances at one `data/` volume.

---

## 3 · Write path — atomic, debounced, isolated

```
mutation (create/update/delete/check/import/settings)
   └─ save()            → schedules ONE flush in 250 ms (coalesces bursts)
        └─ flush()      → mkdir → writeFileSync(FILE + ".tmp") → renameSync(tmp, FILE)
```

| rule | behaviour | why |
| --- | --- | --- |
| debounce | `save()` arms a 250 ms timer; a second call inside the window is a no-op | 200 monitors checked in the same second produce one write, not 200 |
| immediate flush | `save(true)` → synchronous flush | called by `remove()`, `importState()`, `SIGINT`/`SIGTERM` shutdown (plus an 8 s force-exit fallback in `server.js`) |
| atomicity | write the temp file fully, then `renameSync` over the real one | a crash mid-write leaves the previous good file intact (**L-35**) |
| write failure | caught, logged `error` `Failed to persist data`, **the old file is untouched** | a failed flush degrades, it never truncates (**L-38**) |
| no `fsync` | `writeFileSync` + `renameSync` without fsync | process-crash safe; a *power loss* in the same instant can still lose the last flush — accepted trade-off of the zero-dependency design, state your assumption honestly (**L-05**) |

The temp file is always `monitors.json.tmp` in the same directory, so the rename
is same-filesystem and therefore atomic.

---

## 4 · Read path at boot — and what a corrupt file does

`load()` runs once, at require time:

| condition | code path | observable behaviour |
| --- | --- | --- |
| file missing (first boot) | `catch` with `error.code === 'ENOENT'` | starts empty, **no warning** (normal first run) |
| file unparsable / unreadable (`EACCES`, truncated JSON…) | `catch`, non-ENOENT | `logger.warn('Could not read data file, starting empty', {error})` and state = empty |
| file parses | normalised into `state` | monitors/incidents arrays coerced, settings merged over defaults |

This is **fail-open on availability, by design** (`ARCHITECTURE.md` §7):
availability problems degrade, security problems halt (**L-09**).

**Measured consequence of a corrupt file** (reproduced on 2026-10-07, Node
v24.19.0, with `UPTIME_DATA_DIR` pointed at a temp dir containing
`{ this is not json`):

```
after load   -> monitors: 0 | file bytes: { this is not json
files in dir : monitors.json
after create (+500 ms debounce) -> file parses: true | other files: (none — corrupt bytes gone)
```

So, honestly:

- the app **starts and serves an empty fleet** rather than refusing to boot;
- the corrupt bytes are **not quarantined** — no `.bak`, no `.corrupt-<ts>`;
  the first debounced flush (≤250 ms after the first mutation) renames over them
  and they are gone;
- recovery is therefore an **operator race**: `cp monitors.json
  monitors.json.broken` *before* touching the UI, then restore from
  [`/api/export`](#9--backup--restore) or a volume snapshot.

**Operator runbook for a suspect file:**

1. Stop the process (writes stop; the last good flush already happened).
2. Copy `monitors.json` aside — this is the only remaining copy of the data.
3. Attempt a repair on the copy (e.g. `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" copy.json`).
4. Put the repaired file back, start, verify `GET /api/health` → `monitors` count.

A quarantine-on-load behaviour (`rename` the unreadable file to
`monitors.json.corrupt-<ts>` before starting empty) is tracked in
[`TODO.md`](TODO.md) — it does **not** exist today (**L-02**).

---

## 5 · Retention caps (verified in `lib/store.js`)

| structure | cap | constant | enforcement |
| --- | --- | --- | --- |
| `monitor.history[]` | **500** raw points | `HISTORY_LIMIT = 500` | ring buffer — `splice(0, length - 500)` on every push |
| `monitor.rollups[]` | **720** hourly buckets (= 30 days) | `ROLLUP_LIMIT = 720` | trimmed on every `addRollup` (`hour < now − 720 h` dropped) |
| `rollup.samples[]` | **2400** ms values in the *open* hour | inline `> 2400` check | `shift()`; the array is **deleted** when the hour closes (`closeRollup`) |
| `incidents[]` | **500** | `INCIDENT_LIMIT = 500` | `unshift` newest-first, `length = 500` truncates the tail |
| `monitors[]` | unbounded by code | — | bounded by operational reality (§10) |
| `settings.statusPage.title` | 80 chars | `pickStatusPage` | truncated on write |
| `settings.statusPage.message` | 300 chars | `pickStatusPage` | truncated on write |
| import payload history/rollups/incidents | sliced to the same caps | `importState` | non-destructive: a bigger source file is trimmed, never merged unbounded |

Raising any cap requires an ADR with a memory/disk projection attached
(**L-24**) — use §10 as the projection.

---

## 6 · Hourly rollup lifecycle

```
entry {at, ok, status, ms, degraded?}
  → history.push (ring, 500)
  → addRollup:
       key = floorHour(entry.at)
       if the last bucket is the open hour → fold into it
       else closeRollup(previous): recompute p50/p95/p99 from samples, DELETE samples
            create {hour, n:0, ok:0, sum:0, min:null, max:null, samples:[]}
       fold: n++, ok++, sum/min/max, samples.push(ms) (cap 2400)
       recompute percentiles from the sorted samples
       trim buckets older than 720 h
```

Percentiles are **exact within an hour** (computed from raw samples) and
**merged across hours as n-weighted means** (`lib/analytics.js`) — accurate to a
few ms, cheap enough for every request. Once an hour is closed its raw samples
are gone forever; the closed bucket keeps only `{hour, n, ok, sum, min, max,
p50, p95, p99}`.

---

## 7 · Monitor schema

Every field below is written by `store.create()` / `store.update()` or added at
runtime by `lib/checker.js`. Validation limits are enforced by
`validateMonitor()` in `server.js` on every POST/PATCH.

| field | type | default | constraint (server-side) | written by |
| --- | --- | --- | --- | --- |
| `id` | UUID string | — | generated | `store.create` |
| `name` | string | required | trimmed, **≤ 60** chars | validate |
| `url` | string | required | absolute URL; scheme `http:`/`https:`/`tcp:`; tcp must parse as `tcp://host:port` (port 1–65535) | validate |
| `type` | `'http' \| 'tcp'` | `'http'` | derived: `tcp:` protocol ⇒ `tcp` | validate |
| `method` | string | `'GET'` | `GET HEAD POST PUT PATCH DELETE` (upper-cased) | validate |
| `intervalSec` | number | `60` | **10 … 86400** | validate |
| `timeoutMs` | number | `10000` | **500 … 60000** | validate |
| `enabled` | boolean | `true` | `Boolean(body.enabled)` on PATCH | validate/PATCH |
| `status` | `'unknown' \| 'up' \| 'degraded' \| 'down'` | `'unknown'` | derived from the last probe | `checker.record` |
| `consecutiveFailures` | integer ≥ 0 | `0` | grace counter for `failuresBeforeDown` | `checker.record` |
| `wasDown` | boolean | `false` | set on outage, cleared on recovery | `checker.record` |
| `tags` | string[] | `[]` | ≤ **10** items, each ≤ **24** chars, trimmed, de-duplicated | validate |
| `history` | entry[] | `[]` | ring buffer **500**; entry = `{at, ok, status, ms, degraded?}` | `store.addHistory` |
| `rollups` | rollup[] | `[]` | **720** hourly buckets, see §6 | `store.addRollup` |
| `lastCheck` | object \| null | `null` | full probe result: `{at, ok, status, ms, error?, degraded?, bytes?, timing{dns,connect,tls,ttfb,download}, ssl?, redirects?, truncated?}` | `checker.record` |
| `createdAt` | ISO timestamp | now | never rewritten | `store.create` |
| `expectedStatus?` | string | absent = default `200-399` | `^(\d{3}\|\d{3}-\d{3})(, …)*$` | validate |
| `expectedKeyword?` | string | absent = no check | ≤ **120** chars, trimmed | validate |
| `warnMs?` | number | absent (= no degraded state) | **0 … 60000**; `0`/empty clears the field | validate |
| `failuresBeforeDown?` | integer | absent (= **1**) | **1 … 10**; `1` clears the field | validate |
| `checkSsl?` | boolean | absent ⇒ **true** at probe time (`checkSsl !== false`) | explicit boolean | validate |
| `headers?` | object | absent | ≤ **10** entries; name matches RFC token regex; value is a string ≤ **2048** chars; `host/content-length/connection/transfer-encoding/expect` dropped by `probe.buildHeaders` | validate |
| `body?` | string | absent | ≤ **4096** chars; ignored for `GET`/`HEAD` | validate |
| `ssl?` | object | absent | `{validTo, daysLeft, issuer}` refreshed per TLS probe | `checker.record` |
| `sslWarnedAt?` | epoch ms \| null | absent | rate-limits the expiry alert to once per 24 h | `checker.record` |
| `uptime24h` | number \| null | — | **computed on read**, never stored (`publicMonitor`) | — |

**State-level records**

| structure | shape | notes |
| --- | --- | --- |
| `incidents[]` | `{id, at, monitorId, name, url, type: 'down'\|'up', reason}` | pushed on threshold breach and on recovery; cap 500, newest-first |
| `settings.statusPage` | `{enabled: false, title: 'Service status', message: ''}` | the *only* settings block that exists today |

**Not stored:** no user accounts, no sessions, no cookies, no PII fields — see
[`SECURITY.md`](SECURITY.md) §5. Custom `headers` **are** stored verbatim
(plaintext JSON), which matters if you put bearer tokens in them — see
[`SECURITY.md`](SECURITY.md) §7.

---

## 8 · Migrations — auto-migrating and non-destructive

There is no migration runner and none may be introduced (**L-36**). Four
mechanisms do the job:

| when | mechanism | guarantee |
| --- | --- | --- |
| boot (`load`) | top-level `monitors`/`incidents` coerced to arrays; `settings` merged over `DEFAULT_SETTINGS` (shallow, then `statusPage` again) | a file from an older build opens without a step |
| read paths | defensive guards: `rollupsOf()` → `[]`, `histogram()` → `monitor.history \|\| []`, `analytics.summary` tolerates empty | a *missing* optional array degrades to "no data", not a crash |
| import (`importState`) | each source monitor rebuilt field-by-field from `OPTIONAL_FIELDS`; history/rollups/incidents sliced to caps; unknown ids generated | never grows state past the caps (**L-24**), never executes payload content |
| settings patch | `pickStatusPage` allowlist — only `enabled`/`title`/`message` survive | unknown keys are dropped, not stored |

**Honest gaps in the normalisation contract (verified, not assumed):**

1. **Per-monitor fields are *not* normalised on load.** A hand-edited file whose
   monitor lacks `history` makes the whole read surface fail. Measured with a
   fixture containing `{id, name, url, …}` and no `history` key:

   ```
   GET /api/monitors      -> 500 {"error":"Internal server error"}
   GET /api/monitors/m1   -> 500 {"error":"Internal server error"}
   GET /api/stats         -> 500 {"error":"Internal server error"}
   store.addHistory       -> threw: TypeError: Cannot read properties of undefined (reading 'push')
   ```

   So `uptime24h()` (`monitor.history.filter`) and `addHistory()` are the
   unguarded call sites. The fix — normalise `history`/`rollups`/`status` in
   `load()` — is in [`TODO.md`](TODO.md) (**L-36** is only partially met).
2. **Import downgrades the HTTP method.** `importState` writes
   `method: m.method === 'POST' ? 'POST' : 'GET'`, so a monitor exported with
   `HEAD`/`PUT`/`PATCH`/`DELETE` comes back as `GET`. Measured round trip:

   ```
   exported method : HEAD
   imported method : GET
   imported fields : {"expectedStatus":"200-299","headers":{"authorization":"Bearer abc"},
                      "tags":["prod"],"intervalSec":30,"historyLen":1,"rollupsLen":1,
                      "status":"unknown","consecutiveFailures":0,"lastCheck":null}
   ```

   `status`, `consecutiveFailures` and `lastCheck` are reset **by design** (the
   new instance must re-probe); the method change is not — it is a silent
   fidelity loss and is tracked in [`TODO.md`](TODO.md).

**Non-destructive rule (L-37):** no code path deletes user data. Shrinking,
renaming or restructuring the stored state requires (a) an export-first backup
step and (b) an entry in this file. The caps in §5 are *ring buffers*, i.e.
bounded growth, not deletion of a dataset.

---

## 9 · Backup & restore

| operation | how | notes |
| --- | --- | --- |
| export everything | `GET /api/export` | `Content-Disposition: attachment`; body = `{version: 2, exportedAt, monitors, incidents, settings}` (includes `history`, `rollups`, custom `headers`) |
| restore / merge | `POST /api/import?mode=merge` (default) | upserts by `id`; existing monitor wins field-by-field, `status` reset to `unknown` |
| restore / replace | `POST /api/import?mode=replace` | swaps `monitors[]` and `incidents[]` wholesale, then `save(true)` |
| per-monitor CSV | `GET /api/monitors/:id/checks.csv` | columns `timestamp,ok,http_status,response_ms`; ≤ 500 rows (the history ring) |
| cold backup | copy `data/monitors.json` | the file is always complete — writes are atomic (§3) |
| restore without the API | copy the file back while the process is stopped | preferred for fleets over the JSON body limit below |

**Verified limitation — the restore API is capped at 64 kB.** Export is
unbounded (`res.json(store.exportState())`), but `express.json({limit: '64kb'})`
covers every `/api` route including `/api/import`. Measured:

```
payload 83395 bytes -> POST /api/import => 413 {"errors":["Payload too large"]}
payload  238 bytes -> POST /api/import => 200 {"imported":1,"total":1}
```

At ~112 kB per monitor at cap (§10) that means: **anything beyond a handful of
monitors must be restored by copying the file**, not by `POST /api/import`.
`README.md` documents the curl path; treat it as the small-fleet path. Raising
the body limit (or streaming the import) is tracked in [`TODO.md`](TODO.md).

---

## 10 · Disk & memory projection (measured, not estimated)

Method: build the state document exactly as §5/§7 describe (history 500,
rollups 720 with one open bucket holding 2400 samples, 500 incidents), measure
`Buffer.byteLength(JSON.stringify(state))` and `process.memoryUsage()` in a
**fresh process** per fleet size. Machine: Node **v24.19.0**, 2026-10-07.

**Per-monitor worst case (single document slice):**

| slice | bytes |
| --- | --- |
| `history[500]` | 33 031 B (≈ 32.3 KiB) |
| `rollups[720]` incl. open-hour samples | 81 613 B (≈ 79.7 KiB) |
| whole monitor, both arrays at cap | **115 051 B (≈ 112.4 KiB)** |

Re-derive (paste as one line):

```bash
node -e "const H=500,R=720,S=2400;const history=Array.from({length:H},(_,i)=>({at:new Date(Date.now()-i*6e4).toISOString(),ok:i%17!==0,status:i%17!==0?200:503,ms:100+(i%900)}));const rollups=Array.from({length:R-1},(_,i)=>({hour:Date.now()-(R-i)*36e5,n:60,ok:59,sum:15000,min:120,max:980,p50:240,p95:760,p99:910}));rollups.push({hour:Date.now(),n:42,ok:42,sum:10500,min:180,max:640,samples:Array.from({length:S},(_,i)=>200+(i%700)),p50:240,p95:610,p99:630});const m={id:'00000000-0000-4000-8000-000000000000',name:'monitor',url:'https://api.example.com/v1/health/endpoint',method:'GET',type:'http',intervalSec:60,timeoutMs:10000,enabled:true,status:'up',consecutiveFailures:0,wasDown:false,tags:['prod','api'],history,rollups,createdAt:new Date().toISOString(),lastCheck:{at:new Date().toISOString(),ok:true,status:200,ms:243}};console.log('history',Buffer.byteLength(JSON.stringify(history)),'rollups',Buffer.byteLength(JSON.stringify(rollups)),'monitor',Buffer.byteLength(JSON.stringify(m)));"
```

**Whole document + process, one fresh run per row:**

| monitors at cap | `monitors.json` | heap | RSS |
| --- | --- | --- | --- |
| 1 | 0.2 MiB | 4.6 MiB | 40.6 MiB |
| 10 | 1.2 MiB | 7.3 MiB | 44.5 MiB |
| 100 | 11.1 MiB | 32.3 MiB | 78.4 MiB |
| 250 | 27.5 MiB | 75.1 MiB | 135.0 MiB |

Reading of the numbers:

- **Disk** grows ~112 kB per monitor *at cap*; a realistic fleet (far from cap
  on every array) is far smaller. 100 maxed-out monitors = ~11 MiB rewritten on
  a debounced flush — trivial for SSD, chatty for a network filesystem.
- **Memory** carries a ~36 MiB V8 baseline plus ~0.36 MiB RSS per maxed-out
  monitor. PM2's `max_memory_restart: '250M'` gives roughly **500–600 monitors
  of headroom** before a restart loop; that is the practical ceiling, and it
  matches ADR-0001's "revisit beyond ~hundreds of monitors".
- The whole document is re-serialised on every flush (no append-only log).
  Flushes are debounced to at most one per 250 ms, so the cost is
  `O(document)` twice a second worst case.

---

## 11 · Operational rules

1. **One process, one `data/` volume** (**L-39**). PM2 `instances: 1`, one
   container, no shared NFS between replicas.
2. **Mount `data/`** in Docker (`UPTIME_DATA_DIR=/app/data`) or the fleet
   vanishes on restart.
3. **Export before you touch the schema** (**L-37**): `curl -fsS
   localhost:3000/api/export -o backup-$(date +%F).json`.
4. **E2E/tests never touch real data**: `test/api.test.js` and
   `playwright.config.mjs` both set `UPTIME_DATA_DIR` to a temp directory.
5. **Static mode is read-only**: the GitHub Pages build reads
   `data/state.json` and never writes `monitors.json`
   (`ARCHITECTURE.md` §5).

---

## 12 · Changing the schema — checklist

- [ ] Every new field has a default or a read-path guard so an **old file still
      loads** (**L-36**).
- [ ] No code path deletes or overwrites user data on upgrade (**L-37**); if it
      must, export-first + backup path.
- [ ] Independent state statements stay in their own `try/catch` (**L-38**).
- [ ] Caps still hold; if you raise one, attach a projection from §10 and an ADR
      (**L-24**).
- [ ] `POST /api/import` accepts the new field (`OPTIONAL_FIELDS`), otherwise
      backups silently drop it.
- [ ] `GET /api/export` shape (`version`) bumped only when incompatible, and
      `importState` keeps reading the previous version.
- [ ] This file, [`CONTEXT.md`](CONTEXT.md) §6 and — for a design change —
      [`DECISIONS.md`](DECISIONS.md) are updated in the same change (**L-32**,
      **L-42**).

See also: [`ARCHITECTURE.md`](ARCHITECTURE.md) (why one file) ·
[`PRD.md`](PRD.md) FR-9/FR-10 (backup requirements) ·
[`SECURITY.md`](SECURITY.md) (what is and is not encrypted at rest).
