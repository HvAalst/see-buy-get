/**
 * Trigger a client-side file download from in-memory content (a CSV the app already fetched with its auth
 * token). A Blob + a transient object-URL on a synthetic anchor — no server round-trip beyond the fetch
 * the caller already did, and no navigation. Guarded for a non-DOM/SSR context.
 */
export function triggerDownload(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  const blob = new Blob([content], { type: mime });
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
