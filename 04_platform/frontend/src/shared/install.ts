import { useEffect, useState } from 'preact/hooks';
import { isInstalledApp } from './ui/AllAppsLink';

/**
 * 2026-11-02 — INSTALL THIS APP (the owner: "I am missing the call to 'install this app' which could also be sticky until
 * the moment the app is installed … clicking it would not right away install it, but open a slide up and give a short
 * introduction with images in a precise way how to set the notification settings").
 *
 * The browser offers an install once, early, before any screen asks (Chrome, Edge and Samsung's browser fire
 * `beforeinstallprompt`): it is held here from the moment the app's code loads, and its own little bar is kept away, so
 * ours is the one call. Safari on an iPhone offers nothing of the kind — there, installing is Share → Add to Home Screen,
 * which the sheet shows. Once installed the call goes: an app opened from the home screen knows it is installed, and an
 * install made from the browser is remembered on this device for this app.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPlatform = 'android' | 'ios' | 'other';

let deferred: InstallPromptEvent | null = null;
let listening = false;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((w) => w());

/** This app's own mark: each app installs on its own (the Shop app installed is not the Driver app installed). */
const markKey = (): string => `sbg.installed:${import.meta.env.BASE_URL ?? '/'}`;

export function markedInstalled(): boolean {
  try {
    return globalThis.localStorage?.getItem(markKey()) === '1';
  } catch {
    return false;
  }
}

export function markInstalled(): void {
  try {
    globalThis.localStorage?.setItem(markKey(), '1');
  } catch {
    /* storage blocked: the call comes back on the next visit, which is the safe side */
  }
  tell();
}

/** Hold the browser's install offer from the moment the app loads. Safe to call more than once. */
export function listenForInstall(win: Window | undefined = globalThis.window): void {
  if (listening || !win?.addEventListener) return;
  listening = true;
  win.addEventListener('beforeinstallprompt', (e) => {
    // Its own mini bar stays away: ours explains first, and installs only when asked to.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    tell();
  });
  win.addEventListener('appinstalled', () => {
    deferred = null;
    markInstalled();
  });
}
listenForInstall();

/** Android, an iPhone or iPad (an iPad says it is a Mac, but has a touch screen), or anything else. */
export function platformOf(ua: string = globalThis.navigator?.userAgent ?? '', touchPoints: number = globalThis.navigator?.maxTouchPoints ?? 0): InstallPlatform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && touchPoints > 1)) return 'ios';
  return 'other';
}

/**
 * Whether to call for an install: never once installed; where the browser offers it; and on any Android phone or
 * iPhone, where it can always be done by hand. A desk browser that cannot install is not asked to.
 */
export function shouldOffer(s: { installed: boolean; marked: boolean; canPrompt: boolean; platform: InstallPlatform }): boolean {
  if (s.installed || s.marked) return false;
  return s.canPrompt || s.platform !== 'other';
}

export interface InstallState {
  /** The call shows: not installed, and installable here. */
  offer: boolean;
  /** Running from the home screen. */
  installed: boolean;
  platform: InstallPlatform;
  /** The browser can install it with one tap. */
  canPrompt: boolean;
  /** Ask the browser to install it — only ever from a tap in the sheet. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** The person says it is on their home screen (an iPhone's Safari cannot tell). */
  markInstalled: () => void;
}

export function useInstall(): InstallState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const w = () => setTick((n) => n + 1);
    watchers.add(w);
    return () => void watchers.delete(w);
  }, []);
  const installed = isInstalledApp();
  const platform = platformOf();
  const canPrompt = Boolean(deferred);
  return {
    offer: shouldOffer({ installed, marked: markedInstalled(), canPrompt, platform }),
    installed,
    platform,
    canPrompt,
    install: async () => {
      const e = deferred;
      if (!e) return 'unavailable';
      await e.prompt();
      const { outcome } = await e.userChoice;
      // The offer is spent either way; the browser makes a new one later if it is still installable.
      deferred = null;
      if (outcome === 'accepted') markInstalled();
      else tell();
      return outcome;
    },
    markInstalled,
  };
}
