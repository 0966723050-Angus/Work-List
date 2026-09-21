# ATK近期工作項目

手機友善的 RWD / PWA 網頁,資料來源為 Google Drive 中的 `Work List/Work List.xlsm`(工作表「List」)。

## 功能

- **表格數據頁**:顯示 A~H 欄(工作項目、計畫開始/結束時間、工時、狀態、硬體/軟體作業人員、備註)
- **甘特圖頁**:依「Schedule」排程繪製 SVG 甘特圖,長條顏色依 E 欄狀態決定
  - 已排定(已確定) → 淺綠色
  - 暫定 → 藍色
  - 待安排/其他 → 灰色
- **編輯**:表格右上角「✎ 編輯」需輸入密碼(雜湊比對,原始碼中不存明碼)解鎖
- **儲存**:編輯完成後按右下角「💾 儲存」,會:
  1. 以 Google 帳號登入(僅授權此網站存取使用者透過 Picker 選取的單一檔案,不會取得整個雲端硬碟權限)
  2. 只修改原始 xlsm 檔案中「List」工作表被編輯到的儲存格(inline string / 數值),完整保留 VBA 巨集與內嵌的 Schedule 圖表
  3. 透過 Drive API 覆寫回原本的 `Work List.xlsm`

## 架構

純前端靜態網站(可直接部署於 GitHub Pages),不需要自架後端伺服器:

- `index.html` / `css/style.css`:版面與 RWD 樣式
- `js/config.js`:Drive 檔案 ID、Google OAuth Client ID、API 金鑰、編輯密碼雜湊等設定
- `js/xlsx-io.js`:讀取(SheetJS)與「最小幅度」寫入(直接操作 xlsm 內的 `xl/worksheets/sheet1.xml`,以 fflate 解 / 重新壓縮 zip)
- `js/drive-auth.js`:Google Identity Services 登入 + Google Picker 檔案授權
- `js/gantt.js`:SVG 甘特圖渲染
- `js/app.js`:主流程與 UI 互動
- `manifest.webmanifest` / `sw.js` / `icons/`:PWA 安裝與離線快取支援

## Google Cloud 設定(已完成,僅供日後維護參考)

專案:`worklist050`(組織:atk.com.tw)

1. 已啟用 API:Google Drive API、Google Picker API
2. OAuth 同意畫面:使用者類型「內部」(僅 atk.com.tw 網域使用者可登入取得寫入權限)
3. API 金鑰:限制為「Google Drive API」+ 僅接受來自 `https://0966723050-angus.github.io/*` 的請求(唯讀下載用)
4. OAuth 2.0 用戶端 ID(網頁應用程式):已授權 JavaScript 來源 `https://0966723050-angus.github.io`
5. Google Drive 檔案「Work List.xlsm」一般存取權已設為「知道連結的任何人 - 檢視者」,供未登入使用者讀取表格/圖表

若要更換網域或重新產生憑證,請至 [Google Cloud Console](https://console.cloud.google.com/apis/credentials?project=worklist050) 調整,並同步更新 `js/config.js`。

## 本機測試

```bash
python -m http.server 8791
```

再開啟 http://localhost:8791 (注意:因 API 金鑰限制網域,本機測試時「載入資料」會失敗,屬正常現象;請於部署到 GitHub Pages 後於該網域測試完整功能)。
