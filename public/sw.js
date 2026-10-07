/* NovaPulse 2026 service worker — offline-tolerant shell.
 *
 *  - static assets: stale-while-revalidate (instant from cache,
 *    refreshed in the background so deploys are picked up next load)
 *  - navigations:   network-first with cached shell fallback
 *  - data (/api/*, data/*.json): ALWAYS network — never serve stale state
 */
const CACHE = 'novapulse-shell-v2026.2';

/* TS's WebWorker lib types `self` as a plain WorkerGlobalScope, which has no
 * `skipWaiting`/`clients` — those live on ServiceWorkerGlobalScope. Narrow it
 * once here instead of casting at every call site. */
const sw = /** @type {ServiceWorkerGlobalScope & typeof globalThis} */ (
	/** @type {unknown} */ (self)
);

const SHELL = [
	'./',
	'index.html',
	'status.html',
	'style.css',
	'favicon.svg',
	'manifest.webmanifest',
	'js/app.js',
	'js/api.js',
	'js/charts.js',
	'js/config.js',
	'js/icons.js',
	'js/monitors.js',
	'js/status.js',
	'js/ui.js',
	'js/views.js',
];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) =>
				Promise.all(
					SHELL.map((url) => cache.add(url).catch(() => undefined)),
				),
			)
			.then(() => sw.skipWaiting()),
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => sw.clients.claim()),
	);
});

function isDataRequest(url) {
	return url.pathname.includes('/api/') || url.pathname.includes('/data/');
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// Data must reflect reality — network only.
	if (isDataRequest(url)) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request)
				.then((response) => {
					const copy = response.clone();
					caches.open(CACHE).then((cache) => cache.put('index.html', copy));
					return response;
				})
				.catch(() => caches.match('index.html').then((cached) => cached || Response.error())),
		);
		return;
	}

	// Static assets: serve cache instantly when present, always revalidate
	// in the background (a deploy is visible on the next navigation/load).
	event.respondWith(
		caches.match(request).then((cached) => {
			const network = fetch(request)
				.then((response) => {
					if (response.ok) {
						const copy = response.clone();
						caches.open(CACHE).then((cache) => cache.put(request, copy));
					}
					return response;
				})
				.catch(() => cached || Response.error());
			return cached || network;
		}),
	);
});
