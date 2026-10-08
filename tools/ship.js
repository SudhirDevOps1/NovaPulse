#!/usr/bin/env node
/**
 * NovaPulse 2026 — Zero-Friction Autonomous Ship Utility
 *
 * Runs Quality Gate, commits with Conventional Commits, pushes to GitHub,
 * and automatically opens the Pull Request via GitHub API if on a feature branch.
 */

const { execSync } = require('node:child_process');

function run(cmd) {
	try {
		return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
	} catch (_err) {
		return null;
	}
}

function getGitToken() {
	if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
	if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
	try {
		const out = execSync('git credential fill', {
			input: 'protocol=https\nhost=github.com\n\n',
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'ignore'],
		});
		const match = out.match(/password=(.+)/);
		return match ? match[1].trim() : null;
	} catch {
		return null;
	}
}

async function main() {
	console.log('🚀 NovaPulse Automated Ship Utility');
	console.log('──────────────────────────────────────');

	// 1. Run local Quality Gate
	console.log('🔍 Running 5-Stage Quality Gate...');
	try {
		execSync('npm run check', { stdio: 'inherit' });
		console.log('✅ Quality Gate passed 100%!');
	} catch (_err) {
		console.error('❌ Quality Gate failed! Fix issues before shipping.');
		process.exit(1);
	}

	const branch = run('git branch --show-current') || 'main';
	console.log(`📌 Current Branch: ${branch}`);

	// 2. Push to GitHub
	console.log('📤 Pushing changes to GitHub...');
	execSync(`git push -u origin ${branch}`, { stdio: 'inherit' });
	console.log('✅ Changes pushed successfully!');

	// 3. If on a feature branch, auto-open PR via GitHub API
	if (branch !== 'main' && branch !== 'master') {
		const token = getGitToken();
		if (!token) {
			console.log('ℹ️ Remote updated. Open PR via browser link above.');
			return;
		}

		console.log('🤖 Auto-creating Pull Request on GitHub...');
		const lastCommitMsg = run('git log -1 --pretty=%B') || `feat: updates from ${branch}`;
		const title = lastCommitMsg.split('\n')[0].trim();

		try {
			const res = await fetch('https://api.github.com/repos/SudhirDevOps1/NovaPulse/pulls', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github+json',
					'Content-Type': 'application/json',
					'User-Agent': 'novapulse-ship-tool',
				},
				body: JSON.stringify({
					title,
					head: branch,
					base: 'main',
					body: `### 🚀 Automated PR\n\n**Commit**: \`${title}\`\n\n✅ 5-Stage Zero-Defect Quality Gate verified.`,
				}),
			});

			const data = await res.json();
			if (res.status === 201) {
				console.log(`🎉 Pull Request created automatically: ${data.html_url}`);
			} else if (data.message && data.message.includes('A pull request already exists')) {
				console.log('ℹ️ Pull Request already exists for this branch.');
			} else {
				console.log(`ℹ️ GitHub response: ${data.message || 'Check repository'}`);
			}
		} catch (err) {
			console.log('ℹ️ Could not auto-create PR via API:', err.message);
		}
	}
}

main().catch(console.error);
