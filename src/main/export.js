/* Saved QC units → rows for pasting into the records sheet, as TSV, or as a CSV file.
 * Column heads and order come from the data endpoint (cfg.columns: [{ head, field }]). */
const FIELDS = ['id', 'date', 'shipment', 'upc', 'sku', 'serial', 'result', 'verdict', 'note', 'condition', 'location', 'operator'];
const DEFAULT_CONFIG = { columns: FIELDS.map((f) => ({ head: f, field: f })), idPrefix: '', idWidth: 0 };

function ddmmyyyy(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

function normalize(cfg) {
  const c = cfg && Array.isArray(cfg.columns) && cfg.columns.length ? cfg : DEFAULT_CONFIG;
  return {
    columns: c.columns.filter((x) => x && FIELDS.indexOf(x.field) >= 0),
    idPrefix: String(c.idPrefix || ''), idWidth: Math.max(0, Math.min(20, +c.idWidth || 0))
  };
}

/** nextNo = first free number on the server (from the last sync); 0 leaves the id empty. Rows are ordered by save time. */
function rows(units, nextNo, cfg) {
  const c = normalize(cfg);
  const idOf = (i) => nextNo ? c.idPrefix + String(nextNo + i).padStart(c.idWidth, '0') : '';
  return units.filter((u) => !u.voided).sort((a, b) => a.savedAt < b.savedAt ? -1 : 1).map((u, i) =>
    c.columns.map((col) => col.field === 'id' ? idOf(i) : col.field === 'date' ? ddmmyyyy(u.savedAt) : (u[col.field] == null ? '' : u[col.field])));
}
const clean = (v) => String(v).replace(/[\t\r\n]+/g, ' ');
function toTSV(rs) { return rs.map((r) => r.map(clean).join('\t')).join('\n'); }
function toCSV(rs, cfg, withHeader) {
  const q = (v) => /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = rs.map((r) => r.map(q).join(','));
  if (withHeader) lines.unshift(normalize(cfg).columns.map((c) => q(c.head)).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { FIELDS, DEFAULT_CONFIG, rows, toTSV, toCSV };
