/** UI + orchestration for Spending Tracker. Wired by app.js composition root. */
import { round2, uid, MONTHS_SHORT, foldText, tokensOf } from '../domain/util.js';
import { LOCAL_RULES, LOCAL_CITIES, LOCAL_LOC_ABBR } from '../domain/local.js';
import {
  CATEGORY_TREE, LEGACY_CATS, shadeColor, DEFAULT_CATS, DEFAULT_RULES, CURRENCIES, PALETTE
} from '../domain/categories.js';
import { looksNum, detectDecimal, parseAmount } from '../domain/money.js';
import { MONTH_NAMES, validYMD, parseDate, detectDateFormat } from '../domain/dates.js';
import { parseCSV, detectDelimiter } from '../domain/parse-csv.js';
import {
  compilePattern, isRegexPattern, compileRules, invalidateRules, matchRule, fuzzyMatchRule,
  isLocationTail, KLARNA_MARKER, isViaKlarna, cleanDescription, titleCase, displayName,
  CITY_NAMES, CITY_VARIANTS, LOC_ABBR, LEGAL_SUFFIX,
  setRulesProvider, setCategoriesProvider
} from '../domain/rules.js';
import { DICT_INFO, dictMatch, setDictCategoriesProvider } from '../domain/dict.js';
import {
  setStateProvider, isSalaryText, PAYOFF_KEY, catByName, mainOf, isMain, subsOf, mainCats,
  catLabel, inCat, catType, catColor, categorize, recategorizeAll, merchantKey, dedupeKey
} from '../domain/categorize.js';
import { defaultState, normalizeState, migrateCategories } from '../domain/state.js';
import {
  ISK_RULES, ESSENTIAL_DEFAULT, PLAN_DEFAULTS, defaultPlan, bufferGoalNew, normalizePlan, todayStr, FIXED_MAINS, FIXED_SUBS, CREDIT_RE, FEE_RE
} from '../domain/plan-defaults.js';
import { LS_KEY, load as storeLoad, save as storeSave, getDataVersion, setSaveErrorHandler } from '../storage/localStorage.js';
import { $, $$, esc, toast, openModal, closeModal, installModalGlobals } from './dom.js';

export function boot() {

let S;
let _dataVersion = 0;
const load = () => storeLoad();
const save = () => { storeSave(S); _dataVersion = getDataVersion(); };

installModalGlobals();
setSaveErrorHandler(msg => toast(msg, true));
setRulesProvider(() => S && S.rules ? S.rules : []);
setCategoriesProvider(() => S && S.categories ? S.categories : []);
setDictCategoriesProvider(() => S && S.categories ? S.categories : []);
setStateProvider(() => S);

/* ---------------- Formatting ---------------- */
let _fmt = null, _fmtKey = '', _fmtShort = null;
function getFormatters() {
  const st = S.settings, key = st.currency + '|' + st.symbol + '|' + st.symbolPos;
  if (key === _fmtKey) return;
  _fmtKey = key;
  if (st.symbol) {
    const nf = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let nfs; try { nfs = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: 'compact' }); } catch (e) { nfs = nf; }
    const wrap = (n, v) => (v < 0 ? '−' : '') + (st.symbolPos === 'after' ? n + ' ' + st.symbol : st.symbol + n);
    _fmt = { format: v => wrap(nf.format(Math.abs(v)), v) };
    _fmtShort = { format: v => wrap(nfs.format(Math.abs(v)), v) };
    return;
  }
  const mk = extra => {
    try { return new Intl.NumberFormat(undefined, Object.assign({ style: 'currency', currency: st.currency, currencyDisplay: 'narrowSymbol' }, extra)); }
    catch (e) { try { return new Intl.NumberFormat(undefined, Object.assign({ style: 'currency', currency: st.currency }, extra)); } catch (e2) { return null; } }
  };
  _fmt = mk({}) || { format: v => st.currency + ' ' + v.toFixed(2) };
  _fmtShort = mk({ notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 }) || _fmt;
}
const fmt = v => { getFormatters(); return _fmt.format(v || 0); };
const fmtShort = v => { getFormatters(); return _fmtShort.format(v || 0); };
function monthLabel(m, long) {
  if (m === 'all') return 'All time';
  if (m.length === 10) {   // salary period key = start date; labelled by the month the salary arrived
    const name = MONTHS_SHORT[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
    return long ? `${name} (${periodRangeText(m)})` : name;
  }
  const [y, mo] = m.split('-').map(Number);
  return (long ? new Date(y, mo - 1, 1).toLocaleString(undefined, { month: 'long' }) : MONTHS_SHORT[mo - 1]) + ' ' + y;
}
function fmtDate(d) {
  const [y, m, dd] = d.split('-').map(Number);
  try { return new Date(y, m - 1, dd).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return d; }
}

/* ---------------- Import flow: file -> auto-detected mapping -> user review -> transactions ---------------- */
function rowMode(rows) {
  const counts = {}; rows.slice(0, 80).forEach(r => counts[r.length] = (counts[r.length] || 0) + 1);
  return +Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b - a)[0] || 1;
}
function buildConfig(name, text, delimOverride) {
  const delim = delimOverride || detectDelimiter(text);
  return Object.assign(configFromRows(name, parseCSV(text, delim)), { kind: 'csv', text, delim });
}
function configFromRows(name, rows) {
  const cfg = { name, kind: 'csv', text: '', delim: ',', rows, headerRow: -1, colDate: -1, colDesc: -1, colDesc2: -1, amountMode: 'single', colAmount: -1, colDebit: -1, colCredit: -1,
    dateFmt: 'auto', dateAmbiguous: false, decimal: '.', invert: false, invertSuggested: false };
  if (!rows.length) return cfg;
  const mode = rowMode(rows);
  let first = -1;   // first data row: has a date cell plus a numeric cell
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i]; if (r.length < Math.max(2, mode - 1)) continue;
    const di = r.findIndex(c => parseDate(c, 'auto'));
    if (di >= 0 && r.some((c, j) => j !== di && looksNum(c))) { first = i; break; }
  }
  if (first < 0) first = 0;
  if (first > 0 && rows[first - 1].length >= 2 && !rows[first - 1].some(c => parseDate(c, 'auto'))) cfg.headerRow = first - 1;
  autoMapColumns(cfg);
  return cfg;
}
function firstDataIndex(cfg) {
  for (let i = 0; i < Math.min(cfg.rows.length, 40); i++) if (cfg.rows[i].some(c => parseDate(c, 'auto'))) return i;
  return 0;
}
function dataRows(cfg) { return cfg.rows.slice(cfg.headerRow >= 0 ? cfg.headerRow + 1 : firstDataIndex(cfg)); }
function colCount(cfg) { return Math.max(1, ...cfg.rows.slice(0, 80).map(r => r.length)); }
function columnNames(cfg) {
  const hdr = cfg.headerRow >= 0 ? cfg.rows[cfg.headerRow] : [];
  return Array.from({ length: colCount(cfg) }, (_, i) => String.fromCharCode(65 + (i % 26)) + ': ' + (hdr[i] || 'Column ' + (i + 1)));
}
function autoMapColumns(cfg) {
  const names = cfg.headerRow >= 0 ? cfg.rows[cfg.headerRow].map(h => h.toLowerCase()) : [];
  const sample = dataRows(cfg).slice(0, 300);
  const stat = [];
  for (let i = 0; i < colCount(cfg); i++) {
    const vals = sample.map(r => r[i] || '');
    const ne = vals.filter(v => v !== '');
    const dateness = ne.length ? ne.filter(v => parseDate(v, 'auto')).length / ne.length : 0;
    const numness = ne.length ? ne.filter(looksNum).length / ne.length : 0;
    const txt = ne.filter(v => !looksNum(v) && !parseDate(v, 'auto'));
    const textLen = txt.length ? txt.reduce((a, v) => a + v.length, 0) / txt.length * (txt.length / Math.max(1, vals.length)) : 0;
    stat.push({ i, vals, dateness, numness, textLen, distinct: new Set(txt).size, fill: ne.length / Math.max(1, vals.length), name: names[i] || '' });
  }
  const H = (re, extra) => stat.filter(s => re.test(s.name) && (!extra || extra(s)));
  const isBal = s => /balance|saldo|running|available|disponibel|kontostand/.test(s.name);
  const dateCands = stat.filter(s => s.dateness >= 0.7);
  const dc = dateCands.find(s => /(trans|book|bokf|purchase|köp|txn)/.test(s.name) && /(date|datum|dag|fecha|data)/.test(s.name))
    || dateCands.find(s => /(date|datum|dag|fecha)/.test(s.name)) || dateCands[0];
  cfg.colDate = dc ? dc.i : -1;
  const used = new Set([cfg.colDate]);
  const numOk = s => !used.has(s.i) && s.numness >= 0.6 && !isBal(s);
  const amt = H(/amount|belopp|amt|summa|value|betrag|importe|montant|bedrag|beløb|^net$/, numOk);
  const deb = H(/debit|withdraw|paid out|money out|^out$|outflow|uttag|utgift|charge|spent|ausgang|soll/, numOk);
  const cre = H(/credit|deposit|paid in|money in|^in$|inflow|insättning|inbetalning|inkomst|received|eingang|haben/, numOk);
  cfg.colAmount = cfg.colDebit = cfg.colCredit = -1;
  if (amt.length && !(deb.length && cre.length && deb[0].i !== cre[0].i && amt[0].i === deb[0].i)) { cfg.amountMode = 'single'; cfg.colAmount = amt[0].i; }
  else if (deb.length && cre.length && deb[0].i !== cre[0].i) { cfg.amountMode = 'split'; cfg.colDebit = deb[0].i; cfg.colCredit = cre[0].i; }
  else {
    const hasNeg = s => s.vals.some(v => /^\s*[-−(]/.test(v));
    const cands = stat.filter(s => numOk(s) && s.fill > 0.5).sort((a, b) => (hasNeg(b) - hasNeg(a)) || b.numness - a.numness);
    cfg.amountMode = 'single';
    cfg.colAmount = deb.length ? deb[0].i : cands.length ? cands[0].i : -1;
  }
  [cfg.colAmount, cfg.colDebit, cfg.colCredit].forEach(c => used.add(c));
  const strong = /desc|payee|merchant|narrat|text|beskriv|vendor|libell|mottag/;
  const descRe = /desc|payee|merchant|narrat|detail|memo|text|beskriv|mottag|name|specifik|reference|transaction|particulars|vendor|verwendungszweck|concepto|libell|counterpart|händelse|meddelande/;
  let dsc = H(descRe, s => !used.has(s.i) && s.textLen > 0).sort((a, b) => (strong.test(b.name) - strong.test(a.name)) || b.distinct - a.distinct)[0];
  if (!dsc) dsc = stat.filter(s => !used.has(s.i)).sort((a, b) => b.textLen * Math.log(2 + b.distinct) - a.textLen * Math.log(2 + a.distinct))[0];
  cfg.colDesc = dsc ? dsc.i : -1;
  cfg.colDesc2 = -1;
  const v = i => (stat[i] || { vals: [] }).vals;
  const amountVals = cfg.amountMode === 'single' ? v(cfg.colAmount) : v(cfg.colDebit).concat(v(cfg.colCredit));
  cfg.decimal = detectDecimal(amountVals);
  const df = detectDateFormat(cfg.colDate >= 0 ? v(cfg.colDate) : [], cfg.decimal === ',' || cfg.delim === ';');
  cfg.dateFmt = df.fmt; cfg.dateAmbiguous = df.ambiguous;
  // Sign convention: many card exports list purchases as positive numbers.
  cfg.invert = cfg.invertSuggested = false;
  if (cfg.amountMode === 'single' && cfg.colAmount >= 0) {
    const nums = amountVals.map(x => parseAmount(x, cfg.decimal)).filter(x => x != null && x !== 0);
    cfg.invertSuggested = cfg.invert = nums.length >= 3 && nums.filter(x => x > 0).length / nums.length >= 0.75;
  }
}
function buildTxns(cfg) {
  const out = [], errors = [];
  if (cfg.colDate < 0 || cfg.colDesc < 0 || (cfg.amountMode === 'single' ? cfg.colAmount < 0 : (cfg.colDebit < 0 && cfg.colCredit < 0)))
    return { txns: out, errors: ['Please choose the date, description and amount columns.'], skipped: 0 };
  let skipped = 0;
  dataRows(cfg).forEach((r, idx) => {
    const date = parseDate(r[cfg.colDate], cfg.dateFmt);
    let amount = null;
    if (cfg.amountMode === 'single') {
      amount = parseAmount(r[cfg.colAmount], cfg.decimal);
      if (amount != null && cfg.invert) amount = -amount;
    } else {
      const d = cfg.colDebit >= 0 ? parseAmount(r[cfg.colDebit], cfg.decimal) : null;
      const c = cfg.colCredit >= 0 ? parseAmount(r[cfg.colCredit], cfg.decimal) : null;
      if (d != null || c != null) amount = round2((c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0));
    }
    let desc = (r[cfg.colDesc] || '').replace(/\s+/g, ' ').trim();
    if (cfg.colDesc2 >= 0 && r[cfg.colDesc2]) desc = (desc + ' ' + r[cfg.colDesc2].replace(/\s+/g, ' ').trim()).trim();
    if (!date || amount == null) {
      skipped++;
      if (errors.length < 5) errors.push(`Data row ${idx + 1}: ${!date ? 'unreadable date "' + (r[cfg.colDate] || '') + '"' : 'no readable amount'}`);
      return;
    }
    out.push({ id: uid(), date, desc: desc || '(no description)', amount: round2(amount), category: '', catManual: false, note: '', source: cfg.name });
  });
  return { txns: out, errors, skipped };
}
function addTxnsDeduped(list) {
  const existing = {};
  S.txns.forEach(t => { existing[t.key] = (existing[t.key] || 0) + 1; });
  const seen = {};
  let added = 0, dups = 0;
  invalidateRules();
  for (const t of list) {
    t.key = dedupeKey(t);
    seen[t.key] = (seen[t.key] || 0) + 1;
    // The nth identical row in a file is only a duplicate if we already store >= n of them
    // (so two genuine identical coffees on the same day survive, but re-imports are skipped).
    if ((existing[t.key] || 0) >= seen[t.key]) { dups++; continue; }
    t.category = categorize(t);
    S.txns.push(t); added++;
  }
  return { added, dups };
}

/* ---------------- XLSX (Office Open XML) import: hand-written unzip + XML parsing ---------------- */
// Pure-JS raw DEFLATE decoder (RFC 1951), used only when DecompressionStream('deflate-raw') is unavailable.
const _LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const _LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const _DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const _DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const _CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
function inflateRawJS(data, sizeHint) {
  let pos = 0, bitBuf = 0, bitCnt = 0, outLen = 0;
  let out = new Uint8Array(Math.max(1024, sizeHint || data.length * 4));
  const ensure = n => { if (outLen + n > out.length) { const nb = new Uint8Array(Math.max(out.length * 2, outLen + n)); nb.set(out.subarray(0, outLen)); out = nb; } };
  const bits = n => {
    while (bitCnt < n) { if (pos >= data.length) throw new Error('Unexpected end of compressed data'); bitBuf |= data[pos++] << bitCnt; bitCnt += 8; }
    const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v;
  };
  const build = (lengths, n) => {
    const counts = new Uint16Array(16), offs = new Uint16Array(16), symbols = new Uint16Array(n);
    for (let i = 0; i < n; i++) counts[lengths[i]]++;
    counts[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { counts, symbols };
  };
  const decode = h => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error('Invalid Huffman code');
  };
  let fixedL = null, fixedD = null;
  let final = 0;
  do {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > data.length) throw new Error('Truncated stored block');
      const len = data[pos] | (data[pos + 1] << 8); pos += 4;
      if (pos + len > data.length) throw new Error('Truncated stored block');
      ensure(len); out.set(data.subarray(pos, pos + len), outLen); outLen += len; pos += len;
      continue;
    }
    let lit, dist;
    if (type === 1) {
      if (!fixedL) {
        const l = new Uint8Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
        fixedL = build(l, 288); const d = new Uint8Array(30); d.fill(5); fixedD = build(d, 30);
      }
      lit = fixedL; dist = fixedD;
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[_CLORDER[i]] = bits(3);
      const clh = build(cl, 19);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(clh);
        if (sym < 16) lens[i++] = sym;
        else {
          let rep, val = 0;
          if (sym === 16) { if (!i) throw new Error('Bad code lengths'); val = lens[i - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > hlit + hdist) throw new Error('Bad code lengths');
          while (rep--) lens[i++] = val;
        }
      }
      lit = build(lens.subarray(0, hlit), hlit); dist = build(lens.subarray(hlit), hdist);
    } else throw new Error('Invalid deflate block type');
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) { ensure(1); out[outLen++] = sym; }
      else if (sym === 256) break;
      else {
        const li = sym - 257; if (li >= 29) throw new Error('Bad length code');
        const len = _LBASE[li] + bits(_LEXT[li]);
        const di = decode(dist); if (di >= 30) throw new Error('Bad distance code');
        const d = _DBASE[di] + bits(_DEXT[di]);
        if (d > outLen) throw new Error('Distance too far back');
        ensure(len);
        for (let k = 0; k < len; k++) { out[outLen] = out[outLen - d]; outLen++; }
      }
    }
  } while (!final);
  return out.subarray(0, outLen);
}
async function inflateRaw(u8, sizeHint, forceFallback) {
  if (!forceFallback && typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { /* unsupported format name or bad data: use the JS decoder */ }
  }
  return inflateRawJS(u8, sizeHint);
}
// Minimal ZIP reader (central directory based; supports stored + deflate entries).
function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  if (u8.length < 22) throw new Error('File is too small to be an .xlsx');
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx/zip file');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error('ZIP64 workbooks are not supported');
  const entries = {}, td = new TextDecoder('utf-8');
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/');
    if (dv.getUint32(loc, true) !== 0x04034b50) throw new Error('Corrupt zip entry: ' + name);
    const start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
    entries[name.replace(/^\//, '')] = { name, method, csize, usize, encrypted: !!(flags & 1), data: u8.subarray(start, start + csize) };
    p += 46 + nl + xl + cl;
  }
  return entries;
}
async function zipText(entries, path, opts) {
  const e = entries[path] || entries[Object.keys(entries).find(k => k.toLowerCase() === path.toLowerCase())];
  if (!e) return null;
  if (e.encrypted) throw new Error('Password-protected workbooks are not supported');
  let bytes;
  if (e.method === 0) bytes = e.data;
  else if (e.method === 8) bytes = await inflateRaw(e.data, e.usize, opts && opts.forceFallback);
  else throw new Error('Unsupported zip compression method ' + e.method);
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}
function parseXML(text, path) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not parse ' + path);
  return doc;
}
const _tags = (el, name) => Array.from(el.getElementsByTagNameNS('*', name));
const _kids = (el, name) => Array.from(el.children).filter(c => c.localName === name);
function _richText(el) {   // concatenates <t> runs, skipping phonetic (<rPh>) text
  let s = '';
  for (const t of _tags(el, 't')) if (!t.parentNode || t.parentNode.localName !== 'rPh') s += t.textContent;
  return s;
}
function _resolveTarget(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}
const BUILTIN_DATE_FMTS = new Set([14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58]);
function isDateFormatCode(code) {
  if (!code || /^general$/i.test(code)) return false;
  const c = code.split(';')[0].replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/_./g, '').replace(/\*./g, '').replace(/\[(?!h\]|m\]|s\]|hh\]|mm\]|ss\])[^\]]*\]/gi, '');
  return /[dmyhs]/i.test(c.replace(/E[+-]/gi, ''));
}
function excelSerialToISO(serial, date1904) {
  if (!isFinite(serial)) return null;
  let ms;
  if (date1904) ms = Date.UTC(1904, 0, 1) + Math.floor(serial) * 86400000;
  else if (serial >= 61) ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  else ms = Date.UTC(1899, 11, 31) + Math.floor(serial) * 86400000;   // before the fictitious 1900-02-29
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function colIndexFromRef(ref) {
  const m = /^([A-Z]+)/i.exec(ref || ''); if (!m) return -1;
  let n = 0; for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function _numToString(v) {
  const n = Number(v); if (!isFinite(n)) return String(v);
  return String(Math.round(n * 1e9) / 1e9);   // strip binary float noise like 54.990000000000002
}
// Returns [{ name, rows: string[][], hidden }] for every worksheet.
async function parseXlsx(buf, opts) {
  const entries = readZip(buf);
  const wbPath = 'xl/workbook.xml';
  let wbText = await zipText(entries, wbPath, opts);
  let wbFile = wbPath;
  if (!wbText) {   // honour the package root relationship if the workbook lives elsewhere
    const root = await zipText(entries, '_rels/.rels', opts);
    if (root) { const rel = _tags(parseXML(root, '_rels/.rels'), 'Relationship').find(r => /officeDocument$/.test(r.getAttribute('Type') || '')); if (rel) { wbFile = _resolveTarget('', rel.getAttribute('Target')); wbText = await zipText(entries, wbFile, opts); } }
  }
  if (!wbText) throw new Error('No workbook found. Is this really an .xlsx file?');
  const wb = parseXML(wbText, wbFile);
  const wbPr = _tags(wb, 'workbookPr')[0];
  const date1904 = !!wbPr && /^(1|true)$/i.test(wbPr.getAttribute('date1904') || '');
  const relsPath = wbFile.replace(/[^/]+$/, '_rels/') + wbFile.split('/').pop() + '.rels';
  const relsText = await zipText(entries, relsPath, opts);
  const rels = {};
  if (relsText) _tags(parseXML(relsText, relsPath), 'Relationship').forEach(r => { rels[r.getAttribute('Id')] = { target: _resolveTarget(wbFile, r.getAttribute('Target') || ''), type: r.getAttribute('Type') || '' }; });
  const relOf = type => Object.values(rels).find(r => r.type.endsWith('/' + type));
  // shared strings
  let shared = [];
  const ssPath = (relOf('sharedStrings') || {}).target || 'xl/sharedStrings.xml';
  const ssText = await zipText(entries, ssPath, opts);
  if (ssText) shared = _kids(parseXML(ssText, ssPath).documentElement, 'si').map(_richText);
  // styles -> which cell style indexes are dates
  const dateStyle = [];
  const stPath = (relOf('styles') || {}).target || 'xl/styles.xml';
  const stText = await zipText(entries, stPath, opts);
  if (stText) {
    const st = parseXML(stText, stPath);
    const custom = {};
    _tags(st, 'numFmt').forEach(f => { custom[+f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || ''; });
    const cellXfs = _tags(st, 'cellXfs')[0];
    if (cellXfs) _kids(cellXfs, 'xf').forEach((xf, i) => {
      const id = +(xf.getAttribute('numFmtId') || 0);
      dateStyle[i] = custom[id] != null ? isDateFormatCode(custom[id]) : BUILTIN_DATE_FMTS.has(id);
    });
  }
  const sheets = [];
  for (const sh of _tags(wb, 'sheet')) {
    const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id');
    const rel = rels[rid];
    const path = rel ? rel.target : null;
    if (!path || (rel && !/worksheet$/.test(rel.type) && rel.type)) { sheets.push({ name: sh.getAttribute('name') || 'Sheet', rows: [], hidden: true, chart: true }); continue; }
    const text = await zipText(entries, path, opts);
    const rows = [], rowNums = [];
    if (text) {
      const doc = parseXML(text, path);
      const sd = _tags(doc, 'sheetData')[0];
      let rIdx = -1;
      for (const row of sd ? _kids(sd, 'row') : []) {
        const rAttr = parseInt(row.getAttribute('r'), 10);
        rIdx = isFinite(rAttr) ? rAttr - 1 : rIdx + 1;
        const cells = []; let cIdx = -1;
        for (const c of _kids(row, 'c')) {
          const ref = c.getAttribute('r');
          const ci = ref ? colIndexFromRef(ref) : -1;
          cIdx = ci >= 0 ? ci : cIdx + 1;
          const t = c.getAttribute('t') || 'n';
          const vEl = _kids(c, 'v')[0];
          const v = vEl ? vEl.textContent : '';
          let out = '';
          if (t === 's') out = shared[+v] != null ? shared[+v] : '';
          else if (t === 'inlineStr') { const is = _kids(c, 'is')[0]; out = is ? _richText(is) : v; }
          else if (t === 'str' || t === 'e') out = v;
          else if (t === 'b') out = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : v;
          else if (t === 'd') out = v.slice(0, 10);
          else if (v !== '') {
            const num = Number(v);
            const s = +(c.getAttribute('s') || 0);
            out = dateStyle[s] && num >= 1 ? excelSerialToISO(num, date1904) : _numToString(v);
          }
          cells[cIdx] = String(out == null ? '' : out).replace(/\r\n?/g, '\n').trim();
        }
        for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
        if (cells.some(x => x !== '')) { rows.push(cells); rowNums.push(rIdx + 1); }
      }
    }
    sheets.push({ name: sh.getAttribute('name') || ('Sheet' + (sheets.length + 1)), rows, rowNums, hidden: (sh.getAttribute('state') || 'visible') !== 'visible' });
  }
  if (!sheets.length) throw new Error('The workbook has no worksheets');
  return { sheets, date1904 };
}
function sheetHasTransactions(rows) {
  return rows.slice(0, 60).some(r => { const di = r.findIndex(c => parseDate(c, 'auto')); return di >= 0 && r.some((c, j) => j !== di && looksNum(c)); });
}
function defaultSheetIndex(sheets) {
  let i = sheets.findIndex(s => !s.hidden && sheetHasTransactions(s.rows));
  if (i < 0) i = sheets.findIndex(s => sheetHasTransactions(s.rows));
  if (i < 0) i = sheets.findIndex(s => !s.hidden && s.rows.length);
  return Math.max(0, i);
}
function buildXlsxConfig(name, book, sheetIndex) {
  const idx = sheetIndex == null ? defaultSheetIndex(book.sheets) : sheetIndex;
  const cfg = configFromRows(name, book.sheets[idx].rows);
  return Object.assign(cfg, { kind: 'xlsx', book, sheetIndex: idx, text: '', delim: '', rowNums: book.sheets[idx].rowNums });
}
const isZipBytes = u8 => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;

const importQueue = [];
async function handleFiles(files) {
  const arr = Array.from(files || []);
  if (!arr.length) return;
  for (const f of arr) {
    if (/\.(pdf|xls|xlsb|ods|ofx|qfx|qif|numbers)$/i.test(f.name)) {
      toast(`${f.name}: this format isn't supported. ${/\.(xls|xlsb|ods|numbers)$/i.test(f.name) ? 'Save it as .xlsx or CSV first.' : 'Export CSV or .xlsx from your bank.'}`, true); continue;
    }
    try {
      const buf = await f.arrayBuffer();
      let cfg;
      if (/\.(xlsx|xlsm)$/i.test(f.name) || isZipBytes(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)))) {
        const book = await parseXlsx(buf);
        if (!book.sheets.some(s => s.rows.length)) { toast(`${f.name}: no data found in any sheet`, true); continue; }
        cfg = buildXlsxConfig(f.name, book);
      } else {
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('windows-1252').decode(buf); }
        cfg = buildConfig(f.name, text.replace(/^\uFEFF/, ''));
      }
      if (!cfg.rows.length) { toast(`${f.name} is empty`, true); continue; }
      importQueue.push(cfg);
    } catch (e) { toast(`Could not read ${f.name}: ${e.message}`, true); }
  }
  nextImport();
}
function nextImport() {
  if ($('#modalBg').classList.contains('show')) return;
  const cfg = importQueue.shift();
  if (cfg) showMappingModal(cfg);
}
function colOptions(cfg, sel) {
  return `<option value="-1"${sel < 0 ? ' selected' : ''}>— none —</option>` +
    columnNames(cfg).map((n, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
}
// Accounts: which bank account / credit card a file belongs to, remembered per file layout (header row).
function layoutSig(cfg) {
  const hdr = cfg.headerRow >= 0 && cfg.rows[cfg.headerRow] ? cfg.rows[cfg.headerRow].map(c => String(c).trim().toLowerCase()).join('|') : 'nohdr' + colCount(cfg) + '|' + String(cfg.name).replace(/[\d_.-]+/g, '').toLowerCase();
  return (cfg.kind || 'csv') + '|' + hdr;
}
function defaultAccountChoice(cfg) {
  const rem = S.layouts[layoutSig(cfg)];
  if (rem && accById(rem)) return { mode: 'existing', id: rem };
  const base = String(cfg.name).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30) || 'Account';
  return { mode: 'new', type: cfg.invertSuggested ? 'card' : 'bank', name: base };
}
function resolveAccount(cfg) {
  const ch = cfg.acc || defaultAccountChoice(cfg); let id = ch.id;
  if (ch.mode === 'new') {
    let n = (ch.name || '').trim() || (ch.type === 'card' ? 'Credit card' : 'Bank account'), k = 2; const base = n;
    while (S.accounts.some(a => a.name === n)) n = base + ' ' + k++;
    id = uid(); S.accounts.push({ id, name: n, type: ch.type === 'card' ? 'card' : 'bank', match: '', countPayoffs: true });
  }
  if (id) S.layouts[layoutSig(cfg)] = id;
  return id || '';
}
function showMappingModal(cfg) {
  const remaining = importQueue.length;
  openModal('Import: ' + cfg.name + (remaining ? `  (+${remaining} more file${remaining > 1 ? 's' : ''})` : ''), '<div id="mapRoot"></div>', [
    { label: remaining ? 'Skip this file' : 'Cancel', cancel: true },
    { label: 'Import transactions', cls: 'primary', id: 'doImport', keepOpen: true, onClick: () => {
      const res = buildTxns(cfg);
      if (!res.txns.length) { toast('Nothing to import — check the column mapping.', true); return false; }
      const accId = resolveAccount(cfg); res.txns.forEach(t => t.account = accId);
      const { added, dups } = addTxnsDeduped(res.txns);
      save();
      if (added) ui.month = null;
      closeModal(); renderAll();
      toast(`${cfg.name}: imported ${added} transaction${added === 1 ? '' : 's'}` + (dups ? `, skipped ${dups} duplicate${dups === 1 ? '' : 's'}` : '') + (res.skipped ? `, ignored ${res.skipped} unreadable row(s)` : ''));
      return false;
    } }
  ], { wide: true, noFocus: true, onClose: () => setTimeout(nextImport, 60) });
  renderMapping(cfg);
}
function renderMapping(cfg) {
  const root = $('#mapRoot'); if (!root) return;
  const ncols = colCount(cfg);
  const rawStart = Math.max(0, cfg.headerRow >= 0 ? cfg.headerRow : firstDataIndex(cfg));
  const raw = cfg.rows.slice(rawStart, rawStart + 6);
  const res = buildTxns(cfg);
  invalidateRules();
  const preview = res.txns.slice(0, 8);
  const delimName = { ',': 'Comma (,)', ';': 'Semicolon (;)', '\t': 'Tab', '|': 'Pipe (|)' };
  const headerOpts = ['<option value="-1">No header row</option>'].concat(cfg.rows.slice(0, 15).map((r, i) =>
    `<option value="${i}"${i === cfg.headerRow ? ' selected' : ''}>Row ${cfg.rowNums ? cfg.rowNums[i] : i + 1}: ${esc(r.slice(0, 4).join(' | ').slice(0, 60))}</option>`)).join('');
  const sel = (k, opts) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cfg[k]) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  root.innerHTML = `
    <p class="hint" style="margin-top:0">${cfg.kind === 'xlsx' ? `Excel workbook with ${cfg.book.sheets.length} sheet${cfg.book.sheets.length === 1 ? '' : 's'}${cfg.book.date1904 ? ' (1904 date system)' : ''}. Date cells are converted to YYYY-MM-DD. ` : ''}Columns were detected automatically. Check them against the preview and correct anything that looks wrong.</p>
    <div class="form-grid">
      ${cfg.kind === 'xlsx'
        ? `<div class="field"><label>Sheet</label><select data-k="sheet">${cfg.book.sheets.map((sh, i) => `<option value="${i}"${i === cfg.sheetIndex ? ' selected' : ''}>${esc(sh.name)} (${sh.chart ? 'not a worksheet' : sh.rows.length + ' row' + (sh.rows.length === 1 ? '' : 's')}${sh.hidden && !sh.chart ? ', hidden' : ''})</option>`).join('')}</select></div>`
        : `<div class="field"><label>Delimiter</label><select data-k="delim">${Object.keys(delimName).map(d => `<option value="${d === '\t' ? 'tab' : esc(d)}"${d === cfg.delim ? ' selected' : ''}>${delimName[d]}</option>`).join('')}</select></div>`}
      ${(() => { const ch = cfg.acc || (cfg.acc = defaultAccountChoice(cfg)); return `<div class="field"><label for="mapAcc">Account (bank account or credit card)</label><select id="mapAcc" data-acc>${S.accounts.map(a => `<option value="${esc(a.id)}"${ch.mode === 'existing' && ch.id === a.id ? ' selected' : ''}>${esc(a.name)}${a.type === 'card' ? ' (card)' : ''}</option>`).join('')}<option value="__newbank"${ch.mode === 'new' && ch.type === 'bank' ? ' selected' : ''}>＋ New bank account…</option><option value="__newcard"${ch.mode === 'new' && ch.type === 'card' ? ' selected' : ''}>＋ New credit card…</option></select>${ch.mode === 'new' ? `<input type="text" id="mapAccName" data-accname value="${esc(ch.name)}" placeholder="Name, e.g. Swedbank or SEB Kort" style="margin-top:6px" aria-label="New account name">` : ''}<span class="hint">Remembered for files with this layout.</span></div>`; })()}
      <div class="field"><label>Header row</label><select data-k="headerRow">${headerOpts}</select></div>
      <div class="field"><label>Date column</label><select data-k="colDate">${colOptions(cfg, cfg.colDate)}</select></div>
      <div class="field"><label>Date format</label>${sel('dateFmt', [['auto', 'Auto (per row)'], ['YMD', 'YYYY-MM-DD'], ['DMY', 'DD/MM/YYYY'], ['MDY', 'MM/DD/YYYY']])}</div>
      <div class="field"><label>Description column</label><select data-k="colDesc">${colOptions(cfg, cfg.colDesc)}</select></div>
      <div class="field"><label>Extra description column (optional)</label><select data-k="colDesc2">${colOptions(cfg, cfg.colDesc2)}</select></div>
      <div class="field"><label>Amount layout</label>${sel('amountMode', [['single', 'One amount column'], ['split', 'Separate debit / credit columns']])}</div>
      ${cfg.amountMode === 'single'
        ? `<div class="field"><label>Amount column</label><select data-k="colAmount">${colOptions(cfg, cfg.colAmount)}</select></div>`
        : `<div class="field"><label>Debit (money out) column</label><select data-k="colDebit">${colOptions(cfg, cfg.colDebit)}</select></div>
           <div class="field"><label>Credit (money in) column</label><select data-k="colCredit">${colOptions(cfg, cfg.colCredit)}</select></div>`}
      <div class="field"><label>Decimal separator</label>${sel('decimal', [['.', 'Period: 1,234.56'], [',', 'Comma: 1.234,56']])}</div>
      ${cfg.amountMode === 'single' ? `<div class="field check"><input type="checkbox" id="invChk" data-k="invert"${cfg.invert ? ' checked' : ''}><label for="invChk" style="font-size:13px;color:var(--text)">Expenses are positive numbers (flip signs)</label></div>` : ''}
    </div>
    ${cfg.dateAmbiguous ? `<div class="warnbox">⚠ Dates in this file are ambiguous (e.g. 03/04/2026). Guessed <b>${cfg.dateFmt === 'DMY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'}</b>; please verify against the preview.</div>` : ''}
    ${cfg.invertSuggested ? `<div class="hint" style="margin-top:8px">Most amounts in this file are positive, so it looks like a card statement where purchases are positive; signs are flipped. Untick if that's wrong.</div>` : ''}
    <div class="section-title">Raw file (first rows)</div>
    <div class="mini-table"><table><thead><tr>${Array.from({ length: ncols }, (_, i) => `<th>${String.fromCharCode(65 + i % 26)}</th>`).join('')}</tr></thead>
      <tbody>${raw.map(r => `<tr>${Array.from({ length: ncols }, (_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="section-title">Preview: ${res.txns.length} transaction${res.txns.length === 1 ? '' : 's'} found${res.skipped ? `, <span class="err">${res.skipped} row(s) can't be read</span>` : ''}</div>
    ${res.errors.length ? `<div class="err hint" style="margin-bottom:6px">${res.errors.map(esc).join('<br>')}</div>` : ''}
    <div class="mini-table"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Category (auto)</th></tr></thead>
      <tbody>${preview.map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.desc)}</td><td class="num ${t.amount > 0 ? 'pos' : ''}">${esc(fmt(t.amount))}</td><td>${esc(categorize(t))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No rows parsed yet</td></tr>'}</tbody></table></div>`;
  const accSel = $('[data-acc]', root);
  if (accSel) accSel.onchange = () => { const v = accSel.value; cfg.acc = v.startsWith('__new') ? { mode: 'new', type: v === '__newcard' ? 'card' : 'bank', name: v === '__newcard' ? 'Credit card' : (cfg.acc && cfg.acc.name) || 'Bank account' } : { mode: 'existing', id: v }; renderMapping(cfg); };
  const accName = $('[data-accname]', root); if (accName) accName.oninput = () => { cfg.acc.name = accName.value; };
  $$('[data-k]', root).forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.k;
    if (k === 'sheet') Object.assign(cfg, buildXlsxConfig(cfg.name, cfg.book, +el.value));
    else if (k === 'delim') Object.assign(cfg, buildConfig(cfg.name, cfg.text, el.value === 'tab' ? '\t' : el.value));
    else if (k === 'headerRow') { cfg.headerRow = +el.value; autoMapColumns(cfg); }
    else if (k === 'invert') { cfg.invert = el.checked; }
    else if (k === 'dateFmt' || k === 'decimal') { cfg[k] = el.value; if (k === 'dateFmt') cfg.dateAmbiguous = false; }
    else if (k === 'amountMode') {
      cfg.amountMode = el.value;
      if (el.value === 'split' && cfg.colDebit < 0 && cfg.colCredit < 0) cfg.colDebit = cfg.colAmount;
      if (el.value === 'single' && cfg.colAmount < 0) cfg.colAmount = cfg.colDebit >= 0 ? cfg.colDebit : cfg.colCredit;
    }
    else cfg[k] = +el.value;
    renderMapping(cfg);
  }));
}

/* ---------------- Analytics ---------------- */
/* ---------------- Periods: salary-to-salary (default) or calendar months ---------------- */
// Keys: calendar mode 'YYYY-MM'; salary mode = the period's start date 'YYYY-MM-DD'. Keys sort chronologically.
const DAY_MS = 86400000;
const ymdStr = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = ms => { const d = new Date(ms); return ymdStr(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
const addDays = (s, n) => fromUTC(toUTC(s) + n * DAY_MS);
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
const addMonths = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + String(m).padStart(2, '0'); };
// Expected payday in a month: configured day (clamped to month length), moved back to Friday if it falls on a weekend.
function paydayDate(y, m, day) {
  day = Math.min(Math.max(1, +day || 25), new Date(Date.UTC(y, m, 0)).getUTCDate());
  let ms = Date.UTC(y, m - 1, day);
  while ([0, 6].includes(new Date(ms).getUTCDay())) ms -= DAY_MS;
  return fromUTC(ms);
}
const SALARY_RE = /(^|[^a-z0-9])(lon|lonen|loneutbetalning|lonutbetalning|salary|salaries|payroll|wages|paycheck|gehalt|salaris|palkka)($|[^a-z0-9])/;
// Salary = money in, not a transfer, matching the salary pattern (or built-in keywords). t.salary true/false is a manual override.
function isSalary(t) {
  if (t.salary === true) return true;
  if (t.salary === false || !(t.amount > 0) || catType(t.category) === 'transfer') return false;
  const p = (S.settings.salaryPattern || '').trim();
  if (p) { const re = compilePattern(p); return !!re && (re.test(' ' + foldText(cleanDescription(t.desc)) + ' ') || re.test(' ' + foldText(t.desc) + ' ')); }
  return SALARY_RE.test(' ' + foldText(cleanDescription(t.desc)) + ' ');
}
let _periodCache = null; // _dataVersion owned at boot top
function salaryDates() {
  const ds = Array.from(new Set(S.txns.filter(isSalary).map(t => t.date))).sort();
  const out = [];
  for (const d of ds) if (!out.length || daysBetween(out[out.length - 1], d) >= 10) out.push(d);   // ignore top-ups / bonuses a few days after salary
  return out;
}
function getPeriods() {
  const st = S.settings, mode = st.periodMode === 'calendar' ? 'calendar' : 'salary', today = todayStr();
  const sig = [_dataVersion, S.txns.length, mode, st.payday, st.salaryPattern, today].join('|');
  if (_periodCache && _periodCache.sig === sig) return _periodCache;
  const dates = S.txns.map(t => t.date).sort();
  const minD = dates[0] || today, maxD = dates.length && dates[dates.length - 1] > today ? dates[dates.length - 1] : today;
  const firstM = addMonths(minD.slice(0, 7), -1), lastM = addMonths(maxD.slice(0, 7), 2);
  const months = []; for (let m = firstM; m <= lastM; m = addMonths(m, 1)) months.push(m);
  const fb = ym => paydayDate(+ym.slice(0, 4), +ym.slice(5, 7), st.payday || 25);
  let starts = [], salaries = [];
  if (mode === 'calendar') starts = months.map(m => m + '-01');
  else {
    salaries = salaryDates();
    if (!salaries.length) starts = months.map(fb);
    else {
      const first = salaries[0], last = salaries[salaries.length - 1];
      months.filter(m => m < first.slice(0, 7)).forEach(m => { const f = fb(m); if (daysBetween(f, first) >= 20) starts.push(f); });
      salaries.forEach((s, i) => {
        starts.push(s);
        const next = salaries[i + 1];
        if (next && daysBetween(s, next) > 45)   // missing salary month(s): fill with the expected payday
          months.filter(m => m > s.slice(0, 7) && m < next.slice(0, 7)).forEach(m => { const f = fb(m); if (daysBetween(s, f) >= 20 && daysBetween(f, next) >= 20) starts.push(f); });
      });
      months.filter(m => m > last.slice(0, 7)).forEach(m => { const f = fb(m); if (daysBetween(last, f) >= 20) starts.push(f); });
      if (starts[0] > minD) starts.unshift(fb(addMonths(starts[0].slice(0, 7), -1)) < starts[0] ? fb(addMonths(starts[0].slice(0, 7), -1)) : addDays(starts[0], -30));
    }
  }
  starts = Array.from(new Set(starts)).sort();
  const salarySet = new Set(salaries);
  const list = starts.slice(0, -1).map((s, i) => ({ key: mode === 'calendar' ? s.slice(0, 7) : s, start: s, end: addDays(starts[i + 1], -1), salary: salarySet.has(s) }));
  _periodCache = { sig, mode, list, byKey: new Map(list.map(p => [p.key, p])), ofDate: new Map(), salaries };
  return _periodCache;
}
// Income sources (cleaned names) received at least once, biggest first: choices for the salary setting.
function salaryCandidates() {
  const g = {};
  S.txns.forEach(t => { if (t.amount > 0 && catType(t.category) !== 'transfer') { const k = merchantKey(t.desc); g[k] = (g[k] || 0) + t.amount; } });
  return Object.keys(g).sort((a, b) => g[b] - g[a]).slice(0, 25);
}
function periodOf(date) {
  const P = getPeriods();
  if (P.ofDate.has(date)) return P.ofDate.get(date);
  let lo = 0, hi = P.list.length - 1, ans = P.list[0];
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (P.list[mid].start <= date) { ans = P.list[mid]; lo = mid + 1; } else hi = mid - 1; }
  const k = ans ? ans.key : date.slice(0, 7);
  P.ofDate.set(date, k);
  return k;
}
const periodInfo = key => getPeriods().byKey.get(key);
// Periods that contain data, plus the current (ongoing) one if the data is recent.
function allMonths() {
  const set = new Set(S.txns.map(t => periodOf(t.date)));
  const today = todayStr(), last = S.txns.reduce((a, t) => t.date > a ? t.date : a, '');
  if (last && daysBetween(last, today) <= 45 && daysBetween(last, today) >= 0) set.add(periodOf(today));
  return Array.from(set).sort();
}
function monthRange(from, to) { return getPeriods().list.map(p => p.key).filter(k => k >= from && k <= to); }
function prevMonth(key) {
  const L = getPeriods().list, i = L.findIndex(p => p.key === key);
  if (i > 0) return L[i - 1].key;
  return key.length === 7 ? addMonths(key, -1) : addDays(key, -30);
}
const dayMon = s => (+s.slice(8, 10)) + ' ' + MONTHS_SHORT[+s.slice(5, 7) - 1];
function periodRangeText(key) { const p = periodInfo(key); return p ? `${dayMon(p.start)} – ${dayMon(p.end)}${p.end.slice(0, 4) !== p.start.slice(0, 4) ? ' ' + p.end.slice(0, 4) : ''}` : ''; }
function daysLeftText(key) {
  const p = periodInfo(key), t = todayStr();
  if (!p || t < p.start || t > p.end) return '';
  const n = daysBetween(t, p.end) + 1;
  return n === 1 ? 'last day of this period' : `${n} days left`;
}
/* ---------------- Accounts & credit-card payoffs ----------------
   A payoff (Transfers › Credit card payment) is the sum of purchases already on the card statement, so it is a transfer.
   If that card's own statement isn't imported for the payoff's billing window, it can count as spending instead
   (per card, or for payoffs not linked to any card), so spending isn't lost. Card purchases count on their own dates. */
const PAYOFF_CAT = 'Credit card payment'; // PAYOFF_KEY imported from domain/categorize.js
const accById = id => S.accounts.find(a => a.id === id);
const accName = id => { const a = accById(id); return a ? a.name : ''; };
const cardAccounts = () => S.accounts.filter(a => a.type === 'card');
function cardMatchers(a) { return (a.match || a.name).split(',').map(x => x.trim()).filter(Boolean).map(compilePattern).filter(Boolean); }
function cardFor(t) {
  if (t.category !== PAYOFF_CAT) return null;
  const a = accById(t.account); if (a && a.type === 'card') return null;   // the card's own "payment received" line
  if (t.payCard) { const c = accById(t.payCard); if (c) return c; }
  const f = ' ' + foldText(t.desc) + ' ', c = ' ' + foldText(cleanDescription(t.desc)) + ' ';
  return cardAccounts().find(card => cardMatchers(card).some(re => re.test(f) || re.test(c))) || null;
}
let _cardTxCache = { v: -1, m: new Map() };
function cardTxnsBetween(cardId, from, to) {
  if (_cardTxCache.v !== _dataVersion) _cardTxCache = { v: _dataVersion, m: new Map() };
  const k = cardId + '|' + from + '|' + to; if (_cardTxCache.m.has(k)) return _cardTxCache.m.get(k);
  const r = S.txns.filter(x => x.account === cardId && x.date >= from && x.date <= to && x.category !== PAYOFF_CAT && catType(x.category) !== 'transfer');
  _cardTxCache.m.set(k, r); return r;
}
// 'transfer' (excluded from spending) or 'spending'
function payoffTreatment(t) {
  if (t.category !== PAYOFF_CAT) return null;
  const a = accById(t.account); if (a && a.type === 'card') return 'transfer';
  const card = cardFor(t);
  if (!card) return S.settings.countUnlinkedPayoffs ? 'spending' : 'transfer';
  if (cardTxnsBetween(card.id, addDays(t.date, -62), t.date).length) return 'transfer';   // card statement imported for this billing window
  return card.countPayoffs ? 'spending' : 'transfer';
}
// Compare a payoff with the card's purchases: previous calendar month, the month before, or since the previous payoff.
function payoffMatch(t) {
  const card = cardFor(t); if (!card) return null;
  const m = t.date.slice(0, 7), prevM = addMonths(m, -1), prev2 = addMonths(m, -2);
  const lastEnd = ym => addDays(addMonths(ym, 1) + '-01', -1);
  const prevPay = S.txns.filter(x => x !== t && x.category === PAYOFF_CAT && x.date < t.date && cardFor(x) === card).map(x => x.date).sort().pop();
  const cands = [[prevM, prevM + '-01', lastEnd(prevM)], [prev2, prev2 + '-01', lastEnd(prev2)]].map(([ym, a, b]) => ({ label: monthLabel(ym), a, b }));
  if (prevPay) cands.push({ label: 'since ' + fmtDate(prevPay), a: addDays(prevPay, 1), b: t.date });
  let best = null;
  for (const c of cands) {
    const list = cardTxnsBetween(card.id, c.a, c.b); if (!list.length) continue;
    const total = round2(-list.reduce((s, x) => s + x.amount, 0)), diff = round2(Math.abs(t.amount) - total);
    if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { card: card.name, label: c.label, total, diff, n: list.length };
  }
  return best;
}
function summarize(p, acc) {
  if (acc === undefined) acc = ui.acc || '';
  let spent = 0, income = 0, count = 0; const byCat = {}, byMain = {}, byMerchant = {};
  for (const t of S.txns) {
    if (p !== 'all' && periodOf(t.date) !== p) continue;
    if (acc && t.account !== acc) continue;
    count++;
    const ty = catType(t.category);
    if (ty === 'transfer') {
      if (t.category === PAYOFF_CAT && payoffTreatment(t) === 'spending') { spent -= t.amount; byCat[PAYOFF_KEY] = (byCat[PAYOFF_KEY] || 0) - t.amount; byMain[PAYOFF_KEY] = (byMain[PAYOFF_KEY] || 0) - t.amount; }
      continue;
    }
    if (ty === 'income') { income += t.amount; continue; }
    spent -= t.amount;   // refunds in expense categories reduce spending
    byCat[t.category] = (byCat[t.category] || 0) - t.amount;
    const mn = mainOf(t.category); byMain[mn] = (byMain[mn] || 0) - t.amount;
    if (t.amount < 0) { const mk = merchantKey(t.desc); const o = byMerchant[mk] || (byMerchant[mk] = { name: mk, total: 0, n: 0 }); o.total -= t.amount; o.n++; }
  }
  return { spent: round2(spent), income: round2(income), net: round2(income - spent), count, byCat, byMain, byMerchant };
}
// Recurring = same merchant, similar amount (±4%, ±25% for bills), in >= 2 distinct months, at most ~1 charge per month, fairly regular.
function detectRecurring() {
  const groups = {};
  for (const t of S.txns) {
    if (t.amount >= 0 || catType(t.category) !== 'expense') continue;
    const k = merchantKey(t.desc);
    (groups[k] || (groups[k] = [])).push(t);
  }
  const months = allMonths(), lastMonth = months[months.length - 1];
  const out = [];
  for (const [name, list] of Object.entries(groups)) {
    const amts = list.map(t => -t.amount).sort((a, b) => a - b);
    const median = amts[Math.floor(amts.length / 2)];
    // Bills can vary month to month; other recurring charges (subscriptions etc.) should be near-identical.
    const variable = /bill|util|insur|subscr|housing/i.test(mainOf(list[0].category));
    const tol = variable ? 0.25 : 0.04;
    const similar = list.filter(t => Math.abs(-t.amount - median) <= Math.max(0.5, median * tol));
    const ms = Array.from(new Set(similar.map(t => periodOf(t.date)))).sort();
    if (ms.length < 2) continue;
    if (!variable && similar.length / list.length < 0.6) continue;   // most charges from this merchant must match
    if (ms.length === 2 && !variable) { const a = similar.map(t => -t.amount); if (Math.max(...a) - Math.min(...a) > Math.max(0.5, median * 0.02)) continue; }
    if (similar.length / ms.length > 1.5) continue;
    if (ms.length / monthRange(ms[0], ms[ms.length - 1]).length < 0.6) continue;
    const last = similar.map(t => t.date).sort().pop();
    const avg = similar.reduce((a, t) => a - t.amount, 0) / similar.length;
    const cats = {}; similar.forEach(t => cats[t.category] = (cats[t.category] || 0) + 1);
    const cat = Object.keys(cats).sort((a, b) => cats[b] - cats[a])[0];
    out.push({ name, avg: round2(avg), months: ms.length, first: similar.map(t => t.date).sort()[0], last, category: cat, active: periodOf(last) >= prevMonth(lastMonth) });
  }
  return out.sort((a, b) => (b.active - a.active) || b.avg - a.avg);
}

/* ---------------- Charts (hand-written SVG) ---------------- */
function donutSVG(items, total, centerLabel) {
  const R = 90, r = 58, cx = 100, cy = 100;
  let a0 = -Math.PI / 2, paths = '';
  const pt = (rad, a) => [(cx + rad * Math.cos(a)).toFixed(2), (cy + rad * Math.sin(a)).toFixed(2)];
  if (items.length === 1) {
    paths = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${items[0].color}" stroke-width="${R - r}"><title>${esc(items[0].name)}: ${esc(fmt(items[0].value))}</title></circle>`;
  } else {
    for (const it of items) {
      const frac = it.value / total; if (frac <= 0) continue;
      const a1 = a0 + frac * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
      paths += `<path class="slice" ${it.subs ? `data-drill="${esc(it.key)}"` : `data-cat="${esc(it.key === PAYOFF_KEY ? PAYOFF_CAT : (it.key || it.name))}"`} d="M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z" fill="${it.color}" stroke-width="1.5" style="cursor:pointer"><title>${esc(it.name)}: ${esc(fmt(it.value))} (${(frac * 100).toFixed(1)}%)</title></path>`;
      a0 = a1;
    }
  }
  return `<svg class="donut" viewBox="0 0 200 200" role="img" aria-label="Spending by category">${paths}
    <text x="100" y="98" text-anchor="middle" class="center-big">${esc(fmtShort(total))}</text>
    <text x="100" y="117" text-anchor="middle">${esc(centerLabel)}</text></svg>`;
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function trendSVG(months, data, selected) {
  const W = window.innerWidth < 700 ? 360 : 560, H = window.innerWidth < 700 ? 220 : 260, padL = 52, padR = 10, padT = 12, padB = 30;
  const nice = niceMax(Math.max(1, ...data.map(d => Math.max(d.spent, d.income))));
  const cw = (W - padL - padR) / months.length, bw = Math.max(3, Math.min(20, cw * 0.32));
  const y = v => padT + (H - padT - padB) * (1 - v / nice);
  let s = '';
  for (let k = 0; k <= 4; k++) { const v = nice * k / 4, yy = y(v).toFixed(1); s += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text x="${padL - 6}" y="${+yy + 4}" text-anchor="end">${esc(fmtShort(v))}</text>`; }
  months.forEach((m, i) => {
    const d = data[i], x = padL + cw * i + cw / 2, isSel = m === selected;
    s += `<rect class="hit" x="${(padL + cw * i).toFixed(1)}" y="${padT}" width="${cw.toFixed(1)}" height="${H - padT - padB}" data-month="${m}"><title>${esc(monthLabel(m))}&#10;Spent: ${esc(fmt(d.spent))}&#10;Income: ${esc(fmt(d.income))}</title></rect>`;
    const sh = Math.max(0, y(0) - y(Math.max(0, d.spent))), ih = Math.max(0, y(0) - y(Math.max(0, d.income)));
    s += `<rect class="bar-spend${isSel ? ' bar-sel' : ''}" x="${(x - bw - 1).toFixed(1)}" y="${(y(0) - sh).toFixed(1)}" width="${bw.toFixed(1)}" height="${sh.toFixed(1)}" rx="2" pointer-events="none"/>`;
    s += `<rect class="bar-income${isSel ? ' bar-sel' : ''}" x="${(x + 1).toFixed(1)}" y="${(y(0) - ih).toFixed(1)}" width="${bw.toFixed(1)}" height="${ih.toFixed(1)}" rx="2" pointer-events="none"/>`;
    if (months.length <= 12 || i % Math.ceil(months.length / 12) === 0)
      s += `<text x="${x.toFixed(1)}" y="${H - 10}" text-anchor="middle" style="${isSel ? 'fill:var(--text);font-weight:700' : ''}">${MONTHS_SHORT[+m.slice(5, 7) - 1]}${m.slice(5, 7) === '01' || i === 0 ? ' ’' + m.slice(2, 4) : ''}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Monthly spending and income">${s}</svg>
    <div class="summary-line"><span class="pill"><span class="sw" style="background:var(--accent)"></span>Spent</span><span class="pill"><span class="sw" style="background:var(--good)"></span>Income</span><span class="hint">Click a ${S.settings.periodMode === 'calendar' ? 'month' : 'period'} to select it</span></div>`;
}

/* ---------------- Views ---------------- */
const ui = { view: 'dashboard', month: null, q: '', fCat: '', fCats: [], catQ: '', fAcc: '', acc: '', drill: '', fMonth: '', fType: '', sortKey: 'date', sortDir: -1, limit: 150, ruleQ: '', reviewIncome: false };

function renderAll() {
  applyTheme();
  const months = allMonths();
  if (!ui.month || (ui.month !== 'all' && !months.includes(ui.month))) ui.month = months.length ? months[months.length - 1] : 'all';
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + ui.view));
  const nOther = S.txns.filter(t => t.category === 'Other').length;
  $('#reviewBadge').textContent = nOther ? (nOther > 99 ? '99+' : nOther) : '';
  ({ dashboard: renderDashboard, transactions: renderTransactions, review: renderReview, budgets: renderBudgets, plan: renderPlan, settings: renderSettings })[ui.view]();
}
function monthSelectHTML(id, value, includeAll) {
  return `<select id="${id}" aria-label="Period">${includeAll ? `<option value="all"${value === 'all' ? ' selected' : ''}>All time</option>` : ''}${allMonths().reverse().map(m => `<option value="${m}"${m === value ? ' selected' : ''}>${esc(monthLabel(m, true))}</option>`).join('')}</select>`;
}
function emptyStateHTML() {
  return `<div class="dropzone" id="emptyDrop"><div class="big">📄</div>
    <h2 style="margin:8px 0 4px">Import your first bank or card statement</h2>
    <p class="muted" style="margin:0 0 14px">Drag &amp; drop one or more CSV or Excel (.xlsx) exports here, or click to choose files.<br>Everything stays on this device (saved in your browser's localStorage).</p>
    <button class="btn primary">Choose CSV / .xlsx files</button></div>`;
}
function budgetBarHTML(name, spent, budget) {
  const pct = budget > 0 ? spent / budget * 100 : 0;
  const cls = pct > 100 ? 'over' : pct > 85 ? 'warn' : '';
  return `<div><div class="prog-label"><span style="color:var(--text);font-weight:600">${esc(name)}</span><span>${fmt(spent)} / ${fmt(budget)} · ${pct > 100 ? `<span class="err">${fmt(spent - budget)} over</span>` : `${fmt(Math.max(0, budget - spent))} left`}</span></div>
    <div class="progress ${cls}" title="${pct.toFixed(0)}%"><div style="width:${Math.min(100, Math.max(0, pct)).toFixed(1)}%"></div></div></div>`;
}

function renderDashboard() {
  const el = $('#view-dashboard');
  if (!S.txns.length) { el.innerHTML = emptyStateHTML(); $('#emptyDrop').onclick = () => $('#fileInput').click(); return; }
  const p = ui.month, sum = summarize(p), months = allMonths();
  const prev = p !== 'all' && months.includes(prevMonth(p)) ? summarize(prevMonth(p)) : null;
  const delta = (cur, old, higherIsGood) => {
    if (!prev || !old) return '<div class="delta">&nbsp;</div>';
    const d = (cur - old) / Math.abs(old) * 100, up = d > 0;
    if (Math.abs(d) < 0.5) return `<div class="delta">No change vs ${esc(monthLabel(prevMonth(p)))}</div>`;
    return `<div class="delta"><span class="${up === higherIsGood ? 'down' : 'up'}">${up ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</span> vs ${esc(monthLabel(prevMonth(p)))}</div>`;
  };
  if (ui.drill && !(sum.byMain[ui.drill] > 0.004)) ui.drill = '';
  const drill = ui.drill;
  const src = drill ? Object.fromEntries(Object.entries(sum.byCat).filter(([k]) => mainOf(k) === drill && k !== PAYOFF_KEY)) : sum.byMain;
  const catItems = Object.entries(src).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name: drill && name === drill ? name + ' (general)' : name, key: name, value, color: catColor(name), subs: !drill && subsOf(name).length > 0 }));
  const catTotal = catItems.reduce((a, b) => a + b.value, 0);
  const merchants = Object.values(sum.byMerchant).sort((a, b) => b.total - a.total).slice(0, 8);
  const mMax = merchants.length ? merchants[0].total : 1;
  const end = p === 'all' ? months[months.length - 1] : p;
  const full = monthRange(months[0], months[months.length - 1]);
  const ei = full.indexOf(end);
  const tMonths = full.slice(Math.max(0, ei - (window.innerWidth < 500 ? 5 : 11)), ei + 1);   // phones: 6 bars so each is a comfortable tap target
  const tData = tMonths.map(m => summarize(m));
  const rec = detectRecurring(), recActive = rec.filter(r => r.active), recTotal = recActive.reduce((a, r) => a + r.avg, 0);
  const bMonth = p === 'all' ? months[months.length - 1] : p;
  const bsum = p === 'all' ? summarize(bMonth) : sum;
  const budgetCats = S.categories.filter(c => c.type === 'expense' && +S.budgets[c.name] > 0);
  const spentIn = (sm, n) => (isMain(n) ? sm.byMain[n] : sm.byCat[n]) || 0;

  el.innerHTML = `
  <div class="toolbar"><h2>Overview${p !== 'all' && p.length === 10 ? `<div class="hint" style="font-weight:500;font-size:13px;margin-top:2px">Salary period ${esc(periodRangeText(p))}${daysLeftText(p) ? ' · <b>' + daysLeftText(p) + '</b>' : ''}</div>` : p !== 'all' && daysLeftText(p) ? `<div class="hint" style="font-weight:500;font-size:13px;margin-top:2px">${daysLeftText(p)}</div>` : ''}</h2>
    ${S.accounts.length ? `<select id="accSel" aria-label="Account"><option value="">All accounts</option>${S.accounts.map(a => `<option value="${esc(a.id)}"${a.id === ui.acc ? ' selected' : ''}>${esc(a.name)}${a.type === 'card' ? ' (card)' : ''}</option>`).join('')}</select>` : ''}
    <div class="month-nav"><button class="btn icon" id="mPrev" title="Previous period" aria-label="Previous period">‹</button>${monthSelectHTML('monthSel', p, true)}<button class="btn icon" id="mNext" title="Next period" aria-label="Next period">›</button></div>
  </div>
  <div class="grid kpis">
    <div class="card kpi"><div class="label">Spent</div><div class="value">${fmt(sum.spent)}</div>${delta(sum.spent, prev && prev.spent, false)}</div>
    <div class="card kpi"><div class="label">Income</div><div class="value pos">${fmt(sum.income)}</div>${delta(sum.income, prev && prev.income, true)}</div>
    <div class="card kpi"><div class="label">Net</div><div class="value ${sum.net >= 0 ? 'pos' : 'up'}">${fmt(sum.net)}</div><div class="delta">${sum.income > 0 ? `Savings rate ${(sum.net / sum.income * 100).toFixed(0)}%` : '&nbsp;'}</div></div>
    <div class="card kpi"><div class="label">Transactions</div><div class="value">${sum.count}</div><div class="delta">${p === 'all' ? months.length + (S.settings.periodMode === 'calendar' ? ' month' : ' period') + (months.length === 1 ? '' : 's') + ' of data' : esc(monthLabel(p, true))}</div></div>
  </div>
  <div class="grid cols-2" style="margin-top:16px">
    <div class="card"><h3>${drill ? `<button class="btn small" id="drillBack" aria-label="Back to all categories">‹ All</button> ${esc(drill)}` : 'Spending by category'} <small>${esc(monthLabel(p))}${S.accounts.length ? ' · ' + esc(ui.acc ? accName(ui.acc) : 'all accounts') : ''}</small></h3>
      ${catItems.length ? `<div class="chart-wrap">${donutSVG(catItems, catTotal, drill ? 'in ' + drill.toLowerCase() : 'spent')}
        <div class="legend">${catItems.map(c => `<div class="row" ${c.subs ? `data-drill="${esc(c.key)}" title="Show subcategories"` : `data-cat="${esc(c.key === PAYOFF_KEY ? PAYOFF_CAT : c.key)}" title="Show transactions"`}><span class="sw" style="background:${c.color}"></span><span class="nm">${esc(c.name)}${c.subs ? ' <span class="muted">›</span>' : ''}</span><span class="amt">${fmt(c.value)}</span><span class="pct">${(c.value / catTotal * 100).toFixed(0)}%</span></div>`).join('')}
        ${drill ? `<div class="row" data-cat="${esc(drill)}" title="Show all ${esc(drill)} transactions"><span class="nm muted">Show all ${esc(drill)} transactions →</span></div>` : ''}</div></div>`
        : '<div class="empty">No spending in this period</div>'}
    </div>
    <div class="card"><h3>${S.settings.periodMode === 'calendar' ? 'Monthly trend' : 'Trend by salary period'} <small>last ${tMonths.length} ${S.settings.periodMode === 'calendar' ? 'month' : 'period'}${tMonths.length === 1 ? '' : 's'}</small></h3><div id="trend">${trendSVG(tMonths, tData, p)}</div></div>
    <div class="card"><h3>Top merchants <small>${esc(monthLabel(p))}</small></h3>
      ${merchants.length ? `<div class="list">${merchants.map(m => `<div class="hbar" data-merchant="${esc(m.name)}" style="cursor:pointer" title="Show transactions"><span class="nm">${esc(m.name)} <span class="muted">· ${m.n}×</span></span><span class="amt">${fmt(m.total)}</span><div class="track"><div class="fill" style="width:${Math.max(2, m.total / mMax * 100).toFixed(1)}%"></div></div></div>`).join('')}</div>` : '<div class="empty">No purchases in this period</div>'}
    </div>
    <div class="card"><h3>Recurring charges &amp; subscriptions <small>auto-detected</small></h3>
      ${rec.length ? `<div class="table-wrap"><table><thead><tr><th>Merchant</th><th class="num">Typical</th><th class="num hide-sm">${S.settings.periodMode === 'calendar' ? 'Months' : 'Periods'}</th><th>Last</th></tr></thead><tbody>
        ${rec.slice(0, 12).map(r => `<tr style="${r.active ? '' : 'opacity:.55'}"><td><div>${esc(r.name)}</div><span class="pill"><span class="sw" style="background:${catColor(r.category)}"></span>${esc(r.category)}</span></td><td class="num">${fmt(r.avg)}</td><td class="num hide-sm">${r.months}</td><td style="white-space:nowrap">${esc(fmtDate(r.last))}${r.active ? '' : '<br><span class="muted">stopped?</span>'}</td></tr>`).join('')}
        </tbody></table></div><div class="recurring-total">Active recurring ≈ <b>${fmt(recTotal)}</b> / month · ${fmt(recTotal * 12)} / year</div>`
        : '<div class="empty">Nothing recurring detected yet (needs at least 2 months of data).</div>'}
    </div>
  </div>
  ${budgetCats.length ? `<div class="card" style="margin-top:16px"><h3>Budgets <small>${esc(monthLabel(bMonth, true))}</small></h3>
    <div class="grid cols-2" style="gap:12px 24px">${budgetCats.map(c => budgetBarHTML(catLabel(c.name), spentIn(bsum, c.name), +S.budgets[c.name])).join('')}</div></div>` : ''}`;
  $('#monthSel').onchange = e => { ui.month = e.target.value; renderDashboard(); };
  const step = dir => { const list = ['all'].concat(months); const i = Math.min(list.length - 1, Math.max(0, list.indexOf(ui.month) + dir)); ui.month = list[i]; renderDashboard(); };
  $('#mPrev').onclick = () => step(-1); $('#mNext').onclick = () => step(1);
  $$('#trend [data-month]').forEach(r => r.addEventListener('click', () => { ui.month = r.dataset.month; renderDashboard(); }));
  $$('#view-dashboard [data-cat]').forEach(r => r.addEventListener('click', () => gotoTx({ fCat: r.dataset.cat })));
  $$('#view-dashboard [data-drill]').forEach(r => r.addEventListener('click', () => { ui.drill = r.dataset.drill; renderDashboard(); }));
  if ($('#drillBack')) $('#drillBack').onclick = () => { ui.drill = ''; renderDashboard(); };
  if ($('#accSel')) $('#accSel').onchange = e => { ui.acc = e.target.value; renderDashboard(); };
  $$('#view-dashboard [data-merchant]').forEach(r => r.addEventListener('click', () => gotoTx({ q: r.dataset.merchant })));
}
function gotoTx(f) { Object.assign(ui, { q: '', fCat: '', fCats: [], fType: '', fMonth: ui.month === 'all' ? '' : ui.month, limit: 150 }, f); if (ui.fCat) { ui.fCats = [ui.fCat]; ui.fCat = ''; } ui.view = 'transactions'; renderAll(); window.scrollTo(0, 0); }

/* ---------------- Searchable category picker (combobox) ---------------- */
// Cheap Swedish/English synonyms so e.g. "mat" finds Groceries/Dining and "fris" finds Hair/barber.
const CAT_SYN = {
  'Housing': 'bostad boende hem home', 'Mortgage/Rent': 'hyra bolån bolan ränta rent mortgage', 'Housing fee/BRF': 'avgift brf bostadsrätt förening', 'Home insurance': 'hemförsäkring', 'Repairs & furnishing': 'möbler renovering reparation hantverkare furniture',
  'Utilities': 'räkningar bills', 'Electricity': 'el ström elräkning power', 'Broadband': 'bredband internet wifi fiber', 'Mobile': 'mobil telefon phone', 'Water/heating': 'vatten värme fjärrvärme',
  'Groceries': 'mat livsmedel matvaror mataffär food', 'Supermarket': 'matbutik livsmedelsbutik ica coop willys hemköp lidl', 'Ethnic/specialty store': 'livs specialbutik', 'Bakery': 'bageri konditori bröd', 'Alcohol/Systembolaget': 'alkohol vin öl systemet',
  'Dining': 'mat äta ute restaurang food eat', 'Restaurant': 'restaurang lunch middag', 'Fast food': 'snabbmat burger pizza', 'Café': 'kafé fika kaffe coffee', 'Takeaway/delivery': 'hämtmat leverans', 'Bar': 'pub krog drinks',
  'Transport': 'resor bil car', 'Fuel': 'bensin diesel drivmedel tanka petrol', 'Parking': 'parkering', 'Public transport': 'kollektivtrafik buss tunnelbana pendel bus metro', 'Taxi': 'uber bolt', 'Car service/repair': 'bilverkstad verkstad däck', 'Vehicle tax/insurance': 'fordonsskatt bilförsäkring trafikförsäkring', 'Car loan/leasing': 'billån leasing',
  'Shopping': 'handla köp shop', 'Clothing': 'kläder skor clothes fashion', 'Electronics': 'elektronik dator', 'Home & garden': 'trädgård inredning', 'Online marketplace': 'nätbutik webbshop online', 'Kids': 'barn leksaker toys', 'Hobbies': 'hobby fritid',
  'Health': 'hälsa vård sjukvård', 'Pharmacy': 'apotek medicin', 'Doctor/care': 'läkare vårdcentral sjukhus', 'Dental': 'tandläkare tandvård dentist', 'Optician': 'optiker glasögon linser glasses', 'Gym/sports': 'gym träning sport idrott',
  'Pets': 'husdjur djur hund katt', 'Vet': 'veterinär djursjukhus', 'Pet insurance': 'djurförsäkring', 'Pet supplies': 'djurmat foder',
  'Subscriptions': 'prenumeration abonnemang', 'Streaming': 'film musik serier', 'Software/apps': 'appar program mjukvara', 'Memberships/unions': 'medlemskap fackförening fack',
  'Insurance': 'försäkring', 'Finance': 'bank ekonomi', 'Bank fees': 'bankavgift avgifter', 'Loan/credit': 'lån kredit csn amortering', 'Unemployment fund': 'a-kassa akassa',
  'Entertainment': 'nöje bio konsert evenemang', 'Travel': 'resa semester', 'Flights': 'flyg', 'Hotels': 'hotell', 'Trains': 'tåg sj',
  'Personal care': 'skönhet hygien', 'Hair/barber': 'frisör frisyr klippning hår barberare', 'Beauty': 'smink kosmetika', 'Education': 'utbildning skola kurs böcker', 'Gifts & donations': 'gåvor presenter present välgörenhet',
  'Income': 'inkomst', 'Salary': 'lön', 'Refunds': 'återbetalning retur', 'Other income': 'övrig inkomst', 'Transfers': 'överföring', 'Own accounts': 'egna konton', 'Savings': 'sparande spara', 'Credit card payment': 'kreditkort kortfaktura', 'Other': 'övrigt okategoriserad'
};
const foldKey = s => foldText(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Does a category (or its main) match the typed query? Every word must match the start of a word (or, 4+ letters, anywhere).
function catSearchHay(name) { return foldKey(name + ' ' + (CAT_SYN[name] || '')); }
function catQueryMatch(hay, q) {
  const words = hay.split(/[\s\/&,.()-]+/).filter(Boolean);
  return foldKey(q).split(/\s+/).filter(Boolean).every(tk => words.some(w => w.startsWith(tk)) || (tk.length >= 4 && hay.includes(tk)));
}
function catSearch(q, exclude) {   // [{main, mainHit, items:[names]}] in tree order
  const ex = new Set(exclude || []), out = [];
  mainCats().forEach(m => {
    if (ex.has(m.name)) return;
    const subs = subsOf(m.name).filter(s => !ex.has(s.name)).map(s => s.name);
    if (!q.trim()) { out.push({ main: m.name, mainHit: true, items: subs }); return; }
    const mainHit = catQueryMatch(catSearchHay(m.name), q);
    const hits = mainHit ? subs : subs.filter(s => catQueryMatch(catSearchHay(s) + ' ' + foldKey(m.name), q));
    if (mainHit || hits.length) out.push({ main: m.name, mainHit, items: hits });
  });
  return out;
}
function catPickLabel(v, extra, placeholder) {
  const ex = (extra || []).find(x => x[0] === v); if (ex) return esc(ex[1]);
  if (!v) return `<span class="cp-ph">${esc(placeholder || 'Choose category…')}</span>`;
  const c = catByName(v); if (!c) return esc(v);
  return c.parent ? `<span class="cp-of">${esc(c.parent)} › </span>${esc(c.name)}` : esc(c.name);
}
// A button that behaves like a <select> for existing code: has .value and fires a bubbling "change" event.
function catPickHTML(o) {
  return `<button type="button" class="cat-pick${o.cls ? ' ' + o.cls : ''}"${o.id ? ` id="${o.id}"` : ''} value="${esc(o.value || '')}" aria-haspopup="listbox" aria-expanded="false"
    ${o.extra ? ` data-extra="${esc(JSON.stringify(o.extra))}"` : ''}${o.exclude ? ` data-exclude="${esc(JSON.stringify(o.exclude))}"` : ''}${o.placeholder ? ` data-ph="${esc(o.placeholder)}"` : ''}${o.norecent ? ' data-norecent' : ''} ${o.attrs || ''}><span class="cp-label">${catPickLabel(o.value || '', o.extra, o.placeholder)}</span><span class="cp-caret" aria-hidden="true">▾</span></button>`;
}
function pushRecentCat(v) {
  if (!catByName(v)) return;
  const r = (S.settings.recentCats || []).filter(x => x !== v); r.unshift(v); S.settings.recentCats = r.slice(0, 6);
}
const cp = { btn: null, multi: null, active: -1, opts: [] };
function closeCatPicker(refocus) {
  const pop = $('#catPop'); if (!pop) return;
  pop.remove(); const bg = $('#catPopBg'); if (bg) bg.remove();
  window.removeEventListener('resize', cpReposition); window.removeEventListener('scroll', cpReposition, true); if (window.visualViewport) window.visualViewport.removeEventListener('resize', cpReposition);
  const b = cp.btn; cp.btn = null; const m = cp.multi; cp.multi = null;
  if (b) b.setAttribute('aria-expanded', 'false');
  if (m && m.onClose) m.onClose();
  if (refocus) { const f = b && b.isConnected ? b : (m && m.refocusId ? $('#' + m.refocusId) : null); if (f) f.focus(); }
}
const cpSheet = () => window.innerWidth <= 700;
function cpReposition() {
  const pop = $('#catPop'); if (!pop) return;
  if (cpSheet()) { if (window.visualViewport) pop.style.setProperty('--vvh', window.visualViewport.height + 'px'); return; }   // stays above the on-screen keyboard
  if (!cp.btn) return;
  if (!cp.btn.isConnected) return;
  const r = cp.btn.getBoundingClientRect(), w = Math.max(r.width, 300), h = Math.min(380, window.innerHeight - 16);
  const below = window.innerHeight - r.bottom - 8, top = below >= Math.min(h, 260) || below >= r.top ? r.bottom + 4 : Math.max(8, r.top - 4 - Math.min(h, r.top - 12));
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px'; pop.style.top = top + 'px'; pop.style.width = w + 'px';
  pop.style.maxHeight = (top > r.top ? Math.min(h, window.innerHeight - top - 8) : Math.min(h, r.top - 8)) + 'px';
}
// multi: { selected: [names], onToggle(name, list), onClose(), refocusId }
function openCatPicker(btn, multi, initialText) {
  closeCatPicker(false);
  cp.btn = btn; cp.multi = multi || null; cp.active = -1;
  const extra = btn.dataset.extra ? JSON.parse(btn.dataset.extra) : [], exclude = btn.dataset.exclude ? JSON.parse(btn.dataset.exclude) : [];
  const sheet = cpSheet();
  if (sheet) { const bg = document.createElement('div'); bg.id = 'catPopBg'; bg.className = 'cp-bg'; bg.addEventListener('click', () => closeCatPicker(true)); document.body.appendChild(bg); }
  const pop = document.createElement('div');
  pop.id = 'catPop'; pop.className = 'cat-pop' + (sheet ? ' cp-sheet' : ''); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose category');
  pop.innerHTML = `<div class="cp-top"><input type="search" id="catPopInput" role="combobox" aria-expanded="true" aria-controls="catPopList" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search categories… (e.g. park, mat, frisör)" aria-label="Search categories">
    ${multi ? '<button type="button" class="btn primary small" id="catPopDone">Done</button>' : sheet ? '<button type="button" class="btn small" id="catPopDone" aria-label="Close">✕</button>' : ''}</div>
    <div id="catPopList" class="cp-list" role="listbox"${multi ? ' aria-multiselectable="true"' : ''}></div>`;
  document.body.appendChild(pop);
  btn.setAttribute('aria-expanded', 'true');
  const input = $('#catPopInput'), list = $('#catPopList');
  const render = () => {
    const q = input.value, groups = catSearch(q, exclude), sel = multi ? new Set(multi.selected) : new Set([btn.value]);
    const opt = (v, label, cls, implied) => { const on = !!(sel.has(v) || implied); return `<div role="option" class="cp-opt${cls ? ' ' + cls : ''}${on ? ' on' : ''}${implied ? ' implied' : ''}" data-v="${esc(v)}" aria-selected="${on}">${multi ? `<span class="cp-check" aria-hidden="true">${on ? '✓' : ''}</span>` : ''}<span>${label}</span></div>`; };
    let h = '';
    const ex = extra.filter(x => !q.trim() || catQueryMatch(foldKey(x[1]), q));
    if (ex.length) h += `<div role="group">${ex.map(x => opt(x[0], esc(x[1]), 'cp-extra')).join('')}</div>`;
    const recent = !q.trim() && !multi && !btn.hasAttribute('data-norecent') ? (S.settings.recentCats || []).filter(n => catByName(n) && !exclude.includes(n) && !exclude.includes(mainOf(n))) : [];
    if (recent.length) h += `<div role="group" aria-label="Recently used"><div class="cp-head">Recently used</div>${recent.map(n => opt(n, catPickLabel(n), 'cp-recent')).join('')}</div>`;
    h += groups.map(g => {
      const mainSel = multi && sel.has(g.main), hasSubs = subsOf(g.main).length > 0;
      const mainLabel = esc(g.main) + (hasSubs ? `<span class="cp-note">${multi ? ' · all' : ' · general'}</span>` : '');
      return `<div role="group" aria-label="${esc(g.main)}">${hasSubs ? `<div class="cp-head">${esc(g.main)}</div>` : ''}${g.mainHit ? opt(g.main, mainLabel, 'cp-main') : ''}${g.items.map(n => opt(n, esc(n), 'cp-sub', mainSel)).join('')}</div>`;
    }).join('');
    list.innerHTML = h || '<div class="cp-empty">No category matches. Try another word.</div>';
    cp.opts = $$('.cp-opt', list);
    cp.active = cp.opts.length ? Math.max(0, q.trim() ? 0 : cp.opts.findIndex(o => o.classList.contains('on') && !o.classList.contains('cp-recent'))) : -1;
    if (cp.active < 0 && cp.opts.length) cp.active = 0;
    setActive(cp.active, !q.trim());
  };
  const setActive = (i, center) => {
    cp.opts.forEach(o => o.classList.remove('active'));
    cp.active = i; const o = cp.opts[i];
    if (!o) { input.removeAttribute('aria-activedescendant'); return; }
    o.classList.add('active'); o.id = 'cpo-act'; cp.opts.forEach(x => { if (x !== o && x.id === 'cpo-act') x.removeAttribute('id'); });
    input.setAttribute('aria-activedescendant', 'cpo-act');
    o.scrollIntoView({ block: center ? 'center' : 'nearest' });
  };
  const choose = o => {
    const v = o.dataset.v;
    if (multi) { const s = new Set(multi.selected); const m = mainOf(v);
      if (o.classList.contains('implied')) { s.delete(m); subsOf(m).forEach(x => { if (x.name !== v) s.add(x.name); }); }
      else if (s.has(v)) s.delete(v); else { s.add(v); if (isMain(v)) subsOf(v).forEach(x => s.delete(x.name)); }
      multi.selected = Array.from(s); multi.onToggle(v, multi.selected); const keep = input.value; render(); input.value = keep; input.focus(); return; }
    btn.value = v; $('.cp-label', btn).innerHTML = catPickLabel(v, extra, btn.dataset.ph);
    if (!btn.hasAttribute('data-norecent')) pushRecentCat(v);
    closeCatPicker(true);
    btn.dispatchEvent(new Event('change', { bubbles: true }));
  };
  list.addEventListener('mousedown', e => e.preventDefault());   // keep focus in the search field
  list.addEventListener('click', e => { const o = e.target.closest('.cp-opt'); if (o) choose(o); });
  list.addEventListener('mousemove', e => { const o = e.target.closest('.cp-opt'); if (o && !o.classList.contains('active')) { const i = cp.opts.indexOf(o); cp.opts.forEach(x => x.classList.remove('active')); o.classList.add('active'); cp.active = i; } });
  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (cp.opts.length) setActive((cp.active + (e.key === 'ArrowDown' ? 1 : -1) + cp.opts.length) % cp.opts.length); }
    else if (e.key === 'Home' && e.ctrlKey || e.key === 'PageUp') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && e.ctrlKey || e.key === 'PageDown') { e.preventDefault(); setActive(cp.opts.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (cp.opts[cp.active]) choose(cp.opts[cp.active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCatPicker(true); }
    else if (e.key === 'Tab') closeCatPicker(false);
  });
  if ($('#catPopDone')) $('#catPopDone').onclick = () => closeCatPicker(true);
  if (initialText) input.value = initialText;
  render();
  cpReposition(); window.addEventListener('resize', cpReposition); window.addEventListener('scroll', cpReposition, true); if (window.visualViewport) window.visualViewport.addEventListener('resize', cpReposition);
  input.focus();
}
document.addEventListener('mousedown', e => { const pop = $('#catPop'); if (pop && !pop.contains(e.target) && !(cp.btn && cp.btn.contains(e.target)) && !e.target.closest('#catPopBg')) closeCatPicker(false); }, true);
document.addEventListener('click', e => {
  const b = e.target.closest('.cat-pick'); if (!b || b.disabled) return;
  if (cp.btn === b && $('#catPop')) { closeCatPicker(true); return; }
  if (b.dataset.multi) { const h = catPickMulti[b.dataset.multi]; if (h) openCatPicker(b, h()); } else openCatPicker(b);
});
document.addEventListener('keydown', e => {
  const b = e.target.closest && e.target.closest('.cat-pick'); if (!b || b.disabled || $('#catPop')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); b.click(); }
  else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); b.dataset.multi ? openCatPicker(b, catPickMulti[b.dataset.multi](), e.key) : openCatPicker(b, null, e.key); const i = $('#catPopInput'); if (i) i.dispatchEvent(new Event('input')); }
});
const catPickMulti = {
  // Activity filter: several categories at once; a main category includes all its subcategories.
  txf: () => ({ selected: ui.fCats.slice(), refocusId: 'fCatAdd', onToggle: (v, list) => { ui.fCats = list; ui.limit = 150; renderTransactions(); } })
};

// Hide category rows that don't match (main matches → all its subs shown; a matching sub keeps its main visible). Returns the number of visible rows.
function filterCatRows(rows, q, kids) {
  const show = new Set(); catSearch(q || '', []).forEach(g => { show.add(g.main); g.items.forEach(n => show.add(n)); });
  const on = n => !String(q || '').trim() || show.has(n) || (!catByName(n) && catQueryMatch(catSearchHay(n), q));
  let vis = 0;
  rows.forEach(r => { const ok = on(r.dataset.cname); r.hidden = !ok; if (ok) vis++;
    if (kids) kids(r).filter(k => k !== r).forEach(k => { const v = on(k.dataset.cname); k.hidden = !v; if (v) vis++; }); });
  return vis;
}
function catOptions(sel, includeAll, exclude) {
  return (includeAll ? `<option value="">All categories</option>` : '') + mainCats().filter(m => !(exclude && exclude.includes(m.name))).map(m => {
    const subs = subsOf(m.name), o = (n, l) => `<option value="${esc(n)}"${n === sel ? ' selected' : ''}>${esc(l)}</option>`;
    return subs.length ? `<optgroup label="${esc(m.name)}">${o(m.name, m.name + (includeAll ? ' (all)' : ' (general)'))}${subs.map(c => o(c.name, c.name)).join('')}</optgroup>` : o(m.name, m.name);
  }).join('');
}
function filteredTxns() {
  const q = foldKey(ui.q.trim());
  const list = S.txns.filter(t => (!ui.fCats.length || ui.fCats.some(c => inCat(t.category, c))) && (!ui.fAcc || t.account === ui.fAcc) && (!ui.fMonth || periodOf(t.date) === ui.fMonth) &&
    (!ui.fType || (ui.fType === 'in' ? t.amount > 0 : t.amount < 0)) &&
    (!q || foldKey(t.desc + ' ' + cleanDescription(t.desc) + ' ' + t.note + ' ' + catLabel(t.category) + ' ' + merchantKey(t.desc) + ' ' + Math.abs(t.amount).toFixed(2)).includes(q)));
  const k = ui.sortKey, d = ui.sortDir;
  return list.sort((a, b) => {
    let r;
    if (k === 'amount') r = a.amount - b.amount;
    else if (k === 'desc') r = displayName(a.desc).localeCompare(displayName(b.desc));
    else if (k === 'category') r = a.category.localeCompare(b.category);
    else r = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    return r * d || (a.id < b.id ? -1 : 1);
  });
}
function renderTransactions() {
  const el = $('#view-transactions');
  if (!S.txns.length) {
    el.innerHTML = `<div class="toolbar"><h2>Transactions</h2><button class="btn" id="addTx">＋ Add</button></div>` + emptyStateHTML();
    $('#emptyDrop').onclick = () => $('#fileInput').click(); $('#addTx').onclick = () => editTxn(null); return;
  }
  const list = filteredTxns();
  const out = list.filter(t => t.amount < 0).reduce((a, t) => a + t.amount, 0), inn = list.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const arrow = k => ui.sortKey === k ? (ui.sortDir > 0 ? ' ▲' : ' ▼') : '';
  const filtered = ui.q || ui.fCats.length || ui.fMonth || ui.fType || ui.fAcc;
  el.innerHTML = `
  <div class="toolbar"><h2>Transactions</h2><button class="btn" id="addTx">＋ Add</button><button class="btn" id="expCsv" title="Export the listed transactions as CSV">Export CSV</button></div>
  <div class="card">
    <div class="toolbar" style="margin-bottom:6px">
      <input type="search" id="txSearch" placeholder="Search description, category, note, amount…" value="${esc(ui.q)}" style="flex:1;min-width:180px" aria-label="Search">
      <div class="cat-chips" id="fCats" role="group" aria-label="Category filter">${ui.fCats.map(c => `<button type="button" class="chip" data-chipx="${esc(c)}" aria-label="Remove filter ${esc(catLabel(c))}">${esc(catLabel(c))}${subsOf(c).length ? ' · all' : ''} <span aria-hidden="true">✕</span></button>`).join('')}<button type="button" class="cat-pick" id="fCatAdd" data-multi="txf" data-norecent value="" aria-haspopup="listbox" aria-expanded="false" aria-label="Filter by categories"><span class="cp-label">${ui.fCats.length ? '＋ Category' : 'All categories'}</span><span class="cp-caret" aria-hidden="true">▾</span></button></div>
      ${S.accounts.length ? `<select id="fAcc" aria-label="Account"><option value="">All accounts</option>${S.accounts.map(a => `<option value="${esc(a.id)}"${a.id === ui.fAcc ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
      <select id="fMonth" aria-label="Month"><option value="">All periods</option>${allMonths().reverse().map(m => `<option value="${m}"${m === ui.fMonth ? ' selected' : ''}>${esc(monthLabel(m, true))}</option>`).join('')}</select>
      <select id="fType" aria-label="Direction"><option value="">In &amp; out</option><option value="out"${ui.fType === 'out' ? ' selected' : ''}>Money out</option><option value="in"${ui.fType === 'in' ? ' selected' : ''}>Money in</option></select>
      ${filtered ? '<button class="btn small" id="clrF">Clear filters</button>' : ''}
    </div>
    <div class="summary-line"><span><b>${list.length}</b> transaction${list.length === 1 ? '' : 's'}</span><span>Out <b>${fmt(out)}</b></span><span>In <b class="pos">${fmt(inn)}</b></span></div>
    <div class="table-wrap"><table id="txTable"><thead><tr>
      <th class="sortable" data-sort="date">Date${arrow('date')}</th><th class="sortable" data-sort="desc">Description${arrow('desc')}</th>
      <th class="sortable" data-sort="category">Category${arrow('category')}</th><th class="sortable num" data-sort="amount">Amount${arrow('amount')}</th><th></th></tr></thead>
      <tbody>${list.slice(0, ui.limit).map(t => `<tr data-id="${t.id}">
        <td class="c-date">${esc(fmtDate(t.date))}</td>
        <td class="c-desc tx-desc" title="Bank text: ${esc(t.desc)}">${esc(displayName(t.desc))}${isViaKlarna(t.desc) ? ' <span class="pill" style="font-size:11px;padding:0 6px;font-weight:500" title="Paid via Klarna">via Klarna</span>' : ''}${isSalary(t) ? ` <span class="pill salary-pill" style="font-size:11px;padding:0 6px;font-weight:500" title="${t.salary === true ? 'Marked as salary by you' : 'Detected as salary'}: a new period starts on this date">salary${t.salary === true ? ' ✓' : ''}</span>` : ''}${cleanDescription(t.desc) !== t.desc.replace(/\s+/g, ' ').trim() ? `<span class="tx-raw">${esc(t.desc)}</span>` : ''}${t.note ? `<span class="note">${esc(t.note)}</span>` : ''}${S.accounts.length > 1 && t.account ? `<span class="tx-raw">${esc(accName(t.account))}</span>` : ''}${payoffInfoHTML(t)}</td>
        <td class="c-cat">${catPickHTML({ value: t.category, cls: 'cat-select', attrs: 'data-catsel aria-label="Category"' })}${t.catSource === 'dict' && !t.catManual ? `<span class="auto-pill" title="Auto: matched the built-in merchant list (${esc(titleCase(t.dictName))}). Pick another category to correct it; you'll be offered a rule.">auto</span>` : ''}</td>
        <td class="c-amt num ${t.amount > 0 ? 'pos' : ''}">${fmt(t.amount)}</td>
        <td class="c-act row-actions"><button class="btn small" data-edit>Edit</button> <button class="btn small danger" data-del title="Delete" aria-label="Delete">✕</button></td></tr>`).join('')}
      </tbody></table></div>
    ${list.length > ui.limit ? `<div style="text-align:center;margin-top:12px"><button class="btn" id="more">Show more (${list.length - ui.limit} remaining)</button></div>` : ''}
    ${!list.length ? '<div class="empty">No transactions match these filters</div>' : ''}
  </div>`;
  const s = $('#txSearch');
  s.oninput = () => { ui.q = s.value; ui.limit = 150; clearTimeout(renderTransactions._t); renderTransactions._t = setTimeout(() => { renderTransactions(); const n = $('#txSearch'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 200); };
  $$('#fCats [data-chipx]').forEach(b => b.onclick = () => { ui.fCats = ui.fCats.filter(x => x !== b.dataset.chipx); ui.limit = 150; renderTransactions(); const n = $('#fCatAdd'); if (n) n.focus(); });
  if ($('#fAcc')) $('#fAcc').onchange = e => { ui.fAcc = e.target.value; renderTransactions(); };
  $('#fMonth').onchange = e => { ui.fMonth = e.target.value; renderTransactions(); };
  $('#fType').onchange = e => { ui.fType = e.target.value; renderTransactions(); };
  if ($('#clrF')) $('#clrF').onclick = () => { ui.q = ui.fCat = ui.fMonth = ui.fType = ui.fAcc = ''; ui.fCats = []; renderTransactions(); };
  if ($('#more')) $('#more').onclick = () => { ui.limit += 300; renderTransactions(); };
  $('#addTx').onclick = () => editTxn(null);
  $('#expCsv').onclick = () => exportCSV(list);
  $$('#txTable th[data-sort]').forEach(th => th.onclick = () => { const k = th.dataset.sort; if (ui.sortKey === k) ui.sortDir *= -1; else { ui.sortKey = k; ui.sortDir = (k === 'date' || k === 'amount') ? -1 : 1; } renderTransactions(); });
  const tb = $('#txTable tbody');
  tb.onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const t = S.txns.find(x => x.id === tr.dataset.id); if (!t) return;
    if (e.target.closest('[data-edit]')) editTxn(t);
    else if (e.target.closest('[data-del]') && confirm(`Delete this transaction?\n\n${t.date}  ${t.desc}  ${fmt(t.amount)}`)) { S.txns = S.txns.filter(x => x !== t); save(); renderTransactions(); toast('Transaction deleted'); }
  };
  tb.onchange = e => {
    if (!e.target.matches('[data-catsel]')) return;
    const t = S.txns.find(x => x.id === e.target.closest('tr').dataset.id); if (!t) return;
    t.category = e.target.value; t.catManual = true; t.catSource = 'manual'; save();
    if (t.category === PAYOFF_CAT) chooseCard([t], () => {}); else offerRule(t);
  };
}
function payoffInfoHTML(t) {
  if (t.category !== PAYOFF_CAT) return '';
  const a = accById(t.account); if (a && a.type === 'card') return '<span class="tx-raw">Card payment received (not spending)</span>';
  const card = cardFor(t), tr = payoffTreatment(t);
  if (!card) return `<span class="tx-raw">Card payoff · ${tr === 'spending' ? 'counted as spending (no card linked)' : 'not counted'}</span>`;
  const m = tr === 'transfer' ? payoffMatch(t) : null;
  const what = m ? (Math.abs(m.diff) < 1 ? `matches ${esc(card.name)} statement of ${fmt(m.total)} (${esc(m.label)})` : `${esc(card.name)} purchases ${esc(m.label)}: ${fmt(m.total)}, difference ${fmt(Math.abs(m.diff))}`) : '';
  return `<span class="tx-raw payoff-info">Pays off ${esc(card.name)} · ${tr === 'spending' ? 'counted as spending until the card statement is imported' : 'transfer (card purchases are listed separately)'}${what ? ' · ' + what : ''}</span>`;
}
// Link payoffs to a card (existing or new); the card remembers the payoff text, and a rule is saved.
function chooseCard(txns, done) {
  const t = txns[0], kw = merchantKey(t.desc).toLowerCase();
  openModal('Which card does this pay off?', `
    <p style="margin-top:0">${esc(displayName(t.desc))} ${fmt(t.amount)}. Card payoffs are transfers: the purchases are on the card's own statement. Until that statement is imported they can still count as spending.</p>
    <div class="field"><label for="ccSel">Card</label><select id="ccSel">${cardAccounts().map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}<option value="__new"${cardAccounts().length ? '' : ' selected'}>＋ New card…</option><option value="__none">Not linked to a card</option></select></div>
    <div class="field" id="ccNewF"${cardAccounts().length ? ' style="display:none"' : ''}><label for="ccName">New card name</label><input type="text" id="ccName" value="${esc(titleCase(kw))}"></div>
    <div class="field"><label for="ccPat">Payoff text on your bank statement (keyword or /regex/)</label><input type="text" id="ccPat" value="${esc(kw)}"></div>`, [
    { label: 'Skip', cancel: true, onClick: () => { setTimeout(done, 0); } },
    { label: 'Link payoff', cls: 'primary', onClick: () => {
      const v = $('#ccSel').value, pat = $('#ccPat').value.trim();
      if (pat && !compilePattern(pat)) { toast('Invalid pattern', true); return false; }
      let card = null;
      if (v === '__new') { card = { id: uid(), name: $('#ccName').value.trim() || 'Credit card', type: 'card', match: pat, countPayoffs: true }; S.accounts.push(card); }
      else if (v !== '__none') { card = accById(v); if (pat && !cardMatchers(card).some(re => re.test(' ' + foldText(t.desc) + ' '))) card.match = (card.match ? card.match + ', ' : '') + pat; }
      txns.forEach(x => { x.payCard = card ? card.id : ''; });
      if (pat && !S.rules.some(r => r.user && r.pattern.toLowerCase() === pat.toLowerCase() && r.category === PAYOFF_CAT)) S.rules.unshift({ id: uid(), pattern: pat, category: PAYOFF_CAT, user: true });
      invalidateRules(); save(); renderAll(); setTimeout(done, 0);
    } }
  ]);
  $('#ccSel').onchange = e => { $('#ccNewF').style.display = e.target.value === '__new' ? '' : 'none'; };
}
// After a manual category change: offer to apply to similar merchants and save as a rule.
function offerRule(t) {
  const matches = p => { const re = compilePattern(p); return re ? S.txns.filter(x => x !== t && re.test(' ' + x.desc.toLowerCase() + ' ') && x.category !== t.category) : null; };
  openModal('Category set to ' + t.category, `
    <p style="margin-top:0">Also categorize similar transactions as <b>${esc(t.category)}</b> and remember this as a rule for future imports?</p>
    <div class="field"><label>Match descriptions containing (word/phrase, or /regex/)</label><input type="text" id="rulePat" value="${esc(merchantKey(t.desc).toLowerCase())}"></div>
    <p class="hint" id="ruleCount"></p>`, [
    { label: 'Just this one', cancel: true },
    { label: 'Apply to similar & create rule', cls: 'primary', onClick: () => {
      const p = $('#rulePat').value.trim(); const list = matches(p);
      if (!p || !list) { toast('Invalid pattern', true); return false; }
      S.rules.unshift({ id: uid(), pattern: p, category: t.category, user: true }); invalidateRules();
      list.forEach(x => { x.category = t.category; x.catManual = false; });
      save(); toast(`Rule created · ${list.length} other transaction${list.length === 1 ? '' : 's'} updated`);
    } }
  ], { onClose: () => renderAll() });
  const upd = () => { const l = matches($('#rulePat').value.trim()); $('#ruleCount').textContent = !l ? 'Invalid pattern' : `${l.length} other existing transaction${l.length === 1 ? '' : 's'} would change to ${t.category}.`; };
  $('#rulePat').oninput = upd; upd();
}
function editTxn(t) {
  const isNew = !t;
  const d = t || { date: new Date().toISOString().slice(0, 10), desc: '', amount: 0, category: '', note: '' };
  openModal(isNew ? 'Add transaction' : 'Edit transaction', `
    <div class="form-grid">
      <div class="field"><label for="eDate">Date</label><input type="date" id="eDate" value="${esc(d.date)}"></div>
      <div class="field"><label for="eType">Type</label><select id="eType"><option value="out"${d.amount <= 0 ? ' selected' : ''}>Expense (money out)</option><option value="in"${d.amount > 0 ? ' selected' : ''}>Income / refund (money in)</option></select></div>
      <div class="field" style="grid-column:1/-1"><label for="eDesc">Description (original bank text)</label><input type="text" id="eDesc" value="${esc(d.desc)}" placeholder="e.g. Coffee shop">${isNew ? '' : `<span class="hint">Shown as: <b>${esc(displayName(d.desc))}</b></span>`}</div>
      <div class="field"><label for="eAmt">Amount</label><input type="number" step="0.01" min="0" id="eAmt" inputmode="decimal" value="${d.amount ? Math.abs(d.amount) : ''}" placeholder="0.00"></div>
      <div class="field"><label for="eCat">Category</label>${catPickHTML({ id: 'eCat', value: isNew ? '__auto' : d.category, extra: [['__auto', 'Auto (from rules)']] })}</div>
      ${S.accounts.length ? `<div class="field"><label for="eAcc">Account</label><select id="eAcc"><option value="">—</option>${S.accounts.map(a => `<option value="${esc(a.id)}"${a.id === d.account ? ' selected' : ''}>${esc(a.name)}${a.type === 'card' ? ' (card)' : ''}</option>`).join('')}</select></div>` : ''}
      <div class="field" id="eCardF"${d.category === PAYOFF_CAT ? '' : ' style="display:none"'}><label for="eCard">Pays off card</label><select id="eCard"><option value="">Auto (by payoff text)</option>${cardAccounts().map(a => `<option value="${esc(a.id)}"${a.id === d.payCard ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="__new">＋ New card…</option></select><input type="text" id="eCardName" placeholder="New card name" style="display:none;margin-top:6px"></div>
      <div class="field"><label for="eSal">Salary (starts a new period)</label><select id="eSal"><option value="auto"${d.salary === undefined ? ' selected' : ''}>Auto${isNew ? '' : ' (' + (isSalary(Object.assign({}, d, { salary: undefined })) ? 'detected: yes' : 'detected: no') + ')'}</option><option value="yes"${d.salary === true ? ' selected' : ''}>Yes, this is salary</option><option value="no"${d.salary === false ? ' selected' : ''}>No, not salary</option></select></div>
      <div class="field" style="grid-column:1/-1"><label for="eNote">Note (optional)</label><input type="text" id="eNote" value="${esc(d.note)}"></div>
    </div>`, [
    { label: 'Cancel', cancel: true },
    { label: isNew ? 'Add' : 'Save', cls: 'primary', onClick: () => {
      const date = $('#eDate').value, desc = $('#eDesc').value.trim(), a = parseFloat(String($('#eAmt').value).replace(',', '.'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Please enter a valid date', true); return false; }
      if (!desc) { toast('Please enter a description', true); return false; }
      if (!isFinite(a) || a === 0) { toast('Please enter an amount', true); return false; }
      const obj = t || { id: uid(), source: 'manual' };
      obj.date = date; obj.desc = desc; obj.amount = round2(($('#eType').value === 'in' ? 1 : -1) * Math.abs(a)); obj.note = $('#eNote').value.trim();
      const sv = $('#eSal').value; obj.salary = sv === 'yes' ? true : sv === 'no' ? false : undefined;
      if ($('#eAcc')) obj.account = $('#eAcc').value;
      let cardId = $('#eCard').value;
      if ($('#eCat').value === PAYOFF_CAT) {
        if (cardId === '__new') { const card = { id: uid(), name: $('#eCardName').value.trim() || 'Credit card', type: 'card', match: merchantKey(desc).toLowerCase(), countPayoffs: true }; S.accounts.push(card); cardId = card.id; }
        obj.payCard = cardId;
        const pat = merchantKey(desc).toLowerCase();
        const card = accById(cardId);
        if (card && pat && pat !== '(unknown)' && !cardMatchers(card).some(re => re.test(' ' + foldText(desc) + ' '))) card.match = (card.match ? card.match + ', ' : '') + pat;
        if (pat && pat !== '(unknown)' && !S.rules.some(r => r.user && r.pattern.toLowerCase() === pat && r.category === PAYOFF_CAT)) { S.rules.unshift({ id: uid(), pattern: pat, category: PAYOFF_CAT, user: true }); invalidateRules(); }
      } else obj.payCard = '';
      const c = $('#eCat').value;
      if (c === '__auto') { obj.catManual = false; invalidateRules(); obj.category = categorize(obj); }
      else { if (isNew || c !== d.category) { obj.catManual = true; obj.catSource = 'manual'; } obj.category = c; }
      obj.key = dedupeKey(obj);
      if (isNew) S.txns.push(obj);
      save(); renderAll(); toast(isNew ? 'Transaction added' : 'Transaction saved');
    } }
  ]);
  const syncCard = () => { $('#eCardF').style.display = $('#eCat').value === PAYOFF_CAT ? '' : 'none'; $('#eCardName').style.display = $('#eCard').value === '__new' ? '' : 'none'; };
  $('#eCat').addEventListener('change', syncCard); $('#eCard').addEventListener('change', syncCard);
}

// ---- Review uncategorized: group 'Other' by cleaned merchant; one pick categorizes the group + saves a rule
function reviewGroups() {
  const pool = S.txns.filter(t => t.category === 'Other' || (ui.reviewIncome && t.amount > 0 && catType(t.category) === 'income' && !t.catManual && !matchRule(cleanDescription(t.desc)) && !matchRule(t.desc) && !fuzzyMatchRule(cleanDescription(t.desc))));
  const g = {};
  for (const t of pool) {
    const k = merchantKey(t.desc);
    const o = g[k] || (g[k] = { name: k, txns: [], total: 0, raws: new Set(), from: t.date, to: t.date });
    o.txns.push(t); o.total += t.amount; o.raws.add(t.desc);
    if (t.date < o.from) o.from = t.date; if (t.date > o.to) o.to = t.date;
  }
  return { pool, groups: Object.values(g).sort((a, b) => b.txns.length - a.txns.length || Math.abs(b.total) - Math.abs(a.total)) };
}
function renderReview() {
  const el = $('#view-review');
  const { pool, groups } = reviewGroups();
  const nOther = S.txns.filter(t => t.category === 'Other').length;
  el.innerHTML = `
  <div class="toolbar"><h2>Review uncategorized</h2>
    <label class="hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="revInc"${ui.reviewIncome ? ' checked' : ''}> Also show unrecognised money-in (auto-filed as Income)</label></div>
  <div class="card">
    <p class="hint" style="margin-top:0">${S.txns.length ? `<b>${nOther}</b> of ${S.txns.length} transactions (${(nOther / S.txns.length * 100).toFixed(1)}%) are in "Other". ` : ''}Grouped by cleaned merchant name, most frequent first. Choosing a category files <b>every</b> transaction in the group and saves a rule, so future imports are categorized automatically.</p>
    <p class="hint">🔎 <b>Search</b> opens a normal DuckDuckGo search in a new tab, only when you tap it, and sends just the cleaned merchant name plus "Sverige" — no amounts, dates or other data. Nothing else in this app goes online.</p>
    ${groups.length ? groups.map((gr, i) => `<div class="review-row" data-g="${i}">
      <div style="min-width:0"><div style="font-weight:650">${esc(gr.name)}</div>
        <div class="stats">${gr.txns.length}× · ${fmt(gr.total)} · ${esc(fmtDate(gr.from))}${gr.from !== gr.to ? ' – ' + esc(fmtDate(gr.to)) : ''}${gr.txns[0].category !== 'Other' ? ` · now ${esc(gr.txns[0].category)}` : ''}</div>
        <div class="raw" title="${esc([...gr.raws].join('\n'))}">Bank text: ${esc([...gr.raws].slice(0, 3).join(' · '))}${gr.raws.size > 3 ? ` (+${gr.raws.size - 3} more)` : ''}</div></div>
      <div class="review-actions"><a class="btn small" href="https://duckduckgo.com/?q=${encodeURIComponent(gr.name + ' Sverige')}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="Opens a web search for just &quot;${esc(gr.name)} Sverige&quot; in a new tab">🔎 Search</a>
      ${catPickHTML({ value: '', placeholder: 'Choose category…', exclude: ['Other'], attrs: `data-revcat aria-label="Category for ${esc(gr.name)}"` })}</div>
    </div>`).join('') : `<div class="empty">${pool.length || nOther ? '' : 'Nothing to review. Every transaction has a category 🎉'}</div>`}
  </div>`;
  $('#revInc').onchange = e => { ui.reviewIncome = e.target.checked; renderReview(); };
  $$('#view-review [data-revcat]').forEach(sel => sel.onchange = () => {
    const gr = groups[+sel.closest('[data-g]').dataset.g], cat = sel.value; if (!gr || !cat) return;
    const pattern = cleanDescription(gr.txns[0].desc).toLowerCase().split(/\s+/).slice(0, 3).join(' ');
    const rulePattern = merchantKey(gr.txns[0].desc).toLowerCase() === '(unknown)' ? pattern : merchantKey(gr.txns[0].desc).toLowerCase();
    if (!S.rules.some(r => r.pattern.toLowerCase() === rulePattern && r.category === cat)) S.rules.unshift({ id: uid(), pattern: rulePattern, category: cat, user: true });
    invalidateRules();
    gr.txns.forEach(t => { t.category = cat; t.catManual = false; });
    // the new rule may also cover other uncategorized rows with the same cleaned name
    let extra = 0; S.txns.forEach(t => { if (t.category === 'Other' && !t.catManual && categorize(t) === cat) { t.category = cat; extra++; } });
    save(); renderAll();
    toast(`${gr.txns.length + extra} transaction${gr.txns.length + extra === 1 ? '' : 's'} → ${cat} · rule "${rulePattern}" saved`);
    if (cat === PAYOFF_CAT) chooseCard(gr.txns, () => {});
  });
}

function renderBudgets() {
  const el = $('#view-budgets');
  const months = allMonths();
  const m = ui.month && ui.month !== 'all' ? ui.month : (months[months.length - 1] || periodOf(todayStr()));
  const sum = summarize(m);
  const mains = mainCats().filter(c => c.type === 'expense');
  const spentIn = (sm, n) => (isMain(n) ? sm.byMain[n] : sm.byCat[n]) || 0;
  // total: main budgets, plus sub budgets whose main has no budget of its own (avoids double counting)
  const counted = S.categories.filter(c => c.type === 'expense' && +S.budgets[c.name] > 0 && (!c.parent || !(+S.budgets[c.parent] > 0)));
  const totalBudget = counted.reduce((a, c) => a + +S.budgets[c.name], 0);
  const totalSpent = counted.reduce((a, c) => a + spentIn(sum, c.name), 0);
  const last3 = months.filter(x => x <= m).slice(-3);
  const avg = {}; last3.forEach(x => { const sm = summarize(x); S.categories.forEach(c => { const v = spentIn(sm, c.name); if (v) avg[c.name] = (avg[c.name] || 0) + v / last3.length; }); });
  const row = (c, sub) => {
    const b = +S.budgets[c.name] || 0, sp = spentIn(sum, c.name);
    return `<div class="budget-row${sub ? ' sub' : ''}"><div><span class="pill"><span class="sw" style="background:${c.color}"></span>${esc(c.name)}</span>${avg[c.name] ? `<div class="hint" style="margin-top:3px">avg ${fmt(avg[c.name])}</div>` : ''}</div>
        <input type="number" min="0" step="1" inputmode="decimal" placeholder="No budget" data-budget="${esc(c.name)}" value="${b || ''}" aria-label="Budget for ${esc(catLabel(c.name))}">
        <div class="bp">${b > 0 ? budgetBarHTML('', sp, b) : `<span class="hint">Spent ${fmt(sp)}</span>`}</div></div>`;
  };
  el.innerHTML = `
  <div class="toolbar"><h2>Budgets</h2>${catPickHTML({ id: 'bFind', placeholder: 'Find category…', norecent: true, exclude: mainCats().filter(c => c.type !== 'expense').map(c => c.name), attrs: 'aria-label="Find a category to budget"' })}${months.length ? monthSelectHTML('bMonth', m, false) : ''}</div>
  <div class="card">
    <p class="hint" style="margin-top:0">Optional budget per main category or subcategory for each ${S.settings.periodMode === 'calendar' ? 'calendar month' : 'salary period (salary to salary)'} (leave empty for none). Progress shows spending in <b>${esc(monthLabel(m, true))}</b>${daysLeftText(m) ? ' (' + daysLeftText(m) + ')' : ''}; "avg" is the average of the last ${last3.length || 3} ${S.settings.periodMode === 'calendar' ? 'month' : 'period'}(s).</p>
    ${totalBudget > 0 ? `<div style="margin-bottom:10px">${budgetBarHTML('All budgeted categories', totalSpent, totalBudget)}</div>` : ''}
    ${mains.map(c => { const subs = subsOf(c.name); const open = subs.some(x => +S.budgets[x.name] > 0) || ui.openBudget === c.name;
      return row(c, false) + (subs.length ? `<details class="budget-subs" data-main="${esc(c.name)}"${open ? ' open' : ''}><summary>${subs.length} subcategories${subs.some(x => +S.budgets[x.name] > 0) ? ' · ' + subs.filter(x => +S.budgets[x.name] > 0).length + ' budgeted' : ''}</summary>${subs.map(x => row(x, true)).join('')}</details>` : '');
    }).join('')}
  </div>`;
  if ($('#bMonth')) $('#bMonth').onchange = e => { ui.month = e.target.value; renderBudgets(); };
  $$('details.budget-subs').forEach(d => d.addEventListener('toggle', () => { if (d.open) ui.openBudget = d.dataset.main; }));
  $('#bFind').addEventListener('change', e => {
    const inp = $$('[data-budget]').find(x => x.dataset.budget === e.target.value); if (!inp) return;
    const d = inp.closest('details'); if (d) { d.open = true; ui.openBudget = d.dataset.main; }
    const row = inp.closest('.budget-row'); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600);
    row.scrollIntoView({ block: 'center' }); inp.focus({ preventScroll: true });
  });
  $$('[data-budget]').forEach(inp => inp.onchange = () => {
    const v = parseFloat(inp.value); if (isFinite(v) && v > 0) S.budgets[inp.dataset.budget] = round2(v); else delete S.budgets[inp.dataset.budget];
    save(); renderBudgets();
  });
}

/* ---------------- Plan: savings, insights, goals, investing (all computed on this device) ---------------- */
// Swedish ISK / KF standard tax ("schablonbeskattning"), income year 2026 (Skatteverket): statslåneräntan 30 Nov 2025 = 2.55 %,
// + 1 percentage point = 3.55 % schablonintäkt (never below 1.25 %), taxed at 30 % => 1.065 % of the capital base above the tax-free 300,000 kr.
const PS = () => S.plan.settings;
function quantile(arr, q) { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y), pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return a[lo] + (a[hi] - a[lo]) * (pos - lo); }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const floor100 = v => Math.max(0, Math.floor(v / 100) * 100);
const isEssentialCat = c => PS().essential.includes(c);
const isCreditTxn = t => t.amount < 0 && catType(t.category) !== 'income' && (t.category === 'Loan/credit' || isViaKlarna(t.desc) || CREDIT_RE.test(t.desc));
// Complete periods with full data coverage (most recent last), at most `n`.
function planPeriods(n) {
  const today = todayStr(), first = S.txns.reduce((a, t) => !a || t.date < a ? t.date : a, '');
  if (!first) return { keys: [], partial: false };
  const all = allMonths();
  let keys = all.filter(k => { const p = periodInfo(k); return p && p.end < today && daysBetween(p.start, first) <= 5; });
  let partial = false;
  if (!keys.length) { keys = all.filter(k => periodInfo(k)); partial = true; }
  return { keys: keys.slice(-(n || PS().periods)), partial };
}
let _planCache = null;
function planStats() {
  const sig = _dataVersion + '|' + JSON.stringify(PS()) + '|' + todayStr() + '|' + S.settings.periodMode;
  if (_planCache && _planCache.sig === sig) return _planCache.v;
  const { keys, partial } = planPeriods();
  const rec = detectRecurring().filter(r => r.active), recSet = new Set(rec.map(r => r.name));
  const per = keys.map(k => {
    const o = { key: k, income: 0, spent: 0, fixed: 0, essential: 0, saved: 0, credit: 0, payoffs: 0, fees: 0, byMain: {}, byCat: {} };
    for (const t of S.txns) {
      if (periodOf(t.date) !== k) continue;
      const ty = catType(t.category), v = -t.amount;
      if (isCreditTxn(t)) o.credit += v;
      if (t.amount < 0 && FEE_RE.test(t.desc) && (isCreditTxn(t) || t.category === 'Bank fees' || t.category === PAYOFF_CAT)) o.fees += v;
      if (ty === 'transfer') {
        if (t.category === 'Savings') o.saved += v;
        if (t.category === PAYOFF_CAT && t.amount < 0) { if (!isCreditTxn(t)) o.payoffs += v; if (payoffTreatment(t) === 'spending') { o.spent += v; o.byMain[PAYOFF_KEY] = (o.byMain[PAYOFF_KEY] || 0) + v; } }
        continue;
      }
      if (ty === 'income') { o.income += t.amount; continue; }
      o.spent += v; o.byCat[t.category] = (o.byCat[t.category] || 0) + v; const mn = mainOf(t.category); o.byMain[mn] = (o.byMain[mn] || 0) + v;
      if (FIXED_MAINS.includes(mn) || FIXED_SUBS.includes(t.category) || recSet.has(merchantKey(t.desc))) o.fixed += v;
      if (isEssentialCat(t.category)) o.essential += v;
    }
    return o;
  });
  const avg = f => round2(mean(per.map(p => p[f])));
  const ess = per.map(p => p.essential), m = PS().essentialMethod;
  const essentialLow = round2(m === 'mean' ? mean(ess) : quantile(ess, m === 'median' ? 0.5 : 0.25));
  const income = avg('income'), spent = avg('spent'), fixed = avg('fixed'), surplus = round2(income - spent);
  const v = { keys, partial, n: keys.length, per, income, spent, fixed, variable: round2(spent - fixed), surplus, saved: avg('saved'), essentialAvg: avg('essential'), essentialLow,
    credit: avg('credit'), payoffs: avg('payoffs'), fees: avg('fees'), recurring: rec,
    savingsRate: income > 0 ? surplus / income : 0, savedRate: income > 0 ? avg('saved') / income : 0 };
  v.targetAmt = round2(income * PS().targetRate / 100);
  v.suggested = floor100(Math.max(0, surplus) * PS().surplusShare / 100);
  v.bufferTarget = Math.ceil(essentialLow * PS().bufferMonths / 100) * 100;
  // 50/30/20: needs = essential costs, wants = the rest of spending, savings = what's left
  v.rule = income > 0 ? { needs: v.essentialAvg / income, wants: Math.max(0, spent - v.essentialAvg) / income, save: surplus / income } : null;
  _planCache = { sig, v };
  return v;
}
function savedSince(date) { return round2(S.txns.filter(t => t.category === 'Savings' && t.date >= date).reduce((a, t) => a - t.amount, 0)); }
function syncBufferGoal() {
  const g = S.plan.goals.find(x => x.kind === 'buffer'); if (!g) return null;
  const ps = planStats();
  if (g.auto) { g.target = ps.bufferTarget; if (/^Buffer: [\d.]+ months? of essential expenses$/.test(g.name)) g.name = `Buffer: ${PS().bufferMonths} month${PS().bufferMonths === 1 ? '' : 's'} of essential expenses`; }
  return g;
}
const monthsBetween = (a, b) => daysBetween(a, b) / 30.44;
function addMonthsDate(d, n) { const ym = addMonths(d.slice(0, 7), Math.floor(n)); const day = Math.min(+d.slice(8, 10), 28); return ym + '-' + String(day).padStart(2, '0'); }
function goalStatus(g) {
  const today = todayStr(), ps = planStats();
  const progress = round2(g.current + (g.link ? savedSince(g.start) : 0));
  const remaining = Math.max(0, round2(g.target - progress));
  let pace = g.monthly || 0, paceSrc = pace ? 'your monthly contribution' : '';
  if (!pace && g.link && ps.saved > 0) { pace = ps.saved; paceSrc = 'your average transfers to savings'; }
  if (!pace && g.kind === 'buffer' && ps.suggested > 0) { pace = ps.suggested; paceSrc = 'the suggested monthly saving'; }
  if (!pace && g.history.length >= 2) { const a = g.history[0], b = g.history[g.history.length - 1], mo = monthsBetween(a.date, b.date); if (mo >= 0.5 && b.amount > a.amount) { pace = (b.amount - a.amount) / mo; paceSrc = 'your progress so far'; } }
  const pct = g.target > 0 ? Math.min(1, progress / g.target) : 0;
  const forecast = remaining <= 0 ? today : pace > 0 ? addMonthsDate(today, Math.ceil(remaining / pace)) : '';
  const needed = g.date && remaining > 0 ? round2(remaining / Math.max(1, monthsBetween(today, g.date))) : 0;
  return { progress, remaining, pace: round2(pace), paceSrc, pct, forecast, needed, done: g.target > 0 && remaining <= 0, late: !!(g.date && forecast && forecast > g.date) };
}
// Insights: on-device rules, ranked by yearly kr impact.
function planInsights() {
  const ps = planStats(), out = [], per = ps.per, last = per[per.length - 1];
  const minYear = Math.max(1, ps.income * 0.03);   // ignore effects smaller than ~3 % of one month's income per year
  const P = S.settings.periodMode === 'calendar' ? 'month' : 'period';
  if (last && per.length >= 2) {
    const prev = per.slice(-4, -1);
    mainCats().filter(c => c.type === 'expense').forEach(c => {
      const a = mean(prev.map(p => p.byMain[c.name] || 0)), x = last.byMain[c.name] || 0, d = x - a;
      if (d > Math.max(a * 0.15, ps.income * 0.01) && d * 12 >= minYear) out.push({ id: 'rise:' + c.name + ':' + last.key, kind: 'Rising', cat: c.name, impact: d * 12,
        title: `${c.name} is up ${a > 0 ? Math.round(d / a * 100) + ' %' : ''} vs your ${prev.length}-${P} average`,
        text: `${fmt(x)} in ${monthLabel(last.key)} vs ${fmt(a)} on average. If it stays at this level that's ${fmt(d * 12)} more per year.` });
    });
  }
  const cur = periodOf(todayStr());
  [[last && last.key, 'in ' + (last ? monthLabel(last.key) : '')], [cur, 'so far this ' + P]].forEach(([k, when], i) => {
    if (!k || (i === 1 && last && k === last.key)) return;
    const sm = summarize(k, '');
    Object.entries(S.budgets).forEach(([c, b]) => { b = +b; if (!(b > 0) || !catByName(c)) return; const sp = (isMain(c) ? sm.byMain[c] : sm.byCat[c]) || 0;
      if (sp > b) out.push({ id: 'budget:' + c + ':' + k, kind: 'Over budget', cat: c, impact: (sp - b) * 12, title: `${catLabel(c)}: ${fmt(sp - b)} over budget ${when}`, text: `Spent ${fmt(sp)} of a ${fmt(b)} budget. Repeating this every ${P} costs ${fmt((sp - b) * 12)} per year.` }); });
  });
  const subs = ps.recurring.filter(r => mainOf(r.category) === 'Subscriptions');
  if (subs.length) { const yr = subs.reduce((a, r) => a + r.avg * 12, 0);
    out.push({ id: 'subs:' + subs.length + ':' + Math.round(yr / 500), kind: 'Subscriptions', impact: yr, title: `${subs.length} subscription${subs.length === 1 ? '' : 's'}: ${fmt(yr)} per year`,
      text: subs.sort((a, b) => b.avg - a.avg).slice(0, 6).map(r => `${displayName(r.name)} ${fmt(r.avg * 12)}/yr`).join(' · ') + '. Cancel the ones you no longer use.' }); }
  const lastKeys = new Set(per.slice(-2).map(p => p.key).concat([cur]));
  ps.recurring.filter(r => r.first && lastKeys.has(periodOf(r.first)) && r.months <= 3).forEach(r => out.push({ id: 'newrec:' + r.name, kind: 'New recurring', cat: r.category, impact: r.avg * 12,
    title: `New recurring charge: ${displayName(r.name)}`, text: `${fmt(r.avg)} per ${P} since ${fmtDate(r.first)} (${catLabel(r.category)}): ${fmt(r.avg * 12)} per year.` }));
  if (ps.credit > 0 || ps.payoffs > 0 || ps.fees > 0) {
    const est = ps.fees > 0 ? ps.fees * 12 : ps.credit * 12 * 0.05;
    out.push({ id: 'credit:' + (last ? last.key : ''), kind: 'Credit', impact: est, title: `Credit payments: ${fmt(ps.credit + ps.payoffs)} per ${P}`,
      text: `${ps.credit > 0 ? `${fmt(ps.credit)} to Klarna/Collector/loans` : ''}${ps.credit > 0 && ps.payoffs > 0 ? ' and ' : ''}${ps.payoffs > 0 ? `${fmt(ps.payoffs)} in card payoffs` : ''} on average. ${ps.fees > 0 ? `Interest/fees found: ${fmt(ps.fees * 12)} per year.` : 'No interest or fee lines found, but invoice and card credit often costs 15–25 % a year if not paid in full.'} Paying in full or clearing balances is usually the best "return" you can get.` });
  }
  const wantOf = (p, m) => Object.entries(p.byCat).reduce((x, [c, v]) => x + (mainOf(c) === m && !isEssentialCat(c) && !FIXED_SUBS.includes(c) ? v : 0), 0);   // discretionary part only
  const varMains = mainCats().filter(c => c.type === 'expense' && !FIXED_MAINS.includes(c.name) && c.name !== 'Finance' && c.name !== 'Other')
    .map(c => ({ c: c.name, a: mean(per.map(p => wantOf(p, c.name))) })).filter(x => x.a * 0.2 * 12 >= minYear).sort((x, y) => y.a - x.a).slice(0, 3);
  varMains.forEach(x => out.push({ id: 'cut:' + x.c, kind: 'Cut 20 %', cat: x.c, impact: x.a * 0.2 * 12, title: `Cut ${x.c} by 20 % → save ${fmt(x.a * 0.2 * 12)} per year`, text: `From ${fmt(x.a)} to ${fmt(x.a * 0.8)} per ${P} on average.` }));
  out.forEach(i => i.impact = round2(i.impact));
  return out.sort((a, b) => b.impact - a.impact);
}
// Compound growth, monthly contributions. Returns one point per year (0..years).
function fvSeries(o) {
  const net = (1 + o.ret / 100) * (1 - (o.fee || 0) / 100) - 1, rm = Math.pow(1 + net, 1 / 12) - 1;
  let bal = +o.start || 0, contrib = bal, tax = 0; const pts = [{ y: 0, value: bal, contrib }];
  for (let y = 1; y <= o.years; y++) {
    for (let m = 0; m < 12; m++) { bal = bal * (1 + rm) + o.monthly; contrib += o.monthly; }
    if (o.isk) { const t = Math.max(0, bal - ISK_RULES.free) * ISK_RULES.tax / 100; bal -= t; tax += t; }
    const d = o.real ? Math.pow(1 + (o.inflation || 0) / 100, y) : 1;
    pts.push({ y, value: round2(bal / d), contrib: round2(contrib / d), tax: round2(tax) });
  }
  return pts;
}
function growthSVG(pts) {
  const W = window.innerWidth < 700 ? 340 : 560, H = 220, pl = 54, pr = 10, pt = 10, pb = 26;
  const max = niceMax(Math.max(1, ...pts.map(p => p.value), ...pts.map(p => p.contrib))), n = pts.length - 1 || 1;
  const x = i => pl + (W - pl - pr) * i / n, y = v => pt + (H - pt - pb) * (1 - Math.max(0, v) / max);
  const area = f => `M${x(0)},${y(0)} ` + pts.map((p, i) => `L${x(i).toFixed(1)},${y(p[f]).toFixed(1)}`).join(' ') + ` L${x(n)},${y(0)} Z`;
  let s = '';
  for (let k = 0; k <= 4; k++) { const v = max * k / 4, yy = y(v).toFixed(1); s += `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${pl - 6}" y="${+yy + 4}" text-anchor="end">${esc(fmtShort(v))}</text>`; }
  const step = Math.max(1, Math.ceil(n / 6));
  pts.forEach((p, i) => { if (i % step === 0 || i === n) s += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${p.y}y</text>`; });
  s += `<path d="${area('value')}" class="g-value"/><path d="${area('contrib')}" class="g-contrib"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Growth over time">${s}</svg>
    <div class="summary-line"><span class="pill"><span class="sw" style="background:var(--good)"></span>Value</span><span class="pill"><span class="sw" style="background:var(--accent)"></span>Your deposits</span></div>`;
}
const ui2 = { planTab: 'savings', calc: null, showDismissed: false };
function pctTxt(x) { return (x * 100).toFixed(0) + ' %'; }
function renderPlan() {
  const el = $('#view-plan');
  if (!S.txns.length) { el.innerHTML = `<div class="toolbar"><h2>Plan</h2></div><div class="card empty">Import a statement first: the plan is calculated from your own transactions, on this device.</div>`; return; }
  syncBufferGoal();
  const tabs = [['savings', 'Savings'], ['insights', 'Insights'], ['goals', 'Goals'], ['invest', 'Investing']];
  const body = { savings: planSavingsHTML, insights: planInsightsHTML, goals: planGoalsHTML, invest: planInvestHTML }[ui2.planTab]();
  el.innerHTML = `<div class="toolbar"><h2>Plan</h2><span class="hint">Calculated on this device only · nothing is sent anywhere</span></div>
    <div class="seg" role="tablist" id="planTabs">${tabs.map(([k, l]) => `<button class="btn${ui2.planTab === k ? ' active' : ''}" role="tab" aria-selected="${ui2.planTab === k}" data-ptab="${k}">${l}</button>`).join('')}</div>
    <div id="planBody">${body}</div>`;
  $$('#planTabs [data-ptab]').forEach(b => b.onclick = () => { ui2.planTab = b.dataset.ptab; renderPlan(); });
  ({ savings: wirePlanSavings, insights: wirePlanInsights, goals: wirePlanGoals, invest: wirePlanInvest })[ui2.planTab]();
}
function basisHTML(ps) {
  const P = S.settings.periodMode === 'calendar' ? 'calendar month' : 'salary period';
  return `<p class="hint" style="margin-top:0">Averages over your last <b>${ps.n}</b> complete ${P}${ps.n === 1 ? '' : 's'}${ps.n ? ` (${esc(monthLabel(ps.keys[0]))} – ${esc(monthLabel(ps.keys[ps.n - 1]))})` : ''}.${ps.partial ? ' <b>No complete period yet, so this uses incomplete data.</b>' : ps.n < 3 ? ' Fewer than 3 periods: treat these numbers as a rough first estimate.' : ''} Change the assumptions in Settings › Plan.</p>`;
}
function planSavingsHTML() {
  const ps = planStats(), st = PS(), g = S.plan.goals.find(x => x.kind === 'buffer'), gs = g ? goalStatus(g) : null;
  const kpi = (l, v, d, cls) => `<div class="card kpi"><div class="label">${l}</div><div class="value ${cls || ''}">${v}</div>${d ? `<div class="delta">${d}</div>` : ''}</div>`;
  const bar = (label, actual, target) => `<div class="rule-row"><span>${label}</span><div class="progress ${actual > target + 0.05 && label !== 'Savings' ? 'warn' : ''}"><div style="width:${Math.min(100, Math.max(0, actual * 100)).toFixed(1)}%"></div></div><span class="amt">${pctTxt(Math.max(0, actual))} <span class="hint">/ ${pctTxt(target)}</span></span></div>`;
  const toTarget = ps.suggested > 0 && gs && gs.remaining > 0 ? Math.ceil(gs.remaining / ps.suggested) : 0;
  return `<div class="card">${basisHTML(ps)}</div>
  <div class="grid kpis" style="margin-top:12px">
    ${kpi('Income', fmt(ps.income), 'per period')}
    ${kpi('Fixed costs', fmt(ps.fixed), 'housing, bills, insurance, subscriptions, loans, recurring')}
    ${kpi('Variable spending', fmt(ps.variable), 'everything else')}
    ${kpi('Real surplus', fmt(ps.surplus), `savings rate <b>${pctTxt(ps.savingsRate)}</b> · target ${st.targetRate} %`, ps.surplus >= 0 ? 'pos' : 'neg')}
  </div>
  <div class="grid cols-2" style="margin-top:16px">
    <div class="card" id="planSuggest"><h3>Suggested monthly saving</h3>
      <div class="big-num">${fmt(ps.suggested)}</div>
      <p>${ps.surplus > 0 ? `<b>Pay yourself first:</b> move ${fmt(ps.suggested)} to savings the day your salary arrives (${st.surplusShare} % of your average surplus, rounded down; the rest is a margin for irregular costs).` : `You spend about as much as you earn (surplus ${fmt(ps.surplus)}). Start with the Insights tab to free up money before setting a savings amount.`}</p>
      <p class="hint">${st.targetRate} % rule: ${fmt(ps.targetAmt)} per period. ${ps.suggested >= ps.targetAmt ? 'The suggestion meets your target savings rate.' : `To reach it you'd need to free up ${fmt(ps.targetAmt - ps.suggested)} more per period.`} Already moved to savings: ${fmt(ps.saved)} per period (${pctTxt(ps.savedRate)} of income).</p>
      <h3 style="margin-top:14px">50/30/20 comparison</h3>
      ${ps.rule ? bar('Needs', ps.rule.needs, 0.5) + bar('Wants', ps.rule.wants, 0.3) + bar('Savings', ps.rule.save, 0.2) : '<p class="hint">No income found in these periods.</p>'}
      <p class="hint">Needs = your essential costs (see Settings › Plan); wants = all other spending; savings = what's left.</p></div>
    <div class="card" id="planBuffer"><h3>Emergency buffer</h3>
      <div class="big-num">${fmt(ps.bufferTarget)}</div>
      <p><b>${st.bufferMonths} months of essential expenses.</b> Your bare-minimum costs are about <b>${fmt(ps.essentialLow)}</b> per period (${st.essentialMethod === 'lowq' ? 'a low, typical period: lower quartile' : st.essentialMethod === 'median' ? 'median period' : 'average period'}; average ${fmt(ps.essentialAvg)}). Rent/mortgage, bills, insurance, groceries, essential transport, pharmacy/doctor, loan minimums and pets — no dining, shopping, entertainment, travel or subscriptions.</p>
      ${gs ? `${budgetBarHTML(g.name, gs.progress, g.target || 1)}<p class="hint">${gs.done ? 'Buffer complete 🎉' : toTarget ? `At ${fmt(ps.suggested)} per month you'd reach it in about ${toTarget} month${toTarget === 1 ? '' : 's'}.` : ''} Update the amount you have in the Goals tab.</p>` : `<p class="hint">You deleted the buffer goal. <button class="btn small" id="reBuffer">Re-create it</button></p>`}
      <p class="hint">Fixed costs (incl. subscriptions and recurring items) are ${fmt(ps.fixed)} per period: a buffer of ${st.bufferMonths} months of those would be ${fmt(ps.fixed * st.bufferMonths)}.</p></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Per period</h3><div class="table-wrap"><table class="plan-table"><thead><tr><th>Period</th><th>Income</th><th>Fixed</th><th>Variable</th><th>Essential</th><th>Surplus</th></tr></thead><tbody>
    ${ps.per.map(p => `<tr><td>${esc(monthLabel(p.key))}</td><td>${fmt(p.income)}</td><td>${fmt(p.fixed)}</td><td>${fmt(p.spent - p.fixed)}</td><td>${fmt(p.essential)}</td><td class="${p.income - p.spent >= 0 ? 'pos' : 'neg'}">${fmt(p.income - p.spent)}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}
function wirePlanSavings() { if ($('#reBuffer')) $('#reBuffer').onclick = () => { S.plan.goals.unshift(bufferGoalNew()); save(); renderPlan(); }; }
function planInsightsHTML() {
  const all = planInsights(), shown = all.filter(i => !S.plan.dismissed[i.id]), hidden = all.length - shown.length;
  const list = ui2.showDismissed ? all : shown;
  return `<div class="card"><p class="hint" style="margin-top:0">Rules that run on this device and compare you with your own history, ranked by yearly impact in ${esc(S.settings.currency === 'SEK' ? 'kr' : S.settings.currency)}. Dismiss what isn't useful.</p>
    ${list.length ? list.map(i => `<div class="insight${S.plan.dismissed[i.id] ? ' dismissed' : ''}" data-iid="${esc(i.id)}"><div class="ins-main"><span class="pill">${esc(i.kind)}</span><div class="ins-title">${esc(i.title)}</div><div class="hint">${esc(i.text)}</div></div>
      <div class="ins-side"><div class="ins-imp">${fmt(i.impact)}<span class="hint">/yr</span></div>${S.plan.dismissed[i.id] ? `<button class="btn small" data-undismiss>Restore</button>` : `<button class="btn small" data-dismiss aria-label="Dismiss insight">Dismiss</button>`}</div></div>`).join('') : '<div class="empty">No insights right now. 🎉</div>'}
    ${hidden ? `<p><button class="btn small" id="togDismissed">${ui2.showDismissed ? 'Hide dismissed' : `Show ${hidden} dismissed`}</button></p>` : ''}</div>`;
}
function wirePlanInsights() {
  $$('#planBody [data-dismiss]').forEach(b => b.onclick = () => { S.plan.dismissed[b.closest('[data-iid]').dataset.iid] = todayStr(); save(); renderPlan(); });
  $$('#planBody [data-undismiss]').forEach(b => b.onclick = () => { delete S.plan.dismissed[b.closest('[data-iid]').dataset.iid]; save(); renderPlan(); });
  if ($('#togDismissed')) $('#togDismissed').onclick = () => { ui2.showDismissed = !ui2.showDismissed; renderPlan(); };
}
function planGoalsHTML() {
  return `<div class="toolbar" style="margin-bottom:8px"><span class="hint" style="margin-right:auto">Track progress by hand, or link a goal to your transfers in Transfers › Savings.</span><button class="btn primary" id="addGoal">＋ New goal</button></div>
  ${S.plan.goals.length ? S.plan.goals.map((g, i) => { const s = goalStatus(g); return `<div class="card goal" data-gi="${i}">
    <h3>${esc(g.name)} <small>${g.kind === 'buffer' ? (g.auto ? 'target updates from your data' : 'fixed target') : g.link ? 'linked to Savings transfers' : ''}</small></h3>
    ${budgetBarHTML('', s.progress, g.target || 1).replace(/ over<\/span>/, ' above target</span>')}
    <div class="goal-facts">
      <span><b>${fmt(s.progress)}</b> of ${fmt(g.target)} · ${Math.round(s.pct * 100)} %</span>
      ${s.done ? '<span class="pos">Reached 🎉</span>' : s.forecast ? `<span>Forecast: <b>${esc(fmtDate(s.forecast))}</b> at ${fmt(s.pace)}/month (${esc(s.paceSrc)})</span>` : '<span class="hint">Set a monthly amount or update progress to see a forecast.</span>'}
      ${g.date && !s.done ? `<span>Target date ${esc(fmtDate(g.date))}: needs <b>${fmt(s.needed)}</b>/month${s.late ? ' <span class="neg">(behind pace)</span>' : ''}</span>` : ''}
    </div>
    <div class="goal-actions"><button class="btn small" data-gupd>Update amount</button><button class="btn small" data-gedit>Edit</button><button class="btn small danger" data-gdel aria-label="Delete goal">Delete</button></div></div>`; }).join('') : '<div class="card empty">No goals yet.</div>'}`;
}
function goalForm(g) {
  const isNew = !g; g = g || { name: '', target: 0, current: 0, date: '', monthly: 0, link: false, kind: '' };
  openModal(isNew ? 'New goal' : 'Edit goal', `<div class="form-grid">
    <div class="field" style="grid-column:1/-1"><label for="gName">Name</label><input type="text" id="gName" value="${esc(g.name)}" placeholder="e.g. Trip to Japan"></div>
    ${g.kind === 'buffer' ? `<div class="field" style="grid-column:1/-1"><label class="acc-chk"><input type="checkbox" id="gAuto"${g.auto ? ' checked' : ''}> Update the target automatically (${PS().bufferMonths} × essential expenses = ${fmt(planStats().bufferTarget)})</label></div>` : ''}
    <div class="field"><label for="gTarget">Target amount</label><input type="number" min="0" step="100" inputmode="decimal" id="gTarget" value="${g.target || ''}"${g.kind === 'buffer' && g.auto ? ' disabled' : ''}></div>
    <div class="field"><label for="gCur">Current amount</label><input type="number" step="100" inputmode="decimal" id="gCur" value="${g.current || ''}" placeholder="0"></div>
    <div class="field"><label for="gDate">Target date (optional)</label><input type="date" id="gDate" value="${esc(g.date)}"></div>
    <div class="field"><label for="gMonthly">Monthly contribution (optional)</label><input type="number" min="0" step="100" inputmode="decimal" id="gMonthly" value="${g.monthly || ''}"></div>
    <div class="field" style="grid-column:1/-1"><label class="acc-chk"><input type="checkbox" id="gLink"${g.link ? ' checked' : ''}> Add my transfers categorized as Transfers › Savings (from today) to this goal</label></div></div>`, [
    { label: 'Cancel', cancel: true },
    { label: isNew ? 'Create goal' : 'Save', cls: 'primary', onClick: () => {
      const name = $('#gName').value.trim(), auto = $('#gAuto') ? $('#gAuto').checked : false, target = +$('#gTarget').value || 0;
      if (!name) { toast('Please enter a name', true); return false; }
      if (!auto && !(target > 0)) { toast('Please enter a target amount', true); return false; }
      const o = isNew ? { id: uid(), kind: '', start: todayStr(), history: [] } : g;
      Object.assign(o, { name, target: auto ? o.target : target, auto, current: +$('#gCur').value || 0, date: $('#gDate').value || '', monthly: Math.max(0, +$('#gMonthly').value || 0) });
      if ($('#gLink').checked && !o.link) o.start = todayStr(); o.link = $('#gLink').checked;
      o.history.push({ date: todayStr(), amount: o.current });
      if (isNew) S.plan.goals.push(o);
      save(); renderPlan(); toast(isNew ? 'Goal created' : 'Goal saved');
    } }]);
  if ($('#gAuto')) $('#gAuto').onchange = e => { $('#gTarget').disabled = e.target.checked; if (!e.target.checked && !+$('#gTarget').value) $('#gTarget').value = planStats().bufferTarget; };
}
function wirePlanGoals() {
  $('#addGoal').onclick = () => goalForm(null);
  const G = b => S.plan.goals[+b.closest('[data-gi]').dataset.gi];
  $$('#planBody [data-gedit]').forEach(b => b.onclick = () => goalForm(G(b)));
  $$('#planBody [data-gdel]').forEach(b => b.onclick = () => { const g = G(b); if (!confirm(`Delete goal "${g.name}"?`)) return; S.plan.goals = S.plan.goals.filter(x => x !== g); save(); renderPlan(); });
  $$('#planBody [data-gupd]').forEach(b => b.onclick = () => { const g = G(b);
    openModal('Update ' + g.name, `<div class="field"><label for="gNow">Amount saved so far${g.link ? ' (not counting linked Savings transfers)' : ''}</label><input type="number" step="100" inputmode="decimal" id="gNow" value="${g.current || ''}"></div>`, [
      { label: 'Cancel', cancel: true },
      { label: 'Save', cls: 'primary', onClick: () => { const v = +$('#gNow').value; if (!isFinite(v)) return false; g.current = v; g.history.push({ date: todayStr(), amount: v }); save(); renderPlan(); } }]);
    setTimeout(() => $('#gNow') && $('#gNow').focus(), 0); });
}
function ladderState() {
  const ps = planStats(), g = S.plan.goals.find(x => x.kind === 'buffer'), gs = g ? goalStatus(g) : null;
  const bufferDone = !!(gs && gs.done), debt = ps.credit > 0 && !PS().noDebt;
  return { bufferDone, debt, step: !bufferDone ? 1 : debt ? 2 : 3, gs, g, ps };
}
function planInvestHTML() {
  const L = ladderState(), st = PS();
  if (!ui2.calc) ui2.calc = { monthly: L.ps.suggested || 2000, years: 20, start: 0, ret: st.ret, fee: st.fee, real: false, isk: true };
  const c = ui2.calc, R = ISK_RULES;
  const step = (n, title, done, text) => `<li class="ladder-step${done ? ' done' : ''}${L.step === n ? ' here' : ''}"><span class="ladder-n">${done ? '✓' : n}</span><div><b>${title}</b>${L.step === n ? ' <span class="pill here-pill">You are here</span>' : ''}<div class="hint">${text}</div></div></li>`;
  return `<div class="disclaimer" role="note"><b>General information, not financial advice.</b> This is educational and based only on your own numbers and simple assumptions. It is not a personal recommendation, returns are never guaranteed, and you can lose money when investing. Rules change: check current rules with Skatteverket, Pensionsmyndigheten or a licensed adviser.</div>
  <div class="card" style="margin-top:12px"><h3>Priority ladder</h3><ol class="ladder">
    ${step(1, 'Emergency buffer', L.bufferDone, L.gs ? `${fmt(L.gs.progress)} of ${fmt(L.g.target)} (${st.bufferMonths} months of essential expenses).` : 'Create a buffer goal on the Savings tab.')}
    ${step(2, 'Pay off high-interest debt', L.bufferDone && !L.debt, L.ps.credit > 0 ? `${fmt(L.ps.credit)} per period goes to Klarna/Collector/loans. Debt at 15–25 % costs more than investing typically earns. <label class="acc-chk"><input type="checkbox" id="noDebt"${st.noDebt ? ' checked' : ''}> These are paid in full / interest-free</label>` : 'No Klarna/Collector/consumer-loan payments found in your data.')}
    ${step(3, 'Long-term investing', false, 'Money you won\'t need for 5+ years: broad, low-fee, regular monthly saving.')}
  </ol></div>
  <div class="card" style="margin-top:16px"><h3>Swedish options in brief</h3>
    <details class="info"><summary>ISK – investeringssparkonto</summary><p>No tax on gains or dividends and nothing to declare when you sell. Instead a yearly standard tax: the <i>schablonintäkt</i> is the government borrowing rate (statslåneräntan) on 30 Nov of the previous year + 1 percentage point (at least 1.25 %), taxed at 30 %. For <b>${R.year}</b>: ${R.slr} % + 1 = ${R.schablon} % → about <b>${R.tax} %</b> of the capital base per year. Since 2025 there is a tax-free level: <b>${fmt(R.free)}</b> in ${R.year} (${fmt(R.prevFree)} in ${R.prevYear}), per person, shared across all ISK, kapitalförsäkring and PEPP. Source: Skatteverket, rules for income year ${R.year} (checked Oct 2026).</p></details>
    <details class="info"><summary>Kapitalförsäkring (KF)</summary><p>Same standard tax model and the same shared tax-free level as ISK; the tax is usually withdrawn from the account by the insurer. Formally owned by an insurance company, so you can name beneficiaries; some foreign assets and terms differ. Often used for specific situations rather than as a default.</p></details>
    <details class="info"><summary>Pension and PPM</summary><p>The public pension is 18.5 % of pensionable income: 16 % inkomstpension and 2.5 % premiepension, which you can invest in funds through Pensionsmyndigheten's fund marketplace (or leave in the state default option). Most employers also pay tjänstepension, where you often choose funds too. Check your forecast at minpension.se. Pension money is locked until retirement age.</p></details>
    <details class="info"><summary>Low-fee global index funds</summary><p>An index fund follows a market index instead of picking stocks. A broad global index spreads risk over thousands of companies in many countries. Typical yearly fees for such funds are around 0.1–0.4 %, compared with often 1–1.5 % for actively managed funds. Saving a fixed amount monthly smooths out the timing.</p></details>
    <details class="info"><summary>Fees matter</summary><p>A fee is charged every year on your whole balance, so it compounds against you. See the fee comparison below: 1 percentage point lower fee can mean a noticeably larger balance after 20–30 years.</p></details>
  </div>
  <div class="card" style="margin-top:16px" id="calcCard"><h3>Compound growth calculator</h3>
    <div class="calc-grid">
      <div class="field"><label for="cMonthly">Monthly amount</label><input type="number" min="0" step="100" inputmode="decimal" id="cMonthly" value="${c.monthly}"></div>
      <div class="field"><label for="cStart">Starting amount</label><input type="number" min="0" step="1000" inputmode="decimal" id="cStart" value="${c.start}"></div>
      <div class="field"><label for="cYears">Years</label><input type="number" min="1" max="60" step="1" inputmode="numeric" id="cYears" value="${c.years}"></div>
      <div class="field"><label for="cRet">Expected return % / yr (assumption)</label><input type="number" min="-10" max="20" step="0.5" inputmode="decimal" id="cRet" value="${c.ret}"></div>
      <div class="field"><label for="cFee">Fee % / yr</label><input type="number" min="0" max="5" step="0.05" inputmode="decimal" id="cFee" value="${c.fee}"></div>
      <div class="field calc-checks"><label class="acc-chk"><input type="checkbox" id="cReal"${c.real ? ' checked' : ''}> Adjust for inflation (${st.inflation} %/yr, today's money)</label><label class="acc-chk"><input type="checkbox" id="cIsk"${c.isk ? ' checked' : ''}> Deduct ISK tax (${R.tax} % above ${fmtShort(R.free)}, ${R.year} rules)</label></div>
    </div>
    <div id="calcOut">${calcOutHTML()}</div>
    <p class="hint">${c.ret} % nominal is an assumption, not a promise: markets can fall for years. Monthly compounding; fee taken from the return; ISK tax approximated on the year-end balance.</p></div>`;
}
function calcOutHTML() {
  const c = ui2.calc, st = PS(), base = { years: c.years, start: c.start, ret: c.ret, fee: c.fee, real: c.real, inflation: st.inflation, isk: c.isk };
  const pts = fvSeries(Object.assign({ monthly: c.monthly }, base)), end = pts[pts.length - 1];
  const amounts = Array.from(new Set([1000, 2000, 5000, Math.round(c.monthly)])).filter(x => x > 0).sort((a, b) => a - b);
  const fees = Array.from(new Set([0.2, 1, 1.5, +c.fee])).sort((a, b) => a - b);
  const noFee = fvSeries(Object.assign({}, base, { monthly: c.monthly, fee: 0 })).pop().value;
  return `<div class="calc-result"><div><div class="label hint">After ${c.years} years${c.real ? ' (today\'s money)' : ''}</div><div class="big-num">${fmt(end.value)}</div></div>
    <div class="hint">Deposits ${fmt(end.contrib)} · growth ${fmt(end.value - end.contrib)}${c.isk && end.tax ? ` · ISK tax paid ≈ ${fmt(end.tax)}` : ''}</div></div>
    ${growthSVG(pts)}
    <div class="grid cols-2" style="margin-top:12px">
    <div><h3>Scenarios</h3><div class="table-wrap"><table class="plan-table" id="scenTable"><thead><tr><th>Per month</th><th>Deposits</th><th>Value after ${c.years}y</th></tr></thead><tbody>
      ${amounts.map(a => { const e = fvSeries(Object.assign({ monthly: a }, base)).pop(); return `<tr${a === Math.round(c.monthly) ? ' class="sel"' : ''}><td>${fmt(a)}</td><td>${fmt(e.contrib)}</td><td><b>${fmt(e.value)}</b></td></tr>`; }).join('')}</tbody></table></div></div>
    <div><h3>Impact of fees</h3><div class="table-wrap"><table class="plan-table" id="feeTable"><thead><tr><th>Fee / yr</th><th>Value after ${c.years}y</th><th>Fees cost you</th></tr></thead><tbody>
      ${fees.map(f => { const e = fvSeries(Object.assign({}, base, { monthly: c.monthly, fee: f })).pop(); return `<tr${f === +c.fee ? ' class="sel"' : ''}><td>${f} %</td><td>${fmt(e.value)}</td><td class="neg">${fmt(noFee - e.value)}</td></tr>`; }).join('')}</tbody></table></div></div></div>`;
}
function wirePlanInvest() {
  if ($('#noDebt')) $('#noDebt').onchange = e => { PS().noDebt = e.target.checked; save(); renderPlan(); };
  const map = { cMonthly: 'monthly', cStart: 'start', cYears: 'years', cRet: 'ret', cFee: 'fee' };
  const upd = () => {
    Object.entries(map).forEach(([id, k]) => { const v = parseFloat($('#' + id).value); if (isFinite(v)) ui2.calc[k] = k === 'years' ? Math.min(60, Math.max(1, Math.round(v))) : Math.max(k === 'ret' ? -10 : 0, v); });
    ui2.calc.real = $('#cReal').checked; ui2.calc.isk = $('#cIsk').checked; $('#calcOut').innerHTML = calcOutHTML();
  };
  Object.keys(map).forEach(id => $('#' + id).addEventListener('input', upd)); $('#cReal').onchange = upd; $('#cIsk').onchange = upd;
}
// Settings › Plan assumptions
function planSettingsHTML() {
  syncBufferGoal();
  const s = PS(), ps = planStats();
  const mains = mainCats().filter(c => c.type === 'expense');
  return `<div class="card" id="planSettings"><h3>Plan assumptions <button class="btn small" id="planReset">Reset</button></h3>
    <div class="form-grid">
      <div class="field"><label for="pBufM">Emergency buffer (months)</label><input type="number" min="1" max="24" step="1" id="pBufM" data-pset="bufferMonths" value="${s.bufferMonths}"></div>
      <div class="field"><label for="pPer">Average over last … periods</label><select id="pPer" data-pset="periods">${[3, 4, 5, 6].map(n => `<option${n === s.periods ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><label for="pTarget">Target savings rate %</label><input type="number" min="0" max="90" step="1" id="pTarget" data-pset="targetRate" value="${s.targetRate}"></div>
      <div class="field"><label for="pShare">Suggest this % of the surplus</label><input type="number" min="0" max="100" step="5" id="pShare" data-pset="surplusShare" value="${s.surplusShare}"></div>
      <div class="field"><label for="pRet">Expected return % / yr (nominal)</label><input type="number" min="-20" max="30" step="0.5" id="pRet" data-pset="ret" value="${s.ret}"></div>
      <div class="field"><label for="pFee">Fund fee % / yr</label><input type="number" min="0" max="5" step="0.05" id="pFee" data-pset="fee" value="${s.fee}"></div>
      <div class="field"><label for="pInf">Inflation % / yr</label><input type="number" min="-5" max="20" step="0.5" id="pInf" data-pset="inflation" value="${s.inflation}"></div>
      <div class="field"><label for="pMeth">Essential expenses per period</label><select id="pMeth" data-pset="essentialMethod"><option value="lowq"${s.essentialMethod === 'lowq' ? ' selected' : ''}>Low, typical period (lower quartile)</option><option value="median"${s.essentialMethod === 'median' ? ' selected' : ''}>Median period</option><option value="mean"${s.essentialMethod === 'mean' ? ' selected' : ''}>Average</option></select></div>
    </div>
    <details class="info" id="essDetails"${ui2.essOpen ? ' open' : ''}><summary>Essential categories (used for the buffer): ${fmt(ps.essentialLow)} per period → buffer ${fmt(ps.bufferTarget)}</summary>
      <input type="search" id="essQ" placeholder="Search categories (e.g. mat, park)…" aria-label="Search essential categories" style="width:100%;margin-top:8px">
      <div class="ess-list">${mains.map(m => { const subs = subsOf(m.name); return `<div class="ess-main" data-cname="${esc(m.name)}"><label class="acc-chk"><input type="checkbox" data-ess="${esc(m.name)}" data-essmain${s.essential.includes(m.name) ? ' checked' : ''}> <b>${esc(m.name)}</b></label>${subs.length ? `<div class="ess-subs">${subs.map(x => `<label class="acc-chk" data-cname="${esc(x.name)}"><input type="checkbox" data-ess="${esc(x.name)}"${s.essential.includes(x.name) ? ' checked' : ''}> ${esc(x.name)}</label>`).join('')}</div>` : ''}</div>`; }).join('')}</div>
      <button class="btn small" id="essReset">Default essentials</button></details>
    <p class="hint">Saved on this device and in JSON backups. Returns are assumptions, not guarantees.</p></div>`;
}
function wirePlanSettings() {
  const s = PS(), num = new Set(['bufferMonths', 'targetRate', 'surplusShare', 'ret', 'fee', 'inflation', 'periods']);
  $$('#planSettings [data-pset]').forEach(inp => inp.onchange = () => { const k = inp.dataset.pset; s[k] = num.has(k) ? +inp.value : inp.value; S.plan = normalizePlan(S.plan); ui2.calc = null; save(); renderSettings(); });
  $$('#planSettings [data-ess]').forEach(cb => cb.onchange = () => {
    const n = cb.dataset.ess, set = new Set(s.essential), names = cb.hasAttribute('data-essmain') ? [n].concat(subsOf(n).map(x => x.name)) : [n];
    names.forEach(x => cb.checked ? set.add(x) : set.delete(x)); s.essential = Array.from(set); ui2.essOpen = true; save(); renderSettings();
  });
  $('#essDetails').addEventListener('toggle', e => { ui2.essOpen = e.target.open; });
  $('#essQ').oninput = e => filterCatRows($$('#planSettings .ess-main'), e.target.value, row => $$('[data-cname]', row));
  $('#essReset').onclick = () => { s.essential = ESSENTIAL_DEFAULT.slice(); ui2.essOpen = true; save(); renderSettings(); };
  $('#planReset').onclick = () => { S.plan.settings = Object.assign({}, PLAN_DEFAULTS, { essential: ESSENTIAL_DEFAULT.slice() }); ui2.calc = null; save(); renderSettings(); };
}

function renderSettings() {
  const el = $('#view-settings');
  const st = S.settings;
  const rq = (ui.ruleQ || '').toLowerCase();
  const rules = S.rules.map((r, i) => ({ r, i })).filter(({ r }) => !rq.trim() || foldKey(r.pattern).includes(foldKey(rq.trim())) || catQueryMatch(catSearchHay(r.category) + ' ' + catSearchHay(mainOf(r.category)), rq));
  const usage = {}; S.txns.forEach(t => usage[t.category] = (usage[t.category] || 0) + 1);
  el.innerHTML = `
  <div class="toolbar"><h2>Settings</h2></div>
  <div class="grid cols-2">
    <div class="card"><h3>Display</h3>
      <div class="form-grid">
        <div class="field"><label for="sCur">Currency</label><select id="sCur">${CURRENCIES.map(([c, n]) => `<option value="${c}"${c === st.currency ? ' selected' : ''}>${c} (${n})</option>`).join('')}</select></div>
        <div class="field"><label for="sSym">Custom symbol (optional)</label><input type="text" id="sSym" maxlength="6" placeholder="automatic" value="${esc(st.symbol)}"></div>
        <div class="field"><label for="sPos">Custom symbol position</label><select id="sPos"><option value="before"${st.symbolPos === 'before' ? ' selected' : ''}>Before: $100</option><option value="after"${st.symbolPos === 'after' ? ' selected' : ''}>After: 100 kr</option></select></div>
        <div class="field"><label for="sTheme">Theme</label><select id="sTheme">${[['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}"${v === st.theme ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <p class="hint">Preview: <b>${fmt(-1234.5)}</b> · ${fmt(89.99)}. All amounts are shown in this one currency; no conversion is done.</p>
    </div>
    <div class="card" id="periodCard"><h3>Budget period</h3>
      <div class="form-grid">
        <div class="field"><label for="sPeriod">A "month" is</label><select id="sPeriod"><option value="salary"${st.periodMode !== 'calendar' ? ' selected' : ''}>Salary to salary</option><option value="calendar"${st.periodMode === 'calendar' ? ' selected' : ''}>Calendar month</option></select></div>
        <div class="field"><label for="sPayday">Expected payday</label><input type="number" id="sPayday" min="1" max="31" value="${esc(st.payday || 25)}"></div>
        <div class="field" style="grid-column:1/-1"><label for="sSalPat">What counts as salary</label><div style="display:flex;gap:6px"><input type="text" id="sSalPat" style="flex:1" placeholder="automatic: Lön, LON, salary, payroll…" value="${esc(st.salaryPattern || '')}"><select id="sSalPick" aria-label="Pick an income source" style="max-width:45%"><option value="">Pick income source…</option>${salaryCandidates().map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></div></div>
      </div>
      <p class="hint">Each period starts the day a salary arrives and ends the day before the next one, labelled by the month the salary came in. Before the first salary, after the latest one, or in a month with no salary, the expected payday is used (moved to the Friday before when it falls on a weekend). Mark or unmark a single transaction as salary via its Edit button.</p>
      ${st.periodMode !== 'calendar' ? `<p class="hint" id="salList"><b>Salaries found:</b> ${getPeriods().salaries.length ? getPeriods().salaries.map(d => esc(fmtDate(d))).join(', ') : 'none, so periods use the expected payday'}</p>` : ''}
    </div>
    ${planSettingsHTML()}
    <div class="card" id="accCard"><h3>Accounts &amp; credit cards <button class="btn small" id="addCard">＋ Add card</button></h3>
      <p class="hint" style="margin-top:0">Every import is tagged with an account. A payment from your bank account that pays off a card (Transfers › Credit card payment) is a transfer: the purchases are on the card's own statement, counted on the dates you made them. Add each card with the text its payoff has on your bank statement.</p>
      <div id="accList">${S.accounts.map((a, i) => `<div class="acc-row" data-ai="${i}">
        <input type="text" value="${esc(a.name)}" data-aname aria-label="Account name">
        <select data-atype aria-label="Account type"><option value="bank"${a.type === 'bank' ? ' selected' : ''}>Bank account</option><option value="card"${a.type === 'card' ? ' selected' : ''}>Credit card</option></select>
        ${a.type === 'card' ? `<input type="text" value="${esc(a.match)}" data-amatch placeholder="Payoff text, e.g. ${esc(a.name.toLowerCase())}" aria-label="Payoff text on bank statement" title="Keyword(s) or /regex/ that the payoff has on your bank statement (comma-separated). Empty = the card name.">
        <label class="hint acc-chk"><input type="checkbox" data-acount${a.countPayoffs ? ' checked' : ''}> Count payoffs as spending until this card's statement is imported</label>` : ''}
        <span class="hint">${S.txns.filter(t => t.account === a.id).length} txns</span>
        <button class="btn small danger" data-adel title="Remove account" aria-label="Remove account">✕</button></div>`).join('') || '<p class="hint">No accounts yet. They are created when you import a file.</p>'}</div>
      <label class="hint acc-chk"><input type="checkbox" id="sUnlinked"${S.settings.countUnlinkedPayoffs ? ' checked' : ''}> Count card payoffs that aren't linked to any card as spending</label>
    </div>
    <div class="card"><h3>Data &amp; backup</h3>
      <p class="hint" style="margin-top:0">${S.txns.length} transactions · ${S.categories.length} categories · ${S.rules.length} rules. Stored only on this device, in this browser (localStorage).</p>
      ${backupNoteHTML()}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="bExpJson">Export backup (JSON)</button>
        <button class="btn" id="bImpJson">Restore backup…</button>
        <button class="btn" id="bExpCsv">Export transactions (CSV)</button>
        <button class="btn" id="bRecat" title="Re-run rules on all transactions you haven't categorized by hand">Re-apply rules</button>
        <button class="btn danger" id="bClear">Clear all data…</button>
      </div>
    </div>
    <div class="card"><h3>Categories <button class="btn small" id="addCat">＋ Add category</button></h3>
      <input type="search" id="catQ" placeholder="Search categories (e.g. park, mat, frisör)…" value="${esc(ui.catQ || '')}" style="width:100%;margin-bottom:8px" aria-label="Search categories"><p class="hint" id="catQInfo" hidden></p>
      <div id="catList">${mainCats().flatMap(m => [m].concat(subsOf(m.name))).map(c => [c, S.categories.indexOf(c)]).map(([c, i]) => `<div class="cat-row${c.parent ? ' sub' : ''}" data-i="${i}" data-cname="${esc(c.name)}">
        <input type="color" value="${esc(c.color)}" data-color title="Color" aria-label="Color">
        <input type="text" value="${esc(c.name)}" data-name aria-label="Category name" ${c.name === 'Other' ? 'disabled title="The fallback category can\'t be renamed"' : ''}>
        <select data-parent title="Main category" aria-label="Main category" ${c.name === 'Other' || subsOf(c.name).length ? 'disabled' : ''}><option value="">Main category</option>${mainCats().filter(m => m.name !== c.name && m.name !== 'Other').map(m => `<option value="${esc(m.name)}"${m.name === c.parent ? ' selected' : ''}>under ${esc(m.name)}</option>`).join('')}</select>
        <select data-type title="${c.parent ? 'Inherited from the main category' : 'How this category counts'}" aria-label="Type" ${c.parent ? 'disabled' : ''}><option value="expense"${c.type === 'expense' ? ' selected' : ''}>Expense</option><option value="income"${c.type === 'income' ? ' selected' : ''}>Income</option><option value="transfer"${c.type === 'transfer' ? ' selected' : ''}>Transfer (ignored)</option></select>
        <span class="hint" style="width:40px;text-align:right" title="Transactions">${usage[c.name] || 0}</span>
        ${c.parent || c.name === 'Other' ? '' : `<button class="btn small" data-addsub title="Add a subcategory under ${esc(c.name)}" aria-label="Add subcategory">＋ Sub</button>`}
        <button class="btn small danger" data-delcat ${c.name === 'Other' ? 'disabled' : ''} title="Delete" aria-label="Delete">✕</button></div>`).join('')}</div>
      <p class="hint">Main categories and their subcategories. Rename by editing the name; "＋ Sub" adds a subcategory; move one with its "under …" menu. Subcategories count the same way as their main category. "Transfer" categories (card payoffs, own accounts, savings) are left out of spending and income totals.</p>
    </div>
    <div class="card"><h3>Categorization rules <button class="btn small" id="addRule">＋ Add rule</button></h3>
      <p class="hint" style="margin-top:0">First match wins, top to bottom. A pattern is a word or phrase found in the description (case-insensitive, whole words) or a <code>/regular expression/</code>. Your own rules go at the top.</p>
      <input type="search" id="ruleQ" placeholder="Filter rules by keyword or category (e.g. parkering, mat)…" value="${esc(ui.ruleQ || '')}" style="width:100%;margin-bottom:8px" aria-label="Filter rules">
      <div class="rules-list"><table><tbody>${rules.map(({ r, i }) => `<tr data-ri="${i}">
        <td style="width:52%"><input type="text" value="${esc(r.pattern)}" data-rpat aria-label="Pattern"></td>
        <td>${catPickHTML({ value: r.category, cls: 'cp-full', attrs: 'data-rcat aria-label="Category"' })}</td>
        <td style="white-space:nowrap">${r.user ? '<span class="pill" title="Created or edited by you">mine</span> ' : ''}<button class="btn small" data-rup title="Move up" aria-label="Move up">↑</button> <button class="btn small danger" data-rdel title="Delete rule" aria-label="Delete rule">✕</button></td></tr>`).join('') || '<tr><td class="muted">No rules</td></tr>'}</tbody></table></div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" id="resetRules">Restore default rules</button></div>
    </div>
  </div>`;
  $('#sCur').onchange = e => { st.currency = e.target.value; save(); renderSettings(); };
  $('#sSym').onchange = e => { st.symbol = e.target.value.trim(); save(); renderSettings(); };
  $('#sPos').onchange = e => { st.symbolPos = e.target.value; save(); renderSettings(); };
  $('#sTheme').onchange = e => { st.theme = e.target.value; save(); applyTheme(); };
  const periodChanged = () => { ui.month = null; ui.fMonth = ''; save(); renderSettings(); };
  $('#sPeriod').onchange = e => { st.periodMode = e.target.value; periodChanged(); };
  $('#sPayday').onchange = e => { const v = Math.round(+e.target.value); if (v >= 1 && v <= 31) st.payday = v; periodChanged(); };
  $('#sSalPat').onchange = e => { st.salaryPattern = e.target.value.trim(); periodChanged(); };
  $('#sSalPick').onchange = e => { if (e.target.value) { st.salaryPattern = e.target.value; periodChanged(); } };
  wirePlanSettings();
  const catQ = $('#catQ'); const applyCatQ = () => { const n = filterCatRows($$('#catList .cat-row'), ui.catQ); const info = $('#catQInfo'); info.hidden = !ui.catQ.trim(); info.textContent = n ? `${n} categor${n === 1 ? 'y' : 'ies'} match` : 'No category matches'; };
  catQ.oninput = () => { ui.catQ = catQ.value; applyCatQ(); }; applyCatQ();
  $('#addCard').onclick = () => { let n = 'Credit card', k = 2; while (S.accounts.some(a => a.name === n)) n = 'Credit card ' + k++; S.accounts.push({ id: uid(), name: n, type: 'card', match: '', countPayoffs: true }); save(); renderSettings(); const i = $$('#accList [data-aname]').pop(); if (i) { i.focus(); i.select(); } };
  $('#sUnlinked').onchange = e => { S.settings.countUnlinkedPayoffs = e.target.checked; save(); };
  $('#accList').onchange = e => {
    const row = e.target.closest('.acc-row'); if (!row) return; const a = S.accounts[+row.dataset.ai];
    if (e.target.matches('[data-aname]')) { const v = e.target.value.trim(); if (v) a.name = v; }
    if (e.target.matches('[data-atype]')) a.type = e.target.value;
    if (e.target.matches('[data-amatch]')) { const v = e.target.value.trim(); if (v && v.split(',').some(x => x.trim() && !compilePattern(x.trim()))) { toast('Invalid pattern', true); e.target.value = a.match; return; } a.match = v; }
    if (e.target.matches('[data-acount]')) a.countPayoffs = e.target.checked;
    save(); renderSettings();
  };
  $('#accList').onclick = e => {
    if (!e.target.closest('[data-adel]')) return; const a = S.accounts[+e.target.closest('.acc-row').dataset.ai];
    if (!confirm(`Remove account "${a.name}"? Its transactions are kept (without an account).`)) return;
    S.accounts = S.accounts.filter(x => x !== a); S.txns.forEach(t => { if (t.account === a.id) t.account = ''; if (t.payCard === a.id) t.payCard = ''; });
    Object.keys(S.layouts).forEach(k => { if (S.layouts[k] === a.id) delete S.layouts[k]; }); if (ui.acc === a.id) ui.acc = ''; if (ui.fAcc === a.id) ui.fAcc = '';
    save(); renderSettings();
  };
  $('#bExpJson').onclick = exportJSON;
  $('#bImpJson').onclick = () => $('#jsonInput').click();
  $('#bExpCsv').onclick = () => exportCSV(S.txns.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  $('#bRecat').onclick = () => { const n = recategorizeAll(); save(); renderSettings(); toast(`${n} transaction${n === 1 ? '' : 's'} re-categorized (manual choices kept)`); };
  $('#bClear').onclick = () => {
    if (!confirm('Delete ALL transactions, categories, rules, budgets and settings from this browser?\n\nConsider exporting a JSON backup first. This cannot be undone.')) return;
    S = defaultState(); invalidateRules(); save(); ui.month = null; renderAll(); toast('All data cleared');
  };
  $('#addCat').onclick = () => {
    let n = 'New category', k = 2; while (catByName(n)) n = 'New category ' + k++;
    const at = Math.max(0, S.categories.findIndex(c => c.name === 'Other'));
    S.categories.splice(at, 0, { name: n, color: PALETTE[S.categories.length % PALETTE.length], type: 'expense' });
    save(); renderSettings(); const inp = $$('#catList [data-name]')[at]; if (inp) { inp.focus(); inp.select(); }
  };
  $('#catList').onchange = e => {
    const row = e.target.closest('.cat-row'); if (!row) return; const c = S.categories[+row.dataset.i];
    if (e.target.matches('[data-color]')) c.color = e.target.value;
    if (e.target.matches('[data-type]')) { c.type = e.target.value; subsOf(c.name).forEach(x => x.type = c.type); }
    if (e.target.matches('[data-parent]')) {
      const np = e.target.value; if (np) { c.parent = np; c.type = catByName(np).type; } else delete c.parent;
      const [moved] = S.categories.splice(S.categories.indexOf(c), 1); const at = np ? S.categories.indexOf(catByName(np)) + 1 + subsOf(np).length : S.categories.findIndex(x => x.name === 'Other');
      S.categories.splice(at < 0 ? S.categories.length : at, 0, moved);
    }
    if (e.target.matches('[data-name]')) {
      const nn = e.target.value.trim();
      if (!nn || (nn !== c.name && catByName(nn))) { toast(nn ? 'A category with that name already exists' : 'Name cannot be empty', true); e.target.value = c.name; return; }
      renameCategory(c.name, nn);
    }
    save(); renderSettings();
  };
  $('#catList').onclick = e => {
    const add = e.target.closest('[data-addsub]');
    if (add) {
      const m = S.categories[+add.closest('.cat-row').dataset.i]; let n = 'New subcategory', k = 2; while (catByName(n)) n = 'New subcategory ' + k++;
      const at = S.categories.indexOf(m) + 1 + subsOf(m.name).length;
      S.categories.splice(at, 0, { name: n, color: shadeColor(m.color, subsOf(m.name).length % 4, 4), type: m.type, parent: m.name });
      save(); renderSettings(); const inp = $$('#catList .cat-row').find(r => +r.dataset.i === at); if (inp) { const i = inp.querySelector('[data-name]'); i.focus(); i.select(); }
      return;
    }
    const b = e.target.closest('[data-delcat]'); if (!b) return; const c = S.categories[+b.closest('.cat-row').dataset.i];
    const subs = subsOf(c.name), names = [c.name].concat(subs.map(x => x.name));
    const n = names.reduce((a, x) => a + (usage[x] || 0), 0), to = c.parent || 'Other';
    if (!confirm(`Delete category "${c.name}"${subs.length ? ` and its ${subs.length} subcategories` : ''}?` + (n ? `\n${n} transaction(s) will move to "${to}".` : '') + '\nRules pointing to it will be removed.')) return;
    S.categories = S.categories.filter(x => !names.includes(x.name));
    S.txns.forEach(t => { if (names.includes(t.category)) { t.category = to; t.catManual = false; } });
    S.rules = S.rules.filter(r => !names.includes(r.category)); names.forEach(x => delete S.budgets[x]);
    invalidateRules(); save(); renderSettings();
  };
  $('#ruleQ').oninput = e => { ui.ruleQ = e.target.value; clearTimeout(renderSettings._t); renderSettings._t = setTimeout(() => { renderSettings(); const q = $('#ruleQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 200); };
  $('#addRule').onclick = () => { S.rules.unshift({ id: uid(), pattern: 'new keyword', category: 'Other', user: true }); ui.ruleQ = ''; invalidateRules(); save(); renderSettings(); const i = $('[data-rpat]'); if (i) { i.focus(); i.select(); } };
  $('#resetRules').onclick = () => { if (!confirm('Restore the built-in rules? Your own rules (marked "mine") are kept at the top.')) return; S.rules = S.rules.filter(r => r.user).concat(defaultState().rules); invalidateRules(); save(); renderSettings(); toast('Default rules restored'); };
  const rl = $('.rules-list');
  rl.onchange = e => {
    const tr = e.target.closest('tr[data-ri]'); if (!tr) return; const r = S.rules[+tr.dataset.ri];
    if (e.target.matches('[data-rpat]')) { const v = e.target.value.trim(); if (!v || !compilePattern(v)) { toast('Invalid pattern', true); e.target.value = r.pattern; return; } r.pattern = v; r.user = true; }
    if (e.target.matches('[data-rcat]')) { r.category = e.target.value; r.user = true; }
    invalidateRules(); save(); renderSettings();
    toast('Rule saved. Use "Re-apply rules" to update existing transactions.');
  };
  rl.onclick = e => {
    const tr = e.target.closest('tr[data-ri]'); if (!tr) return; const i = +tr.dataset.ri;
    if (e.target.closest('[data-rdel]')) S.rules.splice(i, 1);
    else if (e.target.closest('[data-rup]') && i > 0) { const [r] = S.rules.splice(i, 1); S.rules.splice(i - 1, 0, r); }
    else return;
    invalidateRules(); save(); renderSettings();
  };
}
function renameCategory(oldN, newN) {
  const c = catByName(oldN); if (!c) return;
  c.name = newN;
  S.categories.forEach(x => { if (x.parent === oldN) x.parent = newN; });
  S.txns.forEach(t => { if (t.category === oldN) t.category = newN; });
  S.rules.forEach(r => { if (r.category === oldN) r.category = newN; });
  if (S.budgets[oldN] != null) { S.budgets[newN] = S.budgets[oldN]; delete S.budgets[oldN]; }
  if (ui.fCat === oldN) ui.fCat = newN;
  ui.fCats = ui.fCats.map(x => x === oldN ? newN : x);
  if (S.settings.recentCats) S.settings.recentCats = S.settings.recentCats.map(x => x === oldN ? newN : x);
  invalidateRules();
}

/* ---------------- Export / restore ---------------- */
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const today = () => new Date().toISOString().slice(0, 10);
function exportJSON() { syncBufferGoal(); S.settings.lastBackup = new Date().toISOString(); save(); if (ui.view === 'settings') setTimeout(renderSettings, 0); download(`spending-tracker-backup-${today()}.json`, JSON.stringify(Object.assign({ app: 'spending-tracker', exportedAt: new Date().toISOString() }, S), null, 1), 'application/json'); toast('Backup downloaded'); }
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportCSV(list) {
  const lines = ['Date,Description,Amount,Currency,Category,Note,Source'];
  list.forEach(t => lines.push([t.date, t.desc, t.amount.toFixed(2), S.settings.currency, t.category, t.note, t.source].map(csvCell).join(',')));
  download(`transactions-${today()}.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8'); toast(`Exported ${list.length} transactions`);
}
$('#jsonInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || !Array.isArray(data.txns)) throw new Error('not a Spending Tracker backup file');
    if (!confirm(`Restore backup "${f.name}" with ${data.txns.length} transactions?\nThis REPLACES all current data.`)) return;
    S = normalizeState(data); invalidateRules(); if (S.settings.needsRecat) { delete S.settings.needsRecat; recategorizeAll(); } save(); ui.month = null; renderAll(); toast('Backup restored');
  } catch (err) { toast('Restore failed: ' + err.message, true); }
});

/* ---------------- Theme ---------------- */
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
}
const effectiveDark = () => S.settings.theme === 'dark' || (S.settings.theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
$('#themeBtn').onclick = () => { S.settings.theme = effectiveDark() ? 'light' : 'dark'; save(); applyTheme(); if (ui.view === 'settings') renderSettings(); };

/* ---------------- Wiring ---------------- */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (!b) return; ui.view = b.dataset.view; renderAll(); window.scrollTo(0, 0); });
$('#importBtn').onclick = () => $('#fileInput').click();
$('#fileInput').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; handleFiles(files); });
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropOverlay').classList.add('show'); });
window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').classList.remove('show'); });
window.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.remove('show'); handleFiles(e.dataTransfer.files); });
let _wasNarrow = window.innerWidth < 700;
window.addEventListener('resize', () => { const n = window.innerWidth < 700; if (n !== _wasNarrow) { _wasNarrow = n; if (ui.view === 'dashboard') renderDashboard(); } });
window.addEventListener('storage', e => { if (e.key === LS_KEY) { S = load(); invalidateRules(); renderAll(); } });

S = load();
// One-time re-categorization after cleaning changes (v2: Klarna "K*" marker). Manual categories are never touched.
if (S.settings.needsRecat) {   // two-level categories: re-run auto-categorization for non-manual rows so they get subcategories
  delete S.settings.needsRecat; recategorizeAll(); save();
}
if ((S.settings.cleanVersion || 0) < 2) {
  invalidateRules();
  S.txns.forEach(t => { if (!t.catManual && isViaKlarna(t.desc)) t.category = categorize(t); });
  S.settings.cleanVersion = 2; save();
}
renderAll();
// ---- Device storage: ask the browser to keep our data (iOS/Safari may evict site data after weeks of no use)
var storagePersisted = null;
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(p => p || navigator.storage.persist()).then(p => { storagePersisted = !!p; if (ui.view === 'settings') renderSettings(); }).catch(() => {});
}
function backupNoteHTML() {
  if (!S.txns.length) return '';
  const lb = S.settings.lastBackup, days = lb ? Math.floor((Date.now() - new Date(lb).getTime()) / 86400000) : null, due = days === null || days >= 30;
  const when = days === null ? 'You haven\'t exported a backup yet.' : days === 0 ? 'Last backup: today.' : `Last backup: ${days} day${days === 1 ? '' : 's'} ago.`;
  return `<div class="backup-note${due ? ' due' : ''}" id="backupNote">💾 <b>${when}</b> ${due ? 'A quick JSON backup now and then keeps your history safe.' : ''}<br><span class="hint">Your data lives only on this device. iPhone/Safari can clear website storage if the app isn't opened for a while, and deleting the Home Screen app deletes its data, so keep a backup in Files or iCloud Drive.${storagePersisted === true ? ' Persistent storage is granted.' : ''}</span></div>`;
}

// ---- Installed app (PWA): register the service worker only when served over http(s) with a manifest (index.html in pwa/)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && document.querySelector('link[rel="manifest"]')) {
  let reloading = false;
  const showUpdate = reg => {
    if (!reg.waiting || document.getElementById('updateBar')) return;
    const bar = document.createElement('div'); bar.id = 'updateBar'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>A new version is available.</span><button class="btn primary small" id="updNow">Update</button><button class="btn small" id="updLater" aria-label="Later">Later</button>';
    document.body.appendChild(bar);
    $('#updNow').onclick = () => { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); bar.remove(); };
    $('#updLater').onclick = () => bar.remove();
  };
  const hadController = !!navigator.serviceWorker.controller;   // first install (clients.claim) must not reload the page
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg);
      reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(reg); }); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  });
}

// Small console API (handy for power users and automated tests)
window.SpendingTracker = { get state() { return S; }, planStats, planInsights, fvSeries, goalStatus, syncBufferGoal, normalizePlan, ISK_RULES, invalidateRules, cleanDescription, displayName, isViaKlarna, dedupeKey, fuzzyMatchRule, matchRule, parseXlsx, inflateRawJS, excelSerialToISO, isDateFormatCode, parseCSV, detectDelimiter, parseDate, parseAmount, buildConfig, buildTxns, merchantKey, categorize, detectRecurring, summarize, dictMatch, dictInfo: DICT_INFO, mainOf, payoffTreatment, payoffMatch, cardFor, normalizeState, getPeriods, periodOf, paydayDate, monthLabel, isSalary, allMonths, prevMonth, daysLeftText, periodRangeText };

}
