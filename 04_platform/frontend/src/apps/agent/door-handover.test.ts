import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { doorHandoverLine, type ShopDoorHandover } from './screens/DoorHandoverCard';

/**
 * FOR A BUSINESS'S OWN DOOR, AT THE SHOP'S COUNTER (2026-10-29: "At the nearest shop"). The counter says whether a driver
 * has taken the load yet — and who — because it hands the box to nobody but that driver, by their pass.
 */
describe('a business’s parcel at the counter, for its door', () => {
  const row = (status: string, driverName?: string): ShopDoorHandover => ({ parcelId: 'PUD-1', business: 'Lakeside', load: { freightId: 'frt_1', code: 'FRT-9', status, ...(driverName ? { driverName } : {}) } });

  it('says nobody has taken it, or who did and that they show their pass', () => {
    expect(doorHandoverLine(row('available'), t)).toBe('No driver has taken load FRT-9 yet.');
    expect(doorHandoverLine(row('claimed'), t)).toBe('A driver has taken load FRT-9: hand it over when they show their pass.');
    expect(doorHandoverLine(row('claimed', 'Otieno'), t)).toBe('Otieno took load FRT-9: hand it over when they show their pass.');
  });
});
