/* Render the desktop schedule with native keyboard-operable watch controls. */
(function () {
  var data = JSON.parse(document.getElementById('guide-data').textContent);
  var container = document.getElementById('guide-inner');
  var scroller = document.querySelector('.guide-scroll');
  if (!container || !scroller) return;
  var rangeStart = data.now - data.now % 1800;
  var pxPerMinute = 5;
  var colWidth = 148;
  var firstRender = true;
  var nowLine;
  var resizeTimer;

  function minutes(ts) { return (ts - rangeStart) / 60; }
  function fmt(ts) { return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function make(tag, className, text) {
    var element = document.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function render() {
    var scrollLeft = scroller.scrollLeft;
    var scrollTop = scroller.scrollTop;
    var dataEnd = data.now;
    data.channels.forEach(function (ch) { (ch.Guide || []).forEach(function (a) { dataEnd = Math.max(dataEnd, a.EndTime); }); });
    colWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--guide-col-width')) || 148;
    var available = scroller.clientWidth - colWidth;
    var dataMinutes = Math.max(120, Math.ceil((dataEnd - rangeStart) / 60));
    pxPerMinute = window.innerWidth >= 768 ? Math.min(8, Math.max(3.5, available / Math.min(dataMinutes, 360))) : 5;
    var rangeMinutes = Math.min(dataMinutes, Math.max(240, Math.ceil(available / pxPerMinute / 30) * 30));
    var rangeEnd = rangeStart + rangeMinutes * 60;
    var trackWidth = rangeMinutes * pxPerMinute;
    container.replaceChildren();
    var header = make('div', 'guide-header-row');
    header.appendChild(make('div', 'guide-header-spacer', new Date(data.now * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })));
    var headerTrack = make('div', 'guide-header-track');
    headerTrack.style.width = trackWidth + 'px';
    for (var time = rangeStart; time < rangeEnd; time += 1800) {
      var label = make('div', 'guide-time-label', fmt(time));
      label.style.left = minutes(time) * pxPerMinute + 'px';
      label.style.width = 30 * pxPerMinute + 'px';
      headerTrack.appendChild(label);
    }
    header.appendChild(headerTrack);
    container.appendChild(header);

    data.channels.forEach(function (ch) {
      var row = make('div', 'guide-row guide-item');
      row.dataset.favorite = ch.Favorite ? '1' : '0';
      row.dataset.hidden = ch.Hidden ? '1' : '0';
      row.dataset.search = [ch.GuideNumber, ch.GuideName].concat((ch.Guide || []).map(function (a) { return a.Title; })).join(' ');
      var cell = make('button', 'guide-channel-cell');
      cell.type = 'button';
      cell.setAttribute('aria-label', 'Watch ' + ch.GuideNumber + ' ' + ch.GuideName + ' live');
      cell.appendChild(make('span', 'guide-channel-number', ch.GuideNumber));
      cell.appendChild(make('span', 'guide-channel-label', ch.GuideName));
      cell.addEventListener('click', function () { window.watchChannel(ch.GuideNumber); });
      row.appendChild(cell);
      var track = make('div', 'guide-track');
      track.style.width = trackWidth + 'px';
      var airings = (ch.Guide || []).filter(function (a) { return a.EndTime > rangeStart && a.StartTime < rangeEnd; });
      if (!airings.length) track.appendChild(make('span', 'guide-no-program', 'No program information · select channel to watch live'));
      airings.forEach(function (a) {
        var start = Math.max(a.StartTime, rangeStart);
        var end = Math.min(a.EndTime, rangeEnd);
        var block = make('button', 'guide-block');
        block.type = 'button';
        block.dataset.start = a.StartTime;
        block.dataset.end = a.EndTime;
        block.style.left = minutes(start) * pxPerMinute + 'px';
        block.style.width = Math.max(1, (end - start) / 60 * pxPerMinute - 4) + 'px';
        var description = a.Title + ' · ' + fmt(a.StartTime) + ' – ' + fmt(a.EndTime);
        block.title = description + ' · Watch this channel live';
        block.setAttribute('aria-label', 'Watch ' + ch.GuideName + ' live. Scheduled program: ' + description);
        block.appendChild(make('span', 'guide-block-title', a.Title));
        block.appendChild(make('span', 'guide-block-time', fmt(a.StartTime) + ' – ' + fmt(a.EndTime)));
        block.addEventListener('click', function () { window.watchChannel(ch.GuideNumber); });
        track.appendChild(block);
      });
      row.appendChild(track);
      container.appendChild(row);
    });
    nowLine = make('div', 'guide-now-line');
    nowLine.setAttribute('aria-hidden', 'true');
    container.appendChild(nowLine);
    updateNow();
    document.dispatchEvent(new Event('lunatv:guide-rendered'));
    scroller.scrollLeft = firstRender ? Math.max(0, minutes(data.now) * pxPerMinute - 60) : scrollLeft;
    scroller.scrollTop = scrollTop;
    firstRender = false;
  }

  function updateNow() {
    var now = Date.now() / 1000;
    if (nowLine) nowLine.style.left = colWidth + minutes(now) * pxPerMinute + 'px';
    container.querySelectorAll('.guide-block').forEach(function (block) {
      block.classList.toggle('is-now', Number(block.dataset.start) <= now && now < Number(block.dataset.end));
    });
  }
  render();
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 200); });
  setInterval(updateNow, 30000);
})();
