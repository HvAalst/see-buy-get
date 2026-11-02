import { afterEach, describe, expect, it } from 'vitest';
import { followLink, intentOf, linkLeadsTo, onLaunch, resetLaunchForTests, withoutIntent } from './launch';

/*
 * HOW THE APP WAS OPENED (2026-11-02): a shortcut from holding the icon, or something shared to it from another app.
 */
const page = (href: string) => {
  const replaced: string[] = [];
  (globalThis as { window?: unknown }).window = {
    location: { href },
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
  };
  return replaced;
};

describe('how the app was opened', () => {
  const was = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    resetLaunchForTests();
    (globalThis as { window?: unknown }).window = was;
  });

  it('reads a shortcut’s screen and what was shared, and nothing from an ordinary address', () => {
    expect(intentOf('https://x.test/agent/?go=takeIn')).toEqual({ go: 'takeIn' });
    expect(intentOf('https://x.test/driver/?share=1&text=Gate%203&url=https%3A%2F%2Fmaps.app.goo.gl%2Fabc')).toEqual({ share: { text: 'Gate 3', url: 'https://maps.app.goo.gl/abc' } });
    expect(intentOf('https://x.test/driver/?share=1')).toBeNull();
    // What a phone's share list opens: the fields alone, under their own names (a GET share replaces the query).
    expect(intentOf('https://x.test/driver/?share_title=Pickup&share_text=Gate%203%20https%3A%2F%2Fmaps.app.goo.gl%2Fabc')).toEqual({ share: { title: 'Pickup', text: 'Gate 3 https://maps.app.goo.gl/abc' } });
    // A plain title or text in an ordinary address is not a share.
    expect(intentOf('https://x.test/driver/?text=hello')).toBeNull();
    expect(intentOf('https://x.test/driver/')).toBeNull();
    expect(withoutIntent('https://x.test/send/?go=parcels&invite=abc#top')).toBe('/send/?invite=abc#top');
  });

  it('hands each kind to its own listener, whichever subscribes first — a share is not swallowed by the navigation', () => {
    const replaced = page('https://x.test/agent/?go=takeIn&share=1&text=Pick%20up%20at%20gate%203');
    const went: string[] = [];
    const shared: string[] = [];
    onLaunch('go', (key) => went.push(key));
    // The share sheet mounts later (after sign-in): what was shared waited for it.
    onLaunch('share', (s) => shared.push(s.text ?? ''));
    expect(went).toEqual(['takeIn']);
    expect(shared).toEqual(['Pick up at gate 3']);
    // The address is put back clean, so a reload does not repeat it.
    expect(replaced).toEqual(['/agent/']);
  });

  it('keeps a share that arrives while only the navigation listens — an app already open, brought forward by a share', () => {
    page('https://x.test/driver/');
    let consumer: ((p: { targetURL?: string }) => void) | null = null;
    (globalThis as { window: { launchQueue?: unknown } }).window.launchQueue = { setConsumer: (cb: (p: { targetURL?: string }) => void) => (consumer = cb) };
    const went: string[] = [];
    onLaunch('go', (key) => went.push(key));
    // The phone hands the open app what was shared; the share sheet has not mounted yet (still signing in).
    consumer!({ targetURL: 'https://x.test/driver/?share_text=Gate%203' });
    const shared: string[] = [];
    onLaunch('share', (s) => shared.push(s.text ?? ''));
    expect(went).toEqual([]);
    expect(shared).toEqual(['Gate 3']);
  });

  it('reads photos shared from the gallery as their own kind, waiting for their own listener (2026-11-02)', () => {
    // What the app's worker opens after it kept the photos: their name, and nothing a hand-made address could slip in.
    expect(intentOf('https://x.test/driver/?share_files=k3x9a1')).toEqual({ files: 'k3x9a1' });
    expect(intentOf('https://x.test/driver/?share_files=lost')).toEqual({ files: 'lost' });
    expect(intentOf('https://x.test/driver/?share_files=..%2F..%2Fetc')).toBeNull();
    // The share target's own address with nothing after it: a share that arrived without its photos, said as lost.
    expect(intentOf('https://x.test/driver/share-target')).toEqual({ files: 'lost' });
    expect(withoutIntent('https://x.test/send/?share_files=k3x9a1&invite=abc')).toBe('/send/?invite=abc');

    const replaced = page('https://x.test/agent/?share_files=k3x9a1');
    const shared: string[] = [];
    const files: string[] = [];
    onLaunch('share', (s) => shared.push(s.text ?? ''));
    expect(files).toEqual([]);
    // The photo sheet mounts after the sign-in: the photos waited for it, and the text sheet was handed nothing.
    onLaunch('files', (id) => files.push(id));
    expect(files).toEqual(['k3x9a1']);
    expect(shared).toEqual([]);
    expect(replaced).toEqual(['/agent/']);
  });

  it('gives what waited to the first listener of its kind only, once', () => {
    page('https://x.test/driver/?share=1&text=hello');
    const first: string[] = [];
    const second: string[] = [];
    onLaunch('share', (s) => first.push(s.text ?? ''));
    onLaunch('share', (s) => second.push(s.text ?? ''));
    expect(first).toEqual(['hello']);
    expect(second).toEqual([]);
  });
});

/*
 * 2026-11-02 — WHAT A NOTICE POINTS AT (the owner: "I need a 'mark as read' or 'respond' button"): a chat, a parcel, an
 * offer, a screen. A tapped notification opens the app at the link; Reply or Open in the bell follows the same link inside
 * the page — one way in, so both land in the same place.
 */
describe('where a notice points', () => {
  const was = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    resetLaunchForTests();
    (globalThis as { window?: unknown }).window = was;
  });

  it('reads a chat, a parcel and an offer by their own ids — and nothing a hand-made address could slip past them', () => {
    expect(intentOf('/?chat=cv_1a2b3c')).toEqual({ chat: 'cv_1a2b3c' });
    expect(intentOf('https://x.test/send/?parcel=PUD-1')).toEqual({ parcel: 'PUD-1' });
    expect(intentOf('/?offer=ofr_1')).toEqual({ offer: 'ofr_1' });
    expect(intentOf('/?chat=..%2F..%2Fetc')).toBeNull();
    expect(intentOf('/?chat=%3Cscript%3E')).toBeNull();
    expect(intentOf('/')).toBeNull();
    expect(withoutIntent('https://x.test/send/?parcel=PUD-1&invite=abc')).toBe('/send/?invite=abc');
    expect(withoutIntent('https://x.test/driver/?offer=ofr_1&chat=cv_1')).toBe('/driver/');
  });

  it('a link that came before the app could open it waits for it: a tapped message, then the sign-in', () => {
    const replaced = page('https://x.test/agent/?chat=cv_9');
    onLaunch('go', () => undefined);
    expect(replaced).toEqual(['/agent/']);
    const opened: string[] = [];
    onLaunch('chat', (id) => opened.push(id));
    expect(opened).toEqual(['cv_9']);
  });

  it('leads only where this app opens that kind of place — home, a page outside it, or a parcel in the Shop app lead nowhere', () => {
    onLaunch('go', () => undefined);
    onLaunch('chat', () => undefined);
    expect(linkLeadsTo('/?chat=cv_1')).toBe('chat');
    expect(linkLeadsTo('/?go=runs')).toBe('go');
    expect(linkLeadsTo('/?parcel=PUD-1')).toBeNull();
    expect(linkLeadsTo('/')).toBeNull();
    expect(linkLeadsTo('/terms/ke')).toBeNull();
    expect(linkLeadsTo(undefined)).toBeNull();
    // A notice never hands anything over as a share would: only another app shares.
    expect(linkLeadsTo('/?share=1&text=hi')).toBeNull();
  });

  it('follows a link inside the page, to whoever opens that kind of place, with no page loaded again', () => {
    const went: string[] = [];
    const parcels: string[] = [];
    onLaunch('go', (k) => went.push(k));
    onLaunch('parcel', (id) => parcels.push(id));
    expect(followLink('/?parcel=PUD-1')).toBe(true);
    expect(followLink('/?go=parcels')).toBe(true);
    expect(followLink('/')).toBe(false);
    expect(followLink('/?chat=cv_1')).toBe(false);
    expect(parcels).toEqual(['PUD-1']);
    expect(went).toEqual(['parcels']);
  });
});
