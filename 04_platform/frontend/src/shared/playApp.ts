/**
 * 2026-11-02 — OPENED INSIDE THE PLAY APP (05_engineering/android-auto-messages.md; the owner: "we start with 2" — the
 * driver's messages read aloud in the car and answered by voice).
 *
 * The Play app "SeeBuyGet Driver" is this Driver web app, opened full screen by Chrome (a Trusted Web Activity), plus a
 * small native part that does the car's work. Only there can "Messages in the car" do anything, so Settings offers it
 * only there. The Play app says so in two ways: it opens the app at `/driver/?app=android`, and on a first load Chrome
 * names it as the page's referrer (`android-app://com.seebuyget.driver/`). Once seen, it is kept for the tab
 * (sessionStorage) and for the phone (localStorage): the app's own links and reloads carry neither.
 *
 * And the one way the page hands the native part its car key: the app's own link, which only that package answers.
 * THE CONTRACT with the Android project (section 3 of the plan): `intent://car-link?key=<key>#Intent;scheme=sbgdriver;
 * package=com.seebuyget.driver;end` — and NOTHING ELSE. The integrator, 2026-11-02: a plain `sbgdriver://` link can be
 * answered by any app that claims the scheme, which would hand it the key; an intent naming the package is launched by
 * Chrome into our app alone. Turning it off opens `intent://car-unlink#Intent;…` the same way, so the phone forgets at once.
 *
 * The car part works on Android 9 or newer only (the integrator): an older phone is told so instead of offered it.
 */
export const PLAY_PACKAGE = 'com.seebuyget.driver';
export const CAR_LINK_SCHEME = 'sbgdriver';
/** What the browser keeps: a note that the app was opened inside the Play app. Nothing else. */
export const PLAY_MARK = 'sbg-play-app';
const REFERRER = `android-app://${PLAY_PACKAGE}`;

/** Does this address, or this referrer, say the page was opened by the Play app? */
export function saysPlayApp(href: string | undefined, referrer: string | undefined): boolean {
  if (referrer && (referrer === REFERRER || referrer.startsWith(`${REFERRER}/`))) return true;
  if (!href) return false;
  try {
    return new URL(href, 'https://app.invalid/').searchParams.get('app') === 'android';
  } catch {
    return false;
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem'> | undefined;
const storeOf = (name: 'sessionStorage' | 'localStorage'): Store => {
  try {
    return (globalThis as Record<string, unknown>)[name] as Store;
  } catch {
    return undefined;
  }
};
const read = (s: Store) => {
  try {
    return s?.getItem(PLAY_MARK) === 'android';
  } catch {
    return false;
  }
};
const keep = (s: Store) => {
  try {
    s?.setItem(PLAY_MARK, 'android');
  } catch {
    /* a locked-down WebView: the note is not kept, and the next load reads the address again */
  }
};

/**
 * IS THIS PAGE INSIDE THE PLAY APP? The address or the referrer says so now — and the note is kept — or a note from
 * before does. A browser that is not the Play app's, on a phone without it, never has either.
 */
export function insidePlayApp(): boolean {
  const w = globalThis as { location?: { href?: string }; document?: { referrer?: string } };
  const session = storeOf('sessionStorage');
  const local = storeOf('localStorage');
  if (saysPlayApp(w.location?.href, w.document?.referrer)) {
    keep(session);
    keep(local);
    return true;
  }
  return read(session) || read(local);
}

/** An intent for our package and no other: Chrome starts com.seebuyget.driver with it, or nothing at all. */
const intentFor = (path: string) => `intent://${path}#Intent;scheme=${CAR_LINK_SCHEME};package=${PLAY_PACKAGE};end`;

/** The link that hands the native part its car key. Only ever this one: never a plain `sbgdriver://` link another app could answer. */
export function carLinkOf(key: string): string {
  return intentFor(`car-link?key=${encodeURIComponent(key)}`);
}

/** The link that tells the native part to forget its key and stop — opened once the server has deleted it. */
export const CAR_UNLINK = intentFor('car-unlink');

const assign = (url: string) => globalThis.location?.assign(url);

/** Open the native part with its key. A failure is quiet: the button with the same link is on the screen. */
export function openCarLink(key: string, go: (url: string) => void = assign): void {
  try {
    go(carLinkOf(key));
  } catch {
    /* a tap on the button opens it */
  }
}

/** Tell the native part to forget its key, now. Best effort: the server already refuses the key, whatever the phone does. */
export function openCarUnlink(go: (url: string) => void = assign): void {
  try {
    go(CAR_UNLINK);
  } catch {
    /* the key opens nothing any more; the phone finds out at its next call */
  }
}

/** The car part's floor: Android 9 (the integrator, 2026-11-02). */
export const CAR_MIN_ANDROID = 9;

/**
 * THE ANDROID VERSION THIS PHONE SAYS, or undefined where it says none (not Android, or a browser that will not tell).
 * The user agent first; where the browser hands out its real platform version (Chrome's client hints, `platformVersion`),
 * that wins — a reduced user agent says "Android 10" on every phone.
 */
export function androidMajor(userAgent: string | undefined, platformVersion?: string): number | undefined {
  const hinted = platformVersion ? Number.parseInt(platformVersion, 10) : NaN;
  if (Number.isFinite(hinted) && hinted > 0) return hinted;
  const m = /Android\s+(\d+)/i.exec(userAgent ?? '');
  return m ? Number(m[1]) : undefined;
}

/** Too old for the car part: an Android version below 9 was said. A phone that says nothing is not refused. */
export const tooOldForCar = (major: number | undefined): boolean => major !== undefined && major < CAR_MIN_ANDROID;

/** What this phone says of itself: its user agent now, and Chrome's real platform version when it will give it. */
export function phoneAndroid(): { now: number | undefined; exact: Promise<number | undefined> } {
  const nav = (globalThis as { navigator?: { userAgent?: string; userAgentData?: { platform?: string; getHighEntropyValues?: (h: string[]) => Promise<{ platformVersion?: string }> } } }).navigator;
  const now = androidMajor(nav?.userAgent);
  const data = nav?.userAgentData;
  const exact =
    data?.getHighEntropyValues && /android/i.test(data.platform ?? '')
      ? data
          .getHighEntropyValues(['platformVersion'])
          .then((v) => androidMajor(nav?.userAgent, v.platformVersion))
          .catch(() => now)
      : Promise.resolve(now);
  return { now, exact };
}
