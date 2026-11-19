/* Shared guide controls and in-page playback for list and grid views. */
(function () {
  var favorites = document.getElementById('guide-filter-favorites');
  var hidden = document.getElementById('guide-filter-show-hidden');
  var search = document.getElementById('guide-search');
  var count = document.getElementById('guide-channel-count');
  var empty = document.getElementById('guide-filter-empty');
  var content = document.getElementById('guide-content');
  var overlay = document.getElementById('watch-overlay');
  var frame = document.getElementById('watch-overlay-frame');
  var close = document.getElementById('watch-overlay-close');
  var returnFocus = null;
  var scrollPosition = 0;
  var previousOverflow = '';
  var timeOptions = { hour: 'numeric', minute: '2-digit' };
  var STALE_MS = 5 * 60 * 1000;
  var RETRY_MS = 30 * 1000;
  var isGrid = !!document.getElementById('guide-data');
  var loadedAt = Date.now();
  var attemptedAt = 0;
  var refreshing = false;

  try {
    favorites.checked = localStorage.getItem('guide-favorites') === '1';
    hidden.checked = localStorage.getItem('guide-hidden') === '1';
    search.value = sessionStorage.getItem('guide-search') || '';
  } catch (_) {}

  function applyFilters() {
    if (!content || !favorites || !hidden || !search) return;
    var items = content.querySelectorAll('.guide-item');
    var term = search.value.trim().toLocaleLowerCase();
    var visible = 0;
    items.forEach(function (item) {
      var show = (!favorites.checked || item.dataset.favorite === '1') &&
        (hidden.checked || item.dataset.hidden !== '1') &&
        (!term || (item.dataset.search || '').toLocaleLowerCase().includes(term));
      item.hidden = !show;
      if (show) visible++;
    });
    count.textContent = items.length ? visible + ' channel' + (visible === 1 ? '' : 's') : '';
    empty.hidden = !items.length || visible > 0;
    try {
      localStorage.setItem('guide-favorites', favorites.checked ? '1' : '0');
      localStorage.setItem('guide-hidden', hidden.checked ? '1' : '0');
      sessionStorage.setItem('guide-search', search.value);
    } catch (_) {}
  }

  function hydrateTimes() {
    document.querySelectorAll('.airing-time').forEach(function (el) {
      el.textContent = new Date(Number(el.dataset.start) * 1000).toLocaleTimeString([], timeOptions) +
        ' – ' + new Date(Number(el.dataset.end) * 1000).toLocaleTimeString([], timeOptions);
    });
    document.querySelectorAll('.airing-start').forEach(function (el) {
      el.textContent = 'Up next · ' + new Date(Number(el.dataset.start) * 1000).toLocaleTimeString([], timeOptions);
    });
    updateProgress();
  }

  function updateProgress() {
    var now = Date.now() / 1000;
    document.querySelectorAll('.airing-progress').forEach(function (el) {
      var start = Number(el.dataset.start);
      var end = Number(el.dataset.end);
      var value = end > start ? Math.max(0, Math.min(100, (now - start) / (end - start) * 100)) : 0;
      el.firstElementChild.style.width = value + '%';
    });
  }

  function chooseProfile() {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return 'medium';
    if (connection.saveData || /^(slow-2g|2g|3g)$/.test(connection.effectiveType || '')) return 'low';
    if (typeof connection.downlink === 'number' && connection.downlink >= 8) return 'high';
    if (typeof connection.downlink === 'number' && connection.downlink <= 2.5) return 'low';
    return 'medium';
  }

  // Per-viewer id sent with start/heartbeat/stop so one viewer leaving cannot
  // stop a stream session that other viewers share. Handed to the watch page.
  function newViewerId() {
    var c = window.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  window.watchChannel = function (channel) {
    var profile = chooseProfile();
    var encoded = encodeURIComponent(channel);
    var viewer = encodeURIComponent(newViewerId());
    var destination = '/watch/' + encoded + '?quality=' + encodeURIComponent(profile) + '&embedded=1&viewer=' + viewer;
    fetch('/stream/' + encoded + '/h264/' + encodeURIComponent(profile) + '/start?viewer=' + viewer, { method: 'POST' }).catch(function () {});
    if (!overlay.open) {
      returnFocus = document.activeElement;
      scrollPosition = window.scrollY;
      previousOverflow = document.body.style.overflow;
      overlay.showModal();
      document.body.style.overflow = 'hidden';
      history.pushState({ lunatvWatchOverlay: true }, '', window.location.href);
    }
    frame.src = destination;
    close.focus();
  };

  function dismissOverlay() {
    if (!overlay.open) return;
    overlay.close();
    frame.src = 'about:blank';
    document.body.style.overflow = previousOverflow;
    window.scrollTo(0, scrollPosition);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    refreshIfStale();
  }
  function closeOverlay() {
    if (!overlay.open) return;
    dismissOverlay();
    if (history.state && history.state.lunatvWatchOverlay) history.back();
  }

  if (overlay) {
    // A top-level dialog avoids transformed-container positioning and makes
    // background controls inert while the video is open.
    document.body.appendChild(overlay);
    close.addEventListener('click', closeOverlay);
    overlay.addEventListener('cancel', function (event) { event.preventDefault(); closeOverlay(); });
    window.addEventListener('popstate', dismissOverlay);
    window.addEventListener('message', function (event) {
      if (event.origin === window.location.origin && event.source === frame.contentWindow && event.data === 'lunatv:close-player') closeOverlay();
    });
    window.addEventListener('pagehide', dismissOverlay);
  }

  [favorites, hidden].forEach(function (el) { if (el) el.addEventListener('change', applyFilters); });
  if (search) search.addEventListener('input', applyFilters);
  var clear = document.getElementById('guide-clear-filters');
  if (clear) clear.addEventListener('click', function () {
    favorites.checked = false;
    hidden.checked = false;
    search.value = '';
    applyFilters();
    search.focus();
  });

  document.body.addEventListener('htmx:afterSwap', function (event) {
    if (event.target && event.target.id === 'guide-content') { loadedAt = Date.now(); hydrateTimes(); applyFilters(); }
  });
  document.addEventListener('lunatv:guide-rendered', function () { hydrateTimes(); applyFilters(); });
  ['htmx:sendError', 'htmx:responseError'].forEach(function (name) {
    document.body.addEventListener(name, function (event) {
      if (!event.detail || event.detail.target !== content) return;
      content.innerHTML = '<div class="guide-empty" role="alert"><h2>Your guide couldn’t load</h2><p>Check your connection and try again.</p><button type="button" class="btn btn-primary" id="guide-retry">Try again</button></div>';
      document.getElementById('guide-retry').addEventListener('click', function () { window.htmx.ajax('GET', '/guide/fragment', { target: content, swap: 'innerHTML' }); });
      applyFilters();
    });
  });
  // Resume handling: the list/grid are rendered once, so a tab or bfcache page
  // restored after a long absence still shows old programs as On Now. Refetch
  // through the existing fragment/grid routes when the data is older than
  // STALE_MS, keeping expanded rows, focus and scroll. No timers are added.
  function focusables(section) {
    return Array.prototype.slice.call(section.querySelectorAll('button, a[href], md-filled-button'));
  }
  function captureListState() {
    var state = { scrollY: window.scrollY, expanded: [], focus: null };
    content.querySelectorAll('.guide-channel').forEach(function (section) {
      var body = section.querySelector('.collapse.show');
      if (body && section.dataset.channel) state.expanded.push(section.dataset.channel);
    });
    var active = document.activeElement;
    var owner = active && active !== document.body && active.closest && active.closest('.guide-channel');
    if (owner && content.contains(owner)) state.focus = { channel: owner.dataset.channel, index: focusables(owner).indexOf(active) };
    return state;
  }
  function restoreListState(state) {
    content.querySelectorAll('.guide-channel').forEach(function (section) {
      if (state.expanded.indexOf(section.dataset.channel) === -1) return;
      var body = section.querySelector('.collapse');
      if (body) body.classList.add('show');
      section.querySelectorAll('[data-bs-toggle="collapse"]').forEach(function (toggle) { toggle.setAttribute('aria-expanded', 'true'); });
    });
    if (state.focus) {
      var sections = Array.prototype.slice.call(content.querySelectorAll('.guide-channel'));
      var section = sections.filter(function (item) { return item.dataset.channel === state.focus.channel; })[0];
      var target = section && focusables(section)[state.focus.index];
      if (target && !target.closest('[hidden]')) target.focus({ preventScroll: true });
    }
    window.scrollTo(0, state.scrollY);
  }

  function finishRefresh(ok) {
    refreshing = false;
    if (ok) loadedAt = Date.now();
  }
  function refreshList() {
    return fetch('/guide/fragment', { headers: { 'HX-Request': 'true' } }).then(function (response) {
      if (!response.ok) throw new Error('Guide refresh failed');
      return response.text();
    }).then(function (html) {
      var template = document.createElement('template');
      template.innerHTML = html;
      // Keep the last good guide when the refresh itself comes back as an error/empty state.
      if (!template.content.querySelector('.guide-item') && content.querySelector('.guide-item')) return false;
      var state = captureListState();
      content.innerHTML = html;
      if (window.htmx) window.htmx.process(content);
      hydrateTimes();
      applyFilters();
      restoreListState(state);
      return true;
    });
  }
  function refreshGrid() {
    if (!document.getElementById('guide-inner')) { window.location.reload(); return Promise.resolve(false); }
    return fetch('/guide/grid').then(function (response) {
      if (!response.ok) throw new Error('Guide refresh failed');
      return response.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var json = doc.getElementById('guide-data');
      var data = json && JSON.parse(json.textContent);
      if (!data || !data.channels || !data.channels.length) return false;
      document.dispatchEvent(new CustomEvent('lunatv:guide-data', { detail: { data: data } }));
      return true;
    });
  }
  function refreshIfStale() {
    if (document.visibilityState === 'hidden' || refreshing || (overlay && overlay.open) || !content) return;
    var now = Date.now();
    if (now - loadedAt < STALE_MS || now - attemptedAt < RETRY_MS) { updateProgress(); return; }
    refreshing = true;
    attemptedAt = now;
    (isGrid ? refreshGrid() : refreshList()).then(finishRefresh, function () { finishRefresh(false); });
  }
  document.addEventListener('visibilitychange', refreshIfStale);
  window.addEventListener('pageshow', function (event) { if (event.persisted) refreshIfStale(); });
  hydrateTimes();
  applyFilters();
  setInterval(updateProgress, 30000);
})();
