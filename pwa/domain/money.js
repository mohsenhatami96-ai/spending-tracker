import { round2 } from './util.js';

/* ---------------- Numbers ---------------- */
export function looksNum(s) {
  if (!s) return false;
  const t = String(s).replace(/[A-Za-z$€£¥₹₺﷼\s\u00a0\u202f]/g, '');
  return /^[(\-−+]?\d[\d.,'’]*\)?[-−]?$/.test(t);
}
export function detectDecimal(values) {
  let comma = 0, dot = 0;
  for (const v of values) {
    const t = String(v || '').replace(/[^\d.,]/g, '');
    if (!t) continue;
    if (/,\d{1,2}$/.test(t)) comma++;
    else if (/\.\d{1,2}$/.test(t)) dot++;
  }
  return comma > dot ? ',' : '.';
}
export function parseAmount(s, dec) {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) neg = true;
  if (/[-−]\s*$/.test(t)) neg = true;
  if (/^[^\d]*[-−]/.test(t)) neg = true;
  if (/\bDR\b/.test(t)) neg = true;
  t = t.replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return null;
  if (dec === ',') t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const v = parseFloat(t);
  if (!isFinite(v)) return null;
  return round2(neg ? -v : v);
}
