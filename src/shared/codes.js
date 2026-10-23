/* Barcode scheme shared by the app, the sheet printer and the tests.
 * Alphanumerics and "-" only, so a scanner on any keyboard layout reads them back unchanged.
 * Areas and defect names come from the data endpoint (configure); the defaults below are generic. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QCCodes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PREFIX = 'QCS';

  const DEFAULT_AREAS = [
    { key: 'LENS', label: 'Lens' },
    { key: 'FRONT', label: 'Front Frame' },
    { key: 'TEMPLEL', label: 'Temple Left' },
    { key: 'TEMPLER', label: 'Temple Right' }
  ];
  const GENERIC = ['Scratch', 'Scuff', 'Dent', 'Deformation', 'Paint Defect', 'Marking Defect'];
  const DEFAULT_DEFECTS = { LENS: GENERIC, FRONT: GENERIC, TEMPLEL: GENERIC, TEMPLER: GENERIC };

  const COMMANDS = [
    { key: 'SAVE', label: 'Save' },
    { key: 'BACK', label: 'Back' },
    { key: 'REDO', label: 'Redo' },
    { key: 'UNDO', label: 'Undo' }
  ];

  const api = { PREFIX: PREFIX, COMMANDS: COMMANDS, AREAS: DEFAULT_AREAS, DEFECTS: DEFAULT_DEFECTS };

  const slug = function (s) { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); };

  /** Replace the vocabulary (from the data endpoint). Invalid input leaves the current one. */
  api.configure = function (cfg) {
    if (!cfg || !Array.isArray(cfg.areas) || !cfg.areas.length || !cfg.defects) return;
    const areas = cfg.areas.filter(function (a) { return a && /^[A-Z0-9]+$/.test(a.key) && a.label && Array.isArray(cfg.defects[a.key]); });
    if (!areas.length) return;
    api.AREAS = areas;
    api.DEFECTS = {};
    areas.forEach(function (a) { api.DEFECTS[a.key] = cfg.defects[a.key].map(String); });
  };

  api.slug = slug;
  api.areaByKey = function (k) { return api.AREAS.filter(function (a) { return a.key === k; })[0] || null; };
  api.defectCode = function (areaKey, defect) { return PREFIX + '-D-' + areaKey + '-' + slug(defect); };
  api.commandCode = function (cmd) { return PREFIX + '-C-' + cmd; };
  api.locationCode = function (loc) { return PREFIX + '-L-' + String(loc).toUpperCase(); };

  /** Token → {type:'command',cmd} | {type:'defect',area,defect} | {type:'location',location} | {type:'unknown'} | null (not ours). */
  api.parse = function (token) {
    const t = String(token || '').trim().toUpperCase();
    if (t.indexOf(PREFIX + '-') !== 0) return null;
    const rest = t.slice(PREFIX.length + 1);
    if (rest.indexOf('C-') === 0) {
      const c = rest.slice(2);
      return COMMANDS.some(function (x) { return x.key === c; }) ? { type: 'command', cmd: c } : { type: 'unknown', raw: t };
    }
    if (rest.indexOf('L-') === 0) return { type: 'location', location: rest.slice(2) };
    if (rest.indexOf('D-') === 0) {
      const body = rest.slice(2);
      for (let i = 0; i < api.AREAS.length; i++) {
        const a = api.AREAS[i];
        if (body.indexOf(a.key + '-') !== 0) continue;
        const s = body.slice(a.key.length + 1);
        const d = api.DEFECTS[a.key].filter(function (x) { return slug(x) === s; })[0];
        if (d) return { type: 'defect', area: a.key, defect: d };
      }
    }
    return { type: 'unknown', raw: t };
  };

  /** Defect list → note text, e.g. "Scratch: Lens, Temple Left; Dent: Front Frame". */
  api.noteText = function (defects) {
    const order = [], by = {};
    (defects || []).forEach(function (d) {
      if (!by[d.defect]) { by[d.defect] = []; order.push(d.defect); }
      const lab = api.areaByKey(d.area).label;
      if (by[d.defect].indexOf(lab) === -1) by[d.defect].push(lab);
    });
    return order.map(function (n) { return n + ': ' + by[n].join(', '); }).join('; ');
  };

  return api;
});
