import js from '@eslint/js';
import globals from 'globals';

/**
 * NovaPulse flat config.
 *
 * Target: `eslint .` exits 0 with ZERO warnings — the CI gate treats any
 * warning as a failure (`--max-warnings=0`), so warnings are errors here.
 *
 * Layout of the codebase:
 *   lib/, server.js, test/, tools/   CommonJS, Node runtime
 *   public/js/, public/sw.js, public/app.js   ES modules, browser runtime
 *   *.mjs                             ES modules, Node tooling
 */
export default [
	{
		ignores: [
			'node_modules/**',
			'site/**',
			'gh-state/**',
			'data/**',
			'coverage/**',
			'public/js/**/*.min.js',
			'**/*.min.js',
		],
	},

	js.configs.recommended,

	// ---- Node (CommonJS) ------------------------------------------------
	{
		files: ['server.js', 'lib/**/*.js', 'test/**/*.js', 'tools/**/*.js', 'ecosystem.config.js'],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'commonjs',
			globals: { ...globals.node },
		},
	},

	// ---- Node (ESM tooling) --------------------------------------------
	{
		files: ['*.mjs'],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'module',
			globals: { ...globals.node },
		},
	},

	// ---- Browser -------------------------------------------------------
	{
		files: ['public/js/**/*.js', 'public/app.js'],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'module',
			globals: { ...globals.browser },
		},
	},

	// ---- Service worker (neither `window` nor plain Node) --------------
	{
		files: ['public/sw.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: { ...globals.serviceworker },
		},
	},

	// ---- Project rules --------------------------------------------------
	{
		rules: {
			// Zero-defect gate: warnings are failures, so keep the surface tiny.
			'no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					ignoreRestSiblings: true,
				},
			],
			'no-console': ['error', { allow: ['warn', 'error'] }],
			'no-var': 'error',
			'prefer-const': 'error',
			eqeqeq: ['error', 'always', { null: 'ignore' }],
			'no-implied-eval': 'error',
			'no-new-func': 'error',
			'no-return-await': 'error',
			'no-throw-literal': 'error',
			'require-await': 'off',
			'no-promise-executor-return': 'error',
		},
	},

	// Console is the CLI surface for the GitHub Actions probes.
	{
		files: ['tools/**/*.js'],
		rules: {
			'no-console': 'off',
		},
	},
];
