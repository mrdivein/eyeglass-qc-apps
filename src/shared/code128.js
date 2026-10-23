/* Code 128 (set B) encoder → SVG. Covers printable ASCII, which is all the QC codes use. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QCCode128 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PATTERNS = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 ' +
    '122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 ' +
    '113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 ' +
    '431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 ' +
    '241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 ' +
    '131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');
  const START_B = 104, STOP = 106;

  /** Symbol values including start, checksum and stop. */
  function values(text) {
    const v = [START_B];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 32 || c > 126) throw new Error('Code128B: unsupported character ' + JSON.stringify(text[i]));
      v.push(c - 32);
    }
    let sum = START_B;
    for (let i = 1; i < v.length; i++) sum += v[i] * i;
    v.push(sum % 103, STOP);
    return v;
  }

  /** Alternating bar/space widths (modules), starting with a bar. */
  function widths(text) {
    return values(text).map(function (x) { return PATTERNS[x]; }).join('').split('').map(Number);
  }

  /** SVG string. Quiet zone of 10 modules each side; `module` = module width in px (viewBox units). */
  function svg(text, opts) {
    const o = opts || {};
    const mod = o.module || 2, height = o.height || 60, quiet = 10 * mod;
    const w = widths(text);
    let x = quiet, bars = '';
    for (let i = 0; i < w.length; i++) {
      const len = w[i] * mod;
      if (i % 2 === 0) bars += 'M' + x + ' 0h' + len + 'v' + height + 'h-' + len + 'z';
      x += len;
    }
    const total = x + quiet;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + height + '" width="' + total + '" height="' + height +
      '" preserveAspectRatio="none" shape-rendering="crispEdges"><path d="' + bars + '" fill="#000"/></svg>';
  }

  return { PATTERNS: PATTERNS, values: values, widths: widths, svg: svg };
});
