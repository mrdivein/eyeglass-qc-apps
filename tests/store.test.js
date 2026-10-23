const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const X = require('../src/main/export');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qcscan-'));
const rec = (id, t, extra) => Object.assign({ id, shipment: 'LOT-1', upc: '100000000001', serial: '', result: 'PASS', note: '', condition: 'OK', location: 'LOC-01', operator: 'op1', savedAt: t }, extra);

test('units survive reopening the store (an update only replaces the program folder)', () => {
  const dir = tmp();
  const a = new Store(dir); a.saveUnit(rec('1', '2026-10-23T03:00:00.000Z')); a.saveUnit(rec('2', '2026-10-23T03:01:00.000Z'));
  const b = new Store(dir);
  assert.deepStrictEqual(b.units().map((u) => u.id), ['1', '2']);
});

test('void and export markers fold into the records; a torn last line is ignored', () => {
  const dir = tmp(); const s = new Store(dir);
  s.saveUnit(rec('1', '2026-10-23T03:00:00.000Z')); s.saveUnit(rec('2', '2026-10-23T03:01:00.000Z'));
  s.voidUnit('1'); s.markExported(['2'], 'b1');
  fs.appendFileSync(path.join(dir, 'records.jsonl'), '{"op":"save","rec":{"id":"3"');
  const u = s.units();
  assert.deepStrictEqual(u.map((x) => [x.id, !!x.voided, x.exportedBatch || '']), [['1', true, ''], ['2', false, 'b1']]);
});

test('settings merge and persist', () => {
  const dir = tmp(); const s = new Store(dir);
  s.saveSettings({ apiUrl: 'https://x' }); s.saveSettings({ operator: 'thien' });
  assert.deepStrictEqual(new Store(dir).settings(), { apiUrl: 'https://x', apiKey: '', operator: 'thien', updateToken: '' });
});

test('export rows follow the configured columns and skip voided units', () => {
  const us = [rec('2', '2026-10-23T03:01:00.000Z', { result: 'ISSUE', condition: 'HOLD', note: 'Scratch: Lens', serial: 'S1' }),
    rec('1', '2026-10-23T03:00:00.000Z'), rec('3', '2026-10-23T03:02:00.000Z', { voided: true })];
  const cfg = { idPrefix: 'R-', idWidth: 6, columns: [{ head: 'a', field: 'id' }, { head: 'b', field: 'date' }, { head: 'c', field: 'shipment' }, { head: 'd', field: 'upc' },
    { head: 'e', field: 'serial' }, { head: 'f', field: 'result' }, { head: 'g', field: 'note' }, { head: 'h', field: 'condition' }, { head: 'i', field: 'location' }, { head: 'j', field: 'operator' }] };
  const r = X.rows(us, 1234, cfg);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0][0], 'R-001234');
  assert.strictEqual(r[1][0], 'R-001235');
  assert.deepStrictEqual(r[1].slice(2), ['LOT-1', '100000000001', 'S1', 'ISSUE', 'Scratch: Lens', 'HOLD', 'LOC-01', 'op1']);
  assert.match(r[0][1], /^\d{2}\/\d{2}\/2026$/);
  assert.strictEqual(X.toTSV(r).split('\n').length, 2);
  assert.match(X.toCSV(r, cfg, true), /^\ufeffa,b,c,d/);
});

test('export without a config falls back to generic columns; unknown fields are dropped', () => {
  const r = X.rows([rec('1', '2026-10-23T03:00:00.000Z')], 0, { columns: [{ head: 'x', field: 'nope' }, { head: 'y', field: 'upc' }] });
  assert.deepStrictEqual(r, [['100000000001']]);
  assert.strictEqual(X.rows([rec('1', '2026-10-23T03:00:00.000Z')], 0)[0].length, X.FIELDS.length);
});

test('draft survives reopening the store and is replaced atomically', () => {
  const dir = tmp(); const s = new Store(dir);
  assert.strictEqual(s.draft(), null);
  s.saveDraft({ shipmentId: 'LOT-1', unit: null }); s.saveDraft({ shipmentId: 'LOT-1', unit: { upc: '1' } });
  assert.deepStrictEqual(new Store(dir).draft(), { shipmentId: 'LOT-1', unit: { upc: '1' } });
  assert.strictEqual(fs.existsSync(path.join(dir, 'draft.json.tmp')), false);
});

test('scan log is written line by line into a file per day', () => {
  const dir = tmp(); const s = new Store(dir);
  const t = new Date(2026, 9, 23, 10, 0, 0).getTime();
  s.logScan({ t, token: 'A', screen: 'SCAN' }); s.logScan({ t: t + 1000, token: 'B', screen: 'UNIT' });
  s.logScan({ t: t + 86400000, token: 'C', screen: 'SCAN' });
  const files = fs.readdirSync(path.join(dir, 'logs')).sort();
  assert.deepStrictEqual(files, ['scans-2026-10-23.jsonl', 'scans-2026-10-24.jsonl']);
  const lines = fs.readFileSync(path.join(dir, 'logs', files[0]), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepStrictEqual(lines.map((l) => l.token), ['A', 'B']);
});

test('an edit survives reopening the store and marks the record as edited', () => {
  const dir = tmp(); const a = new Store(dir);
  a.saveUnit(rec('1', '2026-10-23T03:00:00.000Z'));
  a.editUnit('1', { location: 'LOC-09', serial: 'SN7' });
  const u = new Store(dir).units()[0];
  assert.equal(u.location, 'LOC-09'); assert.equal(u.serial, 'SN7'); assert.equal(u.edited, true);
});
