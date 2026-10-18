/** A printable page the server rendered, in a tab of its own: the way the consignment note and the invoices open. */
export function openPage(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
