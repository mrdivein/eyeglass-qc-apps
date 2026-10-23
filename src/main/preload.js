const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('qcApi', {
  info: call('app:info'),
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  cached: call('data:cached'),
  sync: call('data:sync'),
  logScan: call('log:scan'),
  getDraft: call('draft:get'),
  setDraft: call('draft:set'),
  units: call('units:list'),
  saveUnit: call('units:save'),
  editUnit: call('units:edit'),
  voidUnit: call('units:void'),
  exportCopy: call('export:copy'),
  exportFile: call('export:file'),
  printSheet: call('print:sheet'),
  printPdf: call('print:pdf'),
  showFile: call('shell:show'),
  checkUpdate: call('update:check'),
  installUpdate: call('update:install'),
  onUpdate: (fn) => ipcRenderer.on('update:status', (_e, s) => fn(s))
});
