import { describe, expect, it } from 'vitest';
import { EMPTY_BORDER_FORM, borderFormBlocker, crossingLine, formFromRule, listOf, parseCrossings, toBorderBody, waitsInOrder, type BorderWaitRow } from './borders';
import type { CatalogueCountry } from './presence';

/** CA6 — recording the rules of crossing a border. */

const catalogue = [{ code: 'KE', name: 'Kenya' }, { code: 'TZ', name: 'Tanzania' }] as CatalogueCountry[];

describe('a border rule, typed by hand', () => {
  it('reads one crossing per line, with its hours after a bar', () => {
    expect(parseCrossings('Namanga | 06:00–22:00\n\n  Isebania  \n| no name')).toEqual([{ name: 'Namanga', hours: '06:00–22:00' }, { name: 'Isebania' }]);
    expect(listOf('COMESA Yellow Card, EAC transit permit\nCOMESA Yellow Card')).toEqual(['COMESA Yellow Card', 'EAC transit permit']);
  });

  it('refuses a rule that is not between two known, different countries, or has a nonsense limit', () => {
    expect(borderFormBlocker({ ...EMPTY_BORDER_FORM }, catalogue)).toBe('tower.borders.needFrom');
    expect(borderFormBlocker({ ...EMPTY_BORDER_FORM, from: 'KE' }, catalogue)).toBe('tower.borders.needTo');
    expect(borderFormBlocker({ ...EMPTY_BORDER_FORM, from: 'KE', to: 'KE' }, catalogue)).toBe('tower.borders.sameCountry');
    expect(borderFormBlocker({ ...EMPTY_BORDER_FORM, from: 'KE', to: 'TZ', maxWeightKg: '-5' }, catalogue)).toBe('tower.borders.badWeight');
    expect(borderFormBlocker({ ...EMPTY_BORDER_FORM, from: 'KE', to: 'TZ' }, catalogue)).toBeNull();
  });

  it('round-trips a rule through the form, so Change edits what is there', () => {
    const form = { ...EMPTY_BORDER_FORM, from: 'KE', to: 'TZ', crossings: 'Namanga | 24 hours', regionalInsurance: 'COMESA Yellow Card', maxWeightKg: '30000', cabotage: 'allowed' as const };
    const body = toBorderBody(form);
    expect(body).toEqual({ from: 'KE', to: 'TZ', crossings: [{ name: 'Namanga', hours: '24 hours' }], permits: [], regionalInsurance: ['COMESA Yellow Card'], maxWeightKg: 30000, cabotage: 'allowed' });
    const back = formFromRule({ ...(body as Record<string, unknown>), setBy: 'Amina', setAt: '2026-09-13T08:00:00Z' } as never);
    expect(back).toMatchObject({ crossings: 'Namanga | 24 hours', regionalInsurance: 'COMESA Yellow Card', maxWeightKg: '30000', cabotage: 'allowed' });
    expect(crossingLine({ name: 'Namanga', hours: '24 hours' })).toBe('Namanga · 24 hours');
  });

  it('round 14 — lists each post’s measured wait with its crossing’s other posts, the busiest first', () => {
    const row = (from: string, to: string, post: string, crossings: number): BorderWaitRow => ({ from, to, post, hours: 6, crossings, measured: crossings >= 5, longestHours: 9, lastClearedAt: '2026-10-19T08:00:00Z' });
    const ordered = waitsInOrder([row('KE', 'UG', 'Busia', 3), row('KE', 'TZ', 'Namanga', 2), row('KE', 'UG', 'Malaba', 23)]);
    expect(ordered.map((w) => `${w.from}${w.to} ${w.post}`)).toEqual(['KETZ Namanga', 'KEUG Malaba', 'KEUG Busia']);
  });
});
