import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { dayLabel, localDay, spellBegun, spellSpan } from './care';

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
