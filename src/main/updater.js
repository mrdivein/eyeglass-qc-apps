/* OTA: electron-updater reads the latest GitHub Release of this repo, downloads in the background, installs on restart. */
function setupUpdater(app, send, ipcMain, getToken) {
  let au = null;
  const status = (s) => send('update:status', s);

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) { status({ state: 'dev', text: 'Updates work in the installed app only' }); return false; }
    try { configure(); await au.checkForUpdates(); } catch (e) { status({ state: 'error', text: 'Update check failed: ' + (e.message || e) }); }
    return true;
  });
  ipcMain.handle('update:install', () => { if (au) au.quitAndInstall(false, true); });

  /* Repo public: no token, default feed. Repo private: a read-only token (Settings) switches to the authenticated feed. */
  function configure() {
    const token = getToken && getToken();
    if (token) au.setFeedURL({ provider: 'github', owner: 'mrdivein', repo: 'eyeglass-qc-apps', private: true, token: token });
  }

  if (!app.isPackaged) return;
  au = require('electron-updater').autoUpdater;
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.on('checking-for-update', () => status({ state: 'checking', text: 'Checking for updates' }));
  au.on('update-available', (i) => status({ state: 'downloading', text: 'Downloading ' + i.version, version: i.version }));
  au.on('update-not-available', () => status({ state: 'current', text: 'Up to date' }));
  au.on('download-progress', (p) => status({ state: 'downloading', text: 'Downloading ' + Math.round(p.percent) + '%', percent: p.percent }));
  au.on('update-downloaded', (i) => status({ state: 'ready', text: 'Version ' + i.version + ' ready', version: i.version }));
  au.on('error', (e) => status({ state: 'error', text: 'Update error: ' + (e && e.message || e) }));
  const check = () => { try { configure(); } catch (e) { return; } au.checkForUpdates().catch(() => {}); };
  setTimeout(check, 3000);
  setInterval(check, 4 * 60 * 60 * 1000);
}
module.exports = { setupUpdater };
