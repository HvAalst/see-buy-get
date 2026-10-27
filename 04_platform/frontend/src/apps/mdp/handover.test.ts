import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { handoverLine } from './screens/HandoverCard';

describe('a box set aside for its driver, as the counter reads it (the user, 2026-10-27: “As a load to its door”)', () => {
  it('says whether a driver has taken its load, and who — the one to hand it to, by their pass', () => {
    const h = { parcelId: 'PUD-1', size: 'M', calledOffAt: '2026-10-27T08:00:00.000Z', load: { freightId: 'frt_1', code: 'FRT-007', status: 'available' } };
    expect(handoverLine(h, t)).toBe('No driver has taken load FRT-007 yet.');
    expect(handoverLine({ ...h, load: { ...h.load, status: 'claimed', driverName: 'Amos' } }, t)).toBe('Amos has taken load FRT-007: scan their pass to hand it over.');
    expect(handoverLine({ ...h, load: { ...h.load, status: 'claimed' } }, t)).toBe('A driver has taken load FRT-007: scan their pass to hand it over.');
  });
});
