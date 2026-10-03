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

  async function fetchWorkbookBytes(accessToken) {
    const url = `https://www.googleapis.com/drive/v3/files/${CFG.DRIVE_FILE_ID}?alt=media`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err = new Error(`下載檔案失敗 (${resp.status}): ${text.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
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
  function buildPatchedWorkbook(originalBytes, rows, archiveRows) {
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

    if (archiveRows) writeArchiveSheet(zipOut, originalBytes, archiveRows);

    return fflate.zipSync(zipOut, { level: 6 });
  }

  // ---------- 資料庫工作表(已結案項目) ----------

  const ARCHIVE_SHEET_NAME = '資料庫';
  const ARCHIVE_HEADERS = ['工作項目', '計畫開始時間', '計畫結束時間', '工時(天)', '狀態', '硬體作業人員', '軟體/電控作業人員', '備註', '結案日期'];
  const REL_NS_URI = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const WORKSHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

  function parseArchive(bytes) {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    const ws = wb.Sheets[ARCHIVE_SHEET_NAME];
    if (!ws || !ws['!ref']) return [];
    const lastRow = XLSX.utils.decode_range(ws['!ref']).e.r + 1;
    const out = [];
    for (let r = 2; r <= lastRow; r++) {
      const get = (col) => {
        const cell = ws[`${col}${r}`];
        return cell ? cell.v : undefined;
      };
      const item = get('A');
      if ([item, get('B'), get('C'), get('E')].every((v) => v === undefined || v === '')) continue;
      const start = serialToISODate(get('B'));
      const end = serialToISODate(get('C'));
      const s = isoDateToSerial(start);
      const e = isoDateToSerial(end);
      out.push({
        item: item != null ? String(item) : '',
        start,
        end,
        duration: s != null && e != null ? e - s + 1 : null,
        status: get('E') != null ? String(get('E')) : '完工',
        hw: get('F') != null ? String(get('F')) : '',
        sw: get('G') != null ? String(get('G')) : '',
        note: get('H') != null ? String(get('H')) : '',
        closed: serialToISODate(get('I')),
      });
    }
    return out;
  }

  function buildArchiveSheetXml(archiveRows, headers) {
    const colLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const textCell = (ref, text, style) =>
      text === '' || text == null
        ? ''
        : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    const numCell = (ref, num, style) =>
      num == null || Number.isNaN(num) ? '' : `<c r="${ref}" s="${style}"><v>${num}</v></c>`;

    const headerRow =
      `<row r="1">${headers.map((h, i) => textCell(`${colLetters[i]}1`, h, 5)).join('')}</row>`;
    const bodyRows = archiveRows
      .map((a, i) => {
        const r = i + 2;
        const s = isoDateToSerial(a.start);
        const e = isoDateToSerial(a.end);
        return (
          `<row r="${r}">` +
          textCell(`A${r}`, a.item, 2) +
          numCell(`B${r}`, s, 11) +
          numCell(`C${r}`, e, 11) +
          numCell(`D${r}`, s != null && e != null ? e - s + 1 : null, 3) +
          textCell(`E${r}`, a.status || '完工', 3) +
          textCell(`F${r}`, a.hw, 2) +
          textCell(`G${r}`, a.sw, 2) +
          textCell(`H${r}`, a.note, 3) +
          numCell(`I${r}`, isoDateToSerial(a.closed), 11) +
          `</row>`
        );
      })
      .join('');
    const widths = [43, 19, 19, 10, 12, 30, 30, 30, 19];
    const cols = widths
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join('');
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="${NS}" xmlns:r="${REL_NS_URI}">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols>` +
      `<sheetData>${headerRow}${bodyRows}</sheetData></worksheet>`
    );
  }

  // 找出(或新增)「資料庫」工作表在 zip 內的路徑;新增時一併更新
  // workbook.xml / workbook.xml.rels / [Content_Types].xml
  function ensureArchiveSheetPath(zip) {
    const dec = (u8) => new TextDecoder('utf-8').decode(u8);
    const enc = (s) => new TextEncoder().encode(s);
    const wbXml = dec(zip['xl/workbook.xml']);
    const relsXml = dec(zip['xl/_rels/workbook.xml.rels']);

    const sheetTag = (wbXml.match(/<sheet\b[^>]*>/g) || []).find((t) => t.includes(`name="${ARCHIVE_SHEET_NAME}"`));
    if (sheetTag) {
      const rid = (sheetTag.match(/r:id="([^"]+)"/) || [])[1];
      const relTag = (relsXml.match(/<Relationship\b[^>]*>/g) || []).find((t) => t.includes(`Id="${rid}"`));
      const target = relTag && (relTag.match(/Target="([^"]+)"/) || [])[1];
      if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    }

    let n = 2;
    while (zip[`xl/worksheets/sheet${n}.xml`]) n++;
    const path = `xl/worksheets/sheet${n}.xml`;
    const maxSheetId = Math.max(0, ...[...wbXml.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1])));
    const maxRid = Math.max(0, ...[...relsXml.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1])));
    const rid = `rId${maxRid + 1}`;

    zip['xl/workbook.xml'] = enc(
      wbXml.replace('</sheets>', `<sheet name="${ARCHIVE_SHEET_NAME}" sheetId="${maxSheetId + 1}" r:id="${rid}"/></sheets>`)
    );
    zip['xl/_rels/workbook.xml.rels'] = enc(
      relsXml.replace(
        '</Relationships>',
        `<Relationship Id="${rid}" Type="${REL_NS_URI}/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`
      )
    );
    const ctXml = dec(zip['[Content_Types].xml']);
    zip['[Content_Types].xml'] = enc(
      ctXml.replace('</Types>', `<Override PartName="/${path}" ContentType="${WORKSHEET_CT}"/></Types>`)
    );
    return path;
  }

  function writeArchiveSheet(zip, originalBytes, archiveRows) {
    let headers = ARCHIVE_HEADERS;
    try {
      const wb = XLSX.read(originalBytes, { type: 'array', cellDates: false });
      const ws = wb.Sheets[CFG.SHEET_NAME];
      const listHeaders = COLS.map((c) => (ws && ws[`${c}1`] ? String(ws[`${c}1`].v) : ''));
      if (listHeaders.every(Boolean)) headers = [...listHeaders, '結案日期'];
    } catch (e) { /* 取不到表頭就用預設值 */ }
    const path = ensureArchiveSheetPath(zip);
    zip[path] = new TextEncoder().encode(buildArchiveSheetXml(archiveRows, headers));
  }

  async function uploadWorkbook(bytes, accessToken) {
    const url = `https://www.googleapis.com/upload/drive/v3/files/${CFG.DRIVE_FILE_ID}?uploadType=media&supportsAllDrives=true`;
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
      const err = new Error(`上傳失敗 (${resp.status}): ${text.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  }

  window.XlsxIO = {
    fetchWorkbookBytes,
    parseRows,
    parseArchive,
    buildPatchedWorkbook,
    uploadWorkbook,
    serialToISODate,
    isoDateToSerial,
  };
})();
