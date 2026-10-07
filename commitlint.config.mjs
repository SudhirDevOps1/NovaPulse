/**
 * Conventional Commits — enforced locally (husky) and in CI (Darwaza 1).
 *
 * release-please reads these messages to decide the semver bump:
 *   feat:      -> minor
 *   fix:       -> patch
 *   feat!: / BREAKING CHANGE footer -> major
 *
 * Anything outside this set is rejected so `CHANGELOG.md` never goes stale.
 */
export default {
	extends: ['@commitlint/config-conventional'],
	rules: {
		// Scope reflects the real layout of this repo (see .ai/RULES.md §L-31).
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
		'subject-empty': [2, 'never'],
		'type-empty': [2, 'never'],
		// Keep subjects scannable in the generated changelog.
		'subject-max-length': [2, 'always', 90],
		'body-max-line-length': [2, 'always', 120],
		'header-max-length': [2, 'always', 120],
		// Scope stays optional (release-please accepts both `feat: x` and
		// `feat(ui): x`), but when present it must come from the enum above —
		// `scope-enum` is skipped for an empty scope, so bare types still pass.
	},
};
