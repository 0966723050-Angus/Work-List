// drive-auth.js
// 使用 Google Identity Services 取得僅限「使用者選取檔案」的存取權杖(drive.file scope),
// 並透過 Google Picker 讓使用者明確選取 Work List.xlsm,取得該檔案的寫入授權。
// 這樣網站不需要、也不會取得使用者整個雲端硬碟的存取權限。
(function () {
  const CFG = window.APP_CONFIG;

  let tokenClient = null;
  let accessToken = null;
  let pickerConfirmed = false;
  let pickerApiLoaded = false;

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

  function loadPickerApi() {
    return new Promise((resolve, reject) => {
      if (pickerApiLoaded) return resolve();
      if (!window.gapi) return reject(new Error('Google API 元件尚未載入'));
      gapi.load('picker', {
        callback: () => { pickerApiLoaded = true; resolve(); },
        onerror: () => reject(new Error('Google Picker 載入失敗')),
      });
    });
  }

  async function confirmFileWithPicker() {
    await loadPickerApi();
    if (!accessToken) throw new Error('尚未取得存取權杖');

    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
        .setQuery('Work List')
        .setIncludeFolders(true);

      const picker = new google.picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .setDeveloperKey(CFG.GOOGLE_API_KEY)
        .setAppId(CFG.GOOGLE_PROJECT_NUMBER)
        .addView(view)
        .setTitle('請選擇「Work List.xlsm」以授權儲存')
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs && data.docs[0];
            if (doc && doc.id === CFG.DRIVE_FILE_ID) {
              pickerConfirmed = true;
              resolve(true);
            } else {
              reject(new Error('請選擇正確的 Work List.xlsm 檔案'));
            }
          } else if (data.action === google.picker.Action.CANCEL) {
            reject(new Error('已取消授權'));
          }
        })
        .build();
      picker.setVisible(true);
    });
  }

  /**
   * 確保已取得可寫入 Work List.xlsm 的存取權杖。
   * 第一次會跳出 Google 登入 + Picker 選檔視窗;同一瀏覽器工作階段內重複呼叫會重用權杖。
   */
  async function ensureWriteAccess() {
    if (!accessToken) {
      await requestAccessToken({ prompt: 'consent' });
    }
    if (!pickerConfirmed) {
      await confirmFileWithPicker();
    }
    return accessToken;
  }

  function resetAuth() {
    accessToken = null;
    pickerConfirmed = false;
  }

  window.DriveAuth = { ensureWriteAccess, resetAuth };
})();
