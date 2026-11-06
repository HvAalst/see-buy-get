import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { BagScreen } from './screens/BagScreen';

/*
 * 2026-11-06 — A SHOP'S ROOM FOR BAGS, as two numbers (the owner: "open bags need space to work around, but full bags can be
 * kept in any empty corner, but that differs from shop to shop"): the bags it works on at once, and the closed bags it can
 * keep waiting for a driver in a corner. The bags screen says both.
 */
const words = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const screen = (staging: { capacity: number; used: number; free: number; closed?: { waiting: number; corner: number } }) =>
  words(
    renderToString(
      <BagScreen
        state={{ agent: { did: 'did:shop:1' }, bag: null, bagPlan: { groups: [{ key: 'did:shop:2', label: 'Amos Shop', via: 'direct', parcelIds: ['PUD-1'] }], bags: [], staging }, bagPlanState: 'ready', busy: null, error: null, shopParcels: [] } as never}
        actions={{} as never}
      />,
    ),
  );

describe('a shop’s room for bags', () => {
  it('says the closed bags waiting for a driver, and the corner they stand in', () => {
    const text = screen({ capacity: 2, used: 0, free: 2, closed: { waiting: 1, corner: 3 } });
    expect(text).toContain(t('agent.bag.roomFree', { free: 2, capacity: 2 }));
    expect(text).toContain(t('agent.bag.cornerWaiting', { waiting: 1, corner: 3 }));
    expect(t('agent.bag.cornerWaiting', { waiting: 1, corner: 3 })).toBe('1 closed bag waits for a driver; your corner holds 3.');
  });

  it('says where closed bags stand when the shop has said it has no corner — and nothing when none waits', () => {
    expect(screen({ capacity: 2, used: 1, free: 1, closed: { waiting: 1, corner: 0 } })).toContain('1 closed bag waits for a driver where you work.');
    const none = screen({ capacity: 2, used: 0, free: 2, closed: { waiting: 0, corner: 2 } });
    expect(none).not.toContain('closed bag');
  });

  it('says both numbers back when they are saved', () => {
    expect(t('agent.toast.baysSavedDetail', { count: 2, closed: 0 })).toBe('2 bags open at once, and no closed bags in a corner.');
    expect(t('agent.toast.baysSavedDetail', { count: 1, closed: 4 })).toBe('1 bag open at once, and 4 closed bags in a corner.');
  });
});
