// drive-auth.js
// 使用 Google Identity Services 取得存取權杖(drive scope)。改為「必須登入才能
// 檢視」架構後,讀取與寫入都改用同一個 OAuth 權杖,不再需要 API 金鑰或
// Google Picker——每個使用者能看到 / 能否儲存,完全依 Drive 本身在
// Work List.xlsm 上設定的共用權限(檢視者 / 編輯者)判斷。
(function () {
  const CFG = window.APP_CONFIG;

  let tokenClient = null;
  let accessToken = null;

  function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      throw new Error('Google 登入元件尚未載入,請稍後再試');
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.GOOGLE_CLIENT_ID,
      scope: CFG.DRIVE_SCOPE,
      callback: () => {}, // 由 requestAccessToken 動態覆寫
    });
    return tokenClient;
  }

  function requestAccessToken({ prompt } = {}) {
    return new Promise((resolve, reject) => {
      const client = ensureTokenClient();
      client.callback = (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        accessToken = resp.access_token;
        resolve(accessToken);
      };
      try {
        client.requestAccessToken({ prompt: prompt || '' });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 確保已取得存取權杖(用於讀取與寫入)。第一次呼叫(或權杖失效後)會跳出
   * Google 登入視窗;同一瀏覽器工作階段內重複呼叫會重用既有權杖。
   * 必須在使用者點擊事件內呼叫,瀏覽器才不會擋下登入彈出視窗。
   */
  async function ensureAccessToken() {
    if (!accessToken) {
      await requestAccessToken({ prompt: '' });
    }
    return accessToken;
  }

  function resetAuth() {
    accessToken = null;
  }

  window.DriveAuth = { ensureAccessToken, resetAuth };
})();
