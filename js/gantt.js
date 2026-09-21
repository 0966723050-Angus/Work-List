// gantt.js - 依 List 工作表資料繪製「Schedule」甘特圖(SVG,RWD)
// 版面為「日曆格」樣式:可選擇起始/結束日期,每一欄代表一天。
(function () {
  const ROW_H = 48;
  const HEADER_H = 40;
  const MIN_DAY_W = 56;
  const BAR_H = 22;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

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
  function defaultRange() {
    const monday = mondayOfWeek(todayUTC());
    return { start: monday, end: addDays(monday, 6) };
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function render(rows, range) {
    const labelsEl = document.getElementById('ganttLabels');
    const svg = document.getElementById('ganttSvg');
    const scrollEl = document.querySelector('.gantt-scroll');
    const tooltip = document.getElementById('ganttTooltip');
    labelsEl.innerHTML = '';
    svg.innerHTML = '';

    const rangeStart = range && range.start ? range.start : defaultRange().start;
    const rangeEnd = range && range.end ? range.end : defaultRange().end;
    const numDays = Math.max(diffDays(rangeStart, rangeEnd) + 1, 1);

    const containerW = (scrollEl && scrollEl.clientWidth) || 320;
    const dayW = Math.max(MIN_DAY_W, Math.floor(containerW / numDays));

    const width = numDays * dayW + 4;
    const height = HEADER_H + rows.length * ROW_H + 4;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // 日期欄頭 + 直向格線(每天一欄)
    for (let d = 0; d <= numDays; d++) {
      const x = d * dayW + 2;
      svg.appendChild(
        svgEl('line', {
          x1: x, y1: 0, x2: x, y2: height - 2,
          stroke: getVar('--color-border'), 'stroke-width': 1,
        })
      );
      if (d < numDays) {
        const date = addDays(rangeStart, d);
        const isWeekend = mondayIndex(date) >= 5;
        const wLabel = svgEl('text', {
          x: x + dayW / 2, y: 16, 'font-size': 11, 'text-anchor': 'middle',
          fill: isWeekend ? '#ff5a5a' : getVar('--color-text-muted'),
          'font-weight': 600,
        });
        wLabel.textContent = WEEKDAY_LABELS[mondayIndex(date)];
        svg.appendChild(wLabel);
        const dLabel = svgEl('text', {
          x: x + dayW / 2, y: 31, 'font-size': 11, 'text-anchor': 'middle',
          fill: getVar('--color-text-muted'),
        });
        dLabel.textContent = fmtMD(date);
        svg.appendChild(dLabel);
      }
    }
    svg.appendChild(
      svgEl('line', { x1: 0, y1: HEADER_H, x2: width, y2: HEADER_H, stroke: getVar('--color-border'), 'stroke-width': 1 })
    );

    // 今天標記線
    const today = todayUTC();
    const todayOffset = diffDays(rangeStart, today);
    if (todayOffset >= 0 && todayOffset < numDays) {
      const x = todayOffset * dayW + 2;
      svg.appendChild(
        svgEl('line', {
          x1: x, y1: HEADER_H, x2: x, y2: height - 2,
          stroke: '#ff5a5a', 'stroke-width': 1.5, 'stroke-dasharray': '4,3',
        })
      );
    }

    if (rows.length === 0) {
      const t = svgEl('text', { x: 12, y: HEADER_H + 30, 'font-size': 13, fill: getVar('--color-text-muted') });
      t.textContent = '目前沒有工作項目';
      svg.appendChild(t);
      return;
    }

    rows.forEach((r, i) => {
      const y = HEADER_H + i * ROW_H;

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
      };
      const hideTip = () => { tooltip.style.opacity = '0'; };

      rect.addEventListener('mouseenter', showTip);
      rect.addEventListener('mousemove', showTip);
      rect.addEventListener('mouseleave', hideTip);
      rect.addEventListener('touchstart', (e) => { showTip(e); }, { passive: true });
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  window.Gantt = { render, defaultRange, mondayOfWeek, todayUTC, toISO, parseISO, addDays };
})();
