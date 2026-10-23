const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/shared/code128');

test('pattern table is complete and well-formed', () => {
  assert.strictEqual(C.PATTERNS.length, 107);
  C.PATTERNS.slice(0, 106).forEach((p, i) => {
    assert.strictEqual(p.length, 6, 'pattern ' + i);
    assert.strictEqual(p.split('').reduce((a, b) => a + +b, 0), 11, 'pattern ' + i);
  });
  assert.strictEqual(C.PATTERNS[106], '2331112');
  assert.strictEqual(new Set(C.PATTERNS).size, 107);
});

test('checksum matches the published example', () => {
  // Wikipedia's "PJJ123C" example (start A, checksum 54) gives 55 with start B (104 instead of 103)
  const v = C.values('PJJ123C');
  assert.deepStrictEqual(v, [104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
});

test('rejects characters outside set B', () => {
  assert.throws(() => C.values('QCS-é'));
});

test('svg output is a single path', () => {
  const s = C.svg('QCS-C-SAVE');
  assert.match(s, /^<svg /);
  assert.strictEqual((s.match(/<path/g) || []).length, 1);
});
