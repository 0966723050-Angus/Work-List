// app.js - 主要頁面邏輯:分頁切換、表格顯示/編輯、密碼保護、儲存回 Drive
(function () {
  const CFG = window.APP_CONFIG;
  const STATUS_OPTIONS = ['已排定', '暫定', '待安排'];

  let originalBytes = null;
  let rows = []; // { row, item, start, end, duration, status, hw, sw, note }
  let editMode = false;
  let saving = false;

  const el = (id) => document.getElementById(id);
  const recordList = () => el('recordList');
  const statusLine = el('statusLine');
  const emptyState = el('emptyState');
  const editFab = el('editFab');
  const saveFab = el('saveFab');
  const addRowBtn = el('addRowBtn');
  const cancelEditBtn = el('cancelEditBtn');
  const toastEl = el('toast');

  // ---------- 工具 ----------

  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.style.background = isError ? 'var(--color-danger)' : 'var(--color-text)';
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  async function sha256Hex(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function statusBadgeInfo(status) {
    const s = (status || '').trim();
    if (s === '已排定' || s === '已確定') return { cls: 'badge-confirmed', label: s || '已排定' };
    if (s === '暫定') return { cls: 'badge-tentative', label: s };
    if (!s) return { cls: 'badge-pending', label: '未設定' };
    return { cls: 'badge-pending', label: s };
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    return iso.replace(/-/g, '/');
  }

  function recalcDuration(row) {
    if (row.start && row.end) {
      const s = XlsxIO.isoDateToSerial(row.start);
      const e = XlsxIO.isoDateToSerial(row.end);
      row.duration = e != null && s != null ? e - s + 1 : null;
    } else {
      row.duration = null;
    }
  }

  // ---------- 分頁切換 ----------

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      el(`page-${btn.dataset.page}`).classList.add('active');
      if (btn.dataset.page === 'chart') renderGantt();
    });
  });

  // ---------- 甘特圖日期範圍 ----------

  let ganttRange = Gantt.defaultRange();
  const ganttStartInput = el('ganttStart');
  const ganttEndInput = el('ganttEnd');

  function syncGanttInputs() {
    ganttStartInput.value = Gantt.toISO(ganttRange.start);
    ganttEndInput.value = Gantt.toISO(ganttRange.end);
  }
  function renderGantt() {
    Gantt.render(rows, ganttRange);
  }
  ganttStartInput.addEventListener('change', () => {
    if (!ganttStartInput.value) return;
    const newStart = Gantt.parseISO(ganttStartInput.value);
    if (newStart > ganttRange.end) ganttRange.end = newStart;
    ganttRange.start = newStart;
    syncGanttInputs();
    renderGantt();
  });
  ganttEndInput.addEventListener('change', () => {
    if (!ganttEndInput.value) return;
    const newEnd = Gantt.parseISO(ganttEndInput.value);
    if (newEnd < ganttRange.start) ganttRange.start = newEnd;
    ganttRange.end = newEnd;
    syncGanttInputs();
    renderGantt();
  });
  el('ganttThisWeekBtn').addEventListener('click', () => {
    ganttRange = Gantt.defaultRange();
    syncGanttInputs();
    renderGantt();
  });
  syncGanttInputs();

  window.addEventListener('resize', () => {
    clearTimeout(window._ganttResizeT);
    window._ganttResizeT = setTimeout(() => {
      if (el('page-chart').classList.contains('active')) renderGantt();
    }, 200);
  });

  // ---------- 資料載入 ----------

  async function loadData() {
    statusLine.textContent = '載入中…';
    try {
      originalBytes = await XlsxIO.fetchWorkbookBytes();
      rows = XlsxIO.parseRows(originalBytes);
      renderTable();
      renderGantt();
      const now = new Date();
      statusLine.textContent = `共 ${rows.length} 筆・更新於 ${now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) {
      console.error(err);
      statusLine.textContent = '載入失敗';
      toast('載入資料失敗:' + err.message, true);
    }
  }

  // ---------- 表格渲染 ----------

  function renderTable() {
    recordList().innerHTML = '';
    emptyState.hidden = rows.length > 0;
    rows.forEach((row, idx) => {
      recordList().appendChild(editMode ? renderEditCard(row, idx) : renderViewCard(row));
    });
    addRowBtn.style.display = editMode && rows.length < (CFG.MAX_ROW - CFG.MIN_ROW + 1) ? 'inline-flex' : 'none';
  }

  function renderViewCard(row) {
    const card = document.createElement('div');
    card.className = 'record-card';
    const badge = statusBadgeInfo(row.status);
    const people = [row.hw && `硬體:${row.hw}`, row.sw && `軟體/電控:${row.sw}`].filter(Boolean).join('　');
    card.innerHTML = `
      <div class="row-title">
        <span class="item-name">${escapeHtml(row.item || '(未命名項目)')}</span>
        <span class="badge ${badge.cls}">${escapeHtml(badge.label)}</span>
      </div>
      <div class="field-grid">
        <div class="field"><span class="field-label">計畫開始</span><span class="field-value">${fmtDate(row.start)}</span></div>
        <div class="field"><span class="field-label">計畫結束</span><span class="field-value">${fmtDate(row.end)}</span></div>
        <div class="field"><span class="field-label">工時(天)</span><span class="field-value">${row.duration ?? '-'}</span></div>
        <div class="field"><span class="field-label">狀態</span><span class="field-value">${escapeHtml(row.status || '-')}</span></div>
        ${people ? `<div class="field full"><span class="field-label">作業人員</span><span class="field-value">${escapeHtml(people)}</span></div>` : ''}
        ${row.note ? `<div class="field full"><span class="field-label">備註</span><span class="field-value">${escapeHtml(row.note)}</span></div>` : ''}
      </div>`;
    return card;
  }

  function renderEditCard(row, idx) {
    const card = document.createElement('div');
    card.className = 'record-card editing';
    card.innerHTML = `
      <div class="field-grid">
        <div class="field full">
          <span class="field-label">工作項目</span>
          <input type="text" data-f="item" value="${escapeAttr(row.item)}" placeholder="工作項目名稱">
        </div>
        <div class="field">
          <span class="field-label">計畫開始時間</span>
          <input type="date" data-f="start" value="${row.start || ''}">
        </div>
        <div class="field">
          <span class="field-label">計畫結束時間</span>
          <input type="date" data-f="end" value="${row.end || ''}">
        </div>
        <div class="field">
          <span class="field-label">工時(天,自動計算)</span>
          <input type="text" data-f="duration" value="${row.duration ?? ''}" disabled>
        </div>
        <div class="field">
          <span class="field-label">狀態</span>
          <input type="text" list="statusOptions" data-f="status" value="${escapeAttr(row.status)}" placeholder="已排定 / 暫定 / 待安排">
        </div>
        <div class="field">
          <span class="field-label">硬體作業人員</span>
          <input type="text" data-f="hw" value="${escapeAttr(row.hw)}">
        </div>
        <div class="field">
          <span class="field-label">軟體/電控作業人員</span>
          <input type="text" data-f="sw" value="${escapeAttr(row.sw)}">
        </div>
        <div class="field full">
          <span class="field-label">備註</span>
          <input type="text" data-f="note" value="${escapeAttr(row.note)}">
        </div>
      </div>
      <div class="row-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="clear">清除此列</button>
      </div>`;

    card.querySelectorAll('input[data-f]').forEach((input) => {
      input.addEventListener('input', () => {
        const f = input.dataset.f;
        row[f] = input.value;
        if (f === 'start' || f === 'end') {
          recalcDuration(row);
          card.querySelector('input[data-f="duration"]').value = row.duration ?? '';
        }
      });
    });
    card.querySelector('[data-act="clear"]').addEventListener('click', () => {
      Object.assign(row, { item: '', start: '', end: '', duration: null, status: '', hw: '', sw: '', note: '' });
      renderTable();
    });
    return card;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  // datalist for 狀態
  (function addStatusDatalist() {
    const dl = document.createElement('datalist');
    dl.id = 'statusOptions';
    STATUS_OPTIONS.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      dl.appendChild(opt);
    });
    document.body.appendChild(dl);
  })();

  // ---------- 編輯模式 / 密碼 ----------

  const passwordModal = el('passwordModal');
  const passwordInput = el('passwordInput');
  const passwordError = el('passwordError');

  editFab.addEventListener('click', () => {
    if (editMode) return;
    passwordError.textContent = '';
    passwordInput.value = '';
    passwordModal.hidden = false;
    setTimeout(() => passwordInput.focus(), 50);
  });

  el('passwordCancelBtn').addEventListener('click', () => { passwordModal.hidden = true; });
  passwordModal.addEventListener('click', (e) => { if (e.target === passwordModal) passwordModal.hidden = true; });

  async function tryUnlock() {
    const hash = await sha256Hex(passwordInput.value);
    if (hash === CFG.EDIT_PASSWORD_HASH) {
      passwordModal.hidden = true;
      enterEditMode();
    } else {
      passwordError.textContent = '密碼錯誤,請再試一次';
    }
  }
  el('passwordConfirmBtn').addEventListener('click', tryUnlock);
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

  function enterEditMode() {
    editMode = true;
    editFab.style.display = 'none';
    saveFab.style.display = 'inline-flex';
    cancelEditBtn.style.display = 'inline-flex';
    renderTable();
  }

  function exitEditMode() {
    editMode = false;
    editFab.style.display = 'inline-flex';
    saveFab.style.display = 'none';
    addRowBtn.style.display = 'none';
    cancelEditBtn.style.display = 'none';
    renderTable();
  }

  cancelEditBtn.addEventListener('click', async () => {
    if (!confirm('確定要放棄未儲存的變更嗎?')) return;
    await loadData();
    exitEditMode();
  });

  addRowBtn.addEventListener('click', () => {
    const nextRowNum = CFG.MIN_ROW + rows.length;
    if (nextRowNum > CFG.MAX_ROW) {
      toast(`已達最大筆數上限(${CFG.MAX_ROW - CFG.MIN_ROW + 1} 筆)`, true);
      return;
    }
    rows.push({ row: nextRowNum, item: '', start: '', end: '', duration: null, status: '', hw: '', sw: '', note: '' });
    renderTable();
    recordList().lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------- 儲存 ----------

  saveFab.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    const originalLabel = saveFab.innerHTML;
    saveFab.innerHTML = '<span class="spinner"></span> 儲存中…';
    saveFab.disabled = true;
    try {
      const cleanRows = rows.filter((r) => (r.item && r.item.trim()) || r.status || r.start || r.end);
      const patchedBytes = XlsxIO.buildPatchedWorkbook(originalBytes, cleanRows);
      const token = await DriveAuth.ensureWriteAccess();
      await XlsxIO.uploadWorkbook(patchedBytes, token);
      originalBytes = patchedBytes;
      rows = XlsxIO.parseRows(patchedBytes);
      toast('已成功儲存至 Google Drive');
      exitEditMode();
      renderGantt();
    } catch (err) {
      console.error(err);
      toast('儲存失敗:' + err.message, true);
    } finally {
      saving = false;
      saveFab.innerHTML = originalLabel;
      saveFab.disabled = false;
    }
  });

  // ---------- 啟動 ----------

  loadData();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
