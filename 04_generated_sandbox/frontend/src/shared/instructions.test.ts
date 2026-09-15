import { describe, expect, it } from 'vitest';
import { hasInstructions, telHref } from './instructions';

describe('FP7 — the sender’s instructions', () => {
  it('knows when there is anything to show', () => {
    expect(hasInstructions(undefined)).toBe(false);
    expect(hasInstructions({})).toBe(false);
    expect(hasInstructions({ deliveryWindow: 'before 10:00' })).toBe(true);
    expect(hasInstructions({ amendments: [{ text: 'x', at: 't' }] })).toBe(true);
  });

  it('dials a phone and refuses to dial words', () => {
    expect(telHref('+254 700 999 888')).toBe('tel:+254700999888');
    expect(telHref('0712-345-678')).toBe('tel:0712345678');
    expect(telHref('ask Joseph')).toBeNull();
    expect(telHref(undefined)).toBeNull();
  });
});
