/** A printable page the server rendered, in a tab of its own: the way the consignment note and the invoices open. */
export function openPage(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A label the server drew (an SVG), in a tab of its own, to print and stick on: the way the counter's label opens. */
export function openSvg(svg: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
