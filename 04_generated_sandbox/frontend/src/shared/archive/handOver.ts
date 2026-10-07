import { triggerDownloadBlob } from '../download';

/** What became of handing somebody a file: it went to an app of theirs, into their downloads, or they backed out. */
export type HandedOver = 'shared' | 'saved' | 'cancelled';

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
