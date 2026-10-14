import { describe, expect, it } from 'vitest';
import { slotLabel, visitSpans } from './visitHours';

describe('when a company receives visitors, as it is said', () => {
  it('groups the days by the hours they keep — a Saturday morning apart from the week', () => {
    const place = { visitDays: ['sat', 'mon', 'tue', 'wed', 'thu', 'fri'], visitFrom: '09:00', visitTo: '16:00', visitHoursByDay: { sat: { from: '09:00', to: '12:00' } } };
    expect(visitSpans(place)).toEqual([
      { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '16:00' },
      { days: ['sat'], from: '09:00', to: '12:00' },
    ]);
  });

  it('puts days with the same hours together wherever they fall in the week, and says a day alone where it has no hours', () => {
    expect(visitSpans({ visitDays: ['mon', 'tue', 'wed'], visitFrom: '09:00', visitTo: '16:00', visitHoursByDay: { tue: { from: '10:00', to: '12:00' } } })).toEqual([
      { days: ['mon', 'wed'], from: '09:00', to: '16:00' },
      { days: ['tue'], from: '10:00', to: '12:00' },
    ]);
    expect(visitSpans({ visitDays: ['mon', 'sat'], visitHoursByDay: { sat: { from: '09:00', to: '12:00' } } })).toEqual([{ days: ['mon'] }, { days: ['sat'], from: '09:00', to: '12:00' }]);
    expect(visitSpans(undefined)).toEqual([]);
  });

  it('labels the last part of an hour with its end, and a whole hour by its start', () => {
    expect(slotLabel('10:00', '11:00')).toBe('10:00');
    expect(slotLabel('16:00', '16:30')).toBe('16:00–16:30');
    expect(slotLabel('10:00')).toBe('10:00');
  });
});
