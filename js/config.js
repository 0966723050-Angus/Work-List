// ATK近期工作項目 - 全域設定
// GOOGLE_CLIENT_ID / GOOGLE_API_KEY 需在 Google Cloud Console 建立後填入。
window.APP_CONFIG = {
  // Google Drive 上 Work List.xlsm 的檔案 ID
  DRIVE_FILE_ID: '1bss9sYHoav894eaCxA9u68CcfHNuYUNZ',

  // 資料所在工作表名稱
  SHEET_NAME: 'List',

  // OAuth 2.0 用戶端 ID(Google Cloud Console > API 和服務 > 憑證)
  // 用於「編輯後儲存」時取得具寫入權限的存取權杖
  GOOGLE_CLIENT_ID: '873968217418-q5t3i90e4pf04kbd4l6vbpjib13etb7o.apps.googleusercontent.com',

  // API 金鑰(僅用於唯讀下載檔案內容,已限制只能從本網站網域呼叫 Drive API)
  GOOGLE_API_KEY: 'AIzaSyA4nUgF4lT_6hOgYKXqAjXMsRd0vCdBJiM',

  // 寫入 Drive 所需的權限範圍(僅存取此 App 建立/開啟過的檔案,不會讀取使用者整個雲端硬碟)
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.file',

  // 編輯密碼的 SHA-256 雜湊(不在原始碼中存明碼密碼)
  EDIT_PASSWORD_HASH: '6f8c41020e56d0972ca7529a39855ea79ddc499a107381671b6d2f46741a7d00',

  // 表格可編輯/新增的最大資料列(對應 Excel 原始表格已預先格式化的列數範圍 List!A2:A17)
  MAX_ROW: 17,
  MIN_ROW: 2,
};
