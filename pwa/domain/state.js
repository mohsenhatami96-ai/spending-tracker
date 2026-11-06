import { uid, round2 } from './util.js';
import { DEFAULT_CATS, DEFAULT_RULES, LEGACY_CATS } from './categories.js';
import { LOCAL_RULES } from './local.js';
import { defaultPlan, normalizePlan } from './plan-defaults.js';
import { dedupeKey } from './categorize.js';

export function defaultState() {
  const rules = [];
  Object.entries(LOCAL_RULES).forEach(([cat, kws]) => kws.forEach(k => rules.push({ id: uid(), pattern: k, category: cat, user: false })));
  DEFAULT_RULES.forEach(([cat, kws]) => kws.forEach(k => rules.push({ id: uid(), pattern: k, category: cat, user: false })));
  return { version: 2, txns: [], categories: DEFAULT_CATS.map(c => Object.assign({}, c)), rules, budgets: {}, accounts: [], layouts: {},
    settings: { currency: 'USD', symbol: '', symbolPos: 'before', theme: 'auto', periodMode: 'salary', payday: 25, salaryPattern: '', catVersion: 2, countUnlinkedPayoffs: true }, plan: defaultPlan() };
}

export function migrateCategories(st, def, hadRules) {
  const oldDefaults = new Set(['Groceries', 'Dining', 'Transport', 'Shopping', 'Bills & Utilities', 'Subscriptions', 'Entertainment', 'Health', 'Travel', 'Income', 'Transfers', 'Other']);
  const map = n => LEGACY_CATS[n] || n;
  const custom = st.categories.filter(c => !oldDefaults.has(c.name) && !def.categories.some(d => d.name === c.name));
  st.categories = def.categories.map(c => Object.assign({}, c));
  const otherAt = st.categories.findIndex(c => c.name === 'Other');
  st.categories.splice(otherAt, 0, ...custom.map(c => ({ name: c.name, color: c.color, type: c.type })));
  st.txns.forEach(t => { t.category = map(t.category); });
  st.rules = hadRules ? st.rules.filter(r => r.user).map(r => Object.assign(r, { category: map(r.category) })).concat(def.rules.filter(r => !r.user)) : def.rules;
  const b = {}; Object.entries(st.budgets).forEach(([k, v]) => { const n = map(k); b[n] = (b[n] || 0) + (+v || 0); }); st.budgets = b;
  st.settings.catVersion = 2; st.settings.needsRecat = true;
}

export function normalizeState(d) {
  const def = defaultState();
  if (!d || typeof d !== 'object') return def;
  const st = {
    version: 1,
    txns: Array.isArray(d.txns) ? d.txns.filter(t => t && /^\d{4}-\d{2}-\d{2}/.test(t.date) && isFinite(t.amount)).map(t => ({
      id: t.id || uid(), date: String(t.date).slice(0, 10), desc: String(t.desc || ''), amount: round2(+t.amount),
      category: t.category || 'Other', catManual: !!t.catManual, catSource: t.catSource || '', dictName: t.dictName || '', account: t.account || '', payCard: t.payCard || '', salary: t.salary === true ? true : t.salary === false ? false : undefined, note: t.note || '', source: t.source || '', key: t.key || '' })) : [],
    categories: Array.isArray(d.categories) && d.categories.length ? d.categories.map(c => Object.assign({ name: String(c.name), color: c.color || '#888888', type: c.type || 'expense' }, c.parent ? { parent: String(c.parent) } : {})) : def.categories,
    rules: Array.isArray(d.rules) ? d.rules.filter(r => r && r.pattern).map(r => ({ id: r.id || uid(), pattern: String(r.pattern), category: r.category, user: !!r.user })) : def.rules,
    budgets: d.budgets && typeof d.budgets === 'object' ? d.budgets : {},
    accounts: Array.isArray(d.accounts) ? d.accounts.filter(a => a && a.id).map(a => ({ id: String(a.id), name: String(a.name || 'Account'), type: a.type === 'card' ? 'card' : 'bank', match: String(a.match || ''), countPayoffs: a.countPayoffs !== false })) : [],
    layouts: d.layouts && typeof d.layouts === 'object' ? d.layouts : {},
    settings: Object.assign({}, def.settings, d.settings || {}),
    plan: normalizePlan(d.plan)
  };
  if (!(d.settings && d.settings.catVersion >= 2)) migrateCategories(st, def, Array.isArray(d.rules));
  if (!st.categories.find(c => c.name === 'Other')) st.categories.push({ name: 'Other', color: '#a0a7b4', type: 'expense' });
  st.categories.forEach(c => { const p = c.parent && st.categories.find(x => x.name === c.parent && !x.parent); if (c.parent && !p) delete c.parent; else if (p) c.type = p.type; });
  const accIds = new Set(st.accounts.map(a => a.id)); st.txns.forEach(t => { if (t.account && !accIds.has(t.account)) t.account = ''; });
  st.txns.forEach(t => { if (!st.categories.find(c => c.name === t.category)) t.category = 'Other'; if (!t.key) t.key = dedupeKey(t); });
  return st;
}
