import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('emits a header + one CRLF-terminated row per record', () => {
    const csv = toCsv(['A', 'B'], [
      ['x', 1],
      ['y', 2],
    ]);
    expect(csv).toBe('A,B\r\nx,1\r\ny,2');
  });

  it('quotes + escapes cells containing comma, quote or newline', () => {
    expect(toCsv(['A'], [['a,b']])).toBe('A\r\n"a,b"');
    expect(toCsv(['A'], [['she said "hi"']])).toBe('A\r\n"she said ""hi"""');
    expect(toCsv(['A'], [['line1\nline2']])).toBe('A\r\n"line1\nline2"');
  });

  it('neutralises a formula-injection string cell (leading = + - @) with a leading apostrophe', () => {
    expect(toCsv(['Buyer'], [['+254700111222']])).toBe("Buyer\r\n'+254700111222");
    expect(toCsv(['X'], [['=CMD()']])).toBe("X\r\n'=CMD()");
    expect(toCsv(['X'], [['@ref']])).toBe("X\r\n'@ref");
    // combined guard + quoting: a leading '-' AND a comma
    expect(toCsv(['X'], [['-a,b']])).toBe('X\r\n"\'-a,b"');
  });

  it('passes a NEGATIVE NUMBER through untouched (a real minus, not an injection)', () => {
    expect(toCsv(['Amount'], [[-12.5]])).toBe('Amount\r\n-12.5');
  });

  it('renders null/undefined as an empty cell', () => {
    expect(toCsv(['A', 'B'], [[null, undefined]])).toBe('A,B\r\n,');
  });
});
