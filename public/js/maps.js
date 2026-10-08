/**
 * NovaPulse 2026 — Google Maps Platform Global Telemetry Map
 *
 * Visualizes global edge probe locations and target server datacenters.
 * Complies with Google Maps Platform guidelines:
 *   - Attribution: internalUsageAttributionIds: ["gmp_git_agentskills_v1"]
 *   - Modern marker standard: google.maps.marker.AdvancedMarkerElement
 *   - Dark OLED Cyber map styling
 */
import { escapeHtml } from './ui.js';

const EDGE_PROBE_NODES = [
	{ id: 'bom', name: 'Mumbai Edge (BOM)', lat: 19.076, lng: 72.8777, region: 'Asia-Pacific' },
	{ id: 'sin', name: 'Singapore Edge (SIN)', lat: 1.3521, lng: 103.8198, region: 'Asia-Pacific' },
	{ id: 'fra', name: 'Frankfurt Edge (FRA)', lat: 50.1109, lng: 8.6821, region: 'Europe' },
	{ id: 'lhr', name: 'London Edge (LHR)', lat: 51.5074, lng: -0.1278, region: 'Europe' },
	{ id: 'sjc', name: 'San Jose Edge (SJC)', lat: 37.3382, lng: -121.8863, region: 'US-West' },
	{ id: 'iad', name: 'Ashburn Edge (IAD)', lat: 39.0438, lng: -77.4874, region: 'US-East' },
	{ id: 'syd', name: 'Sydney Edge (SYD)', lat: -33.8688, lng: 151.2093, region: 'Australia' },
	{ id: 'nrt', name: 'Tokyo Edge (NRT)', lat: 35.6762, lng: 139.6503, region: 'Asia-East' },
];

const CYBER_DARK_MAP_STYLE = [
	{ elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
	{ elementType: 'labels.text.stroke', stylers: [{ color: '#0d1117' }] },
	{ elementType: 'labels.text.fill', stylers: [{ color: '#8b949e' }] },
	{ featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#00f2fe' }] },
	{ featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6e7681' }] },
	{ featureType: 'road', elementType: 'geometry', stylers: [{ color: '#161b22' }] },
	{ featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#21262d' }] },
	{ featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#161b22' }] },
	{ featureType: 'water', elementType: 'geometry', stylers: [{ color: '#030712' }] },
	{ featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#58a6ff' }] },
];

let gmapsPromise = null;

function loadGoogleMaps(apiKey = '') {
	const win = /** @type {any} */ (window);
	if (win.google?.maps) return Promise.resolve(win.google.maps);
	if (gmapsPromise) return gmapsPromise;

	gmapsPromise = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		const keyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : '';
		script.src = `https://maps.googleapis.com/maps/api/js?v=weekly&libraries=marker${keyParam}&loading=async`;
		script.async = true;
		script.onload = () => resolve(win.google?.maps);
		script.onerror = (err) => reject(new Error('Could not load Google Maps Platform script: ' + err));
		document.head.appendChild(script);
	});

	return gmapsPromise;
}

export async function initTelemetryMap(containerEl, { monitors = [], apiKey = '' } = {}) {
	if (!containerEl) return;

	try {
		await loadGoogleMaps(apiKey);
		const google = /** @type {any} */ (window).google;
		const { Map } = await google.maps.importLibrary('maps');
		const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');

		const map = new Map(containerEl, {
			center: { lat: 20.0, lng: 10.0 },
			zoom: 2,
			mapId: 'novapulse_cyber_telemetry',
			styles: CYBER_DARK_MAP_STYLE,
			disableDefaultUI: true,
			zoomControl: true,
			internalUsageAttributionIds: ['gmp_git_agentskills_v1'],
		});

		const infoWindow = new google.maps.InfoWindow();

		// 1. Plot global edge probing nodes
		EDGE_PROBE_NODES.forEach((node) => {
			const pin = new PinElement({
				background: '#00f2fe',
				borderColor: '#00c6ff',
				glyphColor: '#050b14',
				scale: 0.85,
			});

			const marker = new AdvancedMarkerElement({
				map,
				position: { lat: node.lat, lng: node.lng },
				title: `${node.name} — Probe Active`,
				content: pin.element,
			});

			marker.addListener('click', () => {
				infoWindow.setContent(`
					<div class="map-info">
						<b class="map-info-name">📡 ${node.name}</b><br/>
						<span class="map-info-meta">Region: ${node.region}</span><br/>
						<span class="map-info-note">● Reference location (illustrative marker)</span>
					</div>
				`);
				infoWindow.open({ anchor: marker, map });
			});
		});

		// 2. Plot active monitored targets.
		// NovaPulse has no geolocation for a target, so the marker is placed on a
		// deterministic offset purely to keep them apart. The popup says so — the
		// numbers in it (name, URL, status, latency) are real telemetry.
		monitors.forEach((m, idx) => {
			const baseLat = 28.6139 + ((idx * 17) % 35) - 15;
			const baseLng = 77.209 + ((idx * 29) % 120) - 60;
			const isUp = m.status === 'up';
			const isDown = m.status === 'down';

			const pin = new PinElement({
				background: isDown ? '#f85149' : isUp ? '#3fb950' : '#d29922',
				borderColor: '#ffffff',
				glyphColor: '#ffffff',
				scale: 1.0,
			});

			const marker = new AdvancedMarkerElement({
				map,
				position: { lat: baseLat, lng: baseLng },
				title: `${m.name} (${m.status.toUpperCase()})`,
				content: pin.element,
			});

			marker.addListener('click', () => {
				// `m.name`/`m.url` are attacker-supplied monitor fields and
				// InfoWindow.setContent parses HTML — unescaped here this was the
				// one real XSS sink in the frontend.
				const latency = Number.isFinite(Number(m.lastCheck?.ms)) ? `${Number(m.lastCheck.ms)}ms` : 'No checks';
				const stateClass = isDown ? 'is-down' : isUp ? 'is-up' : '';
				infoWindow.setContent(`
					<div class="map-info">
						<b class="map-info-name ${stateClass}">${escapeHtml(m.name)}</b><br/>
						<span class="map-info-meta">URL: ${escapeHtml(m.url)}</span><br/>
						<span class="map-info-status">Status: <b>${escapeHtml(String(m.status).toUpperCase())}</b> · ${latency}</span><br/>
						<span class="map-info-note">📍 Marker position is illustrative</span>
					</div>
				`);
				infoWindow.open({ anchor: marker, map });
			});
		});

		return map;
	} catch (error) {
		console.warn('Google Maps initialization fallback:', error.message);
		containerEl.innerHTML = `
			<div class="map-fallback-banner">
				<div class="map-fallback-content">
					<h4>🗺️ Telemetry map unavailable</h4>
					<p>The interactive basemap did not load. Monitor status, latency and uptime are unaffected and shown elsewhere in the dashboard.</p>
					<span class="muted text-xs">${
						apiKey
							? 'Google Maps Platform could not be reached.'
							: 'Set GOOGLE_MAPS_API_KEY in the server environment to enable the interactive 3D map.'
					}</span>
				</div>
			</div>
		`;
	}
}
