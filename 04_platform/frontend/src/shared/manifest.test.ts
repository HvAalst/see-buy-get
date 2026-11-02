import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { intentOf } from './launch';
import { readDeepLink } from '../apps/home/logic';

/*
 * 2026-11-02 — WHAT THE PHONE KNOWS ABOUT EACH APP (the owner: "make it as native as today can be"), held to what each
 * app's web manifest promises — the manifest the build really writes, from vite.config.ts's manifestFor:
 *
 * - SHORTCUTS, from holding the icon: each opens `?go=<key>`, and the key is a screen of THAT app (its Screen type, read
 *   from its source here; the front page's, the deep links it already follows). Each has its picture, at the size it says.
 * - THE INSTALL WINDOW's pictures of the real app: there, at the size the manifest says, a phone's shape, small enough.
 * - ONE WINDOW: every app brings the open one forward rather than opening a second copy.
 * - THE SHARE LIST: the apps with conversations take a text or a link, at the address shared/launch.ts reads.
 */

type Icon = { src: string; sizes: string; type?: string };
type Manifest = {
  description?: string;
  shortcuts?: Array<{ name: string; short_name?: string; description?: string; url: string; icons?: Icon[] }>;
  screenshots?: Array<Icon & { form_factor?: string; label?: string }>;
  launch_handler?: { client_mode: string | string[] };
  share_target?: { action: string; method?: string; enctype?: string; params: Record<string, string> };
};

/** The apps that install: every app's folder but the two that do not (vite.config.ts: installable false). */
const INSTALLABLE = ['agent', 'driver', 'fleet', 'genesis', 'home', 'mdp', 'vendor'];
/** The apps with conversations, which the phone's share list offers. */
const CHATS = ['agent', 'driver', 'fleet', 'genesis', 'vendor'];
/** Where each app's Screen type is written. */
const SCREENS: Record<string, string> = {
  agent: 'agent/useAgentApp.ts',
  driver: 'driver/useDriverApp.ts',
  fleet: 'fleet/useFleetApp.ts',
  genesis: 'genesis/useSendApp.ts',
  home: 'home/useHomeApp.ts',
  mdp: 'mdp/useMdpApp.ts',
  vendor: 'vendor/useVendorApp.ts',
};

/** The keys of an app's `export type Screen = 'a' | 'b' …;`, read from its source. */
function screensOf(app: string): string[] {
  const src = readFileSync(join('src', 'apps', ...SCREENS[app].split('/')), 'utf8');
  const decl = /export type Screen\s*=([^;]+);/.exec(src);
  return decl ? [...decl[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]) : [];
}

/** A PNG's width and height from its header, or null when the file is missing or is not a PNG. */
function pngSize(app: string, src: string): { width: number; height: number; bytes: number } | null {
  let png: Uint8Array;
  try {
    png = readFileSync(join('src', 'apps', app, 'public', ...src.split('/')));
  } catch {
    return null;
  }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.byteLength < 24 || sig.some((b, i) => png[i] !== b) || String.fromCharCode(...png.subarray(12, 16)) !== 'IHDR') return null;
  const head = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: head.getUint32(16), height: head.getUint32(20), bytes: png.byteLength };
}

const sizeOf = (sizes: string) => {
  const [width, height] = sizes.split('x').map(Number);
  return { width, height };
};

let manifests: Record<string, Manifest> = {};

beforeAll(async () => {
  // Through a variable on purpose: the config is Node code outside the type-checked tree, and a literal import would pull
  // it (and the Node types it needs) into the browser code's compile.
  const CONFIG = '../../vite.config.ts';
  const config = (await import(/* @vite-ignore */ CONFIG)) as { manifestFor(id: string): Manifest };
  manifests = Object.fromEntries(INSTALLABLE.map((id) => [id, config.manifestFor(id)]));
}, 60_000);

describe('the apps that install', () => {
  it('are every app but the console and the business app', () => {
    const apps = readdirSync(join('src', 'apps'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !['tower', 'business'].includes(e.name))
      .map((e) => e.name)
      .sort();
    expect(apps).toEqual(INSTALLABLE);
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/business: \{[\s\S]*?installable: false/);
  });
});

describe.each(INSTALLABLE)('the %s app', (app) => {
  it('offers its most common jobs from its icon, each a screen of its own', () => {
    const screens = screensOf(app);
    // Proof the Screen type was read: a screen every reader of the app knows is among them.
    const known: Record<string, string> = { agent: 'accept', driver: 'board', fleet: 'runs', genesis: 'track', home: 'market', mdp: 'sort', vendor: 'mint' };
    expect(screens).toContain(known[app]);

    const shortcuts = manifests[app].shortcuts ?? [];
    expect(shortcuts.length).toBeGreaterThanOrEqual(2);
    expect(shortcuts.length).toBeLessThanOrEqual(4);
    const keys = shortcuts.map((s) => {
      const go = intentOf(s.url)?.go;
      expect(s.url).toBe(`./?go=${go}`);
      expect(screens).toContain(go);
      // The front page follows its own deep links (logic.ts), and only those.
      if (app === 'home') expect(readDeepLink(`?go=${go}`)).toEqual({ go });
      expect(s.name.trim()).not.toBe('');
      expect(s.description?.trim()).toBeTruthy();
      // The label under a shortcut is cut at about twelve characters, as an app's own is.
      expect(s.short_name?.length ?? 99).toBeLessThanOrEqual(12);
      return go;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a picture for every shortcut, at the size it says', () => {
    for (const s of manifests[app].shortcuts ?? []) {
      const icons = s.icons ?? [];
      expect(icons.map((i) => i.sizes).sort()).toEqual(['192x192', '96x96']);
      for (const icon of icons) {
        expect(icon.type).toBe('image/png');
        expect({ src: icon.src, ...pngSize(app, icon.src) }).toMatchObject({ src: icon.src, ...sizeOf(icon.sizes) });
      }
    }
  });

  it('shows the install window pictures of the real app, a phone’s shape and small enough to fetch', () => {
    const m = manifests[app];
    expect(m.description?.length ?? 0).toBeGreaterThan(40);
    const shots = m.screenshots ?? [];
    expect(shots.length).toBeGreaterThanOrEqual(2);
    expect(shots.length).toBeLessThanOrEqual(3);
    for (const shot of shots) {
      expect(shot.form_factor).toBe('narrow');
      expect(shot.label?.trim()).toBeTruthy();
      expect(shot.type).toBe('image/png');
      const want = sizeOf(shot.sizes);
      const got = pngSize(app, shot.src);
      expect({ src: shot.src, ...got }).toMatchObject({ src: shot.src, ...want });
      // Chrome's rules for the richer install window: each side 320–3840 px, the long side at most 2.3 times the short.
      expect(Math.min(want.width, want.height)).toBeGreaterThanOrEqual(320);
      expect(Math.max(want.width, want.height)).toBeLessThanOrEqual(3840);
      expect(Math.max(want.width, want.height) / Math.min(want.width, want.height)).toBeLessThanOrEqual(2.3);
      expect(got!.bytes).toBeLessThan(300 * 1024);
    }
  });

  it('brings the window already open forward instead of opening a second one', () => {
    const mode = manifests[app].launch_handler?.client_mode;
    expect(Array.isArray(mode) ? mode[0] : mode).toBe('focus-existing');
  });

  it(CHATS.includes(app) ? 'is in the phone’s share list, for a text or a link' : 'is not in the share list: it has no conversations', () => {
    const target = manifests[app].share_target;
    if (!CHATS.includes(app)) {
      expect(target).toBeUndefined();
      return;
    }
    expect(target).toEqual({ action: './', method: 'GET', enctype: 'application/x-www-form-urlencoded', params: { title: 'share_title', text: 'share_text', url: 'share_url' } });
    // What the phone opens — a GET share REPLACES the action's query with the fields — read the way the app reads it.
    const q = Object.entries(target!.params).map(([k, name]) => `${name}=${encodeURIComponent(`a ${k}`)}`).join('&');
    expect(intentOf(`${target!.action.split('?')[0]}?${q}`)?.share).toEqual({ title: 'a title', text: 'a text', url: 'a url' });
  });
});

describe('what a first visit downloads', () => {
  it('leaves out the install pictures and the shortcuts’ icons: only the phone fetches them, at install', () => {
    const config = readFileSync('vite.config.ts', 'utf8');
    const ignores = /globIgnores:\s*\[([\s\S]*?)\],\s*\n/.exec(config)?.[1] ?? '';
    expect(ignores).toContain("'**/PlaceMapLeaflet-*.js'");
    expect(ignores).toContain("'screenshots/**'");
    expect(ignores).toContain("'icons/shortcuts/**'");
  });
});
