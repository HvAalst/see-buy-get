import type { JSX } from 'preact';
import type { ErrorIconName } from '../../lib/sbg/errors';

/**
 * Monoline icon set. Stroke-only, `currentColor`, stroke-width 1.9 — they inherit the
 * colour of whatever they sit in, so an icon can never drift off-palette.
 *
 * NO EMOJI IS EVER USED AS A UI ICON — with no exception for server-driven content. Emoji
 * render in a different typeface and a different palette on every device, are read aloud by
 * screen readers as their CLDR name, and the newer ones (the ID-card glyph is Unicode 14) are
 * plain tofu on the cheap Androids this product targets. Every icon slot in the app is typed
 * `IconName`, so a glyph cannot reach one even by accident.
 *
 * `IconName` is a superset of `ErrorIconName` by construction, and `PATHS` below is a total
 * `Record<IconName, …>` — together they make "an error asked for a symbol that does not
 * exist" a compile error rather than a blank box on a driver's phone.
 */
export type IconName =
  | ErrorIconName // wallet, lock, keypad, camera, search, pin, clock, scale, block, box, key, edit, offline, refresh, warning
  | 'chevronRight'
  | 'chevronLeft'
  | 'arrowLeft'
  | 'arrowUp'
  | 'scan'
  | 'route'
  | 'repeat'
  | 'home'
  | 'truck'
  | 'check'
  | 'speaker'
  | 'speakerOff'
  | 'close'
  | 'badge'
  | 'weight'
  | 'power';

const PATHS: Record<IconName, JSX.Element> = {
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  arrowLeft: <path d="M20 12H4m0 0 6-6m-6 6 6 6" />,
  arrowUp: <path d="M12 20V4.6m0 0-6.4 6.4M12 4.6 18.4 11" />,
  scan: <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M4 16v2.5A1.5 1.5 0 0 0 5.5 20H8m8-16h2.5A1.5 1.5 0 0 1 20 5.5V8m0 8v2.5a1.5 1.5 0 0 1-1.5 1.5H16M7 12h10" />,
  route: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M6 8.6v3.9a3 3 0 0 0 3 3h4a3 3 0 0 1 3 3" />
    </>
  ),
  box: <path d="m21 8-9-5-9 5 9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8" />,
  repeat: <path d="M4 9a8 8 0 0 1 13.9-3.1L20 8m0 7a8 8 0 0 1-13.9 3.1L4 16m16-12v4h-4M4 20v-4h4" />,
  home: <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5ZM9.5 20.5v-6h5v6" />,
  truck: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H14v10H4.5A1.5 1.5 0 0 1 3 14.5v-7ZM14 9.5h3.6l2.4 3V16h-6" />
      <circle cx="7.5" cy="18" r="1.9" />
      <circle cx="17" cy="18" r="1.9" />
    </>
  ),
  check: <path d="m5 12.6 4.6 4.6L19 7.5" />,
  speaker: <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4a.9.9 0 0 1-.9-.9v-3.2a.9.9 0 0 1 .9-.9ZM15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />,
  speakerOff: <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4a.9.9 0 0 1-.9-.9v-3.2a.9.9 0 0 1 .9-.9ZM16 10l4 4m0-4-4 4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4" />,
  offline: <path d="M3 3l18 18M8.6 15.4a4.8 4.8 0 0 1 6.1-.6M5 12a9.6 9.6 0 0 1 3.2-2.1m3-.7a9.6 9.6 0 0 1 7.8 2.8M2 8.6a15 15 0 0 1 5-3M12 19h.01" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3 1.9" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.4-5.3 6.4-10.2A6.4 6.4 0 0 0 5.6 10.8C5.6 15.7 12 21 12 21Z" />
      <circle cx="12" cy="10.6" r="2.4" />
    </>
  ),
  weight: <path d="M8.6 7.4h6.8l2.6 12.1H6L8.6 7.4ZM9.6 7.4a2.4 2.4 0 1 1 4.8 0" />,
  power: <path d="M12 4v8M7.4 6.9a7.4 7.4 0 1 0 9.2 0" />,

  /* --- symbols an error presentation can ask for (ErrorIconName) ----------- */

  wallet: (
    <>
      <path d="M4 8.6a2 2 0 0 1 2-2h11.4a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.6Z" />
      <path d="M19.4 11.4h-3.2a1.7 1.7 0 0 0 0 3.4h3.2" />
    </>
  ),
  lock: (
    <>
      <path d="M5.7 11.4h12.6v7.8a1.5 1.5 0 0 1-1.5 1.5H7.2a1.5 1.5 0 0 1-1.5-1.5v-7.8Z" />
      <path d="M8.5 11.4V8.1a3.5 3.5 0 0 1 7 0v3.3M12 15v2.2" />
    </>
  ),
  keypad: (
    <>
      <path d="M6.4 3.6h11.2a2 2 0 0 1 2 2v12.8a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2Z" />
      <path d="M8.6 8.4h.01M12 8.4h.01M15.4 8.4h.01M8.6 12h.01M12 12h.01M15.4 12h.01M8.6 15.6h.01M12 15.6h.01" />
    </>
  ),
  camera: (
    <>
      <path d="M3.4 9.4a1.9 1.9 0 0 1 1.9-1.9h2.2l1.3-2h6.4l1.3 2h2.2a1.9 1.9 0 0 1 1.9 1.9v8a1.9 1.9 0 0 1-1.9 1.9H5.3a1.9 1.9 0 0 1-1.9-1.9v-8Z" />
      <circle cx="12" cy="13.2" r="3.3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.7 15.7 4.3 4.3" />
    </>
  ),
  scale: <path d="M12 5.2v14.2M8 19.4h8M6 8.8h12M6 8.8 3.2 14.6h5.6L6 8.8ZM18 8.8l-2.8 5.8h5.6L18 8.8Z" />,
  block: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m6.1 6.1 11.8 11.8" />
    </>
  ),
  key: (
    <>
      <circle cx="8.2" cy="15.8" r="3.7" />
      <path d="m10.9 13.2 8.1-8.1M16.9 7.2l2.2 2.2M14.7 9.4l2.2 2.2" />
    </>
  ),
  edit: (
    <>
      <path d="M4.6 19.4v-3.6L15.9 4.5a2.2 2.2 0 0 1 3.1 3.1L7.7 19.4H4.6Z" />
      <path d="m14.4 6 3.6 3.6" />
    </>
  ),
  warning: (
    <>
      <path d="M10.7 4.8a1.5 1.5 0 0 1 2.6 0l7.4 13.3a1.5 1.5 0 0 1-1.3 2.2H4.6a1.5 1.5 0 0 1-1.3-2.2L10.7 4.8Z" />
      <path d="M12 9.8v4.4M12 17.4h.01" />
    </>
  ),
  badge: (
    <>
      <path d="M4.6 6.4h14.8a1.8 1.8 0 0 1 1.8 1.8v9.4a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8V8.2a1.8 1.8 0 0 1 1.8-1.8Z" />
      <circle cx="8.8" cy="11.4" r="2" />
      <path d="M5.6 16.2a3.7 3.7 0 0 1 6.4 0M14.6 10.6h4.2M14.6 14h3.2" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Pixel box; 24 by default. Never smaller than 18 on a tappable control. */
  size?: number;
  class?: string;
  /** Give a label only when the icon is the sole meaning; otherwise it stays aria-hidden. */
  label?: string;
}

export function Icon({ name, size = 24, class: cls, label }: IconProps) {
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
