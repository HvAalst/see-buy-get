/**
 * Trigger a client-side file download from in-memory content (a CSV the app already fetched with its auth
 * token). A Blob + a transient object-URL on a synthetic anchor — no server round-trip beyond the fetch
 * the caller already did, and no navigation. Guarded for a non-DOM/SSR context.
 */
/**
 * Round 27 — a label for a thermal label printer (ZPL), as a file: what the printer's own tool, or a shared printer, is
 * sent as it is. Named for what it labels, so a counter can tell one from the next in its downloads.
 */
export function downloadZpl(name: string, zpl: string): void {
  triggerDownload(`${name.replace(/[^A-Za-z0-9_-]+/g, '-')}.zpl`, zpl, 'text/plain;charset=utf-8');
}

export function triggerDownload(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  triggerDownloadBlob(filename, new Blob([content], { type: mime }));
}

/**
 * The same, for bytes the app already holds as a Blob — the consignment-note bundle, which is a ZIP the
 * server built and the client never parses. Separate from the string form because re-wrapping a Blob in
 * `new Blob([string])` would corrupt it: a ZIP is not text and does not survive a UTF-8 round trip.
 */
export function triggerDownloadBlob(filename: string, blob: Blob): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on the next tick so the click has taken effect first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
