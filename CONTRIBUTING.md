# 🤝 Contributing to NovaPulse

Thanks for helping. This document is the short path from "I have an idea" to
"my PR is merged". The long-form user/deploy manual is
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md); the CI/Settings operations
manual is [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md); the binding
engineering rules are [.ai/RULES.md](.ai/RULES.md).

---

## 1. Set up

```bash
git clone https://github.com/<your-user>/NovaPulse.git
cd NovaPulse
pnpm install            # installs husky hooks via the prepare script
pnpm run check          # typecheck + lint + tests + build — must be exit 0
pnpm e2e:install        # once: download Playwright browsers
pnpm run e2e            # 26 specs, desktop + mobile
```

`pnpm run verify` runs `check` and `e2e` in one shot — that is exactly what CI
expects from you.

---

## 2. Branch + commit

```bash
git checkout -b fix/short-description
# …make the change…
pnpm run verify
```

Commit messages are **Conventional Commits** — enforced locally by husky and in
CI by Darwaza 1's `Conventional commit lint` job:

```
type(optional-scope): subject ≤ 90 chars
```

| | Allowed |
| :--- | :--- |
| **Types** | `feat` `fix` `docs` `chore` `refactor` `perf` `test` `build` `ci` `style` `revert` |
| **Scopes** *(optional, but this if you use one)* | `api` `probe` `store` `analytics` `notify` `checker` `ui` `dashboard` `status` `security` `ci` `docs` `deps` `release` `monitor` `tools` |
| **Rules** | subject required, ≤ 90 chars · header ≤ 120 · body lines ≤ 120 · blank line before any `Closes:`/`Refs:` footer |

release-please reads these messages, so `feat:` → minor and `fix:` → patch in
the generated changelog. Examples that pass: `fix(ui): keep the toast visible`,
`docs: clarify the fork setup`, `chore(deps): bump express`.

---

## 3. Open the pull request

1. Push your branch and open a PR against `main`.
2. Title matters: it is linted by commitlint like a commit subject.
3. Wait for the checks. **`main` is protected** — a PR can only merge when all
   of these are green:

   | Required check | Workflow |
   | :--- | :--- |
   | `gate` | Darwaza 1 (typecheck, lint, tests × Node 20/22/24, Docker build, commitlint) |
   | `Playwright E2E (desktop + mobile)` | Darwaza 2 |
   | `OWASP ZAP baseline (DAST)` | Darwaza 2 |
   | `SonarQube scan + quality gate notification` | Sonar |

   No force pushes, no direct pushes, no admin bypass — and no approvals
   required, so you can merge your own green PR.

4. If a check is red, **Actions → that run → Re-run failed jobs** after fixing;
   if the base moved under you, re-run so the merge ref is rebuilt.

> **First PR from a new account?** GitHub parks the runs as *«Approve
> workflows to run»* — a maintainer clicks it once, and everything starts.

---

## 4. What "done" means here

- [ ] `pnpm run verify` is exit 0 locally (that is `check` + `e2e`).
- [ ] New behaviour has tests; bug fixes land with a regression test.
- [ ] Public docs that describe the thing you changed were updated
      (README / `docs/` / `.ai/` — grep for the string you changed).
- [ ] No secrets, tokens, emails or other PII in code, logs or fixtures.
- [ ] No placeholders: no `TODO`, no lorem ipsum, no mock data shipped as real.
- [ ] A bug fix is logged in [`.ai/BUGS.md`](.ai/BUGS.md) with symptom →
      root cause → fix → the CI run that proved it.

---

## 5. Where things live

| Path | Contents |
| :--- | :--- |
| `server.js`, `lib/` | HTTP server, probe/store/notify engines |
| `public/` | Dashboard source; `site/` is its generated Pages copy (`pnpm run build`) |
| `test/` | `node --test` unit + integration suite |
| `e2e/` | Playwright specs (desktop + mobile) |
| `tools/` | CI helpers: static builder, GitOps prober, ZAP policy |
| `.github/workflows/` | The 3 Darwazas + Sonar + Release + Monitor |
| `.ai/`, `.agent/` | Architecture, rules, bug register, decision log, agent skills |

---

## 6. Reporting a bug

Security issues never go in a public issue — follow
[docs/SECURITY.md](docs/SECURITY.md) (private GitHub advisory). Everything else:
open an issue with the symptom, how you reproduced it, and the environment. If
you're fixing it, the incident gets a `BUG-2026-XXXX` entry in
[`.ai/BUGS.md`](.ai/BUGS.md) following the existing entries' shape.

---

## 7. License

By contributing you agree your work is released under the [MIT License](LICENSE).
