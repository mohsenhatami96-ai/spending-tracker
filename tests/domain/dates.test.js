import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, validYMD } from '../../domain/dates.js';

describe('parseDate', () => {
  it('parses ISO and regional', () => {
    assert.equal(parseDate('2026-09-03', 'auto'), '2026-09-03');
    assert.equal(parseDate('03/09/2026', 'DMY'), '2026-09-03');
    assert.equal(parseDate('09/03/2026', 'MDY'), '2026-09-03');
    assert.equal(parseDate('20260903', 'auto'), '2026-09-03');
    assert.equal(parseDate('3 Sep 2026', 'auto'), '2026-09-03');
    assert.equal(parseDate('Sep 3, 2026', 'auto'), '2026-09-03');
    assert.equal(parseDate('31/02/2026', 'DMY'), null);
    assert.equal(parseDate('03.09.26', 'DMY'), '2026-09-03');
  });
});

describe('validYMD', () => {
  it('rejects impossible days and formats valid ones', () => {
    assert.equal(validYMD(2026, 2, 31), null);
    assert.equal(validYMD(2026, 2, 28), '2026-02-28');
  });
});
