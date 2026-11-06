/**
 * localStorage adapter for Spending Tracker.
 * LS_KEY must never change — user data lives under this key in the browser.
 * @typedef {import('../domain/ports.js').StateStore} StateStore
 */
import { defaultState, normalizeState } from '../domain/state.js';

/** Exact key used by all prior versions and by Playwright tests. */
export const LS_KEY = 'spendingTracker.v1';

let dataVersion = 0;
export function getDataVersion() { return dataVersion; }
export function bumpDataVersion() { dataVersion++; }

/** @type {((msg: string) => void)|null} */
let saveErrorHandler = null;
export function setSaveErrorHandler(fn) { saveErrorHandler = typeof fn === 'function' ? fn : null; }

/** @returns {import('../domain/ports.js').AppState} */
export function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch (e) {
    console.warn('Load failed', e);
    return defaultState();
  }
}

/** @param {import('../domain/ports.js').AppState} state */
export function save(state) {
  dataVersion++;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    if (saveErrorHandler) saveErrorHandler('Could not save to localStorage: ' + e.message);
    else console.warn('Save failed', e);
  }
}

export function createStore() {
  return { key: LS_KEY, load, save };
}
