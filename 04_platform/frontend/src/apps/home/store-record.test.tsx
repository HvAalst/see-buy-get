import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { readFileSync } from 'node:fs';
import { formatDate, t } from '../../shared/i18n';
import { STORE_REPLIES, STORE_REPLY_MAX, WAY_OUT, replyLine } from '../../shared/storeReply';
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

/*
 * 2026-11-05 — THE STORE'S ONE ANSWER (the owner: "a standing reply … short and snappy. a few standard replies to choose
 * like 'contact our customer service' and an optional other that opens a text input field").
 */
describe('the store’s answer', () => {
  it('stands under what was said: a standard one in the reader’s language, the store’s own words quoted and said to be theirs', () => {
    const standard = page(record({ reply: { kind: 'CONTACT_US', at: '2026-11-05T10:00:00.000Z' } }));
    expect(standard).toContain(t('home.store.replyTitle'));
    expect(standard).toContain(t('common.storeReply.CONTACT_US'));
    const own = page(record({ reply: { kind: 'OTHER', text: 'We pack every order twice now.', at: '2026-11-05T10:00:00.000Z' } }));
    expect(own).toContain('“We pack every order twice now.”');
    expect(own).toContain(t('home.store.replyOwn', { date: formatDate('2026-11-05T10:00:00.000Z') }));
    expect(page(record())).not.toContain(t('home.store.replyTitle'));
  });

  it('is the store’s to give from its own card', () => {
    const html = renderToString(<StoreRecordCard vendorId="ven_abc" reply={{ set: async () => null, clear: async () => null }} />);
    // Nothing to answer from until the record is read; the sheet is there, closed.
    expect(html).toContain(t('vendor.record.title'));
    expect(renderToString(<StoreRecordCard vendorId="ven_abc" />)).not.toContain(t('vendor.reply.title'));
  });

  it('is the same list and limit the server keeps, and says first what the server would refuse', () => {
    const server = readFileSync('../backend/src/modules/pudo/merchant-rating.service.ts', 'utf8');
    const list = /export const STORE_REPLIES = \[([^\]]+)\] as const/.exec(server)?.[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(list).toEqual([...STORE_REPLIES]);
    expect(server).toContain(`export const STORE_REPLY_MAX = ${STORE_REPLY_MAX};`);
    expect(server).toContain(`const WAY_OUT = ${WAY_OUT.toString()};`);
    expect(replyLine('  We pack\nevery order   twice. ')).toBe('We pack every order twice.');
    for (const k of STORE_REPLIES.filter((k) => k !== 'OTHER')) expect(t(`common.storeReply.${k}` as 'common.storeReply.CONTACT_US')).not.toContain('common.');
  });
});

describe('a store nobody has rated yet', () => {
  it('says nobody, not "only 0 buyers"', () => {
    const html = page(record({ rating: { average: 0, count: 0, isNew: true } }));
    expect(html).toContain('Nobody has rated this store yet.');
    expect(html).not.toContain('Only 0');
    expect(page(record({ rating: { average: 4, count: 1, isNew: true } }))).toContain('Only 1 buyer has rated this store.');
  });
});
