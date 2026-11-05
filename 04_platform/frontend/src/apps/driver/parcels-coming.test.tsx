import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ParcelsComing } from './screens/ParcelsComing';
import type { AheadView } from './types';

/*
 * 2026-11-05 — PRE-DROP-OFF, THE DRIVER'S SIDE (the owner: "Seen ahead, taken on ahead"): the parcels coming in at the shops
 * on this road, by next stop; a driver takes them on (the room held on their vehicle), lets them go, or sees who has them.
 */
const coming = (over: Partial<AheadView> = {}): AheadView => ({
  agentDid: 'did:shop:1',
  shopName: 'Downtown Kiosk',
  hopKey: 'mdp-west',
  hopLabel: 'Westlands Hub',
  parcels: 4,
  kg: 6.5,
  booked: 1,
  detourKm: 1.2,
  minutesAway: 8,
  ...over,
});
const card = (ahead: AheadView[]) => renderToString(<ParcelsComing ahead={ahead} onTake={() => undefined} onLetGo={() => undefined} />);

describe('parcels coming in on this road', () => {
  it('says nothing when nothing is coming', () => {
    expect(card([])).toBe('');
  });

  it('says how many, how heavy, for where, at which shop — and offers to take them on', () => {
    const html = card([coming()]);
    expect(html).toContain(t('driver.ahead.title'));
    expect(html).toContain(t('driver.ahead.line', { count: 4, kg: 6.5, stop: 'Westlands Hub' }));
    expect(html).toContain(t('driver.ahead.at', { shop: 'Downtown Kiosk', km: 1.2 }));
    expect(html).toContain(t('driver.ahead.booked', { count: 1 }));
    expect(html).toContain(t('driver.ahead.take'));
  });

  it('taken on by this driver: let go, or the bag is theirs once given', () => {
    expect(card([coming({ mine: { promiseId: 'pah_1', state: 'promised' } })])).toContain(t('driver.ahead.letGo'));
    const given = card([coming({ mine: { promiseId: 'pah_1', state: 'given' } })]);
    expect(given).toContain(t('driver.ahead.bagYours'));
    expect(given).not.toContain(t('driver.ahead.take'));
  });

  it('taken on by another driver: who, and nothing to take', () => {
    const html = card([coming({ takenBy: { driverDid: 'did:drv:2', name: 'Amos' } })]);
    expect(html).toContain(t('driver.ahead.taken', { name: 'Amos' }));
    expect(html).not.toContain(t('driver.ahead.take'));
  });
});
