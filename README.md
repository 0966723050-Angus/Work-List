# ATK近期工作項目

手機友善的 RWD / PWA 網頁,資料來源為 Google Drive 中的 `Work List/Work List.xlsm`(工作表「List」)。

## 功能

- **登入門檻**:開啟網站需先以 Google 帳號登入,才能看到任何資料(非公開頁面)
- **表格數據頁**:顯示 A~H 欄(工作項目、計畫開始/結束時間、工時、狀態、硬體/軟體作業人員、備註)
- **甘特圖頁**:依「Schedule」排程繪製 SVG 甘特圖,長條顏色依 E 欄狀態決定
  - 已排定(已確定) → 淺綠色
  - 暫定 → 藍色
  - 待安排/其他 → 灰色
- **編輯**:表格右上角「✎ 編輯」需輸入密碼(雜湊比對,原始碼中不存明碼)解鎖——這只是防止手滑誤觸的 UX 保護,真正的存取控管由下方的 Drive 共用權限負責
- **儲存**:編輯完成後按右下角「💾 儲存」,會:
  1. 沿用登入時取得的 Google 權杖(若已過期會重新要求登入)
  2. 只修改原始 xlsm 檔案中「List」工作表被編輯到的儲存格(inline string / 數值),完整保留 VBA 巨集與內嵌的 Schedule 圖表
  3. 透過 Drive API 覆寫回原本的 `Work List.xlsm`

**誰能看、誰能存,完全由 Google Drive 上 `Work List.xlsm` 的共用權限決定**(擁有者在 Drive「共用」設定裡把人設為檢視者或編輯者):
- 沒有被加入共用名單的人,登入後 Drive 會直接拒絕讀取(網站顯示載入失敗)
- 只有「檢視者」權限的人,登入後可以看,但按儲存會被 Drive 拒絕(403)
- 「編輯者」權限的人才能真正存檔成功

## 架構

純前端靜態網站(可直接部署於 GitHub Pages),不需要自架後端伺服器:

- `index.html` / `css/style.css`:版面與 RWD 樣式,含登入門檻畫面
- `js/config.js`:Drive 檔案 ID、Google OAuth Client ID、編輯密碼雜湊等設定
- `js/xlsx-io.js`:讀取(SheetJS)與「最小幅度」寫入(直接操作 xlsm 內的 `xl/worksheets/sheet1.xml`,以 fflate 解 / 重新壓縮 zip)
- `js/drive-auth.js`:Google Identity Services 登入,取得讀寫共用的 OAuth 權杖
- `js/gantt.js`:SVG 甘特圖渲染
- `js/app.js`:主流程與 UI 互動
- `manifest.webmanifest` / `sw.js` / `icons/`:PWA 安裝與離線快取支援

## Google Cloud 設定(已完成,僅供日後維護參考)

專案:`worklist050`(組織:atk.com.tw)

1. 已啟用 API:Google Drive API
2. OAuth 同意畫面:使用者類型「內部」(僅 atk.com.tw 網域使用者可登入)
3. 資料存取權(Data Access)已註冊範圍:`https://www.googleapis.com/auth/drive`(讀寫皆用同一權杖,依 Drive 共用權限判斷存取範圍)
4. OAuth 2.0 用戶端 ID(網頁應用程式):已授權 JavaScript 來源 `https://0966723050-angus.github.io`
5. **不再使用 API 金鑰**(2026-09 改為「必須登入才能檢視」架構後,讀取也改用 OAuth 權杖,金鑰已於 Google Cloud Console 刪除)
6. Google Drive 檔案「Work List.xlsm」一般存取權已改回「限制」,僅共用名單內的人(擁有者 + 個別指定的檢視者/編輯者)能存取

若要更換網域或重新產生憑證,請至 [Google Cloud Console](https://console.cloud.google.com/apis/credentials?project=worklist050) 調整,並同步更新 `js/config.js`。

## 本機測試

```bash
python -m http.server 8791
```

再開啟 http://localhost:8791。因 OAuth 用戶端的「已授權 JavaScript 來源」只登記了正式網域,本機測試時登入會失敗,屬正常現象;請於部署到 GitHub Pages 後於該網域測試完整功能。
