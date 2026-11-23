import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { RoadLoadCard, roadFit, type RoadLoadBag, type RoadLoadView } from './screens/RoadLoad';
import type { DriverActions, DriverState } from './useDriverApp';

/*
 * 2026-11-23 — THE ROAD ROUTE'S LOAD (the Netherlands–Bulgaria plan, step 3c; P3-1): a driver of the fleet that runs a road route
 * sees every bag waiting for it in the sending country, the way to each, how full the vehicle would be, and takes the ones that fit.
 */
const bag = (code: string, over: Partial<RoadLoadBag> = {}): RoadLoadBag => ({
  code,
  at: 'Grachten Winkel',
  atId: 'did:agent:1',
  location: { lat: 52.37, lng: 4.89 },
  parcels: 3,
  weightKg: 12,
  fillPct: 20,
  ...over,
});
const view = (bags: RoadLoadBag[], vehicle: RoadLoadView['vehicle'] = { bagPlaces: 15, freeBagPlaces: 15, freeKg: 900 }): RoadLoadView => ({
  routes: [{ from: 'NL', to: 'BG', hubName: 'Sofia Central Hub', bags, weightKg: bags.reduce((n, b) => n + b.weightKg, 0) }],
  ...(vehicle ? { vehicle } : {}),
});
const actions = { loadRoadLoad: async () => undefined, takeRoadLoad: async () => undefined } as unknown as DriverActions;
const card = (load: RoadLoadView | null, onShift = true) => renderToString(<RoadLoadCard state={{ roadLoad: load, busy: null } as unknown as DriverState} actions={actions} onShift={onShift} />);

describe('which bags fit, and how full the vehicle would be', () => {
  it('all of them, where the bag places and the kilos allow', () => {
    expect(roadFit([bag('A'), bag('B')], { bagPlaces: 15, freeBagPlaces: 12, freeKg: 500 })).toEqual({ codes: ['A', 'B'], all: true, used: 5, places: 15 });
  });

  it('no more than the free bag places', () => {
    expect(roadFit([bag('A'), bag('B'), bag('C')], { bagPlaces: 15, freeBagPlaces: 2, freeKg: 500 })).toMatchObject({ codes: ['A', 'B'], all: false, used: 15 });
  });

  it('no more than the kilos left: a heavy bag is left, a lighter one after it still goes', () => {
    expect(roadFit([bag('A', { weightKg: 30 }), bag('B', { weightKg: 80 }), bag('C', { weightKg: 10 })], { bagPlaces: 15, freeBagPlaces: 15, freeKg: 50 }).codes).toEqual(['A', 'C']);
  });

  it('none without a vehicle', () => {
    expect(roadFit([bag('A')], undefined)).toEqual({ codes: [], all: false, used: 0, places: 0 });
  });
});

describe('the route’s load on the driver’s home', () => {
  it('names the route and its central hub, each bag with where it waits and the way there, and takes them all', () => {
    const html = card(view([bag('BAG-1'), bag('BAG-2', { at: 'Haarlem Hoek', location: { lat: 52.38, lng: 4.64 } })]));
    expect(html).toContain('Sofia Central Hub');
    expect(html).toContain('Haarlem Hoek');
    expect(html).toContain('BAG-2');
    expect(html).toContain('google.com/maps/dir/');
    expect(html).toContain(t('driver.roadLoad.fits', { used: 2, places: 15 }));
    expect(html).toContain(t('driver.roadLoad.takeAll', { count: 2 }));
  });

  it('more than fits: says how many, and takes those', () => {
    const html = card(view([bag('A'), bag('B'), bag('C')], { bagPlaces: 15, freeBagPlaces: 1, freeKg: 900 }));
    expect(html).toContain(t('driver.roadLoad.takeSome', { count: 1 }));
    expect(html).not.toContain(t('driver.roadLoad.takeAll', { count: 3 }));
  });

  it('a full vehicle: says so, nothing to take', () => {
    const html = card(view([bag('A')], { bagPlaces: 15, freeBagPlaces: 0, freeKg: 900 }));
    expect(html).toContain(t('driver.roadLoad.full'));
    expect(html).not.toContain(t('driver.roadLoad.takeAll', { count: 1 }));
  });

  it('off shift: seen, not taken', () => {
    const html = card(view([bag('A')]), false);
    expect(html).toContain(t('driver.roadLoad.onShift'));
    expect(html).not.toContain(t('driver.roadLoad.takeAll', { count: 1 }));
  });

  it('a place not known: no way there rather than a pin in the sea', () => {
    expect(card(view([bag('A', { location: { lat: 0, lng: 0 } })]))).not.toContain('google.com/maps');
  });

  it('no route for this driver’s fleet, or not read yet: no card', () => {
    expect(card({ routes: [] })).toBe('');
    expect(card(null)).toBe('');
  });
});
