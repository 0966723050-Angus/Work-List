// gantt.js - 依 List 工作表資料繪製「Schedule」甘特圖(SVG,RWD)
// 版面採「凍結窗格」:左上角固定、日期表頭隨內容橫向捲動但縱向固定、
// 工作項目欄隨內容縱向捲動但橫向固定,只有右下角圖表本體會上下左右捲動,
// 讓橫向捲軸永遠留在固定高度的框框底部。
(function () {
  const ROW_H = 48;
  const HEADER_H = 40;
  const BASE_DAY_W = 40; // 縮放 1x 時,自動塞滿容器寬度的參考基準(下限)
  const ABS_MIN_DAY_W = 18;
  const ABS_MAX_DAY_W = 160;
  const BAR_H = 22;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

  const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.6, 2, 2.5];
  const DEFAULT_ZOOM_INDEX = 3; // = 1x

  function colorForStatus(status) {
    const s = (status || '').trim();
    if (s === '已排定' || s === '已確定') return getVar('--color-status-confirmed');
    if (s === '暫定') return getVar('--color-status-tentative');
    return getVar('--color-status-pending');
  }

  function getVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function toISO(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }
  function addDays(date, n) {
    return new Date(date.getTime() + n * 86400000);
  }
  function diffDays(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  function fmtMD(d) {
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }
  // ISO 星期一為一週開始:0=一 ... 6=日
  function mondayIndex(date) {
    return (date.getUTCDay() + 6) % 7;
  }
  function mondayOfWeek(date) {
    return addDays(date, -mondayIndex(date));
  }
  function todayUTC() {
    const t = new Date();
    return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
  }
  function addMonthsUTC(date, n) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, date.getUTCDate()));
  }
  // 本週(週一~週日,共7欄)
  function currentWeekRange() {
    const monday = mondayOfWeek(todayUTC());
    return { start: monday, end: addDays(monday, 6) };
  }
  // 預設檢視範圍:從本週一起算,往後推 2 個月,並補到當週週日,
  // 確保整個範圍都是完整的週一~週日(每週 7 欄)
  function defaultRange() {
    const monday = mondayOfWeek(todayUTC());
    const roughEnd = addMonthsUTC(monday, 2);
    const end = addDays(roughEnd, 6 - mondayIndex(roughEnd));
    return { start: monday, end };
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  // 明細視窗(黑底 tooltip)以「點擊」開關:再次點擊同一長條、點擊其他長條、
  // 或點擊圖表以外區域都會關閉,取代原本只能 hover 顯示但無法關閉的行為。
  let openBarEl = null;
  function hideTooltip() {
    const tooltip = document.getElementById('ganttTooltip');
    if (tooltip) tooltip.style.opacity = '0';
    openBarEl = null;
  }
  if (!window.__ganttOutsideTapBound) {
    document.addEventListener('click', (evt) => {
      if (openBarEl && !evt.target.closest('.gantt-bar')) hideTooltip();
    });
    window.__ganttOutsideTapBound = true;
  }

  // 圖表本體(唯一可上下左右捲動的區域)捲動時,同步表頭的橫向位置與
  // 工作項目欄的縱向位置,讓兩者維持「凍結」的視覺效果。只需綁定一次。
  if (!window.__ganttScrollSyncBound) {
    document.addEventListener(
      'scroll',
      (evt) => {
        if (!evt.target || evt.target.nodeType !== 1 || !evt.target.classList.contains('gantt-scroll')) return;
        const headerScroll = document.querySelector('.gantt-header-scroll');
        const labelsEl = document.getElementById('ganttLabels');
        if (headerScroll) headerScroll.scrollLeft = evt.target.scrollLeft;
        if (labelsEl) labelsEl.scrollTop = evt.target.scrollTop;
      },
      true
    );
    window.__ganttScrollSyncBound = true;
  }

  function zoomValue(zoomIndex) {
    const idx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoomIndex ?? DEFAULT_ZOOM_INDEX));
    return ZOOM_STEPS[idx];
  }

  function render(rows, range, zoomIndex) {
    const labelsEl = document.getElementById('ganttLabels');
    const headerSvg = document.getElementById('ganttHeaderSvg');
    const svg = document.getElementById('ganttSvg');
    const scrollEl = document.querySelector('.gantt-scroll');
    const tooltip = document.getElementById('ganttTooltip');
    hideTooltip();
    labelsEl.innerHTML = '';
    headerSvg.innerHTML = '';
    svg.innerHTML = '';

    const rangeStart = range && range.start ? range.start : defaultRange().start;
    const rangeEnd = range && range.end ? range.end : defaultRange().end;
    const numDays = Math.max(diffDays(rangeStart, rangeEnd) + 1, 1);

    const zoom = zoomValue(zoomIndex);
    const containerW = (scrollEl && scrollEl.clientWidth) || 320;
    const fitDayW = Math.max(BASE_DAY_W, Math.floor(containerW / numDays));
    const dayW = Math.min(ABS_MAX_DAY_W, Math.max(ABS_MIN_DAY_W, Math.round(fitDayW * zoom)));
    const fontSize = Math.max(9, Math.min(15, Math.round(11 * zoom)));

    const width = numDays * dayW + 4;
    const bodyHeight = Math.max(rows.length * ROW_H + 4, 4);

    headerSvg.setAttribute('width', width);
    headerSvg.setAttribute('height', HEADER_H);
    headerSvg.setAttribute('viewBox', `0 0 ${width} ${HEADER_H}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', bodyHeight);
    svg.setAttribute('viewBox', `0 0 ${width} ${bodyHeight}`);

    // 日期欄頭 + 直向格線(每天一欄)
    for (let d = 0; d <= numDays; d++) {
      const x = d * dayW + 2;
      headerSvg.appendChild(
        svgEl('line', { x1: x, y1: 0, x2: x, y2: HEADER_H, stroke: getVar('--color-border'), 'stroke-width': 1 })
      );
      svg.appendChild(
        svgEl('line', { x1: x, y1: 0, x2: x, y2: bodyHeight - 2, stroke: getVar('--color-border'), 'stroke-width': 1 })
      );
      if (d < numDays) {
        const date = addDays(rangeStart, d);
        const isWeekend = mondayIndex(date) >= 5;
        const wLabel = svgEl('text', {
          x: x + dayW / 2, y: 16, 'font-size': fontSize, 'text-anchor': 'middle',
          fill: isWeekend ? '#ff5a5a' : getVar('--color-text-muted'),
          'font-weight': 600,
        });
        wLabel.textContent = WEEKDAY_LABELS[mondayIndex(date)];
        headerSvg.appendChild(wLabel);
        const dLabel = svgEl('text', {
          x: x + dayW / 2, y: 31, 'font-size': fontSize, 'text-anchor': 'middle',
          fill: getVar('--color-text-muted'),
        });
        dLabel.textContent = fmtMD(date);
        headerSvg.appendChild(dLabel);
      }
    }

    // 今天標記線(表頭與本體都畫,視覺上連成一直線)
    const today = todayUTC();
    const todayOffset = diffDays(rangeStart, today);
    if (todayOffset >= 0 && todayOffset < numDays) {
      const x = todayOffset * dayW + 2;
      headerSvg.appendChild(
        svgEl('line', { x1: x, y1: 0, x2: x, y2: HEADER_H, stroke: '#ff5a5a', 'stroke-width': 1.5, 'stroke-dasharray': '4,3' })
      );
      svg.appendChild(
        svgEl('line', { x1: x, y1: 0, x2: x, y2: bodyHeight - 2, stroke: '#ff5a5a', 'stroke-width': 1.5, 'stroke-dasharray': '4,3' })
      );
    }

    if (rows.length === 0) {
      const t = svgEl('text', { x: 12, y: 24, 'font-size': 13, fill: getVar('--color-text-muted') });
      t.textContent = '目前沒有工作項目';
      svg.appendChild(t);
      return;
    }

    rows.forEach((r, i) => {
      const y = i * ROW_H;

      const labelDiv = document.createElement('div');
      labelDiv.className = 'glabel';
      labelDiv.textContent = r.item || '(未命名)';
      labelDiv.title = r.item || '';
      labelsEl.appendChild(labelDiv);

      svg.appendChild(
        svgEl('line', {
          x1: 0, y1: y + ROW_H, x2: width, y2: y + ROW_H,
          stroke: getVar('--color-border'), 'stroke-width': 1,
        })
      );

      if (!r.start || !r.end) return;
      const s = parseISO(r.start);
      const e = parseISO(r.end);
      if (e < rangeStart || s > rangeEnd) return; // 完全落在檢視範圍外

      const clippedStart = s < rangeStart ? rangeStart : s;
      const clippedEnd = e > rangeEnd ? rangeEnd : e;
      const x = diffDays(rangeStart, clippedStart) * dayW + 2;
      const barW = Math.max((diffDays(clippedStart, clippedEnd) + 1) * dayW - 4, 10);
      const barY = y + (ROW_H - BAR_H) / 2;

      const rect = svgEl('rect', {
        x, y: barY, width: barW, height: BAR_H, rx: 6, ry: 6,
        fill: colorForStatus(r.status),
        class: 'gantt-bar',
      });
      rect.style.cursor = 'pointer';
      svg.appendChild(rect);

      const showTip = (evt) => {
        const people = [r.hw, r.sw].filter(Boolean).join(' / ');
        tooltip.innerHTML =
          `<strong>${escapeHtml(r.item)}</strong><br>` +
          `${r.start} ~ ${r.end}(${r.duration ?? ''}天)<br>` +
          `狀態:${escapeHtml(r.status || '-')}` +
          (people ? `<br>${escapeHtml(people)}` : '') +
          (r.note ? `<br>備註:${escapeHtml(r.note)}` : '');
        const cx = evt.touches ? evt.touches[0].clientX : evt.clientX;
        const cy = evt.touches ? evt.touches[0].clientY : evt.clientY;
        tooltip.style.left = Math.min(cx + 12, window.innerWidth - 250) + 'px';
        tooltip.style.top = Math.max(cy - 40, 8) + 'px';
        tooltip.style.opacity = '1';
        openBarEl = rect;
      };

      rect.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (openBarEl === rect) hideTooltip();
        else showTip(evt);
      });
    });

    // 重新渲染後,讓表頭/標籤欄的捲動位置與本體同步(例如縮放後寬度改變)
    const headerScroll = document.querySelector('.gantt-header-scroll');
    if (headerScroll && scrollEl) headerScroll.scrollLeft = scrollEl.scrollLeft;
    if (labelsEl && scrollEl) labelsEl.scrollTop = scrollEl.scrollTop;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  window.Gantt = {
    render,
    defaultRange,
    currentWeekRange,
    mondayOfWeek,
    todayUTC,
    toISO,
    parseISO,
    addDays,
    ZOOM_STEPS,
    DEFAULT_ZOOM_INDEX,
  };
})();
