const { app, BrowserWindow, ipcMain, clipboard, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const X = require('./export');
const { setupUpdater } = require('./updater');

if (!app.requestSingleInstanceLock()) app.quit();

let win, store;
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#f4f6f8', title: 'QC Scan',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

/* Lots, products and locations come from the data endpoint (read-only, own key). */
async function sync() {
  const s = store.settings();
  if (!s.apiUrl || !s.apiKey) throw new Error('Set the data URL and key in Settings');
  const url = s.apiUrl + (s.apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'api=qc&key=' + encodeURIComponent(s.apiKey);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('Server answered HTTP ' + res.status);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Server refused the request');
  body.syncedAt = new Date().toISOString();
  store.saveCache(body);
  return body;
}

function register() {
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: store.dir, packaged: app.isPackaged }));
  ipcMain.handle('settings:get', () => store.settings());
  ipcMain.handle('settings:set', (_e, s) => store.saveSettings({ apiUrl: String(s.apiUrl || '').trim(), apiKey: String(s.apiKey || '').trim(), operator: String(s.operator || '').trim(), updateToken: String(s.updateToken || '').trim() }));
  ipcMain.handle('data:cached', () => store.cache());
  ipcMain.handle('data:sync', async () => {
    try { return { ok: true, data: await sync() }; } catch (e) { return { ok: false, error: String(e.message || e), data: store.cache() }; }
  });
  ipcMain.handle('log:scan', (_e, ev) => { store.logScan(ev); return true; });
  ipcMain.handle('draft:get', () => store.draft());
  ipcMain.handle('draft:set', (_e, d) => { store.saveDraft(d); return true; });
  ipcMain.handle('units:list', () => store.units());
  ipcMain.handle('units:save', (_e, rec) => { store.saveUnit(rec); return true; });
  ipcMain.handle('units:void', (_e, id) => { store.voidUnit(id); return true; });

  const pick = (all) => store.units().filter((u) => !u.voided && (all || !u.exportedBatch));
  const nextNo = () => { const c = store.cache(); return c && c.nextId ? c.nextId : 0; };
  const exportCfg = () => { const c = store.cache(); return c && c.config && c.config.export; };
  ipcMain.handle('export:copy', (_e, all) => {
    const us = pick(all);
    if (!us.length) return { count: 0 };
    clipboard.writeText(X.toTSV(X.rows(us, nextNo(), exportCfg())));
    store.markExported(us.map((u) => u.id), 'clip-' + new Date().toISOString());
    return { count: us.length, firstUnit: nextNo() };
  });
  ipcMain.handle('export:file', async (_e, all) => {
    const us = pick(all);
    if (!us.length) return { count: 0 };
    const name = 'QC_' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.csv';
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { count: 0, canceled: true };
    fs.writeFileSync(r.filePath, X.toCSV(X.rows(us, nextNo(), exportCfg()), exportCfg(), true));
    store.markExported(us.map((u) => u.id), 'file-' + path.basename(r.filePath));
    return { count: us.length, file: r.filePath };
  });

  ipcMain.handle('print:sheet', () => new Promise((resolve) => win.webContents.print({ printBackground: true }, (ok) => resolve(ok))));
  ipcMain.handle('print:pdf', async (_e, name) => {
    const file = path.join(app.getPath('documents'), String(name || 'sheet').replace(/[^\w.-]+/g, '_') + '.pdf');
    fs.writeFileSync(file, await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
    return file;
  });
  ipcMain.handle('shell:show', (_e, file) => { shell.showItemInFolder(String(file)); return true; });
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('appData'), 'QC Scan'));
  register();
  createWindow();
  setupUpdater(app, send, ipcMain, () => store.settings().updateToken);
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
