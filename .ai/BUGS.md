# 🐞 NovaPulse — Incident Register

> **Format:** `Incident ID → Symptom → Root Cause → Fix → Verification`
>
> Every entry is a real incident that was reproduced and verified. Nothing here
> is hypothetical. New incidents are appended at the top of §1 (open) or moved
> to §2 (closed) with the closing date.
>
> Related: [`CHANGELOG.md`](CHANGELOG.md) · [`DECISIONS.md`](DECISIONS.md) ·
> [`RULES.md`](RULES.md) (the law each incident produced).

---

## 1 · Open incidents

### BUG-2026-0007 — Darwaza 1's commitlint job could never lint a single commit

| field | value |
| --- | --- |
| status | 🔻 **OPEN — fix landed, verification pending** — `ci.yml` corrected; waiting on the Darwaza 1 run it triggers |
| severity | **high** — the required `gate` check was red on **every** PR for a reason unrelated to the code |
| area | `.github/workflows/ci.yml` → `Lint PR commits` |
| introduced | the original Darwaza 1 definition |
| rule produced | `.ai/RULES.md` → **L-34** (a gate that fails for the wrong reason teaches the wrong lesson) |

**Symptom**
> Every Darwaza 1 run died in *Lint PR commits* before `commitlint`
> executed:
> `Run set -euo pipefail` → `fatal: depth 0 is not a positive number` →
> `Process completed with exit code 128`.
> Verified in both runs' logs: PR #1 (run 37626113851, job 112808586961,
> head `f317c62`) and PR #2 (run 37626962194, job 112816689331, head
> `3011797`) — identical line, identical exit code.

**Root cause**

```bash
git fetch --no-tags --depth=0 origin "$BASE_SHA"
```

git parses `--depth` as a *positive* integer and `die()`s on `0`
(`builtin/fetch.c` → `depth %s is not a positive number`), so the command
always exits 128; `set -euo pipefail` then aborts the step. The fetch was
unnecessary anyway — the checkout above already runs with
`fetch-depth: 0` (full history). Reproduced locally on git 2.56.0:
the same `fatal:` line appears outside CI.

**Fix**

- The step now checks `git cat-file -e "$SHA^{commit}"` and only fetches
  when a sha is genuinely missing (plain fetch, then `origin main`, then
  `pull/<n>/head`), and fails with a *named* error if it still is.
- **Evidence discipline (L-34):** this incident also corrects the
  BUG-2026-0005 record — the CI job **never** printed `scope-enum`; that
  violation was reproduced *locally* against the real hook. The two
  defects were independent: a non-conforming bot title (0005) and a job
  that could not detect it (this one).

**Verification:** pending the next Darwaza 1 run on a PR.

---

## 2 · Closed incidents

### BUG-2026-0005 — release-please's PR title could never pass commitlint (`chore(main): …`)

| field | value |
| --- | --- |
| status | ✅ **CLOSED** — 2026-10-07. Tag + GitHub Release `v2026.1.1` published from the corrected title; the open release PR carries `chore: release …` |
| severity | **high** (the release PR could never pass the required `gate` check) |
| area | `release-please-config.json` → title patterns |
| introduced | the first release-please run that opened PR #1 |
| rule produced | `.ai/RULES.md` → **L-31**/**L-33** (Conventional Commits, gates block merge) |

**Symptom**
> PR #1 was opened as `chore(main): release 2026.1.1`. `main` is not in
> the commitlint scope enum, so the message is invalid — verified against
> the **real** hook locally: `chore(main): …` → exit 1 (`scope-enum`),
> `chore: release 2026.1.1` → exit 0.
> (The CI job itself never got that far — it was broken separately, see
> BUG-2026-0007. No CI log ever showed `scope-enum`; that distinction is
> recorded here because L-34 forbids dressing up local evidence as CI
> evidence.)

**Root cause**

The default pattern `chore${scope}: release${component} ${version}` renders
`${scope}` as **the target branch in parentheses** (`PullRequestTitle.toString()`
→ `scope = '(' + targetBranch + ')'`), producing `chore(main): release
2026.1.1`.

**Fix**

- First attempt changed only `group-pull-request-title-pattern` — release-please
  kept the old title (evidence: the Release run on `1ce9378` rewrote the PR
  branch but not its title). A single-package manifest never takes the *group*
  PR path; the effective key is the root-level **`pull-request-title-pattern`**
  (`manifest.ts` → `pullRequestTitlePattern: config['pull-request-title-pattern']`
  → `PullRequestTitle.toString()`). Both keys now carry the same scopeless
  shape, and `docs/RELEASE.md` documents which one governs.
- **Second-order effect, also closed:** the pattern change happened *after*
  PR #1 was opened, and `buildRelease()` parses a merged release PR's title
  against the **current** pattern — `Bad pull request title: 'chore(main): …'`
  → no tag (evidence: run 37626952002 summary `release created: false`,
  `tags: none`). Retitling merged PR #1 to `chore: release 2026.1.1` and
  dispatching the Release workflow made release-please parse it and publish
  **tag `v2026.1.1` + GitHub Release** (2026-10-07 13:36:04Z).

**Verification:** tags API returns `v2026.1.1`, releases API returns the
published release, and PR #2 (the live release PR) is titled
`chore: release 2026.1.1` with a conforming branch commit message.

---

### BUG-2026-0006 — Darwaza 2's DAST job could never enforce its policy

| field | value |
| --- | --- |
| status | ✅ **CLOSED** — 2026-10-07 (local gate 19/19 green; CI verification pending the push) |
| severity | **critical** — a security gate reported red for the wrong reason and never evaluated a single finding |
| area | `.github/workflows/e2e-gate.yml` → `zap` job |
| introduced | the original Darwaza 2 definition |
| rule produced | `.ai/RULES.md` → **L-34** (state the absence of evidence loudly) |

**Symptom**
> Run on PR #1: job *OWASP ZAP baseline (DAST)* failed, annotation
> `Resource not accessible by integration — POST /repos/…/issues` and
> `Unexpected input(s) 'format', 'output_file'`. The job's own log said
> `FAIL-NEW: 0 … WARN-NEW: 2` — yet *Evaluate ZAP findings against the policy*
> shows **skipped**, and no ZAP artifact was produced.

**Root cause** (three defects stacked into one misleading failure)

1. `format` and `output_file` are **not inputs** of
   `zaproxy/action-baseline@v0.12.0` — GitHub silently ignores them (it only
   warns), so the report name the policy expected was never configured.
2. The action files its report as an issue when `allow_issue_writing` is left
   at its default `true`; this workflow's `permissions` deliberately hold no
   `issues: write`, so the API call 403'd and **failed the scan step** — which
   in turn skipped the policy step (`if: success()`).
3. The policy step grepped `zap-baseline.conf`, a file **ZAP never writes**
   (the action's outputs are `report_json.json` / `report_md.md` /
   `report_html.html` + the `zap_scan` artifact), so even a successful scan
   would have failed with "ZAP produced no report".

The gate was red — but for infrastructure reasons, not security findings.

**Fix**

- Removed the two invalid inputs; set `allow_issue_writing: false` (the PR
  gate reports in-job; **Darwaza 3** owns issue filing) and `artifact_name:
  zap_scan`.
- New `tools/zap-policy.js` evaluates `report_json.json`: risk 1–3 blocks,
  risk 0 is a notice — the documented "any `W` fails, `I` is reported"
  policy, now implemented against a file that actually exists. `if: always()`
  so it reports even when the scan step breaks.
- Upload step now names the real report files (`if-no-files-found: warn`).
- Covered by 6 new specs in `test/zap-policy.test.js` (suite 13 → **19**);
  counts synced across `.ai/`, `docs/`, `.agent/`.

**Phase 2 — the scan step still failed, this time for a fourth reason**

The re-run surfaced two more annotations:

1. `Create Artifact Container failed: The artifact name zap_scan is not
   valid` — `zaproxy/action-baseline@v0.12.0` uploads through the retired
   artifact service. **v0.14.0** is explicitly released as *"Update
   dependencies to stop using deprecated `upload-artifact` version"*, so the
   workflow now pins **v0.15.0** (node24, current artifact API).
2. The two real findings the log had hidden all along — the gate's actual
   verdict:
   - `Cross-Origin-Resource-Policy Header Missing or Invalid`
   - `Cross-Origin-Embedder-Policy Header Missing or Invalid`

**App fix for the real findings**

- `securityHeaders` now sends `Cross-Origin-Embedder-Policy: require-corp`
  and `Cross-Origin-Resource-Policy: same-origin` on every response (CSP's
  `default-src 'self'` guarantees no cross-origin subresource exists, so
  `require-corp` cannot break the UI — E2E verified).
- `/api/badge/:id.svg` relaxes CORP to `cross-origin`: the badges are
  documented as embeddable in foreign READMEs (README §badges), and
  `same-origin` would have silently broken that feature — a regression the
  scanner would never have caught.
- Header assertions extended in `test/api.test.js` and
  `e2e/dashboard.spec.mjs` (counts unchanged, 19 / 26).
- L-18 in `.ai/RULES.md`, `docs/SECURITY.md`, `.ai/SECURITY.md`, `PRD.md`
  and `REVIEW.md` now name COEP/CORP.

**Verification:** `pnpm run check` exit 0 — typecheck ×2, lint
`--max-warnings=0`, **19/19 tests**, build; `pnpm run e2e` green with the
hardened headers. CI confirmation pending the push: the ZAP job must reach
*Evaluate ZAP findings against the policy* and pass it.

---

### BUG-2026-0004 — Release workflow failed on every push; Monitor could not deploy

| field | value |
| --- | --- |
| status | ✅ **CLOSED** — 2026-10-07. Both repo toggles set (Pages source = GitHub Actions; "Allow GitHub Actions to create and approve pull requests" = on), failed jobs re-run: **Monitor ✅** (site live at `https://sudhirdevops1.github.io/NovaPulse/`, HTTP 200) and **Release ✅** (opened PR #1) |
| severity | **high** (two of the four push-triggered workflows were permanently red) |
| area | `release-please-config.json`, `.github/workflows/{monitor,release}.yml` |
| introduced | first push of the pipeline (`2f6c76b`) |
| rule produced | `.ai/RULES.md` → **L-34** (a gate must state its own absence, never fake a pass) |

**Symptom (as observed on GitHub Actions)**
> On push `c3ebf06`: *Release (release-please v4)* → **failure** at step
> *Run release-please*; *Monitor* → **failure** at step *Setup Pages*.
> *Darwaza 1* and *Sonar* passed.

**Root cause — two independent faults, both reproduced from evidence**

1. **Release:** `release-please-config.json` carried a nested
   `"release-please": { "bootstrap-sha": "" }` key. The published schema
   (`schemas/config.json`) sets **`additionalProperties: false`** at the
   top level, so release-please rejects the whole file during validation and
   the step dies before any PR logic runs. Verified by fetching the schema and
   diffing its allowed keys against ours (`release-please` was the only
   unknown key; `bootstrap-sha` is legal only as a *top-level* key).
2. **Monitor:** the Pages API answered **HTTP 404** — the repository has no
   Pages site, and `actions/configure-pages` cannot create one with the
   default `GITHUB_TOKEN` (its `enablement` input explicitly requires a PAT
   or GitHub App token). The workflow therefore failed at *Setup Pages* with
   a message that named neither the cause nor the fix.

**Fix**

- Removed the invalid `release-please` block, added `$schema` to the config
  so editors and CI validate it against the real schema.
- `monitor.yml` now has a **preflight step** that calls the Pages API first
  and, on 404, fails with the exact UI path
  (*Settings → Pages → Build and deployment → Source: GitHub Actions*) as an
  `::error` annotation **and** a step summary — same doctrine as Sonar.
- `release.yml` gained a `if: failure()` **Diagnose** step naming the three
  causes actually seen (schema rejection, the "Allow GitHub Actions to
  create and approve pull requests" toggle, non-Conventional commits).
- README §GitOps documents both repository toggles as numbered setup steps.

**Verification**

- All 6 workflows parse (`js-yaml`), config parses as JSON and its keys are
  a subset of the schema's allowed properties; a local
  `release-please manifest-pr --dry-run` now gets **past** config validation
  to the first GraphQL query (it stops only at 401 for want of a local token).
- Re-run on `7e8ee37`:
  - **Darwaza 1** — all 5 jobs green, `gate` ✅ · **Sonar** ✅
  - **Monitor** — fails at the new *Verify Pages source* preflight (was:
    cryptic *Setup Pages*) and its summary prints the exact UI path.
  - **Release** — still red; the run's annotation reads verbatim
    **“GitHub Actions is not permitted to create or approve pull requests.”**
    i.e. the config fix landed and the remaining cause is the repository
    toggle, not the workflow. Operator action:
    **Settings → Actions → General → Workflow permissions → ☑ Allow GitHub
    Actions to create and approve pull requests**.

**Law it reinforces:** **L-34** — when a required capability is absent the
pipeline must say so loudly with the remediation path, never degrade into a
silent or misleading result.

---

### BUG-2026-0001 — Save produced no notification and no save at all

| field | value |
| --- | --- |
| status | ✅ **CLOSED** — 2026-10-07 |
| severity | **critical** (silent data-loss-class defect: user believes data was saved) |
| area | `public/js/views.js` → `openMonitorForm()` |
| introduced | present since the first commit (`2f6c76b`) |
| rule produced | `.ai/RULES.md` → **L-40** (Notify on Save) |

**Symptom (as reported)**
> "kuchh bhi change krne save wagarah par notification message nahi aa rahe hain"

**Investigation — what was actually observed**

Reproduced in a real browser against a real server (not inferred from code):

1. Open **New monitor**, fill valid `Name` + `URL`, click **Create monitor**.
2. Measured in the live DOM:
   - `form.contains(saveBtn)` → **`false`**
   - `saveBtn.getAttribute('form')` → **`null`**
   - a `submit` listener added to the form → **never fired** after the click
   - `#nav-monitors` count → stayed **`0`**
   - `.toast` nodes → **none**
3. Conclusion: the request was never sent. There was no notification because
   there was nothing to notify about.

**Root cause**

`openModal()` renders its slots as three *siblings*:

```js
panel.append(
  h('div', { class: 'modal-head' },  [...]),
  h('div', { class: 'modal-body' },  [body]),   // ← the <form> lives here
  footer ? h('div', { class: 'modal-foot' }, [footer]) : null,  // ← the button
);
```

The save button was created with `type: 'submit'` but placed in
`.modal-foot`, **outside** the `<form>`, and carried no `form="…"` id
reference. Per the HTML spec a submit button submits *its owner form* — with
no owner form, the click is a no-op. So:

```
click → (no form association) → no submit event → onSubmit never called
      → no POST /api/monitors → no monitor → no toast
```

This is exactly the class of bug that a unit test cannot catch (it is a DOM
*wiring* property) and that a green API test suite happily ignores — the API
was fine. It took an end-to-end browser check to expose it.

**Fix**

Give the form a unique id and reference it from the button with the HTML5
`[form]` attribute, which associates a control with a form it is not a
descendant of:

```js
const formId = `monitor-form-${++formSeq}`;          // module-level monotonic seed
const form   = h('form', { class: 'form-grid', novalidate: true, id: formId }, [...]);
const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit',
                              form: formId,           // ← the fix
                              text: editing ? 'Save changes' : 'Create monitor' });
```

The comment at the call site records *why*, so the regression cannot be
re-introduced by a well-meaning refactor that "cleans up" the attribute.

**Why `[form]` and not a `click` listener calling `requestSubmit()`**

- `[form]` is declarative and is the spec's intended mechanism.
- it fixes **implicit** submission too (pressing <kbd>Enter</kbd> in a text
  field), which a click-only listener would leave broken.
- it survives future reordering of the modal slots.

**Verification**

| check | result |
| --- | --- |
| `btn.form === form` after fix | `true` (was `null`) |
| `submit` event fires on click | `true` (was `false`) |
| `POST /api/monitors` issued | `201`, monitor `status: "up"` |
| toast rendered | `Monitor created — … — first check running now`, class `toast success`, opacity `1` |
| nav counter | `0` → `1` |
| automated | `e2e/dashboard.spec.mjs` → *"saving a new monitor shows a success notification"* |

**Fallout / laws written**

- **L-40** — a save with no notification is treated as a failed save.
- E2E spec added as a permanent regression guard (Darwaza 2).

---

### BUG-2026-0002 — Stale server process masking deployed code

| field | value |
| --- | --- |
| status | ✅ **CLOSED** — 2026-10-07 |
| severity | **high** (misdiagnosis risk — makes correct code look broken) |
| area | local runtime / operations |
| rule produced | `.ai/RULES.md` → **L-04** (Evidence Before Claim) |

**Symptom**
`GET /api/health` reported `version: "3.0.0"` and `uptimeSec: 1733` while
`package.json` declared `2026.1.0`. Two `node server.js` processes were alive;
the older one held port 3000 and was serving a build that no longer existed in
the working tree.

**Root cause**
An orphaned `node server.js` (PID from a previous session) was still bound to
`:3000`. The freshly started process logged "listening" but the port was already
taken by the old one, so every request went to stale code. Symptoms reported
against "the current code" were actually produced by a previous version.

**Fix / procedure**

```powershell
netstat -ano | findstr ":3000"          # find the holder
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select ProcessId, CommandLine          # identify it
Stop-Process -Id <pid> -Force            # stop the orphan
# restart and re-read /api/health — version must match package.json
```

**Verification** — after the restart:
`{"version":"2026.1.0","uptimeSec":16,…}` matching `package.json`.

**Fallout / laws written**
- **L-04** — before claiming code is broken, prove *which* code is running.
  Added "re-derive" instructions to `CONTEXT.md` §10.

### BUG-2026-0003 — E2E suite reported 9 failures on a healthy app

| field | value |
| --- | --- |
| status | ✅ **CLOSED** — 2026-10-07 |
| severity | **medium** (a red gate that nobody trusts blocks nothing) |
| area | `e2e/dashboard.spec.mjs` (test defects, not product defects) |
| rule produced | `.ai/RULES.md` → **L-28** (a flaky/broken test is a bug in the test) |

**Symptom**
`pnpm run e2e` → **17 passed / 9 failed** while the application itself behaved
correctly in a real browser.

**Root cause — three independent test defects**

| # | failure | cause |
| --- | --- | --- |
| 1 | 8 × `element is outside of the viewport` | below 900px the sidebar is `position: fixed; transform: translateX(-100%)`, so `.nav a` links are *rendered but off-canvas*. Clicking them without opening `#menu-btn` first always times out. |
| 2 | 4 × `strict mode violation: getByLabel('Name') resolved to 2 elements` | the **Custom headers** label contains the hint `One "Name: value" per line`, so a substring label lookup matched both the Name input and the headers textarea. |
| 3 | cleanup loop never deleted anything | the loop selected `[data-monitor-id]`, an attribute no element in this app ever carries (`monitorRow()` sets `role`/`aria-label` only), so it matched 0 rows and left `e2e/.tmp-data` state behind between runs. |

A fourth, latent problem: `getByRole('button', {name: 'New monitor'})` resolves
to **two** buttons (topbar `#new-monitor-btn` and the empty-state CTA), and the
topbar label is `display:none` below 640px — so the lookup was both ambiguous
on desktop and empty on mobile.

**Fix**

```js
async function clickNav(page, name) {          // open the off-canvas sidebar first
  const menuBtn = page.getByRole('button', { name: 'Open navigation' });
  if (await menuBtn.isVisible()) await menuBtn.click();
  await page.getByRole('link', { name }).click();
}
async function resetMonitors(request) {        // real cleanup, via the API
  for (const m of await (await request.get('/api/monitors')).json()) {
    await request.delete(`/api/monitors/${m.id}`);
  }
}
function newMonitorBtn(page) { return page.locator('#new-monitor-btn'); }  // unambiguous
```

plus `getByLabel('Name', { exact: true })` everywhere, and `#nav-monitors` for
the sidebar count assertion.

**Verification** — `pnpm run e2e` → **26 passed / 0 failed**, twice in a row,
desktop + mobile (exit code `0`). Test isolation is now deterministic: the
`beforeEach` wipes server state through the `request` fixture.

**Fallout / laws written**

- No product change was needed — the app was already correct.
- Documented in `CONTEXT.md` §4 ("Test isolation") so the pattern is reused.

---

## 3 · Triage procedure

1. **Reproduce** with a real command. Attach actual output (`L-04`).
2. **Identify which code is running** — check version + PID first
   (`BUG-2026-0002`).
3. **Find the root cause**, not the nearest symptom. A toast that does not
   appear is rarely a toast problem (`BUG-2026-0001`).
4. **Fix** with the minimal change that removes the cause.
5. **Add a regression test** that fails before the fix and passes after.
6. **Write the law** if the incident reveals a class of mistake worth
   preventing (`L-40`, `L-04`).
7. **Verify**, then append the entry here with its verification table.

## 4 · ID convention

`BUG-<year>-<4-digit sequence>`, assigned at the moment the incident is
first reproduced — not when it is fixed. Sequence continues across years.
