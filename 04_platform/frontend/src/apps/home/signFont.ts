import signFontUrl from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wdth-normal.woff2?url';

/**
 * THE PAINTED SIGN'S NARROW LETTERS, ONLY WHERE THE CONNECTION CAN SPARE THEM (the user, 2026-10-23: "the loading time of
 * the homepage should be short for a low quality phone with poor connection"). Bricolage's width axis is 77 KB — a quarter
 * of everything the homepage downloads — for two headings on the sign. It is fetched after the page has loaded, and not
 * at all on a slow connection or with data saving on: there the sign keeps the headings' own face, already here.
 */
export function loadSignFont(): void {
  try {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || (connection?.effectiveType && connection.effectiveType !== '4g')) return;
    if (typeof FontFace === 'undefined') return;
    const face = new FontFace('Bricolage Grotesque Width', `url(${signFontUrl}) format('woff2-variations')`, { weight: '200 800', stretch: '75% 100%', display: 'swap' });
    void face
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => undefined);
  } catch {
    /* no font API here: the sign keeps the headings' face */
  }
}

/** After the page has loaded, never in its way. */
export function loadSignFontWhenLoaded(): void {
  if (typeof document === 'undefined') return;
  if (document.readyState === 'complete') loadSignFont();
  else globalThis.addEventListener('load', loadSignFont, { once: true });
}
