import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enHome } from '../../shared/i18n/catalogs/en.home';

/*
 * A LINK TO SEEBUYGET SHARED IN A CHAT OPENS AS A CARD WITH A BIG PICTURE (the owner, 2026-11-01: WhatsApp, Telegram,
 * WeChat, VK, Viber). What is held to here, on the head the build really writes for the front page: the picture is the
 * share card at its full address, with its size, type and words said beside it, and the card asked for is the large one;
 * the picture that ships is the size the head says and under WhatsApp's 300 KB; and a build that does not know the
 * site's address writes no address at all — no picture, no canonical — and asks for no large card it has no picture for.
 */
type Head = { type: string; props: Record<string, string> };

// The service worker's hook is written by the build's PWA plugin, which the tests do not run; the page never asks it
// for anything while it is being built.
vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

const SITE = 'https://seebuyget.example';

/** The front page's head as the build writes it, for a build told `site` as its address. No server: every fetch fails. */
async function frontHead(site: string): Promise<{ head: Head[]; SHARE_IMAGE: { path: string; width: number; height: number } }> {
  vi.resetModules();
  vi.stubEnv('SBG_PUBLIC_URL', site);
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { prerender, SHARE_IMAGE } = await import('./prerender');
  const built = await prerender({ url: '/' });
  return { head: [...built.head.elements], SHARE_IMAGE };
}
const metaOf = (head: Head[], key: string) =>
  head.filter((e) => e.type === 'meta' && (e.props.property === key || e.props.name === key)).map((e) => e.props.content);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__;
});

describe('a shared link', () => {
  it('shows the share card, large, with its size, type and words — at the full address', async () => {
    const { head, SHARE_IMAGE } = await frontHead(SITE);
    expect(metaOf(head, 'og:image')).toEqual([`${SITE}${SHARE_IMAGE.path}`]);
    expect(metaOf(head, 'og:image:type')).toEqual(['image/png']);
    expect(metaOf(head, 'og:image:width')).toEqual(['1200']);
    expect(metaOf(head, 'og:image:height')).toEqual(['630']);
    expect(metaOf(head, 'og:image:alt')).toEqual([enHome['home.landing.shareImageAlt']]);
    expect(metaOf(head, 'twitter:card')).toEqual(['summary_large_image']);
    expect(metaOf(head, 'og:locale')).toEqual(['en_GB']);
    // The card's title and line are the front page's own.
    expect(metaOf(head, 'og:title')).toEqual([enHome['home.landing.metaTitle']]);
    expect(metaOf(head, 'og:description')).toEqual([enHome['home.landing.metaDescription']]);
    expect(metaOf(head, 'og:url')).toEqual([`${SITE}/`]);
  });

  it('ships the picture the head describes: a PNG of that size, under 300 KB', async () => {
    const { SHARE_IMAGE } = await import('./prerender');
    // public/ is served from the site's root (vite.config.ts publicDir), so /img/x.png is public/img/x.png.
    const png = readFileSync(join('src', 'apps', 'home', 'public', ...SHARE_IMAGE.path.split('/').filter(Boolean)));
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect({ width: header.getUint32(16), height: header.getUint32(20) }).toEqual({ width: SHARE_IMAGE.width, height: SHARE_IMAGE.height });
    expect(png.byteLength).toBeGreaterThan(10 * 1024);
    expect(png.byteLength).toBeLessThan(300 * 1024);
  });

  it('without the site’s address writes no address, no picture, and asks for no large card', async () => {
    const { head } = await frontHead('');
    // It did read a head: the page still names itself.
    expect(metaOf(head, 'og:title')).toEqual([enHome['home.landing.metaTitle']]);
    expect(head.filter((e) => e.props.property?.startsWith('og:image'))).toEqual([]);
    expect(head.filter((e) => e.type === 'link' && e.props.rel === 'canonical')).toEqual([]);
    expect(metaOf(head, 'og:url')).toEqual([]);
    expect(metaOf(head, 'twitter:card')).toEqual(['summary']);
  });
});
