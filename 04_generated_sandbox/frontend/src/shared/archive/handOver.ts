import { triggerDownloadBlob } from '../download';

/** What became of handing somebody a file: it went to an app of theirs, into their downloads, or they backed out. */
export type HandedOver = 'shared' | 'saved' | 'cancelled';

/** What became of passing a link on: it went to an app of theirs, onto their clipboard, they backed out — or neither way is there, and it is on the screen to copy by hand. */
export type PassedOn = 'shared' | 'copied' | 'cancelled' | 'shown';

/** The two ways a browser can pass a piece of text on. Either may be missing. */
export interface PassOnWays {
  share?: (data: { url: string; title: string }) => Promise<void>;
  copy?: (text: string) => Promise<void>;
}

/** What this browser offers, asked of it rather than assumed. */
export function waysToPassOn(): PassOnWays {
  if (typeof navigator === 'undefined') return {};
  return {
    ...(typeof navigator.share === 'function' ? { share: (data) => navigator.share(data) } : {}),
    ...(navigator.clipboard && typeof navigator.clipboard.writeText === 'function' ? { copy: (text) => navigator.clipboard.writeText(text) } : {}),
  };
}

/**
 * PASS A LINK ON: to the phone's own share sheet — a chat, a text, their mail — or onto the clipboard.
 *
 * The same two rules as for a file. Backing out of the sheet is not a failure, and nothing is copied behind
 * somebody's back because they did. And a sheet that fails for any other reason must not end in nothing: it falls
 * through to the clipboard, and from there to `shown` — the link is on the screen, and can be copied by hand.
 */
export async function passOnLink(url: string, title: string, how: 'share' | 'copy', ways: PassOnWays = waysToPassOn()): Promise<PassedOn> {
  if (how === 'share' && ways.share) {
    try {
      await ways.share({ url, title });
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  if (ways.copy) {
    try {
      await ways.copy(url);
      return 'copied';
    } catch {
      /* a clipboard that refuses leaves the link on the screen */
    }
  }
  return 'shown';
}

/** A filename somebody can save on any operating system. */
export function fileNameFor(number: string): string {
  return `${number.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'consignment-note'}.zip`;
}

/** Can this browser hand a file to the operating system's own share sheet? Asked with a file of the right kind. */
export function canShareFiles(): boolean {
  if (typeof File !== 'function' || typeof navigator === 'undefined' || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(0)], 'x.zip', { type: 'application/zip' })] });
  } catch {
    return false;
  }
}

/**
 * HAND A FILE TO THE OPERATING SYSTEM, which already knows their Drive — and to their downloads where it does not.
 *
 * A CANCELLED SHEET IS NOT A FAILURE: that is the person changing their mind, and putting a file in their downloads
 * because they backed out would be presumptuous. Anything else IS a failure and must not end in nothing happening:
 * `canShare()` is the browser's opinion that it could share, and browsers are wrong about it — a desktop Chrome with
 * no share target says yes and then rejects. Found by driving: the button did nothing at all, silently, which is the
 * worst outcome for the one control that gets somebody their evidence. So everything but a cancel ends in a download.
 */
export async function handOverFile(name: string, blob: Blob, title: string): Promise<HandedOver> {
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/zip' }) : null;
  if (file && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  triggerDownloadBlob(name, blob);
  return 'saved';
}
