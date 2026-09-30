import { describe, expect, it } from 'vitest';
import { GIVE_BACK_ORDER, giveBackWords } from './giveBack';
import type { Translate } from './i18n';

// Echoes the key, so the test reads what was ASKED for rather than one catalog's wording.
const t = ((key: string) => key) as unknown as Translate;

describe('why a carrier gave the space back, as the shipper reads it', () => {
  it('says the coded reason and the carrier’s own words together', () => {
    expect(giveBackWords({ reason: 'vehicle_unavailable', note: 'Gearbox' }, t)).toBe('giveBack.vehicle_unavailable — “Gearbox”');
  });

  it('lets the sentence BE the reason for “other”, rather than prefixing “something else”', () => {
    expect(giveBackWords({ reason: 'other', note: 'The client moved the pickup' }, t)).toBe('“The client moved the pickup”');
  });

  it('says only the coded reason when there are no words beside it', () => {
    expect(giveBackWords({ reason: 'overbooked' }, t)).toBe('giveBack.overbooked');
  });

  it('invents nothing for a booking given back before reasons were kept', () => {
    expect(giveBackWords(undefined, t)).toBe('');
    expect(giveBackWords({}, t)).toBe('');
  });

  it('offers every reason the contract knows, “other” last', () => {
    expect(GIVE_BACK_ORDER[GIVE_BACK_ORDER.length - 1]).toBe('other');
    expect(new Set(GIVE_BACK_ORDER).size).toBe(5);
  });
});
