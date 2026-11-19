import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import type { PlaceMapProps } from './PlaceMap';

/*
 * 2026-11-19 — A MAP A PIN IS PUT ON OPENS WHERE THE PHONE IS (the owner, in the Business app's "Save a new place": "the map
 * opens nairobi, but I am in the Netherlands. It could open somewhat around my current location or else it can ask me to turn
 * it on"). What is held to here: such a map asks the phone once as it opens, when nothing is on it yet; it looks where the
 * phone is, else where its screen said, else the whole world — never one country's city; refused, it says how to turn
 * location on, with a button to ask again; and the screens that find the phone themselves do not ask twice.
 */

// The simple view stands in for the map: what it is handed is what the map is handed.
const handed: PlaceMapProps[] = [];
vi.mock('./PlaceMapPlot', () => ({
  PlaceMapPlot: (p: PlaceMapProps) => {
    handed.push(p);
    return null;
  },
}));

const { asksWhereYouAre, hereNote, viewWithNothingToFrame, whereYouAre, PlaceMap, WORLD_VIEW, HERE_ZOOM } = await import('./PlaceMap');
const { t } = await import('../i18n');

const AMSTERDAM = { lat: 52.3728, lng: 4.8936 };
const drop = () => undefined;
const pin = { id: 'a', label: 'A shop', point: { lat: 52.09, lng: 5.12 } };

beforeEach(() => {
  handed.length = 0;
});

describe('which map asks where the phone is', () => {
  it('a map a pin is put on, with nothing on it yet', () => {
    expect(asksWhereYouAre({ onDrop: drop })).toBe(true);
    expect(asksWhereYouAre({ onDrop: drop, pins: [] })).toBe(true);
  });

  it('not a map with something on it to look at: it frames that', () => {
    expect(asksWhereYouAre({ onDrop: drop, pins: [pin] })).toBe(false);
    expect(asksWhereYouAre({ onDrop: drop, reference: AMSTERDAM })).toBe(false);
    expect(asksWhereYouAre({ onDrop: drop, dropped: AMSTERDAM })).toBe(false);
    expect(asksWhereYouAre({ onDrop: drop, lines: [{ id: 'l', label: 'l', from: AMSTERDAM, to: pin.point }] })).toBe(false);
  });

  it('not a map only to look at, nor one whose screen finds the phone itself', () => {
    expect(asksWhereYouAre({})).toBe(false);
    expect(asksWhereYouAre({ onDrop: drop, findHere: false })).toBe(false);
    // A map only to look at may still be told to ask.
    expect(asksWhereYouAre({ findHere: true })).toBe(true);
  });
});

describe('where a map with nothing on it looks', () => {
  it('where the phone is, close enough to see the streets', () => {
    expect(viewWithNothingToFrame(AMSTERDAM, undefined)).toEqual({ point: AMSTERDAM, zoom: HERE_ZOOM });
    expect(HERE_ZOOM).toBeGreaterThanOrEqual(12);
    // The phone wins over what the screen said: it is where the person is.
    expect(viewWithNothingToFrame(AMSTERDAM, { point: pin.point, zoom: 6 })).toEqual({ point: AMSTERDAM, zoom: HERE_ZOOM });
  });

  it('else where its screen said, else the whole world — never Nairobi for everybody', () => {
    expect(viewWithNothingToFrame(null, { point: pin.point, zoom: 6 })).toEqual({ point: pin.point, zoom: 6 });
    expect(viewWithNothingToFrame(null, undefined)).toEqual(WORLD_VIEW);
    expect(WORLD_VIEW.zoom).toBeLessThanOrEqual(3);
  });
});

describe('asking the phone', () => {
  it('a point when it answers', async () => {
    const ask = vi.fn(async () => AMSTERDAM);
    expect(await whereYouAre(() => true, ask)).toEqual({ state: 'idle', point: AMSTERDAM });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('off when it is refused or cannot say, and not asked at all where there is no way to', async () => {
    expect(await whereYouAre(() => true, async () => null)).toEqual({ state: 'off' });
    const ask = vi.fn(async () => AMSTERDAM);
    expect(await whereYouAre(() => false, ask)).toEqual({ state: 'off' });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('the line under the map', () => {
  it('finding, or how to turn location on, while no pin is down', () => {
    expect(hereNote('asking', null)).toBe('locating');
    expect(hereNote('off', undefined)).toBe('off');
    expect(hereNote('idle', null)).toBeNull();
  });

  it('nothing once a pin is down — also one tapped before the phone answered', () => {
    expect(hereNote('asking', AMSTERDAM)).toBeNull();
    expect(hereNote('off', AMSTERDAM)).toBeNull();
  });
});

describe('the map as it opens', () => {
  it('a map a pin is put on says it is finding where you are, and looks at the world meanwhile', () => {
    const html = renderToString(<PlaceMap label="Where" onDrop={drop} dropped={null} />);
    expect(html).toContain(t('place.sheet.locating'));
    expect(handed[0].start).toEqual(WORLD_VIEW);
  });

  it('with a pin down, or its screen finding the phone itself, says nothing of it', () => {
    expect(renderToString(<PlaceMap label="Where" onDrop={drop} dropped={AMSTERDAM} />)).not.toContain(t('place.sheet.locating'));
    expect(renderToString(<PlaceMap label="Where" onDrop={drop} findHere={false} />)).not.toContain(t('place.sheet.locating'));
    expect(renderToString(<PlaceMap label="Where" pins={[pin]} onDrop={drop} />)).not.toContain(t('place.sheet.locating'));
  });

  it('keeps the start its screen gave until the phone answers', () => {
    renderToString(<PlaceMap label="Where" onDrop={drop} start={{ point: pin.point, zoom: 6 }} />);
    expect(handed[0].start).toEqual({ point: pin.point, zoom: 6 });
  });
});

describe('wired', () => {
  const ui = join('src', 'shared', 'ui');
  const read = (...p: string[]) => readFileSync(join(...p), 'utf8');

  it('refused, the map says how to turn location on, with a button that asks again', () => {
    const src = read(ui, 'PlaceMap.tsx');
    expect(src).toMatch(/note === 'off'[\s\S]{0,200}place\.sheet\.locOff[\s\S]{0,200}onClick=\{findHere\}[\s\S]{0,80}place\.map\.locShow/);
    expect(src).toMatch(/const note = hereNote\(here\.state, props\.dropped\);/);
    expect(src).toMatch(/if \(here\.state === 'asking'\) findHere\(\)/);
  });

  it('the map draws the view it was handed, and never falls back on one country’s city', () => {
    const src = read(ui, 'PlaceMapLeaflet.tsx');
    expect(src).not.toMatch(/-1\.2864|36\.8172|NAIROBI/);
    expect(src).toMatch(/const first = start \?\? WORLD_VIEW;/);
    expect(read(ui, 'PlaceMap.tsx')).toMatch(/<MapComp \{\.\.\.shown\} \/> : <PlaceMapPlot \{\.\.\.shown\} \/>/);
  });

  it('"Save a new place" asks; the screens that find the phone themselves do not ask twice', () => {
    expect(read('src', 'apps', 'tower', 'screens', 'SitePicker.tsx')).toMatch(/<PlaceMap onDrop=\{setPin\} dropped=\{pin\} label=/);
    expect(read(ui, 'PlacePicker.tsx')).toMatch(/findHere=\{false\}/);
    expect(read('src', 'apps', 'home', 'screens', 'JoinScreen.tsx')).toMatch(/start=\{start\}\s+findHere=\{false\}/);
  });
});
