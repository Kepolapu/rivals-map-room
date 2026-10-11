(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    gallery: $('gallery'), catalog: $('catalog'),
    viewer: $('viewer'), stage: $('map-stage'), image: $('viewer-image'), title: $('viewer-title'), mode: $('viewer-mode'),
    message: $('viewer-message'), messageText: $('viewer-message-text'), back: $('viewer-back'), fullscreen: $('fullscreen-button'),
    zoomIn: $('zoom-in'), zoomOut: $('zoom-out'), fit: $('fit-map'), zoomLevel: $('zoom-level'),
    toast: $('toast')
  };
  const state = {
    maps: [], selected: null, returnFocus: null, imageLoaded: false,
    scale: 1, fitScale: 1, panX: 0, panY: 0, fitted: true,
    pointers: new Map(), gesture: null, hadFullscreen: false, worker: null,
    saving: false, cachePending: false, offlineErrorShown: false, toastTimer: null
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderCatalog() {
    const fragment = document.createDocumentFragment();
    for (const map of state.maps) {
      const tile = element('button', `map-tile${map.available ? '' : ' unavailable-tile'}`);
      tile.type = 'button';
      tile.dataset.mapId = map.id;
      if (map.location) tile.append(element('span', 'tile-location', map.location));
      tile.append(element('span', 'tile-title', map.name), element('span', 'tile-mode', map.gameMode || map.mode));
      if (map.available) {
        tile.setAttribute('aria-label', `Open ${map.fullName || map.name}, ${map.gameMode || map.mode}, with all map details`);
        tile.addEventListener('click', () => openMap(map, { fullscreen: true, route: true, trigger: tile }));
      } else {
        const reason = map.unavailableReason || 'The source does not provide an annotated map layout.';
        tile.disabled = true;
        tile.title = reason;
        tile.setAttribute('aria-label', `${map.fullName || map.name}. Unavailable: ${reason}`);
      }
      fragment.append(tile);
    }
    ui.catalog.replaceChildren(fragment);
    ui.catalog.setAttribute('aria-busy', 'false');
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    state.toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 5500);
  }

  function setViewerMessage(message, error = false) {
    ui.message.hidden = !message;
    ui.messageText.textContent = message;
    ui.message.classList.toggle('error', error);
  }

  function setZoomControls(enabled) {
    ui.zoomIn.disabled = !enabled;
    ui.zoomOut.disabled = !enabled;
    ui.fit.disabled = !enabled;
  }

  function applyTransform() {
    if (!state.imageLoaded) return;
    ui.image.style.transform = `translate(-50%, -50%) translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    ui.zoomLevel.textContent = `${Math.round(state.scale / state.fitScale * 100)}%`;
  }

  function fitMap() {
    if (!state.imageLoaded) return;
    const padding = matchMedia('(max-width: 680px)').matches ? 18 : 28;
    const rect = ui.stage.getBoundingClientRect();
    const scale = Math.min((rect.width - padding * 2) / ui.image.naturalWidth, Math.max(rect.height - 180, 80) / ui.image.naturalHeight);
    state.fitScale = Math.max(scale, 0.001);
    state.scale = state.fitScale;
    state.panX = state.panY = 0;
    state.fitted = true;
    applyTransform();
  }

  function zoomAt(nextScale, anchorX = 0, anchorY = 0) {
    if (!state.imageLoaded) return;
    const scale = Math.max(state.fitScale * 0.5, Math.min(nextScale, Math.max(state.fitScale * 8, 2)));
    const ratio = scale / state.scale;
    state.panX = anchorX - (anchorX - state.panX) * ratio;
    state.panY = anchorY - (anchorY - state.panY) * ratio;
    state.scale = scale;
    state.fitted = false;
    applyTransform();
  }

  function attemptFullscreen() {
    if (!ui.viewer.requestFullscreen || document.fullscreenElement) return;
    try {
      const result = ui.viewer.requestFullscreen();
      if (result && result.catch) result.catch(() => { /* The viewport view remains usable if fullscreen is blocked. */ });
    } catch { /* iOS and embedded browsers use the full-viewport view. */ }
  }

  function openMap(map, options = {}) {
    if (!map.available) {
      showToast(map.unavailableReason || 'This map has no annotated layout in the source library.');
      return;
    }
    if (state.selected && state.selected.id === map.id) {
      if (options.fullscreen) attemptFullscreen();
      return;
    }
    state.returnFocus = options.trigger || (ui.gallery.contains(document.activeElement) ? document.activeElement : null);
    state.selected = map;
    state.imageLoaded = false;
    state.pointers.clear();
    state.gesture = null;
    state.hadFullscreen = false;
    ui.viewer.hidden = false;
    ui.gallery.inert = true;
    document.body.style.overflow = 'hidden';
    ui.title.textContent = map.fullName || map.name;
    ui.mode.textContent = `${map.gameMode || map.mode} / ALL DETAILS`;
    ui.image.hidden = true;
    ui.image.alt = `${map.fullName || map.name}, complete annotated ${map.gameMode || map.mode} map`;
    ui.zoomLevel.textContent = '—';
    setZoomControls(false);
    setViewerMessage('Loading map…');
    ui.image.onload = () => {
      if (!state.selected || state.selected.id !== map.id) return;
      state.imageLoaded = true;
      ui.image.style.width = `${ui.image.naturalWidth}px`;
      ui.image.style.height = `${ui.image.naturalHeight}px`;
      ui.image.hidden = false;
      setViewerMessage('');
      setZoomControls(true);
      fitMap();
    };
    ui.image.onerror = () => {
      if (!state.selected || state.selected.id !== map.id) return;
      state.imageLoaded = false;
      ui.image.hidden = true;
      setZoomControls(false);
      setViewerMessage(navigator.onLine ? 'This map could not load. Return to all maps and try again.' : 'This map is not saved offline yet. Connect to download the library.', true);
    };
    ui.image.src = map.src;
    if (options.route) history.pushState({ mapRoom: true }, '', `#map/${encodeURIComponent(map.id)}`);
    if (options.fullscreen) attemptFullscreen();
    ui.back.focus({ preventScroll: true });
  }

  function closeViewer(updateRoute = true) {
    if (!state.selected) return;
    const returnFocus = state.returnFocus;
    const mapId = state.selected.id;
    state.selected = null;
    state.imageLoaded = false;
    state.hadFullscreen = false;
    state.pointers.clear();
    state.gesture = null;
    ui.image.onload = ui.image.onerror = null;
    ui.viewer.hidden = true;
    ui.gallery.inert = false;
    document.body.style.overflow = '';
    if (document.fullscreenElement === ui.viewer && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (updateRoute) {
      if (history.state && history.state.mapRoom && /^#map\//.test(location.hash)) history.back();
      else history.replaceState(null, '', location.pathname + location.search);
    }
    const target = returnFocus && returnFocus.isConnected && returnFocus !== document.body ? returnFocus : [...ui.catalog.querySelectorAll('button')].find((button) => button.dataset.mapId === mapId);
    if (target) target.focus({ preventScroll: true });
  }

  function syncRoute() {
    const match = /^#map\/(.+)$/.exec(location.hash);
    if (!match) { closeViewer(false); return; }
    let id;
    try { id = decodeURIComponent(match[1]); } catch { id = ''; }
    const map = state.maps.find((entry) => entry.id === id);
    if (map && map.available) openMap(map);
    else {
      closeViewer(false);
      history.replaceState(null, '', location.pathname + location.search);
      showToast(map ? map.unavailableReason || 'The source does not provide this map layout.' : 'That map could not be found.');
    }
  }

  function startGesture() {
    const points = [...state.pointers.values()];
    if (points.length === 1) state.gesture = { x: points[0].x, y: points[0].y, panX: state.panX, panY: state.panY };
    else if (points.length >= 2) {
      const rect = ui.stage.getBoundingClientRect();
      state.gesture = {
        x: (points[0].x + points[1].x) / 2 - rect.left - rect.width / 2,
        y: (points[0].y + points[1].y) / 2 - rect.top - rect.height / 2,
        distance: Math.max(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), 1),
        panX: state.panX, panY: state.panY, scale: state.scale
      };
    } else state.gesture = null;
  }

  ui.stage.addEventListener('pointerdown', (event) => {
    if (!state.imageLoaded || (event.pointerType === 'mouse' && event.button !== 0)) return;
    ui.stage.setPointerCapture(event.pointerId);
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    ui.stage.classList.add('dragging');
    startGesture();
  });
  ui.stage.addEventListener('pointermove', (event) => {
    if (!state.pointers.has(event.pointerId) || !state.gesture) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...state.pointers.values()];
    const gesture = state.gesture;
    if (points.length === 1) {
      state.panX = gesture.panX + event.clientX - gesture.x;
      state.panY = gesture.panY + event.clientY - gesture.y;
    } else {
      const rect = ui.stage.getBoundingClientRect();
      const centerX = (points[0].x + points[1].x) / 2 - rect.left - rect.width / 2;
      const centerY = (points[0].y + points[1].y) / 2 - rect.top - rect.height / 2;
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      state.scale = Math.max(state.fitScale * 0.5, Math.min(gesture.scale * distance / gesture.distance, Math.max(state.fitScale * 8, 2)));
      const ratio = state.scale / gesture.scale;
      state.panX = centerX - (gesture.x - gesture.panX) * ratio;
      state.panY = centerY - (gesture.y - gesture.panY) * ratio;
    }
    state.fitted = false;
    applyTransform();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    ui.stage.addEventListener(type, (event) => {
      state.pointers.delete(event.pointerId);
      if (!state.pointers.size) ui.stage.classList.remove('dragging');
      startGesture();
    });
  }
  ui.stage.addEventListener('wheel', (event) => {
    if (!state.imageLoaded) return;
    event.preventDefault();
    const rect = ui.stage.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    zoomAt(state.scale * Math.exp(-delta * 0.0016), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  }, { passive: false });
  ui.stage.addEventListener('dblclick', (event) => {
    if (!state.imageLoaded) return;
    const rect = ui.stage.getBoundingClientRect();
    if (state.scale > state.fitScale * 1.7) fitMap();
    else zoomAt(state.scale * 2, event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  });
  ui.zoomIn.addEventListener('click', () => zoomAt(state.scale * 1.3));
  ui.zoomOut.addEventListener('click', () => zoomAt(state.scale / 1.3));
  ui.fit.addEventListener('click', fitMap);
  ui.back.addEventListener('click', () => closeViewer());
  ui.fullscreen.hidden = !ui.viewer.requestFullscreen;
  ui.fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else attemptFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === ui.viewer) {
      state.hadFullscreen = true;
      ui.fullscreen.setAttribute('aria-label', 'Exit fullscreen');
      ui.fullscreen.title = 'Exit fullscreen';
    } else {
      ui.fullscreen.setAttribute('aria-label', 'Enter fullscreen');
      ui.fullscreen.title = 'Enter fullscreen';
      if (state.hadFullscreen && state.selected) closeViewer();
    }
  });
  window.addEventListener('resize', () => { if (state.selected && state.fitted) fitMap(); });
  window.addEventListener('hashchange', syncRoute);
  window.addEventListener('popstate', syncRoute);
  document.addEventListener('keydown', (event) => {
    if (state.selected) {
      if (event.key === 'Escape') { event.preventDefault(); closeViewer(); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(state.scale * 1.3); }
      else if (event.key === '-') { event.preventDefault(); zoomAt(state.scale / 1.3); }
      else if (event.key === '0') { event.preventDefault(); fitMap(); }
      else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        state.panX += event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0;
        state.panY += event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0;
        state.fitted = false;
        applyTransform();
      } else if (event.key === 'Tab') {
        const buttons = [...ui.viewer.querySelectorAll('button:not(:disabled)')].filter((node) => !node.hidden);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ui.stage)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
  });

  function workerRequest(type) {
    return new Promise((resolve, reject) => {
      if (!state.worker) { reject(new Error('Offline storage is not ready.')); return; }
      const channel = new MessageChannel();
      let timer = setTimeout(() => { channel.port1.close(); reject(new Error('Offline storage did not respond. Please try again.')); }, 90000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        if (event.data.type === 'PROGRESS') {
          timer = setTimeout(() => { channel.port1.close(); reject(new Error('The map download timed out. Please try again.')); }, 90000);
        } else {
          channel.port1.close();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data);
        }
      };
      state.worker.postMessage({ type }, [channel.port2]);
    });
  }

  function showOfflineError(message) {
    if (state.offlineErrorShown) return;
    state.offlineErrorShown = true;
    showToast(message);
  }

  async function cacheMapsQuietly() {
    if (!state.worker || !navigator.onLine) return;
    if (state.saving) { state.cachePending = true; return; }
    state.saving = true;
    try {
      const existing = await workerRequest('OFFLINE_STATUS');
      if (existing.ready) { state.offlineErrorShown = false; return; }
      const status = await workerRequest('CACHE_LIBRARY');
      if (status.ready) state.offlineErrorShown = false;
      else if (navigator.onLine) showOfflineError('Some maps could not be saved offline. Downloads will retry when you reconnect or reopen the app.');
    } catch {
      if (navigator.onLine) showOfflineError('Offline saving could not finish. It will retry when you reconnect or reopen the app.');
    } finally {
      state.saving = false;
      if (state.cachePending) {
        state.cachePending = false;
        cacheMapsQuietly();
      }
    }
  }

  window.addEventListener('online', cacheMapsQuietly);

  function waitForActivation(worker) {
    if (!worker || worker.state === 'activated') return Promise.resolve();
    if (worker.state === 'redundant') return Promise.reject(new Error('Offline setup failed.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener('statechange', changed);
        reject(new Error('Offline setup timed out.'));
      }, 90000);
      function changed() {
        if (worker.state !== 'activated' && worker.state !== 'redundant') return;
        clearTimeout(timer);
        worker.removeEventListener('statechange', changed);
        if (worker.state === 'activated') resolve();
        else reject(new Error('Offline setup failed.'));
      }
      worker.addEventListener('statechange', changed);
      changed();
    });
  }

  async function initializePwa() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      const registration = await navigator.serviceWorker.register('sw.js');
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        state.worker = navigator.serviceWorker.controller;
        cacheMapsQuietly();
      });
      await waitForActivation(registration.installing || registration.waiting);
      const ready = await navigator.serviceWorker.ready;
      state.worker = navigator.serviceWorker.controller || ready.active;
      cacheMapsQuietly();
    } catch {
      if (navigator.onLine) showOfflineError('Offline saving could not start. Reopen the app to try again.');
    }
  }

  async function initialize() {
    try {
      const response = await fetch('maps.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Map library could not load.');
      const maps = await response.json();
      if (!Array.isArray(maps) || !maps.length || maps.some((map) => typeof map.id !== 'string' || typeof map.name !== 'string' || typeof map.mode !== 'string' || (map.available && !/^(?:\.\/)?maps\/[a-z0-9_-]+\.webp$/i.test(map.src)))) throw new Error('Map library format is invalid.');
      state.maps = maps;
      renderCatalog();
      syncRoute();
      await initializePwa();
    } catch {
      ui.catalog.setAttribute('aria-busy', 'false');
      const message = element('div', 'empty-state');
      message.append(element('h2', '', 'The map room could not load.'), element('p', '', navigator.onLine ? 'Refresh to try loading the library again.' : 'Connect once to load and save the map library.'));
      const retry = element('button', 'text-button', 'Try again ↗');
      retry.addEventListener('click', () => location.reload());
      message.append(retry);
      ui.catalog.replaceChildren(message);
    }
  }

  initialize();
})();
