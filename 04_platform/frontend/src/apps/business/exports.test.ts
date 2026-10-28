import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { fromUtcInput, timingLine, timingTag, utcWords, type ExportDetail } from './exports';

/*
 * EXPORTS TO THE PORT (the user, 2026-10-27): the clock an export runs on is the terminal's gate cut-off, said in one clock
 * (UTC) to the exporter, its forwarder and the driver — and the one line that says what it asks now.
 */
const detail = (timing: Partial<ExportDetail['timing']>): Pick<ExportDetail, 'timing' | 'consignment'> =>
  ({
    timing: { state: 'on_time', leaveByAt: '2026-10-29T06:00:00.000Z', roadKm: 486, plannedHours: 12.8, ...timing },
    consignment: { loadingPlace: { label: 'Kericho warehouse' }, terminal: { label: 'Kipevu container terminal' }, booking: { gateCutoffAt: '2026-10-29T18:48:00.000Z', partyName: 'Pwani Forwarders' } },
  }) as unknown as Pick<ExportDetail, 'timing' | 'consignment'>;

describe('an export’s clock', () => {
  it('says a cut-off in UTC, and reads one typed in as UTC', () => {
    expect(utcWords('2026-10-29T18:48:00.000Z')).toBe('29 Oct 2026 18:48 UTC');
    expect(fromUtcInput('2026-10-29T18:48')).toBe('2026-10-29T18:48:00.000Z');
    expect(fromUtcInput('')).toBeUndefined();
    expect(fromUtcInput('not a date')).toBeUndefined();
  });

  it('says when the box must leave to be inside the gate — then that it is on the road, inside, or missed it', () => {
    expect(timingLine(detail({}), t)).toBe(
      'To be inside the gate at Kipevu container terminal before 29 Oct 2026 18:48 UTC, the loaded box must leave Kericho warehouse by 29 Oct 2026 06:00 UTC — 486 km, planned at 12.8 h with time to queue at the gate.',
    );
    expect(timingLine(detail({ collectedAt: '2026-10-29T05:00:00.000Z' }), t)).toBe('On the road to Kipevu container terminal: it must be inside the gate before 29 Oct 2026 18:48 UTC.');
    expect(timingLine(detail({ state: 'gated_in', gatedInAt: '2026-10-29T16:10:00.000Z' }), t)).toBe('Inside the gate at Kipevu container terminal since 29 Oct 2026 16:10 UTC.');
    expect(timingLine(detail({ state: 'missed' }), t)).toContain('Tell Pwani Forwarders: it may go on the next vessel');
  });

  it('tags it: on time, at risk and missed in warning, inside the gate in green', () => {
    expect(timingTag(detail({}).timing, t)).toEqual({ tone: 'info', word: 'On time' });
    expect(timingTag(detail({ state: 'at_risk' }).timing, t)).toEqual({ tone: 'warn', word: 'At risk' });
    expect(timingTag(detail({ state: 'missed' }).timing, t)).toEqual({ tone: 'warn', word: 'Missed the gate' });
    expect(timingTag(detail({ state: 'gated_in' }).timing, t)).toEqual({ tone: 'ok', word: 'Inside the gate' });
  });
});
