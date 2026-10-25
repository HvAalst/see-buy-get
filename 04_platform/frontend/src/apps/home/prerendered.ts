import type { TownPage } from './api';
import type { PublishedDocument } from '../../shared/documents/documents';
import type { Notice } from './pages';

/**
 * WHAT THE BUILD KNEW — handed from the prerender to the browser so both draw the same first frame.
 *
 * The build fetches the town pages once (prerender.tsx) and renders with them; the plugin writes the same data into
 * the page as `<script type="application/json" id="prerender-data">`. The browser's first render reads it from
 * there, so a hydrated page starts from exactly the markup it was sent and fetches fresh figures afterwards.
 *
 * In Node (the build) the data and the address being rendered sit on globalThis; in a browser, the address is the
 * real one and the data is in the page. Neither present — dev, or a server that was down at build time — is an
 * ordinary state: the screens fetch for themselves.
 */
type BuildGlobals = { __SBG_PRERENDER__?: { url: string; towns: TownPage[]; documents?: Partial<Record<Notice, PublishedDocument>> } };

export function prerenderedTowns(): TownPage[] {
  const g = (globalThis as BuildGlobals).__SBG_PRERENDER__;
  if (g) return g.towns;
  try {
    const el = globalThis.document?.getElementById('prerender-data');
    const data = el?.textContent ? (JSON.parse(el.textContent) as { towns?: TownPage[] }) : null;
    return Array.isArray(data?.towns) ? data!.towns : [];
  } catch {
    return [];
  }
}

/**
 * The terms of use, the data notice or the cookie statement as the build read it from the server — so the page a search
 * engine reads has the words in it. The browser asks the server again: staff may have published since the build.
 */
export function prerenderedDocument(which: Notice): PublishedDocument | null {
  const g = (globalThis as BuildGlobals).__SBG_PRERENDER__;
  if (g) return g.documents?.[which] ?? null;
  try {
    const el = globalThis.document?.getElementById('prerender-data');
    const data = el?.textContent ? (JSON.parse(el.textContent) as { documents?: Partial<Record<Notice, PublishedDocument>> }) : null;
    return data?.documents?.[which] ?? null;
  } catch {
    return null;
  }
}

/** The path being shown: the build's route while prerendering, the address bar in a browser. */
export function currentPath(): string {
  return (globalThis as BuildGlobals).__SBG_PRERENDER__?.url ?? globalThis.location?.pathname ?? '/';
}

/** `/towns/dar-es-salaam` → `dar-es-salaam`. */
export function townSlugFromPath(path: string): string | null {
  return /^\/towns\/([a-z0-9-]+)\/?$/.exec(path)?.[1] ?? null;
}
