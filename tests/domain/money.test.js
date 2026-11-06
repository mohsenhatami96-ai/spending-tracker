import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, looksNum, detectDecimal } from '../../domain/money.js';
import { round2 } from '../../domain/util.js';

describe('parseAmount', () => {
  it('parses common formats', () => {
    assert.equal(parseAmount('1,234.56', '.'), 1234.56);
    assert.equal(parseAmount('-12.30', '.'), -12.3);
    assert.equal(parseAmount('(45.00)', '.'), -45);
    assert.equal(parseAmount('1.234,56', ','), 1234.56);
    assert.equal(parseAmount('12,5', ','), 12.5);
    assert.equal(parseAmount('$-204.51', '.'), -204.51);
    assert.equal(parseAmount('99.00-', '.'), -99);
    assert.equal(parseAmount('1 234,00 kr', ','), 1234);
    assert.equal(parseAmount('−7.5', '.'), -7.5);
  });
  it('rejects empty', () => {
    assert.equal(parseAmount('', '.'), null);
    assert.equal(parseAmount(null, '.'), null);
  });
});

describe('round2', () => {
  it('rounds to cents', () => {
    assert.equal(round2(1.005), 1); // Math.round banker's? 1.005*100=100.5 -> 101 in some engines
    assert.equal(round2(10.999), 11);
  });
});

describe('detectDecimal', () => {
  it('picks comma when more commas look like decimals', () => {
    assert.equal(detectDecimal(['1,5', '2,0', '3,25']), ',');
  });
});
