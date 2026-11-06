import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, detectDelimiter } from '../../domain/parse-csv.js';

describe('parseCSV', () => {
  it('handles quotes and newlines', () => {
    const rows = parseCSV('a,"b, c","say ""hi""\nthere"\r\n1,2,3\n', ',');
    assert.deepEqual(rows[0], ['a', 'b, c', 'say "hi"\nthere']);
    assert.deepEqual(rows[1], ['1', '2', '3']);
  });
});

describe('detectDelimiter', () => {
  it('detects semicolon, comma, tab', () => {
    assert.equal(detectDelimiter('a;b;c\n1,5;2;3\n4,5;5;6'), ';');
    assert.equal(detectDelimiter('a,b\n"x;y",2'), ',');
    assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  });
});
