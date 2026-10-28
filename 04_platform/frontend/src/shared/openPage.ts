/**
 * A TAB OPENED AT THE TAP, FILLED WHEN THE FILE HAS ARRIVED (2026-10-28).
 *
 * A tab opened only after waiting for the server is no longer the person's tap: browsers that tie a new tab to the tap
 * itself — Safari above all — block it as a pop-up, and the button seems to do nothing. So the tab is opened first, at
 * the tap, empty; `show` fills it once the file is here, and `cancel` closes it when nothing came. Call it before the
 * first `await`, and `cancel` in a `finally`: once shown, cancel does nothing, so a failure on any path closes the empty
 * tab and a success keeps it.
 *
 * Where even the tap's tab is refused (`opened` false), `show` tries the old way once more rather than navigating away
 * from the app, which would lose what the person was doing.
 */
export interface WaitingTab {
  /** Whether the browser gave us the tab at the tap. */
  readonly opened: boolean;
  show(content: Blob | string, type?: string): void;
  cancel(): void;
}

export function tabAtTheTap(): WaitingTab {
  let tab: Window | null = null;
  try {
    tab = typeof window === 'undefined' ? null : window.open('', '_blank');
  } catch {
    tab = null;
  }
  if (tab) {
    try {
      // Our own page must not be reachable from the file's tab.
      tab.opener = null;
    } catch {
      /* nothing to cut */
    }
  }
  let shown = false;
  return {
    opened: Boolean(tab),
    show(content, type = 'text/html') {
      shown = true;
      const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
      const url = URL.createObjectURL(blob);
      if (tab && !tab.closed) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
      // A minute is long after the tab has read it; the address is not kept for anything else.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    cancel() {
      if (!shown && tab && !tab.closed) tab.close();
    },
  };
}

/**
 * A page or a label ALREADY IN HAND (nothing to wait for), in a tab of its own: the counter's label, a label drawn when
 * the parcel was made. Opened straight from the tap. Anything fetched first goes through `tabAtTheTap`.
 */
export function openPage(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A label the server drew (an SVG) and already in hand, in a tab of its own, to print and stick on. */
export function openSvg(svg: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
