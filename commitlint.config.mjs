/**
 * Conventional Commits — Enforced locally (Husky) and in CI (Darwaza 1 & Release Pipeline).
 *
 * Google release-please reads these messages to decide the semver bump:
 *   feat:      -> minor
 *   fix:       -> patch
 *   feat!: / BREAKING CHANGE footer -> major
 */
export default {
	extends: ['@commitlint/config-conventional'],
	rules: {
		// Conventional commit types supported by release-please changelog sections
		'type-enum': [
			2,
			'always',
			[
				'feat',
				'fix',
				'security',
				'perf',
				'refactor',
				'docs',
				'test',
				'chore',
				'ci',
				'build',
				'revert',
			],
		],
		'type-case': [2, 'always', 'lower-case'],
		'type-empty': [2, 'never'],
		'subject-empty': [2, 'never'],
		'header-max-length': [2, 'always', 100],
		'body-max-line-length': [2, 'always', 120],

		// Scope reflects the real architecture of NovaPulse
		'scope-enum': [
			2,
			'always',
			[
				'api',
				'probe',
				'store',
				'analytics',
				'notify',
				'checker',
				'ui',
				'dashboard',
				'status',
				'security',
				'ci',
				'docs',
				'deps',
				'release',
				'monitor',
				'tools',
			],
		],
	},
};
