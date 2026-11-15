import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { BoardCard } from './screens/BoardScreen';
import type { BoardRow } from './types';

/*
 * 2026-11-13 — THE POSTER'S PRICE BACK (unusual loads, U4): on the driver's card, their own price and the price back, with the
 * one tap that takes it and the way to name another. The work it names is said above it.
 */
const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  freightId: 'f1',
  code: 'FRT-007',
  description: 'A three-seat sofa',
  pickupLabel: 'Kilimani flats',
  destLabel: 'Westlands',
  weightKg: 70,
  commitMode: 'negotiate',
  deadheadKm: 3,
  loadedKm: 6,
  totalKm: 9,
  canTake: true,
  blockers: [],
  ...over,
});
const noop = () => undefined;

describe('a price back on the driver’s card', () => {
  it('says their price, the price back, and offers to take it or name another', () => {
    const html = renderToString(<BoardCard row={row({ mine: { proposalId: 'p1', price: 2500, counter: { price: 2000, note: 'Stairs only' } } })} onPropose={noop} onAsk={noop} onTakeCounter={noop} />);
    expect(html).toContain(t('driver.board.yourPrice', { amount: '2,500' }).split(':')[0]);
    expect(html).toContain('The poster would pay 2000.00');
    expect(html).toContain('Take 2000.00');
    expect(html).toContain('Stairs only');
    expect(html).toContain(t('driver.board.nameAnother'));
    expect(html).toContain(t('driver.board.takeCounter', { amount: '' }).trim().split(' ')[0]);
  });

  it('says only their price while the poster has not answered, and nothing where they named none', () => {
    const waiting = renderToString(<BoardCard row={row({ mine: { proposalId: 'p1', price: 2500 } })} onPropose={noop} onAsk={noop} onTakeCounter={noop} />);
    expect(waiting).not.toContain(t('driver.board.nameAnother'));
    expect(renderToString(<BoardCard row={row()} onPropose={noop} onAsk={noop} />)).not.toContain('board__mine');
  });

  it('says the work on the card: each end and what the driver brings', () => {
    const html = renderToString(
      <BoardCard
        row={row({ work: { needs: 'two', pickup: { hands: 'none', floor: 3 }, delivery: { hands: 'none', theyDoIt: true }, gaps: { pickup: { helpers: 1, tailLift: false, palletJack: false }, delivery: { helpers: 0, tailLift: false, palletJack: false } }, extras: [{ end: 'pickup', kind: 'helper', n: 1 }], marks: ['upright'] } })}
        onPropose={noop}
        onAsk={noop}
      />,
    );
    expect(html).toContain('you bring a helper');
    expect(html).toContain(t('work.mark.upright'));
  });
});
