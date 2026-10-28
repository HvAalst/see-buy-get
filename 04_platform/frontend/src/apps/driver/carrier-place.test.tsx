import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { CarrierPlaceCard } from './screens/CarrierPlaceCard';
import type { DriverActions, DriverState } from './useDriverApp';

/*
 * WHERE THIS CARRIER IS (the user, 2026-10-28: "Drivers should give one if there is one. Otherwise a pin of their legal
 * station"): asked of a driver riding for themselves, never of a fleet's driver.
 */
const render = (driver: Record<string, unknown> | null) =>
  renderToString(<CarrierPlaceCard state={{ driver } as unknown as DriverState} actions={{ geocodePlace: async () => null, refresh: async () => undefined } as unknown as DriverActions} sbg={null} />);

describe('where a driver riding for themselves works from', () => {
  it('asks for a business address, or a pin of the station', () => {
    const html = render({ did: 'did:drv:1', displayName: 'Rider' });
    expect(html).toContain(t('driver.carrierPlace.title'));
    expect(html).toContain(t('driver.carrierPlace.address'));
    expect(html).toContain(t('driver.carrierPlace.station'));
  });

  it('once given, says what the notes carry, with a way to change it', () => {
    const html = render({ did: 'did:drv:1', displayName: 'Rider', carrierPlace: { station: { lat: -1.28333, lng: 36.81667, label: 'Kencom stage' }, at: '2026-10-28T10:00:00Z' } });
    expect(html).toContain('On your notes as the carrier: station Kencom stage at -1.28333, 36.81667.');
    expect(html).toContain(t('driver.carrierPlace.change'));
  });

  it('asks nothing of a fleet’s driver, nor of one taken off a fleet', () => {
    expect(render({ did: 'did:drv:2', displayName: 'Baraka', managerDid: 'did:fleet:kilima' })).toBe('');
    expect(render({ did: 'did:drv:3', displayName: 'Juma', removedFrom: { fleetName: 'Kilima', at: '2026-10-01' } })).toBe('');
  });
});
