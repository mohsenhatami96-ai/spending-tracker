import { foldText } from './util.js';
import { cleanDescription, matchRule, fuzzyMatchRule, titleCase, invalidateRules } from './rules.js';
import { dictMatch } from './dict.js';

/** @type {() => { categories: object[], txns: object[], settings: object }} */
let getState = () => ({ categories: [], txns: [], settings: {} });
export function setStateProvider(fn) { getState = typeof fn === 'function' ? fn : getState; }

const SALARY_RE = /(^|[^a-z0-9])(lon|lonen|loneutbetalning|lonutbetalning|salary|salaries|payroll|wages|paycheck|gehalt|salaris|palkka)($|[^a-z0-9])/;
export const isSalaryText = s => SALARY_RE.test(' ' + foldText(s) + ' ');
export const PAYOFF_KEY = 'Card payoffs (not itemised)';

export function catByName(n) { return getState().categories.find(c => c.name === n); }
export function mainOf(n) { const c = catByName(n); return c && c.parent ? c.parent : n; }
export const isMain = n => { const c = catByName(n); return !!c && !c.parent; };
export const subsOf = main => getState().categories.filter(c => c.parent === main);
export const mainCats = () => getState().categories.filter(c => !c.parent);
export const catLabel = n => { const c = catByName(n); return c && c.parent ? c.parent + ' › ' + c.name : n; };
export const inCat = (leaf, sel) => !sel || leaf === sel || mainOf(leaf) === sel;
export function catType(n) { const c = catByName(n); return c ? c.type : 'expense'; }
export function catColor(n) { if (n === PAYOFF_KEY) return '#adb5bd'; const c = catByName(n); return c ? c.color : '#999'; }

export function categorize(t) {
  const clean = cleanDescription(t.desc);
  const src = (s, c, n) => { t.catSource = s; t.dictName = n || ''; return c; };
  let c = matchRule(clean, true) || matchRule(t.desc, true);
  if (c) return src('rule', c);
  const d = dictMatch(clean) || dictMatch(foldText(t.desc));
  if (d && !(t.amount > 0 && catType(d.category) === 'expense' && isSalaryText(clean))) return src('dict', d.category, d.name);
  c = matchRule(clean, false) || matchRule(t.desc, false);
  if (c) return src('keyword', c);
  c = fuzzyMatchRule(clean);
  if (c) return src('fuzzy', c);
  if (t.amount > 0) { const inc = catByName('Other income') || getState().categories.find(x => x.type === 'income'); return src('', inc ? inc.name : 'Other'); }
  return src('', 'Other');
}

export function recategorizeAll() {
  invalidateRules();
  let changed = 0;
  getState().txns.forEach(t => { if (!t.catManual) { const c = categorize(t); if (c !== t.category) { t.category = c; changed++; } } });
  return changed;
}

const _mkCache = new Map();
export function merchantKey(desc) {
  desc = String(desc || '');
  if (_mkCache.has(desc)) return _mkCache.get(desc);
  const clean = cleanDescription(desc);
  let s = clean.toUpperCase().replace(/[*#_"]/g, ' ').replace(/[^\p{L}\p{N}&'.\/+\- ]/gu, ' ');
  let words = s.split(/\s+/).filter(w => w && /\p{L}/u.test(w) && w !== '-');
  if (!words.length) words = clean.toUpperCase().split(/\s+/).slice(0, 2);
  words = words.slice(0, 3);
  while (words.length > 1 && (/^[A-Z]{2}$/.test(words[words.length - 1]) || /^[-&]$/.test(words[words.length - 1]))) words.pop();
  let r = words.join(' ').replace(/[\s.\-\/,]+$/, '');
  r = r ? titleCase(r) : '(unknown)';
  _mkCache.set(desc, r);
  return r;
}

export function dedupeKey(t) {
  return t.date + '|' + Math.round(t.amount * 100) + '|' + String(t.desc).toLowerCase().replace(/[^a-z0-9åäöéü]+/g, '');
}
