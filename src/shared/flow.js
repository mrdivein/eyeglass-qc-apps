/* QC scan flow: one class, no DOM, no I/O. Every scan goes through scan(token); the UI only renders `state`. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codes'));
  else root.QCFlow = factory(root.QCCodes);
})(typeof self !== 'undefined' ? self : this, function (Codes) {
  const normUpc = function (s) { return String(s || '').replace(/\D/g, '').replace(/^0+/, ''); };
  const DEFAULT_VALUES = { PASS: { result: 'PASS', condition: 'OK' }, POLISH: { result: 'ISSUE', condition: 'HOLD' }, DEFECT: { result: 'ISSUE', condition: 'DEFECT' } };
  const isUpcLike = function (s) { return /^\d{8,14}$/.test(String(s).trim()); };

  class Flow {
    /**
     * data:   { shipments: [{ id, name, status, lines: [{ upc, sku, brand, model, color, type, image, qty, received }] }], locations: [] }
     * saved:  saved unit records (to restore counters and S/N duplicate checks)
     * hooks:  { save(rec), operator, values: { PASS|POLISH|DEFECT: { result, condition } } }
     */
    constructor(data, saved, hooks) {
      this.data = data || { shipments: [], locations: [] };
      this.hooks = hooks || {};
      this.saved = (saved || []).filter(function (u) { return !u.voided; });
      this.state = { screen: 'HOME', shipmentId: null, location: '', unit: null, pendingBack: false, message: null };
    }

    /* ---------- lookups ---------- */
    shipment(id) { return this.data.shipments.filter(function (s) { return s.id === id; })[0] || null; }
    get current() { return this.shipment(this.state.shipmentId); }
    findLine(upc) {
      const s = this.current, n = normUpc(upc);
      return s ? s.lines.filter(function (l) { return normUpc(l.upc) === n; })[0] || null : null;
    }
    savedCount(shipmentId, upc) {
      const n = normUpc(upc);
      return this.saved.filter(function (u) { return u.shipment === shipmentId && normUpc(u.upc) === n; }).length;
    }
    /** Pieces already counted for a line: already recorded on the server (from the sync) plus saved in this app. */
    done(line) { return (line.received || 0) + this.savedCount(this.state.shipmentId, line.upc); }
    shipmentProgress(s) {
      const self = this;
      let qty = 0, done = 0;
      s.lines.forEach(function (l) { qty += l.qty; done += (l.received || 0) + self.savedCount(s.id, l.upc); });
      return { qty: qty, done: done };
    }
    knownLocation(tok) {
      const t = String(tok).trim().toUpperCase();
      return this.data.locations.filter(function (l) { return String(l).toUpperCase() === t; })[0] || null;
    }

    /* ---------- state helpers ---------- */
    msg(kind, text) { this.state.message = { kind: kind, text: text }; return this.state.message; }
    setData(data) { this.data = data; if (this.state.shipmentId && !this.current) this.home(); }
    home() { Object.assign(this.state, { screen: 'HOME', shipmentId: null, unit: null, pendingBack: false }); this.state.message = null; }
    openShipment(id) {
      if (!this.shipment(id)) return this.msg('err', 'Shipment not found');
      Object.assign(this.state, { screen: 'SCAN', shipmentId: id, unit: null, pendingBack: false });
      return this.msg('info', 'Scan UPC');
    }
    unitTouched() { const u = this.state.unit; return !!u && (u.serial !== '' || u.defects.length > 0 || !!u.verdict); }

    openUnit(line) {
      this.state.unit = { upc: line.upc, line: line, serial: '', defects: [], verdict: null };
      this.state.screen = 'UNIT';
      this.state.pendingBack = false;
      const d = this.done(line);
      if (d >= line.qty) return this.msg('warn', 'Already ' + d + '/' + line.qty + ' counted - this one is over the invoice');
      return this.msg('info', 'Scan S/N, defects, then SAVE');
    }

    /* ---------- the one entry point ---------- */
    scan(token) {
      const tok = String(token == null ? '' : token).trim();
      if (!tok) return null;
      const st = this.state;
      if (st.screen === 'HOME') return this.msg('warn', 'Pick a shipment first');

      const p = Codes.parse(tok);
      if (p) {
        if (p.type === 'command') return this.command(p.cmd);
        if (p.type === 'verdict') return this.verdict(p.verdict);
        if (p.type === 'defect') return this.defect(p);
        if (p.type === 'location') return this.setLocation(p.location);
        return this.msg('err', 'Unknown code ' + p.raw);
      }
      const loc = this.knownLocation(tok);
      if (loc) return this.setLocation(loc);

      if (isUpcLike(tok)) {
        const line = this.findLine(tok);
        if (line) {
          if (st.screen === 'SCAN' || !this.unitTouched()) return this.openUnit(line);
          return this.msg('err', 'Unsaved unit - SAVE or REDO first');
        }
        if (st.screen === 'SCAN') return this.msg('err', 'UPC ' + tok + ' is not in ' + this.current.id);
      }
      if (st.screen === 'SCAN') return this.msg('err', 'Unknown code ' + tok);
      return this.serial(tok);
    }

    serial(tok) {
      const st = this.state;
      const dup = this.saved.filter(function (u) { return u.serial && u.serial === tok; })[0];
      if (dup) return this.msg('err', 'S/N ' + tok + ' already saved (' + dup.shipment + ')');
      st.unit.serial = tok;
      st.pendingBack = false;
      return this.msg('ok', 'S/N ' + tok);
    }

    defect(p) {
      const st = this.state;
      if (st.screen !== 'UNIT') return this.msg('warn', 'Scan a UPC first');
      const label = Codes.areaByKey(p.area).label + ': ' + p.defect;
      const i = st.unit.defects.findIndex(function (d) { return d.area === p.area && d.defect === p.defect; });
      st.pendingBack = false;
      if (i >= 0) { st.unit.defects.splice(i, 1); return this.msg('info', 'Removed ' + label); }
      st.unit.defects.push({ area: p.area, defect: p.defect });
      return this.msg('ok', label);
    }

    verdict(v) {
      const st = this.state;
      if (st.screen !== 'UNIT') return this.msg('warn', 'Scan a UPC first');
      st.unit.verdict = v; st.pendingBack = false;
      return this.msg(v === 'PASS' ? 'ok' : 'warn', Codes.verdictByKey(v).label);
    }

    setLocation(loc) {
      this.state.location = String(loc).toUpperCase();
      if (!this.knownLocation(this.state.location)) {
        return this.msg('warn', 'Location ' + this.state.location + ' is not in the location list');
      }
      return this.msg('ok', 'Location ' + this.state.location);
    }

    command(cmd) {
      const st = this.state;
      if (cmd === 'SAVE') return this.save();
      if (cmd === 'REDO') {
        if (st.screen !== 'UNIT') return this.msg('warn', 'Nothing to redo');
        st.unit.serial = ''; st.unit.defects = []; st.unit.verdict = null; st.pendingBack = false;
        return this.msg('info', 'Unit cleared');
      }
      if (cmd === 'UNDO') {
        if (st.screen !== 'UNIT') return this.msg('warn', 'Nothing to undo');
        if (st.unit.verdict) { st.unit.verdict = null; return this.msg('info', 'Verdict cleared'); }
        if (st.unit.defects.length) { const d = st.unit.defects.pop(); return this.msg('info', 'Removed ' + Codes.areaByKey(d.area).label + ': ' + d.defect); }
        if (st.unit.serial) { st.unit.serial = ''; return this.msg('info', 'S/N cleared'); }
        return this.msg('warn', 'Nothing to undo');
      }
      if (cmd === 'BACK') {
        if (st.screen === 'UNIT') {
          if (this.unitTouched() && !st.pendingBack) { st.pendingBack = true; return this.msg('warn', 'Unsaved - BACK again to discard'); }
          st.unit = null; st.screen = 'SCAN'; st.pendingBack = false;
          return this.msg('info', 'Scan UPC');
        }
        this.home();
        return this.msg('info', 'Pick a shipment');
      }
      return this.msg('err', 'Unknown command ' + cmd);
    }

    save() {
      const st = this.state;
      if (st.screen !== 'UNIT') return this.msg('warn', 'Scan a UPC first');
      if (!st.location) return this.msg('err', 'Scan a location before SAVE');
      const u = st.unit;
      if (!u.verdict && u.defects.length) return this.msg('err', 'Scan the verdict: PASS, NEED POLISH or DEFECT');
      const verdict = u.verdict || 'PASS';
      const v = (this.hooks.values && this.hooks.values[verdict]) || DEFAULT_VALUES[verdict];
      const rec = {
        id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        shipment: st.shipmentId,
        upc: u.upc,
        sku: u.line.sku,
        serial: u.serial,
        defects: u.defects.slice(),
        note: Codes.noteText(u.defects),
        verdict: verdict,
        result: v.result,
        condition: v.condition,
        location: st.location,
        operator: this.hooks.operator || '',
        savedAt: new Date().toISOString()
      };
      this.saved.push(rec);
      if (this.hooks.save) this.hooks.save(rec);
      st.unit = null; st.screen = 'SCAN'; st.pendingBack = false;
      return this.msg('ok', 'Saved ' + u.line.model + ' (' + Codes.verdictByKey(verdict).label.toUpperCase() + ')');
    }

    /** Unfinished work as plain data (written to disk after every scan so a power cut loses nothing). */
    snapshot() {
      const st = this.state, u = st.unit;
      return {
        shipmentId: st.shipmentId, location: st.location,
        unit: u ? { upc: u.upc, serial: u.serial, defects: u.defects.slice(), verdict: u.verdict || null } : null
      };
    }

    /** Put the app back where a snapshot left it. Returns true when something was restored. */
    restore(snap) {
      if (!snap || !snap.shipmentId || !this.shipment(snap.shipmentId)) return false;
      this.state.location = snap.location || '';
      this.openShipment(snap.shipmentId);
      const line = snap.unit && this.findLine(snap.unit.upc);
      if (line) {
        this.state.unit = { upc: line.upc, line: line, serial: snap.unit.serial || '', verdict: snap.unit.verdict || null, defects: (snap.unit.defects || []).filter(function (d) { return Codes.areaByKey(d.area); }) };
        this.state.screen = 'UNIT';
        this.msg('warn', 'Restored your unfinished unit - SAVE or REDO');
      } else {
        this.msg('info', 'Restored ' + snap.shipmentId);
      }
      return true;
    }

    /** Remove a saved unit (UI action, e.g. wrong scan). */
    voidSaved(id) {
      const i = this.saved.findIndex(function (u) { return u.id === id; });
      if (i >= 0) this.saved.splice(i, 1);
    }
  }

  return { Flow: Flow, normUpc: normUpc };
});
