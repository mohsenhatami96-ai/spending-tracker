import { foldText, tokensOf } from './util.js';
import { LOCAL_CITIES, LOCAL_LOC_ABBR } from './local.js';

/** @type {() => Array<{pattern:string, category:string, user?:boolean, id?:string}>} */
let getRules = () => [];
export function setRulesProvider(fn) { getRules = typeof fn === 'function' ? fn : () => []; }

/** @type {() => Array<{name:string}>} */
let getCategories = () => [];
export function setCategoriesProvider(fn) { getCategories = typeof fn === 'function' ? fn : () => []; }
const catByName = n => getCategories().find(c => c.name === n);

let _compiled = null;
export function compilePattern(p) {
  p = String(p || '').trim();
  try {
    if (p.length > 2 && p.startsWith('/') && p.lastIndexOf('/') > 0) {
      const last = p.lastIndexOf('/');
      return new RegExp(p.slice(1, last), (p.slice(last + 1).replace(/[^imsu]/g, '') || '') + (p.slice(last + 1).includes('i') ? '' : 'i'));
    }
    if (!p) return null;
    const e = foldText(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp('(^|[^a-z0-9])' + e + '($|[^a-z0-9])', 'i');
  } catch (e) { return null; }
}
export const isRegexPattern = p => { p = String(p || '').trim(); return p.length > 2 && p.startsWith('/') && p.lastIndexOf('/') > 0; };
export function compileRules() {
  _compiled = getRules().map(r => {
    const kw = isRegexPattern(r.pattern) ? '' : tokensOf(r.pattern).join('');
    return { re: compilePattern(r.pattern), category: r.category, user: !!r.user, regex: isRegexPattern(r.pattern), kw: kw.length >= 4 ? kw : '' };
  });
}
export function invalidateRules() { _compiled = null; }
// Exact pass: keyword rules match whole words on accent-folded text (so "hemköp" also matches "HEMKOP").
export function matchRule(desc, userOnly) {
  if (!_compiled) compileRules();
  const raw = ' ' + String(desc || '').toLowerCase() + ' ', folded = ' ' + foldText(desc) + ' ';
  for (const r of _compiled) if ((userOnly === undefined || r.user === userOnly) && r.re && catByName(r.category) && (r.re.test(folded) || (r.regex && r.re.test(raw)))) return r.category;
  return null;
}
// Close pass: tolerant of truncated ("CAFE NAPOLI PIZZE" ~ pizzeria, "APPLE COM BI" ~ apple.com/bill)
// and run-together names ("MAXIICA" ~ maxi ica). Compares keyword letters against the description
// starting at word boundaries.
export function fuzzyMatchRule(desc) {
  if (!_compiled) compileRules();
  const toks = tokensOf(desc); if (!toks.length) return null;
  const joined = toks.join(''), bounds = []; let p = 0;
  for (const t of toks) { bounds.push(p); p += t.length; }
  const ends = new Set(bounds.slice(1).concat([joined.length]));
  for (const r of _compiled) {
    const K = r.kw; if (!K || !catByName(r.category)) continue;
    for (const b of bounds) {
      const rest = joined.slice(b);
      if (rest.startsWith(K)) { if (ends.has(b + K.length) || K.length >= 6) return r.category; }
      else if (rest.length >= 5 && rest.length >= K.length * 0.5 && K.startsWith(rest)) return r.category;   // truncated tail
    }
  }
  return null;
}
// ---- Description cleaning: strips the noise banks add before rule matching & display ----
export const CITY_NAMES = ['stockholm','sthlm','uppsala','göteborg','gothenburg','malmö','västerås','örebro','linköping','norrköping','helsingborg','lund','umeå','gävle','arlanda','sweden','sverige','stockholms'].concat(LOCAL_CITIES);
export const CITY_VARIANTS = Array.from(new Set(CITY_NAMES.flatMap(c => [foldText(c), c.replace(/[åäö]/g, '')])));
export const LOC_ABBR = new Set(['swe', 'se', 'sto', 'sth', 'gbg', 'sth.'].concat(LOCAL_LOC_ABBR));
export const LEGAL_SUFFIX = new Set(['ab', 'a', 'publ', 'ltd', 'inc', 'llc', 'gmbh', 'oy', 'as', 'aps', 'hb', 'kb', 'bv', 'co', 'corp']);
export function isLocationTail(tail) {
  const j = tail.join('').toLowerCase();
  if (tail.length === 1 && LOC_ABBR.has(j)) return true;
  if (j.length < 4 || /\d/.test(j)) return false;
  return CITY_VARIANTS.some(c => c.startsWith(j) || c.startsWith(foldText(j)));
}
// 'K*' only as a token prefix (start of text or after a space / slash / colon / # / * / dash), never inside words like PARK*.
export const KLARNA_MARKER = /(^|[\s\/:#*-])k\s*\*\s*/gi;
export const isViaKlarna = desc => /(^|[\s\/:#*-])k\s*\*/i.test(String(desc || ''));
const _cleanCache = new Map();
export function cleanDescription(raw) {
  raw = String(raw || '');
  if (_cleanCache.has(raw)) return _cleanCache.get(raw);
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*\/\s*\d{2}(\d{2})?[-.]?\d{2}[-.]?\d{2}\s*$/, '')          // card purchase date suffix "/26-01-15"
       .replace(/\s+\d{4}-\d{2}-\d{2}(\s+\d{1,2}[:.]\d{2})?\s*$/, '')          // trailing ISO date/time
       .replace(/^\d{2}(\d{2})?[-.]?\d{2}[-.]?\d{2}\s+/, '');                  // leading date
  s = s.replace(KLARNA_MARKER, '$1');                                          // Klarna marker "K*ZALANDO" -> "ZALANDO"
  for (let k = 0; k < 3; k++) s = s.replace(/^(kortköp|kortkop|köp|kop|card purchase|purchase|pos|visa|mastercard|debit|contactless|autogiro|bankgiro|plusgiro|e-faktura|efaktura|betalning|bg|pg|ag|sq\s*\*|tst\s*\*|sp\s*\*|iz\s*\*|zettle_?\s*\*|paypal\s*\*)(\s+\d{6})?[\s:*#-]*/i, '');
  s = s.replace(KLARNA_MARKER, '$1').trim();
  s = s.replace(/\s+(att|c\/o|ref|ocr|meddelande)[:.]?\s.*$/i, '')               // "TELCO AB ATT: KUNDSERVICE"
       .replace(/\b(x{2,}|\*{2,})\d{2,4}\b/gi, ' ').replace(/#\s*\d+/g, ' ')    // card masks, store numbers "#104"
       .replace(/[\/*_|]+/g, ' ').replace(/\s+/g, ' ').trim();
  let toks = s.split(' ').filter(Boolean);
  if (toks.length && !toks.every(t => /^\+?\d[\d-]*$/.test(t))) {
    const nonNum = toks.filter(t => !/^\d{2,}$/.test(t));
    if (nonNum.length) toks = nonNum;                                            // drop store/terminal numbers
    for (let changed = true; changed && toks.length > 1;) {
      changed = false;
      const last = toks[toks.length - 1].toLowerCase().replace(/[.,]+$/, '');
      if (LEGAL_SUFFIX.has(last) && toks.length > 1) { toks.pop(); changed = true; continue; }
      for (const n of [2, 1]) {
        if (toks.length > n && isLocationTail(toks.slice(-n))) { toks.splice(-n, n); changed = true; break; }
      }
    }
  }
  const out = toks.join(' ').replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '') || raw.trim();
  _cleanCache.set(raw, out);
  return out;
}
export const titleCase = s => String(s).toLowerCase().replace(/(^|[\s\-\/(&])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
export function displayName(desc) { const c = cleanDescription(desc); return /[a-zåäö]/.test(c) && c !== c.toUpperCase() ? c : titleCase(c); }
