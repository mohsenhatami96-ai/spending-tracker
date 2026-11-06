import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, normalizeState } from '../../domain/state.js';
import { LS_KEY } from '../../storage/localStorage.js';

describe('LS_KEY', () => {
  it('stays spendingTracker.v1', () => {
    assert.equal(LS_KEY, 'spendingTracker.v1');
  });
});

describe('defaultState', () => {
  it('starts empty with v2 categories', () => {
    const s = defaultState();
    assert.equal(s.settings.catVersion, 2);
    assert.equal(s.txns.length, 0);
    assert.ok(s.categories.some(c => c.name === 'Other'));
    assert.ok(s.rules.length > 10);
  });
});

describe('normalizeState', () => {
  it('migrates v1 flat categories', () => {
    const st = normalizeState({
      txns: [{ id: 'a', date: '2026-01-01', desc: 'Test', amount: -10, category: 'Bills & Utilities' }],
      categories: [{ name: 'Bills & Utilities', color: '#000', type: 'expense' }],
      settings: { currency: 'SEK' }
    });
    assert.equal(st.settings.catVersion, 2);
    assert.equal(st.settings.needsRecat, true);
    assert.equal(st.txns[0].category, 'Utilities');
  });
  it('keeps valid txns and drops bad ones', () => {
    const st = normalizeState({
      txns: [
        { date: '2026-01-01', desc: 'ok', amount: -1 },
        { date: 'bad', desc: 'x', amount: -1 },
        { date: '2026-01-02', desc: 'y', amount: 'nope' }
      ],
      settings: { catVersion: 2, currency: 'USD' }
    });
    assert.equal(st.txns.length, 1);
    assert.ok(st.txns[0].key);
  });
});
