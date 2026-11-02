import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { markOffline, resetConnectivity } from '../connectivity';
import { toPlaceWords } from '../placewords';
import { PlaceView, PlaceWords } from './PlaceView';
import { staticTiles } from './StaticMap';

/*
 * A PLACE SHOWN: A SMALL MAP FIRST WHERE THE CONNECTION CAN SPARE IT, ELSE ITS THREE WORDS (the owner, 2026-11-02: "I get
 * the three words for my location but I prefer the map if the connection is good"). What is held to here: the map comes
 * with the words beneath it, smaller, and their say-aloud; the words come with "Show the map" one tap away; no signal
 * means the words alone; and every screen that draws a place's three words goes through this one component.
 */
const HUB = { lat: -1.2864, lng: 36.8172 };
const WORDS = toPlaceWords(HUB);

// A phone that can speak, so the say-aloud is drawn (it is not, where it cannot).
const g = globalThis as unknown as { window?: unknown };
beforeEach(() => {
  g.window = { speechSynthesis: { speaking: false, cancel() {}, speak() {} }, SpeechSynthesisUtterance: function () {} };
});
afterEach(() => {
  delete g.window;
  vi.unstubAllGlobals();
  resetConnectivity();
});

const view = (country?: string, over: { openInMaps?: boolean } = {}) =>
  renderToString(
    <PlaceView
      point={HUB}
      country={country}
      mapLabel="Where this hub is"
      aloud={(words) => t('mdp.home.hubWordsAloud', { words })}
      aloudLabel={t('mdp.home.sayWords')}
      {...over}
    />,
  );

describe('a place shown: the map first, or the words first', () => {
  it('where data is cheap (the Netherlands, nothing measured): a small map, the words beneath it smaller, said aloud, and Open in maps', () => {
    const html = view('NL');
    expect(html).toContain('class="smap"');
    expect(html).toContain('aria-label="Where this hub is"');
    expect(html).toMatch(/src="https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png"/);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    // The words stay, beneath the map and a step smaller — after it in the page, not before.
    expect(html).toContain(`<p class="words words--under">${WORDS}</p>`);
    expect(html.indexOf('class="smap"')).toBeLessThan(html.indexOf(WORDS));
    expect(html).toContain(t('mdp.home.sayWords'));
    // Open in maps SHOWS the place (a search), not the way to it.
    expect(html).toContain(t('common.place.openInMaps'));
    expect(html).toContain('https://www.google.com/maps/search/?api=1&amp;query=');
    expect(html).not.toContain(t('common.place.showMap'));
  });

  it('where data is dear (Kenya, nothing measured): the words first, said aloud, and Show the map — no tiles fetched', () => {
    const html = view('KE');
    expect(html).toContain(`<p class="words">${WORDS}</p>`);
    expect(html).toContain(t('mdp.home.sayWords'));
    expect(html).toContain(t('common.place.showMap'));
    expect(html).not.toContain('smap');
    expect(html).not.toContain('tile.openstreetmap.org');
    expect(html).not.toContain(t('common.place.openInMaps'));
  });

  it('a good connection now brings the map in Kenya too; a phone saving data keeps the words in the Netherlands', () => {
    vi.stubGlobal('navigator', { connection: { effectiveType: '4g', downlink: 10 } });
    expect(view('KE')).toContain('class="smap"');
    vi.stubGlobal('navigator', { connection: { effectiveType: '4g', downlink: 10, saveData: true } });
    const saving = view('NL');
    expect(saving).not.toContain('smap');
    expect(saving).toContain(t('common.place.showMap'));
  });

  it('no signal: the words alone — no map, and no offer of one that cannot load', () => {
    markOffline();
    const html = view('NL');
    expect(html).toContain(`<p class="words">${WORDS}</p>`);
    expect(html).not.toContain('smap');
    expect(html).not.toContain(t('common.place.showMap'));
  });

  it('a screen with its own way there leaves Open in maps out', () => {
    const html = view('NL', { openInMaps: false });
    expect(html).toContain('class="smap"');
    expect(html).not.toContain(t('common.place.openInMaps'));
  });

  it('the words alone, under a map already on screen to set the pin: full size, their note, said aloud', () => {
    const html = renderToString(<PlaceWords point={HUB} note={t('home.join.where.wordsNote')} aloud={(words) => t('home.join.where.wordsAloud', { words })} aloudLabel={t('home.join.where.wordsAloudLabel')} />);
    expect(html).toContain(`<p class="words">${WORDS}</p>`);
    expect(html).toContain(t('home.join.where.wordsNote'));
    expect(html).toContain(t('home.join.where.wordsAloudLabel'));
  });
});

describe('the small map’s tiles', () => {
  it('six tiles, the place in the middle of them, at least 256 pixels clear either side and 128 above and below', () => {
    for (const p of [HUB, { lat: 52.3676, lng: 4.9041 }, { lat: 0.3136, lng: 32.5811 }, { lat: -33.86, lng: 151.21 }]) {
      const s = staticTiles(p);
      expect(s.tiles).toHaveLength(6);
      expect(s.at.x).toBeGreaterThanOrEqual(256);
      expect(768 - s.at.x).toBeGreaterThanOrEqual(256);
      expect(s.at.y).toBeGreaterThanOrEqual(128);
      expect(512 - s.at.y).toBeGreaterThanOrEqual(128);
      // The place's own tile is the middle column, and holds the point.
      const own = s.tiles.find((tile) => tile.left === 256 && tile.top <= s.at.y && s.at.y < tile.top + 256)!;
      const n = 2 ** s.zoom;
      expect(own.x).toBe(Math.floor(((p.lng + 180) / 360) * n));
    }
  });

  it('Nairobi at zoom 15 is OpenStreetMap’s tile 19735 across — the same tile the full map fetches', () => {
    const s = staticTiles(HUB);
    expect(s.tiles.some((tile) => tile.src === `https://tile.openstreetmap.org/15/19735/${tile.y}.png`)).toBe(true);
  });

  it('round the back of the world: a place by the date line takes its neighbour from the other edge', () => {
    const s = staticTiles({ lat: -17.7, lng: 179.99 });
    const n = 2 ** s.zoom;
    expect(s.tiles.map((tile) => tile.x)).toContain(0);
    expect(s.tiles.every((tile) => tile.x >= 0 && tile.x < n)).toBe(true);
  });
});

/*
 * EVERY PLACE'S THREE WORDS GO THROUGH THE RULE. A screen that draws them itself (toPlaceWords on a screen) shows words
 * where the owner asked for a map. They are drawn by PlaceWords alone; a screen that uses PlaceWords without PlaceView
 * must have a map on screen to set the pin with — an editor (PlaceMap with onDrop); every other screen uses PlaceView.
 */
const SRC = 'src';
function sources(dir = ''): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

describe('every place’s three words go through the one rule', () => {
  const files = sources();
  const text = new Map(files.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));

  it('only the shared component turns a place into its words for a screen', () => {
    // The guard read something: the codec is found, and the code in it.
    expect(text.get('shared/placewords.ts')).toContain('export function toPlaceWords');
    const drawing = files.filter((f) => /\btoPlaceWords\b/.test(text.get(f)!));
    expect(drawing.sort()).toEqual(['shared/placewords.ts', 'shared/ui/PlaceView.tsx']);
  });

  it('the screens that only SHOW a place use PlaceView — the Hub’s start screen among them', () => {
    const viewers = files.filter((f) => f.startsWith('apps/') && /<PlaceView\b/.test(text.get(f)!));
    expect(viewers).toEqual(expect.arrayContaining(['apps/mdp/screens/HomeScreen.tsx', 'apps/genesis/screens/TrackScreen.tsx']));
  });

  it('the words alone only under a map on screen to set the pin — the sign-up’s where step among them', () => {
    const alone = files.filter((f) => f.startsWith('apps/') && /<PlaceWords\b/.test(text.get(f)!));
    expect(alone).toEqual(expect.arrayContaining(['apps/home/screens/JoinScreen.tsx', 'apps/agent/screens/HomeScreen.tsx', 'apps/vendor/screens/StoreScreen.tsx']));
    // A PlaceMap whose props, up to where the tag closes, take a dropped pin.
    const setsAPin = (src: string) => [...src.matchAll(/<PlaceMap\b/g)].some((m) => /\bonDrop=/.test(src.slice(m.index, src.indexOf('/>', m.index))));
    expect(setsAPin(text.get('apps/home/screens/JoinScreen.tsx')!)).toBe(true);
    expect(setsAPin('<PlaceMap label="x" pins={[]} />')).toBe(false);
    expect(alone.filter((f) => !setsAPin(text.get(f)!))).toEqual([]);
  });
});
