/** Pure utilities shared across domain. */
export const round2 = x => Math.round(x * 100) / 100;
export const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const foldText = s => String(s || '').toLowerCase().replace(/[åäàáâ]/g, 'a').replace(/[öøóô]/g, 'o').replace(/[éèêë]/g, 'e').replace(/[üú]/g, 'u');
export const tokensOf = s => foldText(s).split(/[^a-z0-9&]+/).filter(Boolean);
