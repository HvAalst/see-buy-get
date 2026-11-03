import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { LoadsScreen } from './screens/LoadsScreen';
import type { DriverActions, DriverState } from './useDriverApp';
import type { Claimable } from './types';

/*
 * 2026-11-03 — A LOAD KEPT COLD, ON THE DRIVER'S CARD BEFORE IT IS COLLECTED. On the road the temperature strip says the
 * range with the last reading; before pickup the card said nothing of it, so the body was cooled to it — or not — by
 * luck. Now the card says the range and to cool the body first, and the strip keeps saying it on the road.
 */
describe('the driver’s card, kept cold', () => {
  const claim = (over: Partial<Claimable>): Claimable => ({ kind: 'freight', ref: 'frt_1', code: 'FRT-1', status: 'claimed', pickupLabel: 'Kudu cold store', destLabel: 'Nakuru cold store', weightKg: 900, ...over }) as unknown as Claimable;
  const screen = (c: Claimable) =>
    renderToString(<LoadsScreen state={{ vehicle: { vehicleClass: 'truck', capacityKg: 9000, plate: 'KDC 123C' }, driver: { badgeId: 'B-1' }, remaining: 8100, claims: [c], departures: [], held: {}, session: { currency: 'KES' }, busy: null, error: null } as unknown as DriverState} actions={{} as DriverActions} />);
  const before = t('driver.loads.tempBeforePickup', { min: -25, max: -18 });

  it('says the range to keep, and to cool the body first, before the load is collected', () => {
    expect(before).toBe('Kept between -25 and -18 °C — cool the body to it before you collect.');
    expect(screen(claim({ tempBand: { minC: -25, maxC: -18 } }))).toContain(before);
  });

  it('says nothing of a temperature on a load not kept cold; on the road the strip says it, not this line', () => {
    expect(screen(claim({}))).not.toContain('cool the body');
    const riding = screen(claim({ status: 'in_transit', tempBand: { minC: -25, maxC: -18 } }));
    expect(riding).not.toContain(before);
    expect(riding).toContain(t('driver.loads.tempKeep', { min: -25, max: -18 }));
  });
});
