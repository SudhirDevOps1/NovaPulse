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

_None. The register is clear._

---

## 2 · Closed incidents

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
