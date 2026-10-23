/* Local data in the user-data folder (%APPDATA%\QC Scan on Windows), which an update never touches.
 *  records.jsonl  append-only log of QC saves (one line per event), safe against a crash mid-write
 *  settings.json, cache.json  small files replaced atomically */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.unitsFile = path.join(dir, 'records.jsonl');
  }

  readJson(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')); } catch (e) { return fallback; }
  }
  writeJson(name, obj) {
    const f = path.join(this.dir, name), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, f);
  }

  settings() { return Object.assign({ apiUrl: '', apiKey: '', operator: '', updateToken: '' }, this.readJson('settings.json', {})); }
  saveSettings(s) { const cur = this.settings(); this.writeJson('settings.json', Object.assign(cur, s)); return this.settings(); }
  cache() { return this.readJson('cache.json', null); }
  saveCache(c) { this.writeJson('cache.json', c); }

  append(ev) { fs.appendFileSync(this.unitsFile, JSON.stringify(ev) + '\n'); }
  saveUnit(rec) { this.append({ op: 'save', rec: rec }); }
  voidUnit(id) { this.append({ op: 'void', id: id, at: new Date().toISOString() }); }
  markExported(ids, batch) { this.append({ op: 'exported', ids: ids, batch: batch, at: new Date().toISOString() }); }

  /** Fold the log into current records: voided ones are marked, exported ones carry their batch name. */
  units() {
    let text = '';
    try { text = fs.readFileSync(this.unitsFile, 'utf8'); } catch (e) { return []; }
    const byId = {}, order = [];
    text.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      let ev; try { ev = JSON.parse(line); } catch (e) { return; }   // a half-written last line is skipped
      if (ev.op === 'save' && ev.rec && !byId[ev.rec.id]) { byId[ev.rec.id] = Object.assign({}, ev.rec); order.push(ev.rec.id); }
      else if (ev.op === 'void' && byId[ev.id]) byId[ev.id].voided = true;
      else if (ev.op === 'exported') (ev.ids || []).forEach(function (id) { if (byId[id]) byId[id].exportedBatch = ev.batch; });
    });
    return order.map(function (id) { return byId[id]; });
  }
}

module.exports = { Store };
