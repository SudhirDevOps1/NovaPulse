/* Build-time mode switch — never detected at runtime (CSP forbids inline scripts).
 *
 *  'server' — the Express build: reads from /api/*, full read-write UI.
 *  'static' — the GitHub Pages build: tools/gh-build.js rewrites this file to
 *             'static' and the app reads ./data/state.json (read-only UI).
 */
/** @type {'server' | 'static'} */
export const APP_MODE = 'server';
