import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { CarForm, turnOffHere, type CarState } from './CarSettings';
import { carApi, carRowSub, type CarHere } from './carMessages';
import { CAR_UNLINK, PLAY_MARK, androidMajor, carLinkOf, insidePlayApp, openCarLink, openCarUnlink, saysPlayApp, tooOldForCar } from '../playApp';
import { ViaCar } from '../conversation/Conversations';
import { sentFromCar } from '../conversation/logic';

/**
 * MESSAGES IN THE CAR, UNDER THE DRIVER APP'S SETTINGS (the owner, 2026-11-02: "we start with 2"). The row is there only
 * inside the Play app; behind it, ON takes the PIN and opens the Play app's native part with its key by the contract's
 * link; "Waiting for the phone" until the phone answers, then "On for this phone"; OFF takes one tap. And a reply spoken
 * in the car says so in the chat.
 */
const say = t as never;
const state = (here: CarHere | null, over: Partial<CarState> = {}): CarState => ({ inside: true, here, unread: false, set: () => undefined, reread: async () => undefined, ...over });
const api = carApi((async () => ({ data: null, error: null })) as never, () => 'en');
const KEY = `car_${'ab'.repeat(32)}`;

/** A browser's storage, for the length of a test. */
function storage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } } as Storage;
}
const g = globalThis as Record<string, unknown>;
const held: Record<string, unknown> = {};

describe('inside the Play app, and nowhere else', () => {
  beforeEach(() => {
    for (const k of ['location', 'document', 'sessionStorage', 'localStorage']) held[k] = g[k];
    g.sessionStorage = storage();
    g.localStorage = storage();
  });
  afterEach(() => {
    for (const k of Object.keys(held)) g[k] = held[k];
  });

  it('is said by the Play app’s start address, or by its referrer on a first load — and by nothing else', () => {
    expect(saysPlayApp('https://seebuyget.com/driver/?app=android', '')).toBe(true);
    expect(saysPlayApp('https://seebuyget.com/driver/', 'android-app://com.seebuyget.driver/')).toBe(true);
    expect(saysPlayApp('https://seebuyget.com/driver/', 'android-app://com.seebuyget.driver')).toBe(true);
    for (const [href, referrer] of [['https://seebuyget.com/driver/', ''], ['https://seebuyget.com/driver/?app=ios', ''], ['https://seebuyget.com/driver/', 'android-app://com.example.other/'], ['https://seebuyget.com/driver/', 'android-app://com.seebuyget.driver.evil/'], ['https://seebuyget.com/driver/', 'https://seebuyget.com/']]) {
      expect([href, referrer, saysPlayApp(href, referrer)]).toEqual([href, referrer, false]);
    }
  });

  it('once seen, kept for the tab and for the phone: the app’s own reloads carry no marker', () => {
    g.location = { href: 'https://seebuyget.com/driver/' };
    g.document = { referrer: '' };
    expect(insidePlayApp()).toBe(false);
    g.location = { href: 'https://seebuyget.com/driver/?app=android' };
    expect(insidePlayApp()).toBe(true);
    expect((g.sessionStorage as Storage).getItem(PLAY_MARK)).toBe('android');
    expect((g.localStorage as Storage).getItem(PLAY_MARK)).toBe('android');
    g.location = { href: 'https://seebuyget.com/driver/?chat=cv_1' };
    expect(insidePlayApp()).toBe(true);
  });

  it('Android 8 or older is said, not offered: the car part runs on 9 or newer — Chrome’s own platform version wins over a reduced user agent', () => {
    expect(androidMajor('Mozilla/5.0 (Linux; Android 8.1.0; SM-J530F) AppleWebKit/537.36 Chrome/119.0 Mobile Safari/537.36')).toBe(8);
    expect(androidMajor('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', '8.0.0')).toBe(8);
    expect(androidMajor('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', '14.0.0')).toBe(14);
    expect(androidMajor('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBeUndefined();
    expect([7, 8, 9, 14, undefined].map(tooOldForCar)).toEqual([true, true, false, false, false]);
    expect(carRowSub({ inside: true, here: { on: false, which: 0 }, unread: false, tooOld: true }, say)).toBe('Needs Android 9 or newer.');
    // One somehow on already can still be turned off.
    expect(carRowSub({ inside: true, here: { on: true, which: 0, phone: 'on' }, unread: false, tooOld: true }, say)).toBe('On for this phone.');
    expect(carRowSub({ inside: false, here: { on: false, which: 0 }, unread: false, tooOld: true }, say)).toBeNull();
    const html = renderToString(<CarForm api={api} state={state({ on: false, which: 0 }, { tooOld: true, android: 8 })} />);
    expect(html).toContain('Needs Android 9 or newer');
    expect(html).toContain('This phone says it has Android 8');
    expect(html).not.toContain('acct-car-pin');
    expect(html).not.toContain('Turn it on');
  });

  it('the row: none outside the Play app, none where the PIN does not work here; off, waiting for the phone, on', () => {
    expect(carRowSub({ inside: false, here: { on: true, which: 0, phone: 'on' }, unread: false }, say)).toBeNull();
    expect(carRowSub({ inside: true, here: { on: false, which: -1 }, unread: false }, say)).toBeNull();
    expect(carRowSub({ inside: true, here: null, unread: false }, say)).toBeNull();
    expect(carRowSub({ inside: true, here: { on: false, which: 0 }, unread: false }, say)).toBe('Off. Turn it on to hear your messages in the car.');
    expect(carRowSub({ inside: true, here: { on: true, which: 0, phone: 'waiting' }, unread: false }, say)).toBe('Waiting for the phone.');
    expect(carRowSub({ inside: true, here: { on: true, which: 0, phone: 'on' }, unread: false }, say)).toBe('On for this phone.');
  });
});

describe('the link that hands the Play app its key — the contract with the Android project', () => {
  it('an intent only com.seebuyget.driver answers — never a plain sbgdriver:// link, which any app could claim', () => {
    expect(carLinkOf(KEY)).toBe(`intent://car-link?key=${KEY}#Intent;scheme=sbgdriver;package=com.seebuyget.driver;end`);
    const opened: string[] = [];
    openCarLink(KEY, (url) => opened.push(url));
    openCarUnlink((url) => opened.push(url));
    expect(opened).toEqual([carLinkOf(KEY), 'intent://car-unlink#Intent;scheme=sbgdriver;package=com.seebuyget.driver;end']);
    expect(CAR_UNLINK).toBe(opened[1]);
    for (const url of opened) expect(url).toMatch(/^intent:\/\/[^#]+#Intent;scheme=sbgdriver;package=com\.seebuyget\.driver;end$/);
  });

  it('turned off: the server deletes the key first, then the phone is told to forget it — and not when the server refused', async () => {
    const opened: string[] = [];
    const held = (globalThis as { location?: unknown }).location;
    (globalThis as { location?: unknown }).location = { href: 'https://seebuyget.com/driver/', assign: (url: string) => opened.push(url) };
    try {
      const calls: string[] = [];
      const off = (ok: boolean) => carApi((async (path: string) => {
        calls.push(path);
        return ok ? { data: { on: false, which: 0 }, error: null } : { data: null, error: { code: 'INTERNAL', message: 'no' } };
      }) as never);
      // The form's own turn-off, as its button calls it, without a page to draw on.
      await turnOffHere(off(false));
      expect(opened).toEqual([]);
      await turnOffHere(off(true));
      expect(calls).toEqual(['/v1/sbg/account/car/off', '/v1/sbg/account/car/off']);
      expect(opened).toEqual([CAR_UNLINK]);
    } finally {
      (globalThis as { location?: unknown }).location = held;
    }
  });

  it('sends the app’s language with every read and turn-on, and the PIN only to turn it on', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const spy = carApi((async (path: string, body: Record<string, unknown>) => {
      calls.push([path, body]);
      return { data: null, error: null };
    }) as never, () => 'sw');
    await spy.read();
    await spy.turnOn('48261');
    await spy.turnOff();
    expect(calls.map(([p, b]) => [p, b.lang, b.pin])).toEqual([
      ['/v1/sbg/account/car', 'sw', undefined],
      ['/v1/sbg/account/car/on', 'sw', '48261'],
      ['/v1/sbg/account/car/off', undefined, undefined],
    ]);
  });
});

describe('behind the row', () => {
  it('off: what it does, what passes through Google, and the PIN before anything is made', () => {
    const html = renderToString(<CarForm api={api} state={state({ on: false, which: 0 })} />);
    expect(html).toContain('the car reads aloud the messages from the people in your chats');
    expect(html).toContain('never the words');
    expect(html).toContain('acct-car-pin');
    expect(html).toContain('Your PIN, to turn it on');
    expect(html).toContain('Turn it on');
    expect(html).not.toContain('Turn it off');
  });

  it('waiting for the phone: says so, with the link that opens the phone’s part again, and the way off', () => {
    const html = renderToString(<CarForm api={api} state={state({ on: true, which: 0, phone: 'waiting' })} initialKey={KEY} />);
    expect(html).toContain('Waiting for the phone');
    expect(html).toContain(`href="intent://car-link?key=${KEY}#Intent;scheme=sbgdriver;package=com.seebuyget.driver;end"`);
    // Never a plain link another app could answer.
    expect(html).not.toContain('sbgdriver://');
    expect(html).toContain('Open it on this phone');
    expect(html).toContain('Turn it off');
    expect(html).not.toContain('acct-car-pin');
  });

  it('…and with no key in hand (the page was opened again), no link: turn it off and on again', () => {
    const html = renderToString(<CarForm api={api} state={state({ on: true, which: 0, phone: 'waiting' })} />);
    expect(html).toContain('turn it off and on again');
    expect(html).not.toContain('car-link');
  });

  it('on for this phone: says so, says what goes through Google, offers the way off — and never the key', () => {
    const html = renderToString(<CarForm api={api} state={state({ on: true, which: 0, phone: 'on' })} initialKey={KEY} />);
    expect(html).toContain('On for this phone');
    expect(html).toContain('Sent from the car');
    expect(html).toContain('Turn it off');
    expect(html).not.toContain(KEY);
  });
});

describe('in the chat', () => {
  it('a reply spoken in the car says “Sent from the car”, to both sides; any other message says nothing of the kind', () => {
    expect(sentFromCar({ via: 'car' })).toBe(true);
    expect(sentFromCar({})).toBe(false);
    expect(renderToString(<ViaCar m={{ via: 'car' }} />)).toBe(' · Sent from the car');
    expect(renderToString(<ViaCar m={{}} />)).toBe('');
  });
});
