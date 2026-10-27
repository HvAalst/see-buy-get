import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { BoardCard } from './screens/BoardScreen';
import { OfferCard } from './screens/OffersScreen';
import type { BoardRow, OfferView } from './types';

/*
 * WHAT DRIVERS SAY OF A SHIPPER WHO PAYS THEM DIRECTLY (the user, 2026-10-27: "build the driver warning"): before a driver
 * takes a matched load — on the board, and on an offer — how many of that shipper's loads drivers said were not paid, still
 * unpaid a week after they said so. Nothing when none.
 */
const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  freightId: 'f1',
  code: 'FRT-001',
  description: 'Cut stone',
  pickupLabel: 'Mawe quarry',
  destLabel: 'Athi River',
  weightKg: 800,
  commitMode: 'instant',
  deadheadKm: 5,
  loadedKm: 20,
  totalKm: 25,
  canTake: true,
  blockers: [],
  ...over,
});
const offer = (over: Partial<OfferView> = {}): OfferView =>
  ({ offerId: 'o1', kind: 'freight', ref: 'f1', pickupLabel: 'Mawe quarry', destLabel: 'Athi River', weightKg: 800, detourKm: 2, minutesAway: 6, message: '', expiresAt: new Date(Date.now() + 600_000).toISOString(), status: 'pending', ...over }) as OfferView;
const noop = () => undefined;

describe('the shipper drivers say has not paid them', () => {
  const said = (n: number) => t('common.paidDirect.shipperUnpaid', { n });

  it('is said on the board before the load is taken, beside who pays — and not at all when nobody said so', () => {
    const warned = renderToString(<BoardCard row={row({ paidByShipper: true, shipperUnpaid: 2 })} currency="KES" onPropose={noop} onAsk={noop} />);
    expect(warned).toContain(t('driver.paidByShipper'));
    expect(warned).toContain(said(2));
    expect(warned).toContain('meta--warn');
    const clean = renderToString(<BoardCard row={row({ paidByShipper: true })} currency="KES" onPropose={noop} onAsk={noop} />);
    expect(clean).toContain(t('driver.paidByShipper'));
    expect(clean).not.toContain('meta--warn');
  });

  it('a load the shipper answered it paid is said as disputed — beside, never inside, the unpaid count', () => {
    const html = renderToString(<BoardCard row={row({ paidByShipper: true, shipperUnpaid: 1, shipperDisputed: 2 })} currency="KES" onPropose={noop} onAsk={noop} />);
    expect(html).toContain(said(1));
    expect(html).toContain(t('common.paidDirect.shipperDisputed', { n: 2 }));
    const disputedOnly = renderToString(<BoardCard row={row({ paidByShipper: true, shipperDisputed: 1 })} currency="KES" onPropose={noop} onAsk={noop} />);
    expect(disputedOnly).toContain(t('common.paidDirect.shipperDisputed', { n: 1 }));
    expect(disputedOnly).not.toContain('meta--warn');
  });

  it('is said on an offer too', () => {
    expect(renderToString(<OfferCard offer={offer({ paidByShipper: true, shipperUnpaid: 1 })} now={Date.now()} currency="KES" />)).toContain(said(1));
    expect(renderToString(<OfferCard offer={offer({ paidByShipper: true })} now={Date.now()} currency="KES" />)).not.toContain('meta--warn');
  });
});
