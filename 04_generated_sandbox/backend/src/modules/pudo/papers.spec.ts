import { driverPapers, lapsedOf, offRoadLine, paperLapsesAt, paperStatus, vehiclePapers } from './papers';

/** FP4 — a date does what a date is for: the day after it, the thing is off; no date switches nothing off. */
describe('papers that switch things off', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  const DAY = 86_400_000;

  it('is valid all day on its expiry date and lapses the day after, in UTC', () => {
    expect(paperLapsesAt('2026-09-14')).toBe(Date.parse('2026-09-15T00:00:00Z'));
    expect(paperStatus('insurance', '2026-09-14', undefined, now).state).toBe('due');
    expect(paperStatus('insurance', '2026-09-13', undefined, now).state).toBe('lapsed');
    expect(paperStatus('insurance', '2026-09-14', undefined, Date.parse('2026-09-15T00:00:01Z')).state).toBe('lapsed');
  });

  it('is due within 30 days, ok beyond, none without a date, and never lapsed on an unreadable date', () => {
    expect(paperStatus('inspection', '2026-10-10', 'INS-1', now)).toMatchObject({ state: 'due', daysLeft: 27, reference: 'INS-1' });
    expect(paperStatus('inspection', '2027-01-01', undefined, now).state).toBe('ok');
    expect(paperStatus('licence', undefined, 'L-1', now)).toEqual({ kind: 'licence', state: 'none', reference: 'L-1' });
    expect(paperStatus('licence', 'someday', undefined, now).state).toBe('none');
  });

  it('reads a vehicle and a driver, and says which papers are off in words', () => {
    const v = vehiclePapers({ documents: { insuranceExpiresAt: '2026-09-01', inspectionExpiresAt: '2026-12-01' } }, now);
    expect(v.map((p) => `${p.kind}:${p.state}`)).toEqual(['insurance:lapsed', 'inspection:ok']);
    expect(lapsedOf(v).map(offRoadLine)).toEqual(['Insurance lapsed 1 Sep 2026']);
    expect(driverPapers({ licence: { number: 'L', classes: ['van'], expiresAt: new Date(now + 5 * DAY).toISOString() } }, now)[0]).toMatchObject({ kind: 'licence', state: 'due', daysLeft: 5 });
    expect(driverPapers({ licence: { number: 'L', classes: ['bike'] } }, now)[0].state).toBe('none');
  });
});
