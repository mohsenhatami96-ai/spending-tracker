import { uid } from './util.js';

export const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + String(m).padStart(2,'0') + '-' + String(day).padStart(2,'0');
};

export const ISK_RULES = { year: 2026, slr: 2.55, schablon: 3.55, tax: 1.065, free: 300000, prevYear: 2025, prevFree: 150000, prevTax: 0.888 };
export const FIXED_MAINS = ['Housing', 'Utilities', 'Insurance', 'Subscriptions'];
export const FIXED_SUBS = ['Loan/credit', 'Car loan/leasing', 'Vehicle tax/insurance', 'Unemployment fund', 'Pet insurance'];
// Bare-minimum ("essential") costs used for the emergency buffer. Editable in Settings › Plan.
export const ESSENTIAL_DEFAULT = ['Housing', 'Mortgage/Rent', 'Housing fee/BRF', 'Home insurance', 'Repairs & furnishing', 'Utilities', 'Electricity', 'Broadband', 'Mobile', 'Water/heating',
  'Insurance', 'Groceries', 'Supermarket', 'Ethnic/specialty store', 'Bakery', 'Fuel', 'Public transport', 'Vehicle tax/insurance', 'Car loan/leasing',
  'Pharmacy', 'Doctor/care', 'Loan/credit', 'Unemployment fund', 'Vet', 'Pet insurance'];
export const CREDIT_RE = /\b(klarna|collector|resurs|qliro|ikano|anyfin|lendo|nordax|svea ekonomi|santander consumer|bank norwegian|avida|brocc|marginalen)\b/i;
export const FEE_RE = /\b(ränta|räntor|ranta|avgift|aviavgift|aviseringsavgift|påminnelse|paminnelse|dröjsmål|drojsmal|inkasso|late fee|interest|uppläggning)/i;
export const PLAN_DEFAULTS = { bufferMonths: 3, periods: 6, targetRate: 20, surplusShare: 75, ret: 7, inflation: 2, fee: 0.2, essentialMethod: 'lowq', essential: ESSENTIAL_DEFAULT.slice(), noDebt: false };
export function defaultPlan() { return { settings: Object.assign({}, PLAN_DEFAULTS, { essential: ESSENTIAL_DEFAULT.slice() }), goals: [bufferGoalNew()], dismissed: {}, bufferGoalCreated: true }; }
export function bufferGoalNew() { return { id: 'g-buffer', kind: 'buffer', name: 'Buffer: 3 months of essential expenses', target: 0, auto: true, date: '', monthly: 0, current: 0, link: false, start: todayStr(), history: [] }; }
export function normalizePlan(p) {
  p = p && typeof p === 'object' ? p : {};
  const s = Object.assign({}, PLAN_DEFAULTS, p.settings || {});
  const num = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  s.bufferMonths = num(s.bufferMonths, 1, 24, 3); s.periods = Math.round(num(s.periods, 3, 12, 6)); s.targetRate = num(s.targetRate, 0, 90, 20); s.surplusShare = num(s.surplusShare, 0, 100, 75);
  s.ret = num(s.ret, -20, 30, 7); s.inflation = num(s.inflation, -5, 20, 2); s.fee = num(s.fee, 0, 5, 0.2);
  s.essentialMethod = ['lowq', 'median', 'mean'].includes(s.essentialMethod) ? s.essentialMethod : 'lowq';
  s.essential = Array.isArray(s.essential) ? s.essential.map(String) : ESSENTIAL_DEFAULT.slice(); s.noDebt = !!s.noDebt;
  const goals = Array.isArray(p.goals) ? p.goals.filter(g => g && g.name).map(g => ({ id: String(g.id || uid()), kind: g.kind === 'buffer' ? 'buffer' : '', name: String(g.name), target: Math.max(0, +g.target || 0), auto: g.kind === 'buffer' ? g.auto !== false : false,
    date: /^\d{4}-\d{2}-\d{2}$/.test(g.date || '') ? g.date : '', monthly: Math.max(0, +g.monthly || 0), current: +g.current || 0, link: !!g.link, start: /^\d{4}-\d{2}-\d{2}$/.test(g.start || '') ? g.start : todayStr(),
    history: Array.isArray(g.history) ? g.history.filter(h => h && /^\d{4}-\d{2}-\d{2}$/.test(h.date) && isFinite(h.amount)).map(h => ({ date: h.date, amount: +h.amount })) : [] })) : [];
  if (!p.bufferGoalCreated && !goals.some(g => g.kind === 'buffer')) goals.unshift(bufferGoalNew());
  return { settings: s, goals, dismissed: p.dismissed && typeof p.dismissed === 'object' ? p.dismissed : {}, bufferGoalCreated: true };
}
