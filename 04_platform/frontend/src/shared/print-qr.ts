/**
 * PRINTING A CODE THAT IS MEANT TO LIVE ON A SURFACE.
 *
 * Half the codes in this product are phygital: a dashboard sticker, a bag tag, a badge. They are only
 * worth anything once they are on paper and stuck to the thing they name — and until now the app could
 * show one and then leave somebody to work out how to get it out of a phone.
 *
 * `window.print()` on the page itself is not that. It prints the app: a top bar, a tab bar, a sheet
 * backdrop, and the code somewhere in the middle at whatever size the screen chose. So this opens ONE
 * clean sheet holding the code, what it is, and the line a person reads when a scanner will not — which
 * is the whole point of the caption existing.
 *
 * The SVG is taken from the DOM rather than re-encoded. It is already on screen, already the right
 * payload, and re-deriving it here would be a second place for the encoding to drift.
 */

export interface PrintableQr {
  /** What this code is, printed above it: "KDA 111W". */
  title: string;
  /** The code in words, under it. A scanner failing is exactly when this is needed. */
  caption?: string;
  /** One line of instruction — where it goes, and what it does. */
  note?: string;
  /** The live `<svg>` on screen. Serialised as-is. */
  svg: SVGElement | null;
}

/** How big the code prints. 62mm survives a phone camera across a cab in poor light. */
const PRINT_MM = 62;

export function printQrSheet({ title, caption, note, svg }: PrintableQr): boolean {
  if (!svg) return false;

  // A fixed physical size, not the on-screen pixels: what matters on paper is millimetres.
  const markup = svg.outerHTML.replace(/width="[^"]*"/, `width="${PRINT_MM}mm"`).replace(/height="[^"]*"/, `height="${PRINT_MM}mm"`);

  const win = globalThis.open?.('', '_blank', 'width=640,height=800');
  // A blocked pop-up is the ordinary case on a phone, and it must not look like a broken button — the
  // caller says so instead. Nothing is lost: the code is still on the screen behind them.
  if (!win) return false;

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { margin: 14mm; }
    body { font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #14181f; text-align: center; margin: 0; }
    h1 { font-size: 26px; margin: 0 0 4mm; letter-spacing: -0.01em; }
    .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 18px; letter-spacing: 0.06em; margin: 4mm 0 0; }
    .note { font-size: 14px; color: #4a5261; max-width: 90mm; margin: 6mm auto 0; }
    /* A cut line, because this is going on a dashboard and somebody will reach for scissors. */
    .sheet { display: inline-block; padding: 8mm; border: 1px dashed #c9cfd7; border-radius: 4mm; margin-top: 6mm; }
  </style></head><body>
    <div class="sheet">
      <h1>${esc(title)}</h1>
      ${markup}
      ${caption ? `<p class="code">${esc(caption)}</p>` : ''}
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
  // Printed after the document settles — calling straight away prints a blank page in some browsers.
  win.setTimeout(() => win.print(), 250);
  return true;
}
