// xlsx-io.js
// 負責:1) 從 Google Drive 下載 Work List.xlsm 並解析「List」工作表 A~H 欄
//       2) 編輯後,對原始檔案的 xl/worksheets/sheet1.xml 做「最小幅度」修改
//          (只改動被編輯的儲存格),保留 VBA 巨集與內嵌的 Schedule 圖表不受影響,
//          再重新打包上傳回 Google Drive。
(function () {
  const CFG = window.APP_CONFIG;
  const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const SHEET_XML_PATH = 'xl/worksheets/sheet1.xml';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

  const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
  const DAY_MS = 86400000;

  function serialToISODate(serial) {
    if (serial === null || serial === undefined || serial === '') return '';
    const ms = EXCEL_EPOCH_UTC + Number(serial) * DAY_MS;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function isoDateToSerial(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    const ms = Date.UTC(y, m - 1, d);
    return Math.round((ms - EXCEL_EPOCH_UTC) / DAY_MS);
  }

  function escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ---------- 讀取 ----------

  async function fetchWorkbookBytes() {
    const url = `https://www.googleapis.com/drive/v3/files/${CFG.DRIVE_FILE_ID}?alt=media&key=${CFG.GOOGLE_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`下載檔案失敗 (${resp.status}): ${text.slice(0, 200)}`);
    }
    return await resp.arrayBuffer();
  }

  function parseRows(bytes) {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    const ws = wb.Sheets[CFG.SHEET_NAME];
    if (!ws) throw new Error(`找不到工作表「${CFG.SHEET_NAME}」`);

    const rows = [];
    for (let r = CFG.MIN_ROW; r <= CFG.MAX_ROW; r++) {
      const get = (col) => {
        const cell = ws[`${col}${r}`];
        return cell ? cell.v : undefined;
      };
      const item = get('A');
      const status = get('E');
      const hasAny = [item, get('B'), get('C'), status, get('F'), get('G'), get('H')]
        .some((v) => v !== undefined && v !== '');
      if (!hasAny) continue;

      rows.push({
        row: r,
        item: item != null ? String(item) : '',
        start: serialToISODate(get('B')),
        end: serialToISODate(get('C')),
        duration: get('D') !== undefined && get('D') !== '' ? Number(get('D')) : null,
        status: status != null ? String(status) : '',
        hw: get('F') != null ? String(get('F')) : '',
        sw: get('G') != null ? String(get('G')) : '',
        note: get('H') != null ? String(get('H')) : '',
      });
    }
    return rows;
  }

  // ---------- 寫入(最小幅度 patch) ----------

  function getCellsIndexByColumn(colLetter) {
    return COLS.indexOf(colLetter) + 1; // A=1 ... H=8
  }

  // 依欄位順序找出「插入點」錨點(row 內下一個已存在、欄序較大的 <c>)
  function findInsertAnchor(rowEl, colLetter) {
    const targetIdx = colLetterToIndex(colLetter);
    const children = Array.from(rowEl.children).filter((el) => el.localName === 'c');
    for (const el of children) {
      const ref = el.getAttribute('r') || '';
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      if (colLetterToIndex(m[1]) > targetIdx) return el;
    }
    return null;
  }

  function colLetterToIndex(letters) {
    let idx = 0;
    for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
    return idx;
  }

  function getOrCreateCell(doc, rowEl, colLetter, rowNum, fallbackStyle) {
    const ref = `${colLetter}${rowNum}`;
    let cell = Array.from(rowEl.children).find(
      (el) => el.localName === 'c' && el.getAttribute('r') === ref
    );
    if (cell) return cell;
    cell = doc.createElementNS(NS, 'c');
    cell.setAttribute('r', ref);
    if (fallbackStyle) cell.setAttribute('s', fallbackStyle);
    const anchor = findInsertAnchor(rowEl, colLetter);
    if (anchor) rowEl.insertBefore(cell, anchor);
    else rowEl.appendChild(cell);
    return cell;
  }

  function clearCellValue(cell) {
    // 移除既有的 <v>/<is> 子節點與 t 屬性(保留 <f> 若存在,由呼叫端另行處理)
    Array.from(cell.children).forEach((child) => {
      if (child.localName === 'v' || child.localName === 'is') cell.removeChild(child);
    });
    cell.removeAttribute('t');
  }

  function setCellInlineString(doc, cell, text) {
    // 移除公式與既有內容,改為 inlineStr,避免動到 sharedStrings.xml
    Array.from(cell.children).forEach((child) => cell.removeChild(child));
    if (text === '' || text == null) {
      cell.removeAttribute('t');
      return;
    }
    cell.setAttribute('t', 'inlineStr');
    const isEl = doc.createElementNS(NS, 'is');
    const tEl = doc.createElementNS(NS, 't');
    tEl.textContent = String(text);
    isEl.appendChild(tEl);
    cell.appendChild(isEl);
  }

  function setCellNumber(doc, cell, num) {
    Array.from(cell.children).forEach((child) => {
      if (child.localName === 'v' || child.localName === 'is') cell.removeChild(child);
    });
    if (num === null || num === undefined || Number.isNaN(num)) {
      cell.removeAttribute('t');
      return;
    }
    cell.removeAttribute('t');
    const vEl = doc.createElementNS(NS, 'v');
    vEl.textContent = String(num);
    cell.appendChild(vEl);
  }

  function setFormulaCellValue(doc, cell, numOrNull) {
    // 保留 <f>,只更新 <v> 與 t="str" 的空值狀態
    let vEl = Array.from(cell.children).find((c) => c.localName === 'v');
    if (!vEl) {
      vEl = doc.createElementNS(NS, 'v');
      cell.appendChild(vEl);
    }
    if (numOrNull === null || numOrNull === undefined || Number.isNaN(numOrNull)) {
      cell.setAttribute('t', 'str');
      vEl.textContent = '';
    } else {
      cell.removeAttribute('t');
      vEl.textContent = String(numOrNull);
    }
  }

  function ensureDurationFormula(doc, sheetData, rowEl, rowNum) {
    // 找到 D2 的主公式,必要時把 ref 擴充到涵蓋目前列
    const dCell = getOrCreateCell(doc, rowEl, 'D', rowNum, '3');
    let fEl = Array.from(dCell.children).find((c) => c.localName === 'f');

    if (rowNum === CFG.MIN_ROW) {
      if (fEl) {
        const currentRef = fEl.getAttribute('ref') || '';
        const m = currentRef.match(/^D\d+:D(\d+)$/);
        const currentMax = m ? Number(m[1]) : CFG.MIN_ROW;
        if (CFG.MAX_ROW > currentMax) {
          fEl.setAttribute('ref', `D${CFG.MIN_ROW}:D${CFG.MAX_ROW}`);
        }
      }
      return dCell;
    }

    if (!fEl) {
      fEl = doc.createElementNS(NS, 'f');
      fEl.setAttribute('t', 'shared');
      fEl.setAttribute('si', '0');
      dCell.insertBefore(fEl, dCell.firstChild);
    }
    return dCell;
  }

  const STATUS_STYLE_FALLBACK = { A: null, E: '3', F: '3', G: '3', H: '3' };

  /**
   * 將編輯後的資料列(rows,結構同 parseRows 回傳格式)套用到原始 xlsm bytes,
   * 回傳新的檔案 bytes(Uint8Array),可直接上傳回 Drive。
   */
  function buildPatchedWorkbook(originalBytes, rows) {
    const zipIn = fflate.unzipSync(new Uint8Array(originalBytes));
    const sheetBytes = zipIn[SHEET_XML_PATH];
    if (!sheetBytes) throw new Error('原始檔案缺少工作表 XML,無法寫入');

    const xmlText = new TextDecoder('utf-8').decode(sheetBytes);
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) throw new Error('工作表 XML 解析失敗');

    const sheetData = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    const rowByNum = new Map();
    Array.from(sheetData.children).forEach((rowEl) => {
      if (rowEl.localName === 'row') rowByNum.set(Number(rowEl.getAttribute('r')), rowEl);
    });

    const byRowNum = new Map(rows.map((r) => [r.row, r]));

    for (let r = CFG.MIN_ROW; r <= CFG.MAX_ROW; r++) {
      const rowEl = rowByNum.get(r);
      if (!rowEl) continue; // 範本已預留 2..MAX_ROW,理論上都存在
      const data = byRowNum.get(r) || { item: '', start: '', end: '', status: '', hw: '', sw: '', note: '' };

      const aCell = getOrCreateCell(doc, rowEl, 'A', r, null);
      setCellInlineString(doc, aCell, data.item || '');

      const bCell = getOrCreateCell(doc, rowEl, 'B', r, '11');
      setCellNumber(doc, bCell, isoDateToSerial(data.start));

      const cCell = getOrCreateCell(doc, rowEl, 'C', r, '11');
      setCellNumber(doc, cCell, isoDateToSerial(data.end));

      const dCell = ensureDurationFormula(doc, sheetData, rowEl, r);
      const sSerial = isoDateToSerial(data.start);
      const eSerial = isoDateToSerial(data.end);
      const duration = sSerial != null && eSerial != null ? eSerial - sSerial + 1 : null;
      setFormulaCellValue(doc, dCell, duration);

      const eCell = getOrCreateCell(doc, rowEl, 'E', r, '3');
      setCellInlineString(doc, eCell, data.status || '');

      const fCell = getOrCreateCell(doc, rowEl, 'F', r, '3');
      setCellInlineString(doc, fCell, data.hw || '');

      const gCell = getOrCreateCell(doc, rowEl, 'G', r, '3');
      setCellInlineString(doc, gCell, data.sw || '');

      const hCell = getOrCreateCell(doc, rowEl, 'H', r, '3');
      setCellInlineString(doc, hCell, data.note || '');
    }

    const newXml = new XMLSerializer().serializeToString(doc);
    const zipOut = Object.assign({}, zipIn);
    zipOut[SHEET_XML_PATH] = new TextEncoder().encode(newXml);

    return fflate.zipSync(zipOut, { level: 6 });
  }

  async function uploadWorkbook(bytes, accessToken) {
    const url = `https://www.googleapis.com/upload/drive/v3/files/${CFG.DRIVE_FILE_ID}?uploadType=media`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/vnd.ms-excel.sheet.macroEnabled.12',
      },
      body: bytes,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`上傳失敗 (${resp.status}): ${text.slice(0, 300)}`);
    }
    return await resp.json();
  }

  window.XlsxIO = {
    fetchWorkbookBytes,
    parseRows,
    buildPatchedWorkbook,
    uploadWorkbook,
    serialToISODate,
    isoDateToSerial,
  };
})();
