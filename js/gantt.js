// gantt.js - 依 List 工作表資料繪製「Schedule」甘特圖(SVG,RWD)
(function () {
  const ROW_H = 36;
  const HEADER_H = 32;
  const DAY_W = 26;
  const BAR_H = 22;
  const SVG_NS = 'http://www.w3.org/2000/svg';

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
  function addDays(date, n) {
    return new Date(date.getTime() + n * 86400000);
  }
  function diffDays(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  function fmtMD(d) {
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function render(rows) {
    const labelsEl = document.getElementById('ganttLabels');
    const svg = document.getElementById('ganttSvg');
    const tooltip = document.getElementById('ganttTooltip');
    labelsEl.innerHTML = '';
    svg.innerHTML = '';

    const scheduled = rows.filter((r) => r.start && r.end);
    if (scheduled.length === 0) {
      svg.setAttribute('width', 300);
      svg.setAttribute('height', 80);
      const t = svgEl('text', { x: 12, y: 30, 'font-size': 13, fill: getVar('--color-text-muted') });
      t.textContent = '目前沒有已排定日期的工作項目';
      svg.appendChild(t);
      return;
    }

    let minDate = parseISO(scheduled[0].start);
    let maxDate = parseISO(scheduled[0].end);
    scheduled.forEach((r) => {
      const s = parseISO(r.start);
      const e = parseISO(r.end);
      if (s < minDate) minDate = s;
      if (e > maxDate) maxDate = e;
    });
    minDate = addDays(minDate, -2);
    maxDate = addDays(maxDate, 3);
    const totalDays = Math.max(diffDays(minDate, maxDate), 7);

    const width = totalDays * DAY_W + 20;
    const height = HEADER_H + rows.length * ROW_H + 10;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // 週格線 + 日期標籤
    for (let d = 0; d <= totalDays; d += 7) {
      const x = d * DAY_W + 10;
      const date = addDays(minDate, d);
      svg.appendChild(
        svgEl('line', {
          x1: x, y1: HEADER_H, x2: x, y2: height - 4,
          stroke: getVar('--color-border'), 'stroke-width': 1,
        })
      );
      const label = svgEl('text', {
        x: x + 4, y: 20, 'font-size': 11, fill: getVar('--color-text-muted'),
      });
      label.textContent = fmtMD(date);
      svg.appendChild(label);
    }

    // 今天標記線
    const today = new Date();
    const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const todayDiff = diffDays(minDate, new Date(todayUTC));
    if (todayDiff >= 0 && todayDiff <= totalDays) {
      const x = todayDiff * DAY_W + 10;
      svg.appendChild(
        svgEl('line', {
          x1: x, y1: HEADER_H, x2: x, y2: height - 4,
          stroke: '#ff5a5a', 'stroke-width': 1.5, 'stroke-dasharray': '4,3',
        })
      );
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
      const x = diffDays(minDate, s) * DAY_W + 10;
      const barW = Math.max((diffDays(s, e) + 1) * DAY_W - 4, 8);
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

  window.Gantt = { render };
})();
