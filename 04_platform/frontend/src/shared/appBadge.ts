/**
 * 2026-11-02 — THE COUNT ON THE APP'S ICON (the owner: "make it as native as today can be").
 *
 * An installed app can put a number on its home-screen icon, as a native app does: here, how many notices are unread.
 * It shows on an iPhone's home screen (iOS 16.4 and later), on a computer's dock or taskbar, and on Android launchers
 * that draw counts; elsewhere the call does nothing and nothing breaks. Each installed app has its own icon and so its
 * own count. When a notice arrives while the app is closed, the push worker marks the icon; the exact count is set the
 * next time the app is open and has read its inbox.
 */
type Badging = { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function setIconCount(n: number, nav: Badging | undefined = globalThis.navigator as Badging | undefined): void {
  try {
    if (n > 0) void nav?.setAppBadge?.(Math.floor(n))?.catch(() => undefined);
    else void nav?.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    /* a browser without badges, or one that refuses outside an installed app: the bell still counts */
  }
}
