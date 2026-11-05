import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { StoreScreen } from './screens/StoreScreen';
import type { StoreReputation } from './api';
import type { HomeActions, HomeState } from './useHomeApp';
import { TrackScreen } from '../genesis/screens/TrackScreen';
import type { SendActions, SendState } from '../genesis/useSendApp';
import type { TrackView } from '../genesis/types';
import { StoreRecordCard } from '../vendor/screens/StoreRecordCard';

/*
 * 2026-11-05 — A STORE'S PUBLIC RECORD, picked up again ("Merchant reputation, from the widget": the measured half only,
 * tags not prose, receiver-only, the same for everybody, and no store may hide it). Built in October; what it lacked:
 * a new store's first orders made into percentages, no way to it from a parcel's tracking, and the store never shown it.
 */
const record = (over: Partial<StoreReputation> = {}): StoreReputation => ({
  vendorId: 'ven_1',
  name: 'Nairobi Threads',
  shipments: 12,
  shipsNextDayRate: 0.75,
  nextDayCount: 9,
  medianHoursToHandover: 10,
  sold: 12,
  neverDroppedRate: 0,
  neverDroppedCount: 0,
  upheldDisputeRate: 0,
  upheldCount: 0,
  tags: [],
  rating: { average: 4.2, count: 5, isNew: false },
  ...over,
});
const page = (r: StoreReputation) =>
  renderToString(<StoreScreen state={{ reputation: r, reputationState: 'ready', reputationError: null } as unknown as HomeState} actions={{} as HomeActions} />);

describe('a store’s public page', () => {
  it('says a real sample as percentages, with the typical time', () => {
    const html = page(record());
    expect(html).toContain('75%');
    expect(html).toContain(t('home.store.nextDay'));
    expect(html).toContain(t('home.store.typical'));
    expect(html).not.toContain(t('home.store.fewNote'));
  });

  it('counts a new store’s first orders rather than make a percentage of one or two — and leaves out a “typical” of one', () => {
    const html = page(record({ shipments: 2, shipsNextDayRate: 0, nextDayCount: 0, sold: 2, upheldDisputeRate: 0.5, upheldCount: 1, rating: { average: 0, count: 0, isNew: true } }));
    expect(html).toContain(t('home.store.countOf', { n: '0', m: '2' }));
    expect(html).toContain(t('home.store.nextDayCount'));
    expect(html).not.toContain('0%');
    // A claim upheld is still said — as what it is out of, not as "50%".
    expect(html).toContain(t('home.store.countOf', { n: '1', m: '2' }));
    expect(html).not.toContain('50%');
    expect(html).not.toContain(t('home.store.typical'));
    expect(html).toContain(t('home.store.fewNote'));
  });
});

describe('a store’s parcel, tracked', () => {
  const parcel = (over: Partial<TrackView> = {}): TrackView =>
    ({ ref: 'PUD-1', status: 'On_Bus', size: 'M', destination: 'Mama Njeri', destZone: 'Z-B', steps: [], ...over }) as TrackView;
  const tracked = (v: TrackView) => renderToString(<TrackScreen state={{ result: v, key: 'K', recent: [] } as unknown as SendState} actions={{} as SendActions} />);

  it('names the store it came from, a tap from its public record', () => {
    const html = tracked(parcel({ store: { vendorId: 'ven_1', name: 'Nairobi Threads' } }));
    expect(html).toContain(t('send.track.fromStore', { store: 'Nairobi Threads' }));
    expect(html).toContain('?store=ven_1');
  });

  it('says nothing of a store for a parcel somebody sent themselves', () => {
    const html = tracked(parcel());
    expect(html).not.toContain('?store=');
  });
});

describe('the store’s own card', () => {
  it('opens its public page and says the one widget setting that shows it at the checkout', () => {
    const html = renderToString(<StoreRecordCard vendorId="ven_abc" />);
    expect(html).toContain(t('vendor.record.title'));
    expect(html).toContain('?store=ven_abc');
    expect(html).toContain('store=&quot;ven_abc&quot;');
  });

  it('draws nothing before the store is known', () => {
    expect(renderToString(<StoreRecordCard />)).toBe('');
  });
});
