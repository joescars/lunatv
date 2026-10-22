/* Shared viewer/admin preference; run before styles to avoid a theme flash. */
(function () {
  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var preference = null;
  try { preference = localStorage.getItem('theme'); } catch (_) {}
  if (preference !== 'light' && preference !== 'dark') preference = null;

  function apply(theme) {
    root.setAttribute('data-bs-theme', theme);
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#141218' : '#faf8ff';
    var button = document.getElementById('theme-toggle');
    if (button) {
      var label = 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.querySelector('i').className = 'bi ' + (theme === 'dark' ? 'bi-sun' : 'bi-moon');
    }
  }
  apply(preference || (media.matches ? 'dark' : 'light'));
  media.addEventListener('change', function () {
    if (!preference) apply(media.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', function (event) {
    if (event.key !== 'theme' && event.key !== null) return;
    preference = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null;
    apply(preference || (media.matches ? 'dark' : 'light'));
  });
  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-bs-theme'));
    var button = document.getElementById('theme-toggle');
    if (button) button.addEventListener('click', function () {
      preference = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', preference); } catch (_) {}
      apply(preference);
    });
  });
})();
