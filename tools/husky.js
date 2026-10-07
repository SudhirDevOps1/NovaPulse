/**
 * Husky installer that works in CI, in a fresh clone and offline.
 *
 * `husky` (the official CLI) exits non-zero when it cannot find a `.git`
 * directory, which would fail `pnpm install` inside a container or a tarball
 * install. We therefore treat "no git repo" as a no-op, and only wire the
 * hooks when `.git` exists. `--force` rewrites the hooks even if they exist.
 *
 *   node tools/husky.js           # used by `pnpm prepare`
 *   node tools/husky.js --force   # re-install hooks deliberately
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const force = process.argv.includes('--force');

function gitDir() {
	const dotGit = path.join(root, '.git');
	if (!fs.existsSync(dotGit)) return null;
	// Worktrees/submodules use a `.git` *file* pointing at the real dir.
	if (fs.statSync(dotGit).isDirectory()) return dotGit;
	return null;
}

function main() {
	const git = gitDir();
	if (!git) {
		// Not a checkout (container build, CI install from a tarball): skip quietly.
		process.exit(0);
	}

	const hookDir = path.join(git, 'hooks');
	fs.mkdirSync(hookDir, { recursive: true });

	const result = spawnSync('husky', ['install'], {
		cwd: root,
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: { ...process.env, HUSKY: force ? '0' : process.env.HUSKY },
	});

	if (result.error || result.status !== 0) {
		// Never let hook wiring break an install — the CI gates run the same
		// commands directly, so a local hook failure must not block `pnpm install`.
		if (force) {
			process.stderr.write('husky: could not install git hooks (see above)\n');
			process.exit(1);
		}
		process.exit(0);
	}
}

main();
