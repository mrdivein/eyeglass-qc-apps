(function () {
  const api = window.qcApi;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Codes = window.QCCodes, Code128 = window.QCCode128;

  let flow = null, settings = {}, view = 'flow', showClosed = false, sheetTab = 'defects', hiddenShelves = loadHidden(), logAll = false, updateState = null, manualCheck = false;
  const lastScans = [];

  /* ---------- feedback ---------- */
  let ac = null;
  function tone(freq, ms, delay) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + (delay || 0);
      o.frequency.value = freq; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
      o.start(t); o.stop(t + ms / 1000);
    } catch (e) { /* no audio device */ }
  }
  const SOUND = { ok: () => tone(1000, 90), info: () => tone(700, 60), warn: () => { tone(500, 90); tone(500, 90, 0.14); }, err: () => tone(180, 350) };

  function showMsg(m) {
    if (!m) return;
    const el = $('msg');
    el.className = 'msg ' + m.kind; el.textContent = m.text;
    (SOUND[m.kind] || SOUND.info)();
  }
  function setMsg(kind, text) { showMsg({ kind: kind, text: text }); }

  /* ---------- data ---------- */
  function emptyData() { return { shipments: [], locations: [], nextId: 0 }; }
  async function load() {
    settings = await api.getSettings();
    const data = (await api.cached()) || emptyData();
    applyConfig(data);
    flow = new window.QCFlow.Flow(data, await api.units(), {
      operator: settings.operator,
      values: data.config && data.config.values,
      save: (rec) => { api.saveUnit(rec); }
    });
    api.onUpdate((s) => { updateState = s; renderUpdate(); });
    try { if (flow.restore(await api.getDraft())) showMsg(flow.state.message); } catch (e) { /* no usable draft */ }
    render();
    if (!settings.apiUrl || !settings.apiKey) { settingsDialog(); } else sync(true);
  }

  function applyConfig(data) { if (data && data.config) Codes.configure(data.config); }

  async function sync(quiet) {
    $('syncInfo').textContent = 'Syncing...';
    const r = await api.sync();
    if (r.data) { applyConfig(r.data); flow.setData(r.data); flow.hooks.operator = settings.operator; flow.hooks.values = r.data.config && r.data.config.values; }
    if (r.ok) { if (!quiet) setMsg('ok', 'Synced ' + r.data.shipments.length + ' shipments'); }
    else setMsg('warn', 'Offline - using saved data. ' + r.error);
    render();
  }

  /* ---------- scan input ---------- */
  function onScan(tok) {
    const st = flow.state;
    const before = st.screen;
    const m = flow.scan(tok);
    api.logScan({ t: Date.now(), token: tok, screen: before, shipment: flow.state.shipmentId, kind: m ? m.kind : '', text: m ? m.text : '' }).catch(() => {});
    lastScans.unshift({ tok: tok, kind: m ? m.kind : 'info', t: new Date() });
    lastScans.length = Math.min(lastScans.length, 8);
    showMsg(m);
    if (view !== 'flow') view = 'flow';
    render();
    return before;
  }
  $('scan').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value; e.target.value = '';
    if (!v.trim()) return;
    onScan(v);
  });
  function keepFocus() {
    if ($('dlg').open) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA') && a !== $('scan')) return;
    $('scan').focus();
  }
  document.addEventListener('click', () => setTimeout(keepFocus, 0));
  setInterval(keepFocus, 1500);

  /* ---------- render ---------- */
  let lastDraft = '';
  function persistDraft() {
    const d = JSON.stringify(flow.snapshot());
    if (d !== lastDraft) { lastDraft = d; api.setDraft(JSON.parse(d)).catch(() => {}); }
  }

  function render() {
    persistDraft();
    const st = flow.state;
    $('crumbs').textContent = st.shipmentId ? (flow.current.name || st.shipmentId) : '';
    const lp = $('locPill');
    lp.hidden = !st.shipmentId;
    lp.textContent = st.location ? 'Location ' + st.location : 'No location';
    lp.className = 'pill' + (st.location ? '' : ' bad');
    const c = flow.data.syncedAt;
    $('syncInfo').textContent = c ? 'Synced ' + new Date(c).toLocaleString() : 'Not synced';
    renderUpdate();
    const v = $('view');
    if (view === 'sheets') v.innerHTML = sheetsHtml();
    else if (view === 'log') v.innerHTML = logHtml();
    else if (st.screen === 'HOME') v.innerHTML = homeHtml();
    else if (st.screen === 'SCAN') v.innerHTML = scanHtml();
    else v.innerHTML = unitHtml();
    bind();
    const m = flow.state.message;
    if (m && !$('msg').dataset.keep) { $('msg').className = 'msg ' + m.kind; $('msg').textContent = m.text; }
  }

  function renderUpdate() {
    const b = $('updateBar');
    const quiet = !updateState || ['current', 'checking', 'dev'].indexOf(updateState.state) >= 0;
    if (quiet && !(manualCheck && updateState)) { b.hidden = true; return; }
    if (quiet && updateState.state === 'current') setTimeout(() => { manualCheck = false; renderUpdate(); }, 6000);
    b.hidden = false;
    b.className = updateState.state === 'ready' ? 'ready' : '';
    b.innerHTML = esc(updateState.state === 'current' ? 'You have the latest version (' + (window.__ver || '') + ')' : updateState.text) + (updateState.state === 'ready' ? ' <button id="btnRestart">Restart now</button>' : '');
    const r = $('btnRestart');
    if (r) r.onclick = () => api.installUpdate();
  }

  const pct = (p) => p.qty ? Math.min(100, Math.round(p.done / p.qty * 100)) : 0;

  function homeHtml() {
    const ships = flow.data.shipments.filter((s) => showClosed || s.status !== 'CLOSED');
    const cards = ships.map((s) => {
      const p = flow.shipmentProgress(s);
      return '<div class="card ship" data-ship="' + esc(s.id) + '"><h3>' + esc(s.name || s.id) + '</h3>' +
        '<span class="tag">' + esc(s.status) + '</span> <span class="muted">' + esc(s.id) + '</span>' +
        '<div class="bar"><i style="width:' + pct(p) + '%"></i></div>' +
        '<div><b>' + p.done + '</b> / ' + p.qty + ' pcs</div></div>';
    }).join('');
    return '<div class="toolbar"><button id="btnSync" class="primary">Sync</button>' +
      '<label><input type="checkbox" id="chkClosed"' + (showClosed ? ' checked' : '') + '> Show closed</label>' +
      '<span class="grow"></span><span class="muted">v' + esc(window.__ver || '') + '</span></div>' +
      '<div class="grid ships">' + (cards || '<div class="muted">No shipments. Press Sync.</div>') + '</div>';
  }

  function scanHtml() {
    const s = flow.current;
    const rows = s.lines.map((l) => {
      const d = flow.done(l), cls = d > l.qty ? 'over' : (d === l.qty ? 'done' : '');
      return '<tr class="' + cls + '"><td>' + esc(l.brand) + '</td><td>' + esc(l.model) + '</td><td>' + esc(l.color) + '</td><td>' + esc(l.type) +
        '</td><td>' + esc(l.upc) + '</td><td class="num">' + d + ' / ' + l.qty + '</td></tr>';
    }).join('');
    const recent = lastScans.map((x) => '<span class="tag">' + esc(x.tok) + '</span>').join(' ');
    const p = flow.shipmentProgress(s);
    return '<div class="scanbig"><div class="big">Scan UPC</div><div class="muted">' + p.done + ' / ' + p.qty + ' pcs</div><div class="locrow">Location ' + locPickHtml() + '</div></div>' +
      '<div class="card" style="padding:0"><table><thead><tr><th>Brand</th><th>Model</th><th>Color</th><th>Type</th><th>UPC</th><th class="num">Checked</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* Manual alternative to scanning a location: a list grouped by shelf. */
  function locPickHtml() {
    const cur = flow.state.location;
    const groups = {};
    flow.data.locations.forEach((l) => { (groups[Codes.shelfOf(l)] = groups[Codes.shelfOf(l)] || []).push(l); });
    const opts = Object.keys(groups).sort().map((g) => '<optgroup label="' + esc(g) + '">' + groups[g].map((l) => '<option' + (l.toUpperCase() === cur ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</optgroup>').join('');
    return '<select id="locPick" class="locpick"><option value=""' + (cur ? '' : ' selected') + '>Pick location</option>' + opts + '</select>';
  }

  function unitHtml() {
    const u = flow.state.unit, l = u.line;
    const d = flow.done(l), over = d >= l.qty;
    const areas = Codes.AREAS.map((a) => {
      const hits = u.defects.filter((x) => x.area === a.key);
      return '<div class="area' + (hits.length ? ' hit' : '') + '"><b>' + esc(a.label) + '</b>' + hits.map((h) => '<span>' + esc(h.defect) + '</span>').join('') + '</div>';
    }).join('');
    const needVerdict = !u.verdict && u.defects.length > 0;
    const verdicts = Codes.VERDICTS.map((v) => '<button class="verdict ' + v.key.toLowerCase() + (u.verdict === v.key ? ' on' : '') + '" data-verdict="' + v.key + '">' + esc(v.label) + '</button>').join('');
    return '<div class="unit"><div class="card prod">' + (l.image ? '<img src="' + esc(l.image) + '" alt="" onerror="this.remove()">' : '') +
      '<div class="brand2">' + esc(l.brand) + '</div><div class="model">' + esc(l.model) + '</div>' +
      '<dl><dt>SKU</dt><dd>' + esc(l.sku) + '</dd><dt>Color</dt><dd>' + esc(l.color) + '</dd><dt>Type</dt><dd>' + esc(l.type) + '</dd><dt>UPC</dt><dd>' + esc(l.upc) + '</dd></dl>' +
      '<div class="count' + (over ? ' over' : '') + '">Checked ' + d + ' / ' + l.qty + '</div></div>' +
      '<div class="card"><div class="field"><label>S/N</label><div class="val' + (u.serial ? '' : ' empty') + '">' + esc(u.serial || 'scan S/N') + '</div></div>' +
      '<div class="field"><label>Location</label><div class="val' + (flow.state.location ? '' : ' empty') + '">' + esc(flow.state.location || 'scan location') + '</div>' + locPickHtml() + '</div>' +
      '<div class="areas">' + areas + '</div>' +
      '<div class="verdicts' + (needVerdict ? ' need' : '') + '">' + verdicts + '</div>' +
      '<div class="btns"><button class="primary" data-cmd="SAVE">Save</button><button data-cmd="BACK">Back</button><button data-cmd="REDO">Redo</button><button data-cmd="UNDO">Undo</button></div></div></div>';
  }

  /* ---------- saved units ---------- */
  function logHtml() {
    const us = flow.saved.slice().reverse().filter((u) => logAll || !u.exportedBatch);
    const rows = us.map((u) => '<tr><td>' + esc(new Date(u.savedAt).toLocaleString()) + '</td><td>' + esc(u.shipment) + '</td><td>' + esc(u.upc) + '</td><td>' + esc(u.sku) +
      '</td><td>' + esc(u.serial) + '</td><td>' + esc(u.verdict || u.result) + '</td><td>' + esc(u.note) + '</td><td>' + esc(u.location) +
      '</td><td>' + (u.exportedBatch ? 'exported' : '') + '</td><td><button class="danger" data-void="' + esc(u.id) + '">Delete</button></td></tr>').join('');
    return '<div class="toolbar"><button id="btnCopy" class="primary">Copy rows</button><button id="btnFile">Save CSV</button>' +
      '<label><input type="checkbox" id="chkAll"' + (logAll ? ' checked' : '') + '> Include exported</label>' +
      '<span class="grow"></span><span class="muted">' + flow.saved.length + ' saved</span></div>' +
      '<div class="card" style="padding:0"><table><thead><tr><th>Time</th><th>Shipment</th><th>UPC</th><th>SKU</th><th>S/N</th><th>Result</th><th>Defects</th><th>Location</th><th></th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="10" class="muted">Nothing saved yet</td></tr>') + '</tbody></table></div>';
  }

  /* ---------- printable code sheets (barcodes only, no instruction text) ---------- */
  function codeCell(label, text) { return '<div class="code"><div class="lab">' + esc(label) + '</div>' + Code128.svg(text, { module: 4, height: 110 }) + '</div>'; }
  function areaSection(sec) {
    return '<h2>' + esc(sec.area.label) + '</h2><div class="codes">' + sec.items.map((d) => codeCell(d, Codes.defectCode(sec.area.key, d))).join('') + '</div>';
  }
  /* One code per row, as large as the page allows. A page holds PAGE_BUDGET units: a code costs 1, an area heading 0.5; an area continues on the next page. */
  const PAGE_BUDGET = 5.5;
  function defectPages() {
    const pages = [[]];
    let used = 0;
    Codes.AREAS.forEach((a) => {
      let left = Codes.DEFECTS[a.key].slice();
      while (left.length) {
        let room = Math.floor(PAGE_BUDGET - used - 0.5);
        if (room < 1) { pages.push([]); used = 0; room = Math.floor(PAGE_BUDGET - 0.5); }
        const take = left.splice(0, room);
        pages[pages.length - 1].push({ area: a, items: take });
        used += 0.5 + take.length;
      }
    });
    return pages;
  }
  function sheetsHtml() {
    const tabs = ['defects', 'commands', 'locations'].map((t) => '<button data-sheet="' + t + '" class="' + (sheetTab === t ? 'on' : '') + '">' + t[0].toUpperCase() + t.slice(1) + '</button>').join('');
    let body = '', picker = '';
    if (sheetTab === 'defects') {
      const pages = defectPages();
      body = pages.map((pg, i) => '<div class="sheet' + (i < pages.length - 1 ? ' page-break' : '') + '"><h1>QC defects</h1>' + pg.map(areaSection).join('') + '</div>').join('');
    } else if (sheetTab === 'commands') {
      body = '<div class="sheet page-break"><h1>QC commands</h1><div class="codes cmd">' + Codes.COMMANDS.map((c) => codeCell(c.label.toUpperCase(), Codes.commandCode(c.key))).join('') + '</div></div>' +
        '<div class="sheet"><h1>QC verdict</h1><div class="codes cmd">' + Codes.VERDICTS.map((v) => codeCell(v.label.toUpperCase(), Codes.commandCode(v.key))).join('') + '</div></div>';
    } else {
      const shelves = shelfList();
      const locs = flow.data.locations.filter((l) => !hiddenShelves.has(Codes.shelfOf(l)));
      const per = 8, pages = [];
      for (let i = 0; i < locs.length; i += per) pages.push(locs.slice(i, i + per));
      picker = '<div class="toolbar">' + shelves.map((sh) => '<label><input type="checkbox" data-shelf="' + esc(sh) + '"' + (hiddenShelves.has(sh) ? '' : ' checked') + '> ' + esc(sh) + '</label>').join('') +
        '<button data-shelves="all">All</button><button data-shelves="none">None</button><span class="muted">' + locs.length + ' codes</span></div>';
      body = pages.map((pg, i) => '<div class="sheet' + (i < pages.length - 1 ? ' page-break' : '') + '"><h1>Locations</h1><div class="codes two">' +
        pg.map((l) => codeCell(l, Codes.locationCode(l))).join('') + '</div></div>').join('') || '<div class="muted">No locations. Press Sync.</div>';
    }
    return '<div class="tabs">' + tabs + '<span class="grow"></span><button id="btnPrint" class="primary">Print</button><button id="btnPdf">Save PDF</button></div>' + picker + body;
  }
  function shelfList() { return Array.from(new Set(flow.data.locations.map(Codes.shelfOf))).sort(); }
  function loadHidden() { try { return new Set(JSON.parse(localStorage.getItem('hiddenShelves') || '[]')); } catch (e) { return new Set(); } }
  function saveHidden() { try { localStorage.setItem('hiddenShelves', JSON.stringify(Array.from(hiddenShelves))); } catch (e) { /* storage unavailable */ } }

  /* ---------- settings ---------- */
  async function settingsDialog() {
    const info = await api.info();
    window.__ver = info.version;
    const d = $('dlg');
    d.innerHTML = '<h2>Settings</h2><label>Data URL</label><input type="text" id="sUrl" value="' + esc(settings.apiUrl) + '">' +
      '<label>Data key</label><input type="password" id="sKey" value="' + esc(settings.apiKey) + '">' +
      '<label>Operator</label><input type="text" id="sOp" value="' + esc(settings.operator) + '">' +
      '<label>Update token (private repo only)</label><input type="password" id="sTok" value="' + esc(settings.updateToken) + '">' +
      '<p class="muted">Version ' + esc(info.version) + ' &middot; data folder ' + esc(info.dataDir) + '</p>' +
      '<div class="row"><button id="sUpd">Check for updates</button><span class="grow"></span><button id="sCancel">Cancel</button><button id="sSave" class="primary">Save</button></div>';
    d.showModal();
    $('sCancel').onclick = () => { d.close(); keepFocus(); };
    $('sUpd').onclick = async () => { manualCheck = true; updateState = { state: 'checking', text: 'Checking for updates' }; d.close(); renderUpdate(); await api.checkUpdate(); };
    $('sSave').onclick = async () => {
      settings = await api.setSettings({ apiUrl: $('sUrl').value, apiKey: $('sKey').value, operator: $('sOp').value, updateToken: $('sTok').value });
      flow.hooks.operator = settings.operator;
      d.close(); keepFocus(); sync(false);
    };
  }

  /* ---------- buttons ---------- */
  function bind() {
    const q = (sel, fn) => document.querySelectorAll(sel).forEach((el) => { el.onclick = () => fn(el); });
    q('[data-ship]', (el) => { showMsg(flow.openShipment(el.dataset.ship)); render(); });
    q('[data-cmd]', (el) => { onScan(Codes.commandCode(el.dataset.cmd)); });
    q('[data-verdict]', (el) => { onScan(Codes.commandCode(el.dataset.verdict)); });
    const lp = $('locPick');
    if (lp) lp.onchange = () => { const v = lp.value; lp.blur(); if (v) onScan(Codes.locationCode(v)); setTimeout(keepFocus, 0); };
    q('[data-sheet]', (el) => { sheetTab = el.dataset.sheet; render(); });
    q('[data-shelf]', (el) => { if (el.checked) hiddenShelves.delete(el.dataset.shelf); else hiddenShelves.add(el.dataset.shelf); saveHidden(); render(); });
    q('[data-shelves]', (el) => { hiddenShelves = el.dataset.shelves === 'all' ? new Set() : new Set(shelfList()); saveHidden(); render(); });
    q('[data-void]', async (el) => {
      if (!window.confirm('Delete this saved unit?')) return;
      await api.voidUnit(el.dataset.void); flow.voidSaved(el.dataset.void); flow.saved = flow.saved.filter((u) => u.id !== el.dataset.void); render();
    });
    const b = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    b('btnSync', () => sync(false));
    b('btnPrint', () => api.printSheet());
    b('btnPdf', async () => { const f = await api.printPdf('QC_' + sheetTab); setMsg('ok', 'Saved ' + f); api.showFile(f); });
    b('btnCopy', async () => { const r = await api.exportCopy(logAll); setMsg(r.count ? 'ok' : 'warn', r.count ? r.count + ' rows copied. Paste them into the sheet' : 'Nothing to export'); await refreshSaved(); });
    b('btnFile', async () => { const r = await api.exportFile(logAll); if (r.count) setMsg('ok', r.count + ' rows saved'); await refreshSaved(); });
    const ck = $('chkClosed'); if (ck) ck.onchange = () => { showClosed = ck.checked; render(); };
    const ca = $('chkAll'); if (ca) ca.onchange = () => { logAll = ca.checked; render(); };
  }
  async function refreshSaved() { flow.saved = (await api.units()).filter((u) => !u.voided); render(); }

  $('btnHome').onclick = () => { view = 'flow'; flow.home(); setMsg('info', 'Pick a shipment'); render(); };
  $('btnLog').onclick = async () => { view = 'log'; await refreshSaved(); };
  $('btnSheets').onclick = () => { view = 'sheets'; render(); };
  $('btnSettings').onclick = settingsDialog;

  load().then(() => api.info().then((i) => { window.__ver = i.version; }));
})();
