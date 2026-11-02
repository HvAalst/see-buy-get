import { afterEach, describe, expect, it } from 'vitest';
import { intentOf, onLaunch, resetLaunchForTests, withoutIntent } from './launch';

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
