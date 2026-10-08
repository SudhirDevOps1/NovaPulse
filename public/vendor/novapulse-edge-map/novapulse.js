/*!
 * NovaPulse Edge Map — v1.0.0
 * Embedded, keyless world map of edge-probe vantage points.
 * Built on Leaflet + OpenStreetMap. MIT licensed.
 *
 * Global namespace: window.NovaPulseMap
 * Auto-init:  <div data-novapulse-map></div>
 *             <script src="dist/novapulse.min.js" defer></script>
 *
 * This file is dependency-free. It expects Leaflet (window.L) to be
 * present; it does not bundle it. See README for CDN + npm setup.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.NovaPulseMap = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     Constants
     ══════════════════════════════════════════════════════════════════ */

  var VERSION = '1.0.0';

  /* Status → colour. Overridable per-instance via options.colors. */
  var STATUS_COLOR = {
    Operational: '#22C55E',
    Degraded: '#F59E0B',
    Down: '#EF4444'
  };

  /* Status precedence for cluster aggregation (worst wins). */
  var STATUS_RANK = { Operational: 0, Degraded: 1, Down: 2 };

  var OSM_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright" ' +
    'target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

  /* Tile presets. Every one is keyless and CORS-free.
     NOTE: CARTO's dark_all endpoint now serves a fixed 2,394-byte
     "API KEY REQUIRED" placeholder for unauthenticated requests. It is
     kept only as a documented option for users who hold a CARTO key. */
  var TILES = {
    /* Dark-native basemap. Requires a free CARTO API key. */
    cartoDark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: OSM_ATTR + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
      invert: false,
      needsKey: true
    },
    /* Keyless light raster. Shell applies a CSS invert+re-tint filter so
       the map still reads dark. Verified working with no key. */
    osmDark: {
      url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      maxZoom: 18,
      attribution: OSM_ATTR,
      invert: true
    },
    /* Keyless light raster, no filter. Best for light-theme hosts. */
    osmLight: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution: OSM_ATTR,
      invert: false
    },
    /* Fully offline / CSP-safe: no network, no attribution needed.
       Drawn client-side as a graticule on the shell background. */
    none: { url: null, attribution: '', invert: false, offline: true }
  };

  /* ══════════════════════════════════════════════════════════════════
     Small utilities
     ══════════════════════════════════════════════════════════════════ */

  function isEl(x) {
    return x && typeof x === 'object' && x.nodeType === 1;
  }

  function resolveContainer(input) {
    if (isEl(input)) return input;
    if (typeof input === 'string') {
      var el = document.querySelector(input);
      if (!el) throw new Error('[NovaPulseMap] container not found: ' + input);
      return el;
    }
    throw new Error('[NovaPulseMap] options.container is required');
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    return function () { target.removeEventListener(type, fn, opts); };
  }

  function prefersReducedMotion() {
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /* ══════════════════════════════════════════════════════════════════
     Embedded styles
     Injected once into <head>. Kept deliberately small and namespaced
     under .nps-* so it cannot collide with a host page.
     ══════════════════════════════════════════════════════════════════ */

  var STYLE_ID = 'novapulse-edge-map-css';
  var CSS = [
    /* Host is a stack, not the map itself — it must NOT clip or fix a
       height, otherwise the toggle and stats panel get cut off. */
    '.nps{position:relative;background:var(--nps-ink,#0B0F14);',
    'border:1px solid var(--nps-line,#243244);border-radius:var(--nps-radius,16px);',
    'isolation:isolate;width:100%;}',
    /* The surface owns height + clipping + corners. */
    '.nps>div[data-nps-surface]{position:relative;overflow:hidden;',
    'border-radius:calc(var(--nps-radius,16px) - 1px);',
    'height:var(--nps-height,420px);width:100%;}',
    '.nps>div[data-nps-surface]>.leaflet-container{height:100%;width:100%;}',
    '.nps.nps-invert .leaflet-tile-pane{filter:invert(1) hue-rotate(185deg) brightness(.92) contrast(1.05) saturate(.55);}',
    '.nps .leaflet-container{font:inherit;background:var(--nps-ink,#0B0F14);}',
    '@keyframes nps-zoom-in{from{transform:scale(1.06)}to{transform:scale(1)}}',
    '.nps-anim .leaflet-container{animation:nps-zoom-in 1100ms cubic-bezier(.22,1,.36,1) both;transform-origin:50% 55%;}',

    /* markers */
    '.nps-icon{background:none!important;border:0!important;}',
    '.nps-icon>*{position:absolute;border-radius:9999px;}',
    '.nps-pulse{inset:0;border:2px solid var(--c);opacity:0;animation:nps-pulse 2.6s cubic-bezier(.22,1,.36,1) infinite;}',
    '.nps-dot{inset:8px;background:var(--c);box-shadow:0 0 0 2px var(--nps-ink,#0B0F14),0 0 10px 1px var(--c),0 0 22px 4px color-mix(in srgb,var(--c) 45%,transparent);}',
    '@keyframes nps-pulse{0%{transform:scale(.5);opacity:.85}70%{transform:scale(1.8);opacity:0}100%{transform:scale(1.8);opacity:0}}',
    '.nps-pulse.d1{animation-delay:.45s}.nps-pulse.d2{animation-delay:.9s}.nps-pulse.d3{animation-delay:1.35s}',
    '.nps-icon[data-status=Down] .nps-pulse{animation-duration:1.5s}',
    '.nps-icon[data-status=Down] .nps-pulse::after{content:"";position:absolute;inset:0;border-radius:9999px;border:2px solid var(--c);animation:nps-pulse 1.5s cubic-bezier(.22,1,.36,1) .75s infinite;}',
    '.nps-icon[data-status=Degraded] .nps-pulse{animation-duration:3.4s}',

    /* clusters */
    '.nps-cluster .nps-ring{inset:0;background:var(--nps-ink,#0B0F14);border:2px solid var(--c);box-shadow:0 0 0 1px var(--nps-ink,#0B0F14),0 0 18px 2px color-mix(in srgb,var(--c) 50%,transparent);}',
    '.nps-cluster .nps-count{inset:0;display:grid;place-items:center;font-size:11px;font-weight:800;line-height:1;color:var(--c);font-variant-numeric:tabular-nums;}',
    '.nps-cluster .nps-dot{display:none}',

    /* tooltip */
    '.nps-tip{background:rgba(17,24,35,.97)!important;border:1px solid var(--nps-line,#243244)!important;',
    'border-radius:12px!important;box-shadow:0 12px 32px rgba(0,0,0,.6)!important;color:var(--nps-fg,#E2E8F0)!important;',
    'padding:11px 14px!important;font-family:inherit!important;white-space:nowrap!important;margin-top:-4px!important;}',
    '.nps-tip::before{display:none!important}',
    '.nps-tip-name{font-weight:700;font-size:.875rem;letter-spacing:-.01em;}',
    '.nps-tip-city{font-size:.7rem;color:var(--nps-faint,#9FB0C6);margin-top:2px;text-transform:uppercase;letter-spacing:.07em;}',
    '.nps-tip-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:9px;}',
    '.nps-tip-k{font-size:.7rem;color:var(--nps-faint,#9FB0C6);text-transform:uppercase;letter-spacing:.06em;}',
    '.nps-tip-lat{font-size:.875rem;font-weight:700;font-variant-numeric:tabular-nums;}',
    '.nps-tip-badge{display:inline-flex;align-items:center;gap:5px;font-size:.6875rem;font-weight:700;padding:3px 7px;border-radius:6px;',
    'background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c);border:1px solid color-mix(in srgb,var(--c) 32%,transparent);}',
    '.nps-tip-badge i{width:6px;height:6px;border-radius:9999px;background:var(--c)}',

    /* controls — !important because leaflet.css may load later and
       .leaflet-bar rules tie on specificity. */
    '.nps .leaflet-control-attribution{background:var(--nps-ink,#0B0F14)!important;color:var(--nps-faint,#9FB0C6)!important;',
    'font-size:11px!important;line-height:1.5;padding:5px 8px!important;border-radius:6px 0 0 0;}',
    '.nps .leaflet-control-attribution a{color:#C7D4E2!important;display:inline-block;padding:2px 0;}',
    '.nps .leaflet-control-zoom{border:0!important;box-shadow:none!important;display:flex!important;flex-direction:column!important;gap:6px!important;}',
    '.nps .leaflet-control-zoom a,.nps .leaflet-bar a{width:36px!important;height:36px!important;display:grid!important;place-items:center!important;',
    'background:rgba(17,24,35,.94)!important;border:1px solid var(--nps-line,#243244)!important;border-radius:9px!important;',
    'color:#C7D4E2!important;font-size:1.05rem!important;font-weight:600!important;line-height:1!important;cursor:pointer!important;',
    'text-decoration:none!important;backdrop-filter:blur(8px);transition:background .18s ease,border-color .18s ease,color .18s ease;}',
    '.nps .leaflet-control-zoom a::before,.nps .leaflet-bar a::before{content:none!important}',
    '.nps .leaflet-control-zoom a:hover,.nps .leaflet-bar a:hover{background:#1B2634!important;border-color:#33455C!important;color:#fff!important}',
    '.nps .leaflet-control-zoom a:focus-visible{outline:2px solid #38BDF8!important;outline-offset:2px!important}',
    '.nps .leaflet-control-zoom a.leaflet-disabled{opacity:.35!important;cursor:default!important}',
    '.nps .leaflet-control-scale-line{background:var(--nps-ink,#0B0F14)!important;border-color:#33455C!important;',
    'color:var(--nps-faint,#9FB0C6)!important;font-size:11px!important;padding:3px 7px!important;}',

    /* legend + hint */
    '.nps-legend{position:absolute;z-index:500;right:12px;top:12px;background:rgba(11,15,20,.9);border:1px solid var(--nps-line,#243244);',
    'border-radius:10px;padding:8px 10px;backdrop-filter:blur(8px);display:flex;flex-direction:column;gap:5px;pointer-events:none;}',
    '.nps-legend div{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--nps-faint,#9FB0C6)}',
    '.nps-legend i{width:8px;height:8px;border-radius:9999px}',
    '.nps-hint{position:absolute;z-index:500;left:12px;bottom:34px;background:rgba(11,15,20,.88);border:1px solid var(--nps-line,#243244);',
    'color:var(--nps-faint,#9FB0C6);font-size:11px;padding:5px 9px;border-radius:8px;backdrop-filter:blur(8px);',
    'pointer-events:none;transition:opacity .4s ease;font-family:inherit;}',

    /* stats */
    '.nps-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:10px 12px 0;}',
    '.nps-stat{background:var(--nps-soft,#111823);border:1px solid var(--nps-line,#243244);border-radius:12px;padding:12px 14px;}',
    '.nps-stat-k{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--nps-faint,#9FB0C6);}',
    '.nps-stat-v{margin:4px 0 0;font-size:1.5rem;font-weight:700;font-variant-numeric:tabular-nums;color:var(--nps-fg,#E2E8F0);}',
    '.nps-stat-v small{font-size:.875rem;font-weight:500;color:var(--nps-faint,#9FB0C6);}',

    /* table */
    '.nps-table-wrap{margin:10px 12px 12px;overflow-x:auto;border:1px solid var(--nps-line,#243244);border-radius:12px;}',
    '.nps-table{width:100%;border-collapse:collapse;font-size:.875rem;text-align:left;}',
    '.nps-table th{background:rgba(255,255,255,.03);color:var(--nps-faint,#9FB0C6);font-size:11px;text-transform:uppercase;',
    'letter-spacing:.07em;font-weight:600;padding:12px 16px;white-space:nowrap;}',
    '.nps-table td,.nps-table tbody th{padding:12px 16px;border-top:1px solid rgba(255,255,255,.05);font-weight:600;color:var(--nps-fg,#E2E8F0);}',
    '.nps-table tbody tr:hover{background:rgba(255,255,255,.03)}',
    '.nps-table .nps-coord{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.75rem;font-variant-numeric:tabular-nums;',
    'color:var(--nps-faint,#9FB0C6);font-weight:400;white-space:nowrap;}',
    '.nps-table .nps-num{text-align:right;font-variant-numeric:tabular-nums;color:#CBD5E1;font-weight:400;}',
    '.nps-table .nps-stat-cell{text-align:right;}',
    '.nps-pill{display:inline-block;border-radius:6px;border:1px solid;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap;}',
    '.nps-dotmark{display:inline-block;width:8px;height:8px;border-radius:9999px;margin-right:8px;vertical-align:middle;}',
    '.nps-toggle{display:inline-flex;align-items:center;gap:12px;cursor:pointer;user-select:none;background:var(--nps-soft,#111823);',
    'border:1px solid var(--nps-line,#243244);border-radius:12px;padding:10px 16px;margin-bottom:10px;font-family:inherit;}',
    '.nps-toggle-lbl{font-size:.875rem;font-weight:600;color:var(--nps-fg,#E2E8F0)}',
    '.nps-toggle.is-off .nps-toggle-lbl{color:var(--nps-faint,#9FB0C6)}',
    '.nps-switch{position:relative;width:44px;height:26px;flex:none;border:0;border-radius:999px;background:rgba(34,197,94,.8);cursor:pointer;padding:0;transition:background .2s ease;}',
    '.nps-switch.is-off{background:rgba(100,116,139,.45)}',
    '.nps-switch:focus-visible{outline:2px solid #38BDF8;outline-offset:2px}',
    '.nps-switch i{position:absolute;top:3px;left:2px;width:20px;height:20px;border-radius:999px;background:#fff;transition:transform .22s cubic-bezier(.22,1,.36,1)}',
    '.nps-switch.is-off i{transform:translateX(18px)}',
    '.nps-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',

    '@media (prefers-reduced-motion:reduce){',
    '.nps-anim .leaflet-container{animation:none}',
    '.nps-pulse{animation:none!important;opacity:.25;transform:scale(1.4)}',
    '.nps-icon[data-status=Down] .nps-pulse::after{animation:none!important;opacity:.25;transform:scale(1.4)}}',
    '@media (prefers-contrast:more){.nps-tip{border-width:2px!important}}'
  ].join('');

  function injectStyles(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(el);
  }

  /* ══════════════════════════════════════════════════════════════════
     Tiny event emitter
     ══════════════════════════════════════════════════════════════════ */

  function Emitter() {
    this._h = {};
  }
  /* Calling without new (NovaPulseMap({...})) reaches Emitter with
     `this` undefined under strict mode, which threw before _build. */
  Emitter.prototype.init = function () { this._h = {}; return this; };
  Emitter.prototype.on = function (type, fn) {
    (this._h[type] || (this._h[type] = [])).push(fn);
    var self = this;
    return function () { self.off(type, fn); };
  };
  Emitter.prototype.off = function (type, fn) {
    var a = this._h[type];
    if (!a) return;
    var i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  };
  Emitter.prototype.emit = function (type, detail) {
    var a = (this._h[type] || []).slice();
    for (var i = 0; i < a.length; i++) {
      try { a[i](detail); }
      catch (e) { console.error('[NovaPulseMap] handler error on "' + type + '"', e); }
    }
    if (type !== '*' && this._h['*']) this.emit('*', { type: type, detail: detail });
  };

  /* ══════════════════════════════════════════════════════════════════
     NovaPulseMap
     ══════════════════════════════════════════════════════════════════ */

  function NovaPulseMap(options) {
    if (!(this instanceof NovaPulseMap)) return new NovaPulseMap(options);
    Emitter.call(this);

    var o = options || {};
    var self = this;

    this.options = {
      container: o.container || null,
      nodes: o.nodes || [],
      nodesUrl: o.nodesUrl || null,
      theme: o.theme === 'light' ? 'light' : 'dark',
      tile: o.tile || (o.theme === 'light' ? 'osmLight' : 'osmDark'),
      tileUrl: o.tileUrl || null,
      height: o.height || 420,
      zoom: typeof o.zoom === 'number' ? o.zoom : 2,
      /* minZoom 1, not 2. fitBounds() silently clamps at minZoom, so a
         narrow/short container at minZoom 2 leaves world-edge nodes
         scrolled outside the viewport with no way to reach them.
         z1 gives it the room to always fit every node. */
      minZoom: typeof o.minZoom === 'number' ? o.minZoom : 1,
      maxZoom: typeof o.maxZoom === 'number' ? o.maxZoom : 8,
      cluster: o.cluster !== false,
      clusterRadius: typeof o.clusterRadius === 'number' ? o.clusterRadius : 34,
      live: o.live !== false,
      refreshMs: typeof o.refreshMs === 'number' ? o.refreshMs : 5000,
      jitter: typeof o.jitter === 'number' ? o.jitter : 0.14,
      showToggle: !!o.showToggle,
      showStats: !!o.showStats,
      showTable: !!o.showTable,
      showLegend: o.showLegend !== false,
      showScale: o.showScale !== false,
      showHint: o.showHint !== false,
      scrollWheelZoom: o.scrollWheelZoom !== false,
      emitStateToParent: o.emitStateToParent !== false,
      colors: Object.assign({}, STATUS_COLOR, o.colors || {}),
      onNodeClick: typeof o.onNodeClick === 'function' ? o.onNodeClick : null
    };

    this._destroyed = false;
    this._interacted = false;
    this._hinted = false;
    this._live = this.options.live;
    this._rendered = [];
    this._timer = null;
    this._offs = [];

    if (typeof window === 'undefined' || !window.L) {
      throw new Error('[NovaPulseMap] Leaflet (window.L) not found. Load Leaflet before this script.');
    }

    this._root = resolveContainer(this.options.container);

    /* Mounting twice on one element used to orphan the first instance:
       its interval, ResizeObserver and Leaflet map all stayed live and
       invisible, leaking on every re-init. Tear it down first. */
    var prior = this._root.__npsInstance;
    if (prior && prior !== this && typeof prior.destroy === 'function') {
      try { prior.destroy(); } catch (e) { console.error('[NovaPulseMap] failed to dispose previous instance', e); }
    }
    this._root.__npsInstance = this;

    this._build();
  }

  NovaPulseMap.prototype = Object.create(Emitter.prototype);
  NovaPulseMap.prototype.constructor = NovaPulseMap;

  /* ── Construction ─────────────────────────────────────────────────── */

  NovaPulseMap.prototype._build = function () {
    var self = this;
    var o = this.options;
    var host = this._root;

    injectStyles(host.ownerDocument || document);

    /* Host gets the theme vars. */
    host.classList.add('nps');
    host.style.setProperty('--nps-height', o.height + 'px');
    if (o.theme === 'dark') host.style.setProperty('--nps-ink', '#0B0F14');
    else host.style.setProperty('--nps-ink', '#FFFFFF');

    host.innerHTML = '';

    /* The host is an in-flow stack: [toggle] [map surface] [stats/table].
       The SURFACE — not the host — must own the fixed height, clipping and
       rounded corners. Pinning the height to the host instead makes
       Leaflet measure a collapsed pane and park every marker at -17000px.
       Order is built explicitly: append the surface first, then insert the
       toggle BEFORE it, then append the panel after. */
    this._frame = document.createElement('div');
    this._frame.setAttribute('data-nps-surface', '');
    host.appendChild(this._frame);

    if (o.showToggle) this._buildToggle();
    if (o.showStats || o.showTable) this._buildPanel();

    /* ── map ── */
    var map = L.map(this._frame, {
      center: o.nodes.length ? this._centerOf(o.nodes) : [24, 12],
      zoom: o.zoom,
      minZoom: o.minZoom,
      maxZoom: o.maxZoom,
      worldCopyJump: true,
      scrollWheelZoom: false, /* armed on hover; never traps page scroll */
      keyboard: true,
      zoomControl: false,
      attributionControl: true
    });
    this._map = map;

    var preset = TILES[o.tile] || TILES.osmDark;
    var url = o.tileUrl || preset.url;

    if (url) {
      /* Only pass keys the preset actually defines. Leaflet's
         _getSubdomain() throws on subdomains:undefined, so a conditional
         build is required rather than an object literal with holes. */
      var cfg = { attribution: preset.attribution || '' };
      if (preset.maxZoom) cfg.maxZoom = preset.maxZoom;
      if (preset.subdomains) cfg.subdomains = preset.subdomains;

      var layer = L.tileLayer(url, cfg);
      /* Follow the PRESET, not the theme. A host asking for theme:'dark'
         with tile:'osmLight' still wants that raster shown as-is. */
      if (preset.invert) host.classList.add('nps-invert');
      layer.on('tileerror', function () {
        self.emit('error', { code: 'tile-error', url: url });
      });
      layer.addTo(map);
      this._layer = layer;
    }

    if (o.showScale) {
      L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 110 }).addTo(map);
    }
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    if (o.showLegend) this._buildLegend();

    /* ── markers ── */
    this._markerLayer = L.layerGroup().addTo(map);

    /* ── interaction ── */
    map.on('zoomend', function () { self._renderMarkers(); self._refresh(); });
    map.on('dragstart', function () { self._interacted = true; self._dismissHint(); });
    map.on('zoomstart', function () { self._interacted = true; self._dismissHint(); });
    map.on('click', function () { self._dismissHint(); });

    if (o.scrollWheelZoom) {
      var c = map.getContainer();
      this._offs.push(on(c, 'mouseenter', function () { map.scrollWheelZoom.enable(); }));
      this._offs.push(on(c, 'mouseleave', function () { map.scrollWheelZoom.disable(); }));
      this._offs.push(on(c, 'wheel', function () { self._dismissHint(); }, { passive: true, once: true }));
    }

    /* ── responsiveness (never overflow the container) ── */
    var self2 = this;
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(function () { self2.invalidateSize(); });
      this._ro.observe(host);
    }
    this._offs.push(on(window, 'orientationchange', function () {
      setTimeout(function () { self.invalidateSize(); }, 250);
    }));
    this._offs.push(on(document, 'visibilitychange', function () {
      if (!document.hidden) self.invalidateSize();
    }));

    if (o.showHint) this._buildHint();

    if (!prefersReducedMotion()) {
      host.classList.add('nps-anim');
      var pane = this._frame.querySelector('.leaflet-container');
      if (pane) {
        this._offs.push(on(pane, 'animationend', function () {
          host.classList.remove('nps-anim');
          self.invalidateSize();
        }, { once: true }));
      }
    }

    /* ── embed protocol ── */
    if (o.emitStateToParent && window.parent && window.parent !== window) {
      this._offs.push(on(window, 'message', function (ev) { self._onMessage(ev); }));
    }

    this.setNodes(o.nodes);
    this._fit();

    this._start();
    this.emit('ready', this.getState());
  };

  NovaPulseMap.prototype._centerOf = function (nodes) {
    var lat = 0, lon = 0, n = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (typeof nodes[i].lat === 'number' && typeof nodes[i].lon === 'number') {
        lat += nodes[i].lat; lon += nodes[i].lon; n++;
      }
    }
    return n ? [lat / n, lon / n] : [24, 12];
  };

  /* ── Chrome ───────────────────────────────────────────────────────── */

  NovaPulseMap.prototype._buildToggle = function () {
    var self = this;
    var host = this._root;

    /* Built node-by-node rather than via innerHTML, so the switch is a
       real element reference regardless of how the host page parses
       markup, and nothing user-supplied can reach innerHTML here. */
    var wrap = document.createElement('label');
    wrap.className = 'nps-toggle';

    var lbl = document.createElement('span');
    lbl.className = 'nps-toggle-lbl';
    lbl.setAttribute('data-lbl', '');
    lbl.textContent = 'Live Probing Active';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nps-switch';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', 'true');
    btn.setAttribute('aria-label', 'Live probing');

    var knob = document.createElement('i');
    btn.appendChild(knob);
    wrap.appendChild(lbl);
    wrap.appendChild(btn);
    host.insertBefore(wrap, this._frame);

    this._toggleEls = { wrap: wrap, btn: btn, knob: knob, lbl: lbl };

    btn.addEventListener('click', function () { self.setLive(!self._live); });
  };

  NovaPulseMap.prototype._buildLegend = function () {
    var el = document.createElement('div');
    el.className = 'nps-legend';
    el.setAttribute('aria-hidden', 'true');
    var self = this;
    ['Operational', 'Degraded', 'Down'].forEach(function (st) {
      var row = document.createElement('div');
      var dot = document.createElement('i');
      dot.style.background = self.options.colors[st];
      row.appendChild(dot);
      row.appendChild(document.createTextNode(st));
      el.appendChild(row);
    });
    this._frame.appendChild(el);
  };

  NovaPulseMap.prototype._buildHint = function () {
    var el = document.createElement('div');
    el.className = 'nps-hint';
    el.textContent = 'Scroll to zoom · drag to pan';
    this._frame.appendChild(el);
    this._hint = el;
  };

  NovaPulseMap.prototype._buildPanel = function () {
    var o = this.options;
    var box = document.createElement('div');
    if (o.showStats) {
      var stats = document.createElement('div');
      stats.className = 'nps-stats';
      addCard(stats, 'Avg latency', 'npsAvg');
      addCard(stats, 'Online', 'npsUp');
      addCard(stats, 'Degraded', 'npsWarn');
      addCard(stats, 'Down', 'npsDown');
      box.appendChild(stats);
    }
    if (o.showTable) {
      var wrap = document.createElement('div');
      wrap.className = 'nps-table-wrap';

      var table = document.createElement('table');
      table.className = 'nps-table';

      var caption = document.createElement('caption');
      caption.className = 'nps-sr';
      caption.textContent = 'Edge probe vantage points, coordinates, latency and status';
      table.appendChild(caption);

      var thead = document.createElement('thead');
      var hrow = document.createElement('tr');
      ['Vantage point', 'Coordinates', 'Latency', 'Status'].forEach(function (label, i) {
        var th = document.createElement('th');
        th.setAttribute('scope', 'col');
        if (i > 1) th.style.textAlign = 'right';
        th.textContent = label;
        hrow.appendChild(th);
      });
      thead.appendChild(hrow);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      tbody.setAttribute('data-rows', '');
      table.appendChild(tbody);
      wrap.appendChild(table);
      box.appendChild(wrap);
      this._rows = tbody;
    }
    this._root.appendChild(box);
    this._panel = box;

    function addCard(parent, label, key) {
      var card = document.createElement('div');
      card.className = 'nps-stat';
      var k = document.createElement('p');
      k.className = 'nps-stat-k';
      k.textContent = label;
      var v = document.createElement('p');
      v.className = 'nps-stat-v';
      var span = document.createElement('span');
      span.setAttribute('data-' + key, '');
      span.textContent = '—';
      v.appendChild(span);
      card.appendChild(k);
      card.appendChild(v);
      parent.appendChild(card);
    }
  };

  /* ── Node data ────────────────────────────────────────────────────── */

  NovaPulseMap.prototype._normalize = function (nodes) {
    var self = this;
    return (nodes || []).map(function (n, i) {
      /* Coerce, but reject anything that is not a real coordinate.
         Number(null) === 0 and Number('') === 0, so a null/blank field
         would otherwise land the node off the coast of Africa. */
      var lat = n.lat === null || n.lat === '' || n.lat === undefined ? NaN : Number(n.lat);
      var lon = n.lon === null || n.lon === '' || n.lon === undefined ? NaN : Number(n.lon);
      if (!isFinite(lat) || !isFinite(lon)) return null;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
      var status = n.status || 'Operational';
      return {
        id: n.id || String(i),
        name: n.name || ('Node ' + (i + 1)),
        region: n.region || '',
        lat: lat,
        lon: lon,
        status: self.options.colors[status] ? status : 'Operational',
        latency: typeof n.latency === 'number' ? n.latency : (typeof n.ms === 'number' ? n.ms : 0)
      };
    }).filter(Boolean);
  };

  NovaPulseMap.prototype.setNodes = function (nodes) {
    this._nodes = this._normalize(nodes);
    this._renderTable();
    this._renderMarkers();
    this._refresh();
    this._post({ type: 'nodes', count: this._nodes.length });
    return this;
  };

  NovaPulseMap.prototype.getNodes = function () {
    return this._nodes.slice();
  };

  NovaPulseMap.prototype.getNode = function (id) {
    for (var i = 0; i < this._nodes.length; i++) {
      if (this._nodes[i].id === id) return Object.assign({}, this._nodes[i]);
    }
    return null;
  };

  /* ── Clustering ───────────────────────────────────────────────────── */

  NovaPulseMap.prototype._group = function () {
    var self = this;
    if (!this.options.cluster) {
      return this._nodes.map(function (v) { return [v]; });
    }
    var pts = this._nodes.map(function (v) {
      return { v: v, p: self._map.project([v.lat, v.lon], self._map.getZoom()) };
    });
    var used = new Array(pts.length).fill(false);
    var groups = [];
    var R = this.options.clusterRadius;

    for (var i = 0; i < pts.length; i++) {
      if (used[i]) continue;
      var g = [pts[i].v];
      used[i] = true;
      for (var j = i + 1; j < pts.length; j++) {
        if (used[j]) continue;
        if (pts[i].p.distanceTo(pts[j].p) < R) { g.push(pts[j].v); used[j] = true; }
      }
      groups.push(g);
    }
    return groups;
  };

  NovaPulseMap.prototype._worst = function (list) {
    var worst = 'Operational';
    for (var i = 0; i < list.length; i++) {
      if ((STATUS_RANK[list[i].status] || 0) > (STATUS_RANK[worst] || 0)) worst = list[i].status;
    }
    return worst;
  };

  NovaPulseMap.prototype._renderMarkers = function () {
    if (!this._markerLayer || this._destroyed || !this._map) return;
    var self = this;
    this._markerLayer.clearLayers();
    this._rendered = [];

    this._group().forEach(function (group, i) {
      var status = self._worst(group);
      var solo = group.length === 1;

      var icon = solo
        ? L.divIcon({
            className: 'nps-icon',
            html: '<span class="nps-pulse d' + (i % 4) + '"></span><span class="nps-dot"></span>',
            iconSize: [24, 24], iconAnchor: [12, 12], tooltipAnchor: [0, -14]
          })
        : L.divIcon({
            className: 'nps-icon nps-cluster',
            html: '<span class="nps-pulse d' + (i % 4) + '"></span><span class="nps-ring"></span>' +
                  '<span class="nps-count">' + group.length + '</span>',
            iconSize: [32, 32], iconAnchor: [16, 16], tooltipAnchor: [0, -18]
          });

      var pos = solo
        ? [group[0].lat, group[0].lon]
        : [group.reduce(function (s, v) { return s + v.lat; }, 0) / group.length,
           group.reduce(function (s, v) { return s + v.lon; }, 0) / group.length];

      var m = L.marker(pos, {
        icon: icon,
        keyboard: true,
        riseOnHover: true,
        title: solo ? group[0].name : group.map(function (v) { return v.name; }).join(', ')
      });
      m.bindTooltip(solo ? self._tipNode(group[0]) : self._tipCluster(group, status), {
        direction: 'top', opacity: 1, sticky: true, className: 'nps-tip', interactive: false
      });
      m.addTo(self._markerLayer);

      var el = m.getElement();
      if (el) {
        el.dataset.status = status;
        el.style.setProperty('--c', self.options.colors[status]);
      }
      self._rendered.push({ marker: m, group: group, solo: solo });
    });
  };

  NovaPulseMap.prototype._tipNode = function (v) {
    var c = this.options.colors[v.status];
    return '<div style="--c:' + c + '">' +
      '<div class="nps-tip-name">' + escapeHtml(v.name) + '</div>' +
      (v.region ? '<div class="nps-tip-city">' + escapeHtml(v.region) + '</div>' : '') +
      '<div class="nps-tip-row"><span class="nps-tip-k">Latency</span>' +
      '<span class="nps-tip-lat">' + (v.status === 'Down' ? '—' : v.latency + ' ms') + '</span></div>' +
      '<div class="nps-tip-row"><span class="nps-tip-k">Status</span>' +
      '<span class="nps-tip-badge"><i></i>' + v.status + '</span></div></div>';
  };

  NovaPulseMap.prototype._tipCluster = function (group, status) {
    var alive = group.filter(function (v) { return v.status !== 'Down'; });
    var avg = alive.length
      ? Math.round(alive.reduce(function (s, v) { return s + v.latency; }, 0) / alive.length)
      : null;
    var c = this.options.colors[status];
    return '<div style="--c:' + c + '">' +
      '<div class="nps-tip-name">' + group.length + ' vantage points</div>' +
      '<div class="nps-tip-city">' + escapeHtml(group.map(function (v) { return v.name; }).join(' · ')) + '</div>' +
      '<div class="nps-tip-row"><span class="nps-tip-k">Avg latency</span>' +
      '<span class="nps-tip-lat">' + (avg === null ? '—' : avg + ' ms') + '</span></div>' +
      '<div class="nps-tip-row"><span class="nps-tip-k">Status</span>' +
      '<span class="nps-tip-badge"><i></i>' + status + '</span></div></div>';
  };

  /* ── Data refresh ─────────────────────────────────────────────────── */

  NovaPulseMap.prototype._jitter = function (v) {
    var spread = v.status === 'Down' ? 0 : v.latency * this.options.jitter;
    return Math.max(1, Math.round(v.latency + (Math.random() * 2 - 1) * spread));
  };

  NovaPulseMap.prototype._refresh = function () {
    if (this._destroyed || !this._map) return;
    var self = this;

    if (this._live) {
      this._nodes.forEach(function (v) {
        if (v.status !== 'Down') v.latency = self._jitter(v);
      });
    }

    this._rendered.forEach(function (r) {
      var status = self._worst(r.group);
      r.marker.setTooltipContent(r.solo ? self._tipNode(r.group[0]) : self._tipCluster(r.group, status));
      var el = r.marker.getElement();
      if (el) {
        el.dataset.status = status;
        el.style.setProperty('--c', self.options.colors[status]);
      }
      if (!r.solo) return;
      r.marker.off('click');
      r.marker.on('click', function () {
        self.emit('nodeclick', self.getNode(r.group[0].id));
        if (self.options.onNodeClick) self.options.onNodeClick(self.getNode(r.group[0].id), self);
      });
    });

    this._renderRows();
    this._renderStats();
    this._post({ type: 'state', state: this.getState() });
  };

  /* ── Panels ───────────────────────────────────────────────────────── */

  NovaPulseMap.prototype._renderStats = function () {
    if (!this.options.showStats) return;
    var nodes = this._nodes;
    var up = 0, warn = 0, down = 0, alive = [];
    nodes.forEach(function (v) {
      if (v.status === 'Down') down++;
      else if (v.status === 'Degraded') { warn++; alive.push(v); }
      else { up++; alive.push(v); }
    });
    var avg = alive.length
      ? Math.round(alive.reduce(function (s, v) { return s + v.latency; }, 0) / alive.length)
      : 0;

    var set = function (key, val, color) {
      var el = this._root.querySelector('[data-' + key + ']');
      if (!el) return;
      el.textContent = val;
      if (color) el.style.color = color;
    };
    set.call(this, 'npsAvg', avg + ' <small>ms</small>');
    set.call(this, 'npsUp', (up + warn) + ' <small>/' + nodes.length + '</small>', this.options.colors.Operational);
    set.call(this, 'npsWarn', warn, this.options.colors.Degraded);
    set.call(this, 'npsDown', down, this.options.colors.Down);

    var banner = this._root.querySelector('[data-nps-banner]');
    if (banner) {
      var st = down ? 'Down' : warn ? 'Degraded' : 'Operational';
      var c = this.options.colors[st];
      banner.textContent = down ? 'Partial Outage' : warn ? 'Degraded Performance' : 'All Systems Operational';
      banner.style.color = c;
      banner.style.background = c + '22';
      banner.style.borderColor = c + '55';
    }
  };

  NovaPulseMap.prototype._renderTable = function () {
    if (!this._rows) return;
    var self = this;
    this._rows.innerHTML = this._nodes.map(function (v) {
      var c = self.options.colors[v.status];
      return '<tr><th scope="row"><span class="nps-dotmark" style="background:' + c + '"></span>' +
        escapeHtml(v.name) + '</th>' +
        '<td class="nps-coord">' + v.lat.toFixed(4) + ', ' + v.lon.toFixed(4) + '</td>' +
        '<td class="nps-num" data-lat="' + v.id + '">—</td>' +
        '<td class="nps-stat-cell"><span class="nps-pill" data-badge="' + v.id + '" style="color:' + c +
        ';background:' + c + '22;border-color:' + c + '55">' + v.status + '</span></td></tr>';
    }).join('');
  };

  NovaPulseMap.prototype._renderRows = function () {
    if (!this._rows) return;
    var self = this;
    this._nodes.forEach(function (v) {
      var cell = self._rows.querySelector('[data-lat="' + v.id + '"]');
      if (cell) cell.textContent = v.status === 'Down' ? '—' : v.latency + ' ms';
      var pill = self._rows.querySelector('[data-badge="' + v.id + '"]');
      if (pill) {
        var c = self.options.colors[v.status];
        pill.textContent = v.status;
        pill.style.color = c;
        pill.style.background = c + '22';
        pill.style.borderColor = c + '55';
      }
    });
  };

  /* ── Live toggle ──────────────────────────────────────────────────── */

  NovaPulseMap.prototype.setLive = function (on_) {
    this._live = !!on_;
    if (this._toggleEls) {
      var e = this._toggleEls;
      e.wrap.classList.toggle('is-off', !this._live);
      e.btn.classList.toggle('is-off', !this._live);
      e.btn.setAttribute('aria-checked', String(this._live));
      e.knob.style.transform = this._live ? 'translateX(0)' : 'translateX(18px)';
      e.lbl.textContent = this._live ? 'Live Probing Active' : 'Probing Paused';
    }
    this._start();
    this.emit('livechange', this._live);
    this._post({ type: 'live', live: this._live });
    return this;
  };

  NovaPulseMap.prototype.toggleLive = function () { return this.setLive(!this._live); };
  NovaPulseMap.prototype.isLive = function () { return this._live; };

  /* ── Timer ────────────────────────────────────────────────────────── */

  NovaPulseMap.prototype._start = function () {
    var self = this;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._timer = setInterval(function () { self._refresh(); },
      this._live ? this.options.refreshMs : this.options.refreshMs * 3);
  };

  /* ── Sizing ───────────────────────────────────────────────────────── */

  NovaPulseMap.prototype._fit = function () {
    if (this._destroyed || !this._map) return;
    if (this._nodes.length < 2) return;
    /* LatLngBounds from two points spanning the antimeridian yields an
       empty/inverted box, and fitBounds on that throws. Fall back to a
       plain fit over the widest safe zoom. */
    var lats = this._nodes.map(function (v) { return v.lat; });
    var lons = this._nodes.map(function (v) { return v.lon; });
    var latSpan = Math.max.apply(null, lats) - Math.min.apply(null, lats);
    var lonSpan = Math.max.apply(null, lons) - Math.min.apply(null, lons);
    if (!(latSpan >= 0) || !(lonSpan >= 0)) return;
    var b = L.latLngBounds(this._nodes.map(function (v) { return [v.lat, v.lon]; }));
    var BLEED = 14;
    this._map.fitBounds(b, {
      paddingTopLeft: [BLEED, BLEED],
      paddingBottomRight: [BLEED, BLEED],
      animate: false
    });
  };

  NovaPulseMap.prototype.invalidateSize = function () {
    if (this._destroyed || !this._map) return this;
    /* Measure the SURFACE, not the host. The host is a stack that can be
       taller than the map (toggle + panel), and after destroy() Leaflet
       reports a zero size — either path produces a bogus fitBounds. */
    var surface = this._frame;
    if (!surface || !surface.clientWidth || !surface.clientHeight) return this;
    this._map.invalidateSize({ pan: false, animate: false });
    if (!this._interacted) this._fit();
    return this;
  };

  /* ── Map controls ─────────────────────────────────────────────────── */

  /* All guarded: Leaflet's remove() detaches the container, so calling
     into it afterwards throws inside Leaflet, not here. */
  NovaPulseMap.prototype.zoomIn = function () {
    if (!this._destroyed && this._map) this._map.zoomIn();
    return this;
  };
  NovaPulseMap.prototype.zoomOut = function () {
    if (!this._destroyed && this._map) this._map.zoomOut();
    return this;
  };
  NovaPulseMap.prototype.fit = function () {
    if (this._destroyed || !this._map) return this;
    this._interacted = false;
    this._fit();
    return this;
  };
  NovaPulseMap.prototype.setView = function (latlng, zoom) {
    if (this._destroyed || !this._map) return this;
    this._interacted = true;
    this._map.setView(latlng, zoom);
    return this;
  };
  NovaPulseMap.prototype.getZoom = function () {
    return (this._destroyed || !this._map) ? null : this._map.getZoom();
  };

  /* ── Hint ─────────────────────────────────────────────────────────── */

  NovaPulseMap.prototype._dismissHint = function () {
    if (this._hinted || !this._hint) return;
    this._hinted = true;
    this._hint.style.opacity = '0';
    var h = this._hint;
    setTimeout(function () { if (h.parentNode) h.parentNode.removeChild(h); }, 450);
  };

  /* ── Embed (postMessage) protocol ─────────────────────────────────── */

  NovaPulseMap.prototype._post = function (msg) {
    if (!this.options.emitStateToParent) return;
    if (!window.parent || window.parent === window) return;
    try {
      window.parent.postMessage(Object.assign({ __novaPulse: 1 }, msg), '*');
    } catch (e) { /* cross-origin parent blocks it; safe to ignore */ }
  };

  NovaPulseMap.prototype._onMessage = function (ev) {
    var d = ev && ev.data;
    if (!d || d.__novaPulse !== 1 || typeof d.type !== 'string') return;
    var self = this;
    switch (d.type) {
      case 'ping':  this._post({ type: 'ready', state: this.getState() }); break;
      case 'getState': this._post({ type: 'state', state: this.getState() }); break;
      case 'setNodes': this.setNodes(d.nodes || []); break;
      case 'setLive':  this.setLive(!!d.live); break;
      case 'resize':  this.invalidateSize(); break;
      case 'fit':     this.fit(); break;
      default: break;
    }
  };

  /* ── State ────────────────────────────────────────────────────────── */

  NovaPulseMap.prototype.getState = function () {
    if (this._destroyed) {
      return {
        version: VERSION, live: false, zoom: null, nodes: [],
        counts: { Operational: 0, Degraded: 0, Down: 0 },
        status: 'Operational', clusters: 0
      };
    }
    var counts = { Operational: 0, Degraded: 0, Down: 0 };
    this._nodes.forEach(function (v) { counts[v.status] = (counts[v.status] || 0) + 1; });
    var worst = this._worst(this._nodes);
    return {
      version: VERSION,
      live: this._live,
      zoom: this._map ? this._map.getZoom() : this.options.zoom,
      nodes: this.getNodes(),
      counts: counts,
      status: worst,
      clusters: this._rendered.filter(function (r) { return !r.solo; }).length
    };
  };

  /* ── Teardown ─────────────────────────────────────────────────────── */

  NovaPulseMap.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this._offs.forEach(function (off) { try { off(); } catch (e) {} });
    this._offs = [];
    if (this._map) { try { this._map.remove(); } catch (e) {} }
    this._root.innerHTML = '';
    this._root.classList.remove('nps', 'nps-invert', 'nps-anim');
    /* Only clear the back-reference if it still points at us, so a
       destroy() on a stale instance cannot unclaim a newer mount. */
    if (this._root.__npsInstance === this) delete this._root.__npsInstance;
    this._root.style.removeProperty('--nps-height');
    this._root.style.removeProperty('--nps-ink');
    this.emit('destroy', null);
    this._h = {};
  };

  /* ══════════════════════════════════════════════════════════════════
     Auto-init:  <div data-novapulse-map data-nodes='[...]'></div>
     ══════════════════════════════════════════════════════════════════ */

  function readOptionsFromAttrs(el) {
    var o = { container: el };
    var map = {
      'data-nodes': 'nodes', 'data-tile': 'tile', 'data-theme': 'theme',
      'data-tile-url': 'tileUrl', 'data-height': 'height', 'data-zoom': 'zoom',
      'data-nodes-url': 'nodesUrl', 'data-refresh': 'refreshMs'
    };
    Object.keys(map).forEach(function (attr) {
      var raw = el.getAttribute(attr);
      if (raw == null) return;
      var key = map[attr];
      if (key === 'nodes') { try { o.nodes = JSON.parse(raw); } catch (e) {} }
      else if (key === 'height' || key === 'zoom' || key === 'refreshMs') o[key] = Number(raw);
      else o[key] = raw;
    });
    ['cluster', 'showLegend', 'showScale', 'showHint', 'scrollWheelZoom'].forEach(function (k) {
      var raw = el.getAttribute('data-' + k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }));
      if (raw != null) o[k] = raw !== 'false';
    });
    ['showToggle', 'showStats', 'showTable'].forEach(function (k) {
      var raw = el.getAttribute('data-' + k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }));
      if (raw != null) o[k] = raw !== 'false';
    });
    return o;
  }

  function autoInit() {
    var nodes = document.querySelectorAll('[data-novapulse-map]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__npsInstance) continue;
      try {
        /* The constructor now records __npsInstance itself, so calling
           mount() again is a no-op instead of a double mount. */
        var inst = new NovaPulseMap(readOptionsFromAttrs(nodes[i]));
        /* A JSON source turns the widget into a live status embed. */
        if (inst.options.nodesUrl) {
          fetch(inst.options.nodesUrl, { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              inst.setNodes(Array.isArray(data) ? data : (data.nodes || []));
            })
            .catch(function () { inst.emit('error', { code: 'nodes-fetch' }); });
        }
      } catch (e) {
        console.error('[NovaPulseMap] auto-init failed', e);
      }
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoInit);
    } else {
      autoInit();
    }
  }

  /* ── Exports ──────────────────────────────────────────────────────── */

  NovaPulseMap.VERSION = VERSION;
  NovaPulseMap.TILES = TILES;
  NovaPulseMap.STATUS_COLOR = STATUS_COLOR;
  NovaPulseMap.create = function (o) { return new NovaPulseMap(o); };
  NovaPulseMap.mount = function (o) { return autoInit(); };
  NovaPulseMap.autoInit = autoInit;

  return NovaPulseMap;
});