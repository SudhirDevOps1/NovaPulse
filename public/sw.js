/* Kestrel service worker — offline-tolerant shell.
 *
 *  - static assets: stale-while-revalidate (instant from cache,
 *    refreshed in the background so deploys are picked up next load)
 *  - navigations:   network-first with cached shell fallback
 *  - data (/api/*, data/*.json): ALWAYS network — never serve stale state
 */
const CACHE = 'kestrel-shell-v2';

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

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) =>
				Promise.all(
					SHELL.map((url) => cache.add(url).catch(() => undefined)),
				),
			)
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

function isDataRequest(url) {
	return url.pathname.includes('/api/') || url.pathname.includes('/data/');
}

self.addEventListener('fetch', (event) => {
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
