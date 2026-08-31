import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  EMPTY_MINT,
  ORDER_CSV_HEADERS,
  dimsComplete,
  dockBlockers,
  fromHandoff,
  handoffLine,
  mintMissing,
  money,
  orderRowsToCsv,
  orderStatus,
  ordersSummary,
  originRows,
  paidWord,
  policyLine,
  priceCards,
  stagingTone,
} from './logic';
import type { CheckoutRow, NetworkPoint, OrderRow, OriginOption, QuoteView } from './types';

const point = (over: Partial<NetworkPoint> = {}): NetworkPoint => ({
  did: 'did:a',
  shopName: 'Mama Sarah Shop',
  zone: 'Z-A',
  openState: 'open',
  pricePerParcel: 1.5,
  ...over,
});

const handoff = (over: Partial<CheckoutRow> = {}): CheckoutRow => ({
  id: 'chk_1',
  vendorId: 'ven_1',
  destAgentDid: 'did:dest',
  buyerEmail: 'amina@example.com',
  source: 'node',
  consumed: false,
  at: '2026-07-22T10:00:00Z',
  ...over,
});

const quote = (locked = 4.4, flexible = 6.6): QuoteView => ({
  hops: [],
  totalKm: 10,
  nodeFees: 2,
  size: 'M',
  locked: { transport: 2, base: 4, total: locked },
  flexible: { transport: 4, base: 6, total: flexible },
});

describe('the store’s own dock', () => {
  const ok = { label: 'Njiro warehouse, gate 2', zone: 'NorthTown', point: { lat: -1.2, lng: 36.8 }, bays: '2' };

  it('gates on a name, a zone, a pin and real floor room, in the order the form asks', () => {
    expect(dockBlockers({ ...ok, label: '  ' }, t)).toContain('name');
    expect(dockBlockers({ ...ok, zone: '' }, t)).toContain('zone');
    expect(dockBlockers({ ...ok, point: null }, t)).toContain('pin');
    expect(dockBlockers(ok, t)).toBeNull();
  });

  it('treats a typed 0 bays as a WRONG answer, not a missing one', () => {
    // `!bays` would let a typed zero fall through as "unset" and post a dock with no floor at all — which
    // the server would then refuse every bag on, with nothing on screen explaining why.
    expect(dockBlockers({ ...ok, bays: '0' }, t)).toContain('at least one');
    expect(dockBlockers({ ...ok, bays: '' }, t)).toContain('at least one');
    expect(dockBlockers({ ...ok, bays: 'two' }, t)).toContain('at least one');
    expect(dockBlockers({ ...ok, bays: '-3' }, t)).toContain('at least one');
    expect(dockBlockers({ ...ok, bays: '1' }, t)).toBeNull();
  });

  it('warns only when the floor is genuinely FULL, never merely busy', () => {
    // A store with two bays is at 50% the moment it opens one bag. Colouring that as a problem would teach
    // them to ignore the colour on the day it matters.
    expect(stagingTone({ capacity: 2, used: 1, free: 1 })).toBe('ok');
    expect(stagingTone({ capacity: 2, used: 2, free: 0 })).toBe('warn');
    expect(stagingTone({ capacity: 1, used: 0, free: 1 })).toBe('ok');
  });
});

describe('policy', () => {
  it('reads the split in plain words', () => {
    expect(policyLine({ mode: 'full', freeOverSubtotal: 50, buyerContributionCap: 3 }, t)).toContain('whole shipping price');
    const capped = policyLine({ mode: 'capped', freeOverSubtotal: 50, buyerContributionCap: 3 }, t);
    expect(capped).toContain('at most 3.00');
    expect(capped).toContain('over 50.00');
  });
});

describe('status words', () => {
  it('every status has merchant words and a drawable icon', () => {
    for (const s of ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Delivered', 'Disputed', 'Voided'] as const) {
      const p = orderStatus(s, t);
      expect(p.word.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
    }
    expect(orderStatus('Created', t).tone).toBe('warn'); // the merchant still has to act
    expect(paidWord('ParcelPaid', t)).toEqual({ word: 'Paid', tone: 'ok' });
    expect(paidWord('Unpaid', t).tone).toBe('warn');
  });
});

describe('mint wizard', () => {
  it('dims gate needs all four positive measurements', () => {
    expect(dimsComplete({ l: '20', w: '10', h: '5', kg: '1.2' })).toBe(true);
    expect(dimsComplete({ l: '20', w: '10', h: '', kg: '1.2' })).toBe(false);
    expect(dimsComplete({ l: '0', w: '10', h: '5', kg: '1.2' })).toBe(false);
  });

  it('mintMissing walks the wizard order', () => {
    expect(mintMissing(EMPTY_MINT, t)).toContain('Measure');
    const measured = { ...EMPTY_MINT, l: '20', w: '10', h: '5', kg: '1' };
    expect(mintMissing(measured, t)).toContain('photo');
    expect(mintMissing({ ...measured, photoRef: 'p.jpg' }, t)).toContain('buyer collects');
    expect(mintMissing({ ...measured, photoRef: 'p.jpg', destDid: 'did:d' }, t)).toContain('drop-off');
    expect(mintMissing({ ...measured, photoRef: 'p.jpg', destDid: 'did:d', originDid: 'did:o' }, t)).toBeNull();
  });

  it('fromHandoff prefIlls the buyer side and pins the checkout id', () => {
    const f = fromHandoff(EMPTY_MINT, handoff({ buyerMobile: '+254700', externalOrderId: 'SO-9' }));
    expect(f.checkoutId).toBe('chk_1');
    expect(f.destDid).toBe('did:dest');
    expect(f.buyerMobile).toBe('+254700');
    expect(f.externalOrderId).toBe('SO-9');
  });

  it('handoffLine counts items and names the buyer', () => {
    expect(handoffLine(handoff({ items: [{ name: 'Shirt', qty: 2 }], externalOrderId: 'SO-1' }), t)).toBe('2 items · SO-1 · amina@example.com');
    expect(handoffLine(handoff(), t)).toBe('order · amina@example.com');
  });
});

describe('originRows', () => {
  it('prices open shops cheapest-first; unroutable sink, closed and the destination vanish', () => {
    const pts = [
      point({ did: 'cheap', shopName: 'Cheap' }),
      point({ did: 'dear', shopName: 'Dear' }),
      point({ did: 'nowhere', shopName: 'Nowhere' }),
      point({ did: 'closed', shopName: 'Closed', openState: 'closed' }),
      point({ did: 'dest', shopName: 'Destination' }),
    ];
    const options: OriginOption[] = [
      { did: 'dear', quote: quote(7) },
      { did: 'cheap', quote: quote(3) },
      { did: 'nowhere', error: 'no route' },
    ];
    const rows = originRows(pts, 'dest', options);
    expect(rows.map((r) => r.point.did)).toEqual(['cheap', 'dear', 'nowhere']);
    expect(rows[0].total).toBe(3);
    expect(rows[2].total).toBeNull();
  });
});

describe('price cards', () => {
  it('cheapest first, always', () => {
    const cards = priceCards(quote(), t);
    expect(cards.map((c) => c.key)).toEqual(['locked', 'flexible']);
    expect(cards[0].total).toBeLessThan(cards[1].total);
  });
});

/**
 * The client export and the server export are the SAME file.
 *
 * "Export selected" runs here; "export all" runs in vendorOrdersToCsv on the server. A column added to one
 * and not the other is not a cosmetic difference — it is two files with the same name and different shapes,
 * and whoever reconciles them cannot tell which one they are holding. The list below is copied from the
 * server's and is meant to be edited only in step with it.
 */
const SERVER_ORDER_HEADERS = ['Order', 'Shipment DID', 'Buyer', 'Products', 'Status', 'Paid', 'Destination', 'Shipping cost', 'Buyer charge', 'Currency', 'Created'];

const orderRow = (over: Partial<OrderRow> = {}): OrderRow => ({
  parcelId: 'PUD-1', status: 'Created', paidStatus: 'ParcelPaid', destZone: 'Kisumu', size: 'M',
  shipmentCost: 12.5, buyerCharge: 3, currency: 'KES', createdAt: '2026-08-26T10:00:00Z', ...over,
});

describe('the shipment export', () => {
  it('carries the server export’s columns, in the server export’s order', () => {
    expect(ORDER_CSV_HEADERS).toEqual(SERVER_ORDER_HEADERS);
  });

  it('takes the currency from the row, so a store selling in another market exports its own money', () => {
    const lines = orderRowsToCsv([orderRow(), orderRow({ parcelId: 'PUD-2', currency: 'ETB' })]).split('\r\n');
    expect(lines[0]).toBe(SERVER_ORDER_HEADERS.join(','));
    expect(lines[1].split(',')[SERVER_ORDER_HEADERS.indexOf('Currency')]).toBe('KES');
    expect(lines[2].split(',')[SERVER_ORDER_HEADERS.indexOf('Currency')]).toBe('ETB');
  });

  it('leaves the cell blank rather than guessing when a row carries no currency', () => {
    const lines = orderRowsToCsv([orderRow({ currency: undefined })]).split('\r\n');
    expect(lines[1].split(',')[SERVER_ORDER_HEADERS.indexOf('Currency')]).toBe('');
  });
});

describe('speaking', () => {
  it('reads balance, motion and the unpaid nudge', () => {
    expect(ordersSummary(12.5, 3, 0, t)).toBe('Balance 12.50. 3 orders on the move.');
    expect(ordersSummary(0, 1, 1, t)).toContain('1 unpaid — top up to release it.');
    expect(money(undefined)).toBe('0.00');
  });
});
