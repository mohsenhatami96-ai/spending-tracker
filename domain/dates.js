/* ---------------- Dates ---------------- */
export const MONTH_NAMES = { jan:1,feb:2,mar:3,apr:4,may:5,maj:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,okt:10,nov:11,dec:12,
  january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12,januari:1,februari:2,mars:3,juni:6,juli:7,augusti:8,oktober:10 };
export function validYMD(y, m, d) {
  if (y < 100) y += 2000;
  if (!(y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
// fmt: 'auto' | 'YMD' | 'DMY' | 'MDY'
export function parseDate(s, fmt) {
  if (!s) return null;
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:$|[T\s])/))) return validYMD(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return validYMD(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?:$|[\s,T])/))) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (fmt === 'DMY') return validYMD(y, b, a);
    if (fmt === 'MDY') return validYMD(y, a, b);
    return validYMD(y, b, a) || validYMD(y, a, b);
  }
  if ((m = s.match(/^(\d{1,2})[\s\-.]+([A-Za-zåäö]{3,9})\.?[\s\-.,]+(\d{2,4})/))) { const mo = MONTH_NAMES[m[2].toLowerCase()]; if (mo) return validYMD(+m[3], mo, +m[1]); }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/))) { const mo = MONTH_NAMES[m[1].toLowerCase()]; if (mo) return validYMD(+m[3], mo, +m[2]); }
  return null;
}
export function detectDateFormat(values, hintDMY) {
  let ymd = 0, dmy = 0, mdy = 0, amb = 0;
  for (const v of values) {
    const s = String(v || '').trim(); if (!s) continue;
    if (/^\d{4}[-\/.]?\d{1,2}[-\/.]?\d{1,2}/.test(s)) { ymd++; continue; }
    const m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
    if (m) { const a = +m[1], b = +m[2]; if (a > 12 && b <= 12) dmy++; else if (b > 12 && a <= 12) mdy++; else amb++; }
  }
  if (ymd > 0 && ymd >= dmy + mdy + amb) return { fmt: 'YMD', ambiguous: false };
  if (dmy && !mdy) return { fmt: 'DMY', ambiguous: false };
  if (mdy && !dmy) return { fmt: 'MDY', ambiguous: false };
  if (dmy && mdy) return { fmt: dmy >= mdy ? 'DMY' : 'MDY', ambiguous: true };
  if (amb) return { fmt: hintDMY ? 'DMY' : 'MDY', ambiguous: true };
  return { fmt: 'auto', ambiguous: false };
}


