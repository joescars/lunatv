// Surfaces failed htmx requests (HTTP errors and network failures) that htmx
// would otherwise drop silently, e.g. recording delete and channel flag
// updates. The guide fragment has its own inline retry UI in guide.js.
(function () {
  var region;
  function getRegion() {
    if (region) return region;
    region = document.createElement('div');
    region.id = 'htmx-errors';
    region.className = 'position-fixed bottom-0 start-50 translate-middle-x p-3';
    region.style.zIndex = '2000';
    region.style.maxWidth = 'min(36rem, 100vw)';
    document.body.appendChild(region);
    return region;
  }
  function describe(path) {
    if (/\/recordings\/[^/]+\/delete/.test(path)) return 'Couldn’t delete the recording';
    if (/\/channels\/flag/.test(path)) return 'Couldn’t update the channel';
    if (/\/scan\//.test(path)) return 'Couldn’t update the channel scan';
    return 'Request failed';
  }
  function show(evt, kind) {
    var detail = evt.detail || {};
    var target = detail.target;
    if (target && target.id === 'guide-content') return;
    var cfg = detail.requestConfig || {};
    var message = describe(String(cfg.path || ''));
    var xhr = detail.xhr;
    if (kind === 'response' && xhr && xhr.status) {
      var text = String(xhr.responseText || '').replace(/\s+/g, ' ').trim();
      message += ' (HTTP ' + xhr.status + (text && text.length <= 160 ? ': ' + text : '') + ').';
    } else {
      message += ': the server could not be reached.';
    }
    var alert = document.createElement('div');
    alert.className = 'alert alert-danger alert-dismissible shadow mb-2';
    alert.setAttribute('role', 'alert');
    alert.textContent = message;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', function () { alert.remove(); });
    alert.appendChild(close);
    getRegion().appendChild(alert);
    setTimeout(function () { alert.remove(); }, 10000);
  }
  document.addEventListener('htmx:responseError', function (evt) { show(evt, 'response'); });
  document.addEventListener('htmx:sendError', function (evt) { show(evt, 'send'); });
  document.addEventListener('htmx:timeout', function (evt) { show(evt, 'send'); });
})();
