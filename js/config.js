// ATK近期工作項目 - 全域設定
// GOOGLE_CLIENT_ID 需在 Google Cloud Console 建立後填入。
window.APP_CONFIG = {
  // Google Drive 上 Work List.xlsm 的檔案 ID
  DRIVE_FILE_ID: '1bss9sYHoav894eaCxA9u68CcfHNuYUNZ',

  // 資料所在工作表名稱
  SHEET_NAME: 'List',

  // OAuth 2.0 用戶端 ID(Google Cloud Console > API 和服務 > 憑證)
  // 檢視與儲存都需要先用 Google 帳號登入取得這個權杖
  GOOGLE_CLIENT_ID: '873968217418-q5t3i90e4pf04kbd4l6vbpjib13etb7o.apps.googleusercontent.com',

  // 讀取與寫入 Drive 所需的權限範圍。改為「必須登入才能檢視」架構後,
  // 讀/寫都直接依 Drive 本身在 Work List.xlsm 設定的共用權限(檢視者/編輯者)
  // 判斷,因此不再需要 API 金鑰或 Google Picker。
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive',

  // 編輯密碼的 SHA-256 雜湊(不在原始碼中存明碼密碼)
  // 這只是防止手滑誤觸編輯的 UX 保護,真正的存取控管由 Drive 共用權限 + Google 登入負責
  EDIT_PASSWORD_HASH: '6f8c41020e56d0972ca7529a39855ea79ddc499a107381671b6d2f46741a7d00',

  // 表格可編輯/新增的最大資料列(對應 Excel 原始表格已預先格式化的列數範圍 List!A2:A17)
  ADMIN_EMAIL_HASH: 'e825d940b8eb5d18c87d50a0b8eb361ddf858c45209a965f57854192aa8970e3',
  MAX_ROW: 17,
  MIN_ROW: 2,
};
