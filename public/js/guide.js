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

  window.watchChannel = function (channel) {
    var profile = chooseProfile();
    var encoded = encodeURIComponent(channel);
    var destination = '/watch/' + encoded + '?quality=' + encodeURIComponent(profile) + '&embedded=1';
    fetch('/stream/' + encoded + '/h264/' + encodeURIComponent(profile) + '/start', { method: 'POST' }).catch(function () {});
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
    if (event.target && event.target.id === 'guide-content') { hydrateTimes(); applyFilters(); }
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
  hydrateTimes();
  applyFilters();
  setInterval(updateProgress, 30000);
})();
