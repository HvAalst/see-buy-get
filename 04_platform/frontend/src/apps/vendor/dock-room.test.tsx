import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { dockBlockers } from './logic';
import { DockScreen } from './screens/DockScreen';

/*
 * 2026-11-06 — A STORE'S OWN PLACE, ITS ROOM FOR BAGS, as a shop's (the owner: "go ahead"): the bags it works on at once,
 * and the closed bags it keeps in a corner while they wait for a driver.
 */
const words = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
const place = { label: 'Njiro warehouse', zone: 'NorthTown', point: { lat: -1.2, lng: 36.8 }, bays: '2' };

describe('a store’s own place, its room for bags', () => {
  it('takes no corner, or a whole number of bags — never fewer than none, or part of one', () => {
    expect(dockBlockers({ ...place, corner: '0' }, t)).toBeNull();
    expect(dockBlockers({ ...place, corner: '3' }, t)).toBeNull();
    expect(dockBlockers({ ...place, corner: '-1' }, t)).toBe(t('vendor.logic.dockCorner'));
    expect(dockBlockers({ ...place, corner: '1.5' }, t)).toBe(t('vendor.logic.dockCorner'));
  });

  it('says the closed bags waiting and the corner they stand in, and lets both numbers be said again', () => {
    const state = {
      vendor: { vendorId: 'v_1', did: 'did:store:1', collection: { label: 'Njiro warehouse', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, bays: 2, closedRoom: 3, enabledAt: '2026-11-06T00:00:00Z' } },
      dock: { groups: [], bags: [], staging: { capacity: 2, used: 0, free: 2, closed: { waiting: 1, corner: 3 } } },
      dockState: 'ready',
      points: [],
      busy: null,
      error: null,
    };
    const text = words(renderToString(<DockScreen state={state as never} actions={{ hubs: {} } as never} />));
    expect(text).toContain(t('vendor.dock.cornerWaiting', { waiting: 1, corner: 3 }));
    expect(t('vendor.dock.cornerWaiting', { waiting: 1, corner: 3 })).toBe('1 closed bag waits for a driver; your corner holds 3.');
    expect(text).toContain(t('vendor.dock.roomTitle'));
    expect(text).toContain(t('vendor.dock.cornerLabel'));
  });
});
