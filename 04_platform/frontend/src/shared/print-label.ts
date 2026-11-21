/**
 * 2026-11-21 — A PARCEL LABEL PRINTED AT HOME (the payments plan, 5a; the owner: "with the print option comes the instruction on
 * how to paste it on the parcel"). One clean page: the label at 100 mm wide — the size a counter's printer makes — and, under it,
 * how to stick it on. Opened in a new window and printed from there; a blocked pop-up is said by the caller, never a dead button.
 */
export interface PrintableLabel {
  /** The page's title: the parcel's number. */
  title: string;
  /** The label, as the server made it (trusted markup from our own backend). */
  svg: string;
  /** What to do with it, one step each, in the reader's language. */
  steps: string[];
  /** Said under the steps. */
  note?: string;
}

/** The label's width on paper. */
const LABEL_MM = 100;

export function printParcelLabel({ title, svg, steps, note }: PrintableLabel): boolean {
  if (!svg) return false;
  const win = globalThis.open?.('', '_blank', 'width=720,height=900');
  if (!win) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  const sized = svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1').replace('<svg', `<svg width="${LABEL_MM}mm"`);
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { margin: 12mm; }
    body { font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #14181f; margin: 0; }
    .label { display: inline-block; padding: 4mm; border: 1px dashed #c9cfd7; border-radius: 3mm; }
    ol { max-width: 150mm; margin: 8mm 0 0; padding-left: 6mm; }
    li { margin: 0 0 2mm; }
    .note { color: #4a5261; max-width: 150mm; margin: 4mm 0 0; }
  </style></head><body>
    <div class="label">${sized}</div>
    <ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${note ? `<p class="note">${esc(note)}</p>` : ''}
  </body></html>`);
  win.document.close();
  win.focus();
  win.print?.();
  return true;
}
