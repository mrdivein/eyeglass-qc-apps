const test = require('node:test');
const assert = require('node:assert');
const { Flow } = require('../src/shared/flow');
const Codes = require('../src/shared/codes');

const line = (upc, qty, extra) => Object.assign({ upc, sku: 'SKU' + upc, brand: 'ACME', model: 'M' + upc, color: 'Black', type: 'OPTICAL', image: '', qty, received: 0 }, extra);
const data = () => ({
  shipments: [{ id: 'LOT-1', name: 'Lot 1', status: 'DELIVERED', lines: [line('100000000001', 2), line('100000000002', 1)] }],
  locations: ['LOC-01', 'LOC-02']
});
function setup(saved) {
  const out = [];
  const f = new Flow(data(), saved || [], { save: (r) => out.push(r), operator: 'op1' });
  f.openShipment('LOT-1');
  return { f, out };
}
const D = (a, d) => Codes.defectCode(a, d), C = Codes.commandCode;

test('UPC in shipment opens the unit screen, unknown UPC is rejected', () => {
  const { f } = setup();
  assert.strictEqual(f.scan('123456789012').kind, 'err');
  assert.strictEqual(f.state.screen, 'SCAN');
  assert.strictEqual(f.scan('100000000001').kind, 'info');
  assert.strictEqual(f.state.screen, 'UNIT');
  assert.strictEqual(f.state.unit.line.sku, 'SKU100000000001');
});

test('leading zeros on a scanned UPC still match', () => {
  const { f } = setup();
  f.scan('0100000000001');
  assert.strictEqual(f.state.screen, 'UNIT');
});

test('full pass: UPC, S/N, location, SAVE', () => {
  const { f, out } = setup();
  f.scan('100000000001'); f.scan('SN-001'); f.scan('LOC-01');
  const m = f.scan(C('SAVE'));
  assert.strictEqual(m.kind, 'ok');
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual([out[0].result, out[0].condition, out[0].note, out[0].serial, out[0].location, out[0].operator],
    ['PASS', 'OK', '', 'SN-001', 'LOC-01', 'op1']);
  assert.strictEqual(f.state.screen, 'SCAN');
});

test('defects make it ISSUE/HOLD and toggle off when scanned again', () => {
  const { f, out } = setup();
  f.scan('100000000001'); f.scan(D('LENS', 'Scratch')); f.scan(D('TEMPLEL', 'Scratch')); f.scan(D('FRONT', 'Dent'));
  f.scan(D('FRONT', 'Dent'));                       // toggled off
  f.scan(D('TEMPLER', 'Deformation'));
  f.scan('LOC-01'); f.scan(C('POLISH')); f.scan(C('SAVE'));
  assert.strictEqual(out[0].result, 'ISSUE');
  assert.strictEqual(out[0].condition, 'HOLD');
  assert.strictEqual(out[0].note, 'Scratch: Lens, Temple Left; Deformation: Temple Right');
});

test('SAVE without a location is refused; location is remembered for the next unit', () => {
  const { f, out } = setup();
  f.scan('100000000001');
  assert.strictEqual(f.scan(C('SAVE')).kind, 'err');
  assert.strictEqual(out.length, 0);
  f.scan(Codes.locationCode('LOC-02')); f.scan(C('SAVE'));
  f.scan('100000000002'); f.scan(C('SAVE'));
  assert.strictEqual(out[1].location, 'LOC-02');
});

test('REDO clears S/N and defects, UNDO pops the last one', () => {
  const { f } = setup();
  f.scan('100000000001'); f.scan('SN-1'); f.scan(D('LENS', 'Scratch')); f.scan(D('FRONT', 'Dent'));
  f.scan(C('UNDO'));
  assert.strictEqual(f.state.unit.defects.length, 1);
  f.scan(C('REDO'));
  assert.deepStrictEqual([f.state.unit.serial, f.state.unit.defects.length], ['', 0]);
  assert.strictEqual(f.state.screen, 'UNIT');
});

test('BACK needs a second scan to discard a touched unit; goes to SCAN, then HOME', () => {
  const { f, out } = setup();
  f.scan('100000000001'); f.scan(D('LENS', 'Scratch'));
  assert.strictEqual(f.scan(C('BACK')).kind, 'warn');
  assert.strictEqual(f.state.screen, 'UNIT');
  f.scan(C('BACK'));
  assert.strictEqual(f.state.screen, 'SCAN');
  assert.strictEqual(out.length, 0);
  f.scan(C('BACK'));
  assert.strictEqual(f.state.screen, 'HOME');
});

test('an untouched unit goes back immediately and another UPC switches product', () => {
  const { f } = setup();
  f.scan('100000000001'); f.scan('100000000002');
  assert.strictEqual(f.state.unit.line.upc, '100000000002');
  f.scan(C('BACK'));
  assert.strictEqual(f.state.screen, 'SCAN');
});

test('a UPC scanned on a touched unit is refused, not taken as S/N', () => {
  const { f } = setup();
  f.scan('100000000001'); f.scan(D('LENS', 'Scratch'));
  assert.strictEqual(f.scan('100000000002').kind, 'err');
  assert.strictEqual(f.state.unit.line.upc, '100000000001');
});

test('duplicate S/N only warns and is still taken', () => {
  const { f } = setup();
  f.scan('100000000001'); f.scan('SN-1'); f.scan('LOC-01'); f.scan(C('SAVE'));
  f.scan('100000000001');
  const m = f.scan('SN-1');
  assert.strictEqual(m.kind, 'warn');
  assert.ok(/Duplicate S\/N SN-1/.test(m.text));
  assert.strictEqual(f.state.unit.serial, 'SN-1');
  f.scan(C('SAVE'));
  assert.strictEqual(f.saved.filter((u) => u.serial === 'SN-1').length, 2);
});

test('progress counts rows already recorded plus saved ones, and warns when over', () => {
  const d = data(); d.shipments[0].lines[1].received = 1;
  const f = new Flow(d, [], {});
  f.openShipment('LOT-1');
  assert.strictEqual(f.scan('100000000002').kind, 'warn');
  assert.deepStrictEqual(f.shipmentProgress(f.current), { qty: 3, done: 1 });
});

test('saved units restore counters; voided ones do not count', () => {
  const saved = [{ id: 'a', shipment: 'LOT-1', upc: '100000000001', serial: '' }, { id: 'b', shipment: 'LOT-1', upc: '100000000001', voided: true }];
  const f = new Flow(data(), saved, {});
  assert.strictEqual(f.savedCount('LOT-1', '100000000001'), 1);
});

test('defect scan outside a unit does nothing; unknown QCS code is an error', () => {
  const { f } = setup();
  assert.strictEqual(f.scan(D('LENS', 'Scratch')).kind, 'warn');
  assert.strictEqual(f.scan('QCS-X-NOPE').kind, 'err');
});

test('codes round-trip and ignore case', () => {
  Codes.AREAS.forEach((a) => Codes.DEFECTS[a.key].forEach((d) => {
    const p = Codes.parse(Codes.defectCode(a.key, d).toLowerCase());
    assert.deepStrictEqual([p.type, p.area, p.defect], ['defect', a.key, d]);
  }));
  Codes.COMMANDS.forEach((c) => assert.strictEqual(Codes.parse(Codes.commandCode(c.key)).cmd, c.key));
  assert.strictEqual(Codes.parse('100000000001'), null);
  const codes = new Set();
  Codes.AREAS.forEach((a) => Codes.DEFECTS[a.key].forEach((d) => codes.add(Codes.defectCode(a.key, d))));
  assert.strictEqual(codes.size, Codes.AREAS.reduce((n, a) => n + Codes.DEFECTS[a.key].length, 0));
});

test('configure replaces the vocabulary and the codes follow it', () => {
  const before = { areas: Codes.AREAS, defects: Codes.DEFECTS };
  try {
    Codes.configure({ areas: [{ key: 'A1', label: 'Area One' }, { key: 'BAD KEY', label: 'x' }], defects: { A1: ['Chip', 'Crack Line'], 'BAD KEY': ['y'] } });
    assert.deepStrictEqual(Codes.AREAS.map((a) => a.key), ['A1']);
    assert.deepStrictEqual(Codes.parse(Codes.defectCode('A1', 'Crack Line')), { type: 'defect', area: 'A1', defect: 'Crack Line' });
    assert.strictEqual(Codes.parse('QCS-D-LENS-SCRATCH').type, 'unknown');
    Codes.configure({ areas: [] });                 // invalid config is ignored
    assert.deepStrictEqual(Codes.AREAS.map((a) => a.key), ['A1']);
  } finally { Codes.AREAS = before.areas; Codes.DEFECTS = before.defects; }
});

test('result values come from the configured hooks', () => {
  const out = [];
  const f = new Flow(data(), [], { save: (r) => out.push(r), values: { PASS: { result: 'GOOD', condition: 'FREE' }, POLISH: { result: 'BAD', condition: 'KEEP' }, DEFECT: { result: 'WORSE', condition: 'DROP' } } });
  f.openShipment('LOT-1'); f.scan('100000000001'); f.scan('LOC-01'); f.scan(C('SAVE'));
  f.scan('100000000001'); f.scan(D('LENS', 'Scratch')); f.scan(C('POLISH')); f.scan(C('SAVE'));
  f.scan('100000000001'); f.scan(C('DEFECT')); f.scan(C('SAVE'));
  assert.deepStrictEqual(out.map((r) => [r.verdict, r.result, r.condition]), [['PASS', 'GOOD', 'FREE'], ['POLISH', 'BAD', 'KEEP'], ['DEFECT', 'WORSE', 'DROP']]);
});

test('snapshot and restore bring back shipment, location and the unfinished unit', () => {
  const { f } = setup();
  f.scan('100000000001'); f.scan('SN-9'); f.scan(D('LENS', 'Scratch')); f.scan('LOC-02');
  const snap = JSON.parse(JSON.stringify(f.snapshot()));
  const g = new Flow(data(), [], {});
  assert.strictEqual(g.restore(snap), true);
  assert.deepStrictEqual([g.state.screen, g.state.shipmentId, g.state.location, g.state.unit.serial, g.state.unit.defects.length], ['UNIT', 'LOT-1', 'LOC-02', 'SN-9', 1]);
  g.scan(C('POLISH'));
  assert.strictEqual(g.scan(C('SAVE')).kind, 'ok');
});

test('restore without a unit lands on the scan screen; stale or empty snapshots are ignored', () => {
  const { f } = setup();
  f.scan('LOC-01');
  const g = new Flow(data(), [], {});
  assert.strictEqual(g.restore(f.snapshot()), true);
  assert.deepStrictEqual([g.state.screen, g.state.location], ['SCAN', 'LOC-01']);
  assert.strictEqual(new Flow(data(), [], {}).restore({ shipmentId: 'GONE' }), false);
  assert.strictEqual(new Flow(data(), [], {}).restore(null), false);
});

test('defects need a verdict before SAVE; a clean unit defaults to PASS', () => {
  const { f, out } = setup();
  f.scan('100000000001'); f.scan('LOC-01'); f.scan(D('LENS', 'Scratch'));
  assert.strictEqual(f.scan(C('SAVE')).kind, 'err');
  assert.strictEqual(out.length, 0);
  f.scan(C('POLISH'));
  assert.strictEqual(f.scan(C('SAVE')).kind, 'ok');
  assert.deepStrictEqual([out[0].verdict, out[0].result, out[0].condition], ['POLISH', 'ISSUE', 'HOLD']);
  f.scan('100000000002'); f.scan(C('SAVE'));
  assert.deepStrictEqual([out[1].verdict, out[1].result], ['PASS', 'PASS']);
});

test('verdict can be changed, UNDO clears it first, REDO clears everything', () => {
  const { f } = setup();
  f.scan('100000000001'); f.scan('SN-1'); f.scan(D('LENS', 'Scratch')); f.scan(C('POLISH')); f.scan(C('DEFECT'));
  assert.strictEqual(f.state.unit.verdict, 'DEFECT');
  f.scan(C('UNDO'));
  assert.deepStrictEqual([f.state.unit.verdict, f.state.unit.defects.length], [null, 1]);
  f.scan(C('PASS')); f.scan(C('REDO'));
  assert.deepStrictEqual([f.state.unit.verdict, f.state.unit.serial, f.state.unit.defects.length], [null, '', 0]);
});

test('a verdict scan outside a unit is refused; a verdict alone counts as touched', () => {
  const { f } = setup();
  assert.strictEqual(f.scan(C('DEFECT')).kind, 'warn');
  f.scan('100000000001'); f.scan(C('DEFECT'));
  assert.strictEqual(f.scan(C('BACK')).kind, 'warn');
  assert.strictEqual(f.state.screen, 'UNIT');
});

test('shelfOf groups a location by its first two parts', () => {
  const Codes = require('../src/shared/codes.js');
  assert.equal(Codes.shelfOf('A-04-03-06-B2'), 'A-04');
  assert.equal(Codes.shelfOf('A-03-02-01'), 'A-03');
  assert.equal(Codes.shelfOf('DOCK'), 'DOCK');
});

test('byLocation counts pieces per location with a verdict split', () => {
  const { byLocation } = require('../src/shared/flow.js');
  const r = byLocation([
    { location: 'B', verdict: 'PASS', result: 'PASS' }, { location: 'A', verdict: 'DEFECT', result: 'ISSUE' },
    { location: 'B', verdict: 'POLISH', result: 'ISSUE' }, { location: 'B', result: 'PASS' }, { verdict: 'PASS' }
  ]);
  assert.deepEqual(r.map((o) => o.location), ['(none)', 'A', 'B']);
  assert.deepEqual(r[2], { location: 'B', pcs: 3, pass: 2, polish: 1, defect: 0 });
  assert.equal(r[1].defect, 1);
});

test('location search and editing of saved units', () => {
  const f = new Flow({ shipments: [], locations: ['A-04-02-01-B1', 'A-04-03-01-B1', 'A-04-03-01-B2', 'HOLD'] }, [
    { id: 'u1', shipment: 'S', serial: 'SN1', location: 'HOLD', verdict: 'PASS', result: 'PASS', condition: 'OK', note: '' },
    { id: 'u2', shipment: 'S', serial: 'SN2', location: 'HOLD', verdict: 'PASS', result: 'PASS', condition: 'OK', note: '' }
  ], { values: { DEFECT: { result: 'ISSUE', condition: 'DAMAGED' } } });
  assert.deepEqual(f.matchLocations('a0403').length, 2);
  assert.equal(f.resolveLocation('a-04-02'), 'A-04-02-01-B1');
  assert.equal(f.resolveLocation('a-04-03'), null);
  assert.equal(f.resolveLocation('hold'), 'HOLD');
  assert.equal(f.editSaved('u1', { location: 'zz' }).ok, false);
  const dupEdit = f.editSaved('u1', { serial: 'SN2' });
  assert.ok(dupEdit.ok && /Duplicate S\/N SN2/.test(dupEdit.warning));
  f.editSaved('u1', { serial: 'SN1' });
  const r = f.editSaved('u1', { location: 'a-04-03-01-b2', serial: ' SN9 ', verdict: 'DEFECT', note: 'Scratch: Lens' });
  assert.deepEqual(r.patch, { location: 'A-04-03-01-B2', serial: 'SN9', verdict: 'DEFECT', result: 'ISSUE', condition: 'DAMAGED', note: 'Scratch: Lens' });
  assert.equal(f.saved[0].location, 'A-04-03-01-B2');
  assert.deepEqual(f.editSaved('u1', {}).patch, {});
});
