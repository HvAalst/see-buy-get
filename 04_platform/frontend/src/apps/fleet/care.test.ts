import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { BREAKDOWN_CAUSES, CAUSE_WORD, OFF_ROAD_REASONS, SERVICE_KINDS, SERVICE_STATE, SERVICE_WORD, dayLabel, localDay, planWords, spellBegun, spellSpan, whereWords } from './care';
import { CAUSE_WORD as DRIVER_CAUSE_WORD } from '../driver/screens/Breakdown';

describe('a vehicle off the road, in words', () => {
  const today = '2026-10-15';

  it('names today and tomorrow, and any other day by its name — the day, not the clock’s', () => {
    expect(dayLabel('2026-10-15', today, t)).toBe('today');
    expect(dayLabel('2026-10-16', today, t)).toBe('tomorrow');
    const later = dayLabel('2026-10-18', today, t);
    expect(later).toMatch(/18/);
    expect(later).toMatch(/Oct/);
  });

  it('says a spell’s days: one day, a span, or until it is put back', () => {
    expect(spellSpan({ fromDay: today, untilDay: today }, today, t)).toBe('today only');
    expect(spellSpan({ fromDay: today, untilDay: '2026-10-16' }, today, t)).toBe('today to tomorrow');
    expect(spellSpan({ fromDay: '2026-10-16' }, today, t)).toBe('from tomorrow, until put back');
  });

  it('ends a spell that has begun and calls off one that has not', () => {
    expect(spellBegun({ fromDay: today }, today)).toBe(true);
    expect(spellBegun({ fromDay: '2026-10-14' }, today)).toBe(true);
    expect(spellBegun({ fromDay: '2026-10-16' }, today)).toBe(false);
  });

  it('reads today off this device’s own calendar', () => {
    expect(localDay(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
  });
});

describe('an odometer reading, in words', () => {
  it('says kilometres with the digits grouped, and who gave a reading', async () => {
    const { kmWords, SOURCE_WORD } = await import('./care');
    expect(kmWords(120400)).toMatch(/^120.400 km$/);
    expect(t(SOURCE_WORD.shift_start)).toBe('at a shift start');
    expect(t(SOURCE_WORD.office)).toBe('by the office');
  });
});

describe('a defect, in words', () => {
  it('names every item a check asks about and a driver can report, in both apps — never a code', async () => {
    const { DEFECT_WORD } = await import('./care');
    const { ITEM_WORD } = await import('../driver/screens/VehicleCheck');
    for (const [item, key] of Object.entries(DEFECT_WORD)) {
      expect(t(key)).not.toBe(key);
      expect(t(ITEM_WORD[item as keyof typeof ITEM_WORD])).not.toMatch(/^driver\./);
    }
    expect(Object.keys(ITEM_WORD).sort()).toEqual(Object.keys(DEFECT_WORD).sort());
  });
});

describe('a vehicle’s service, in words', () => {
  it('says how often: by km, by months, or whichever comes first', () => {
    expect(planWords({ everyKm: 15_000, everyMonths: 6 }, t)).toBe(`Every ${(15_000).toLocaleString()} km or 6 months, whichever comes first`);
    expect(planWords({ everyKm: 5_000 }, t)).toBe(`Every ${(5_000).toLocaleString()} km`);
    expect(planWords({ everyMonths: 3 }, t)).toBe('Every 3 months');
  });

  it('has words for everything that can be done to it, and for how the next service stands', () => {
    for (const k of SERVICE_KINDS) expect(t(SERVICE_WORD[k])).not.toMatch(/^fleet\./);
    for (const s of Object.values(SERVICE_STATE)) expect(t(s.key)).not.toMatch(/^fleet\./);
    expect(SERVICE_STATE.overdue.tone).toBe('danger');
  });
});

describe('a breakdown, in words', () => {
  it('says where: where the phone was, the last known position, or that nobody knows', () => {
    expect(whereWords({ location: { lat: -1.31, lng: 36.84 }, locationFrom: 'phone' }, t)).toBe('Where the phone was: -1.31000, 36.84000');
    expect(whereWords({ location: { lat: -1.28, lng: 36.81 }, locationFrom: 'last_known' }, t)).toBe('Last known position: -1.28000, 36.81000');
    expect(whereWords({}, t)).toBe('No position known');
  });

  it('has words for every cause, in the office and the driver alike', () => {
    for (const c of BREAKDOWN_CAUSES) {
      expect(t(CAUSE_WORD[c])).not.toMatch(/^fleet./);
      expect(t(DRIVER_CAUSE_WORD[c])).not.toMatch(/^driver./);
    }
    expect(Object.keys(DRIVER_CAUSE_WORD).sort()).toEqual([...BREAKDOWN_CAUSES].sort());
  });

  it('is never a spell the office takes by hand: a breakdown is recorded as one, which tells the shippers and holds the plan', () => {
    expect(OFF_ROAD_REASONS).not.toContain('breakdown');
  });
});
