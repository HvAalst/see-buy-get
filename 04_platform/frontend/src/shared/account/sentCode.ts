/**
 * A CODE ALREADY SENT TO AN ADDRESS, REMEMBERED THROUGH A RELOAD (the owner, 2026-11-01: "when I have to switch apps, from
 * chrome on mobile to mail, to fetch the security code to confirm my email, the sbg page is refreshed and I can't write
 * the code from the earlier email"). A phone's browser loads the page again on return; the box for the code was gone,
 * so the code in the inbox had nowhere to go. Remembered in this tab's session storage — which address, and when — for
 * the fifteen minutes a code is good. The code itself is never kept here.
 */

const KEY = 'sbg.codeSent';
export const CODE_GOOD_MS = 15 * 60 * 1000;

const same = (address: string) => address.trim().toLowerCase();

/** When a code was sent to this address in this tab, if that was less than fifteen minutes ago. */
export function sentEarlier(address: string, now: number = Date.now(), store: Pick<Storage, 'getItem'> | undefined = globalThis.sessionStorage): number | null {
  try {
    const raw = store?.getItem(KEY);
    const kept = raw ? (JSON.parse(raw) as { address?: string; at?: number }) : null;
    if (!kept?.address || typeof kept.at !== 'number' || !same(address)) return null;
    return kept.address === same(address) && now - kept.at < CODE_GOOD_MS && now >= kept.at ? kept.at : null;
  } catch {
    return null;
  }
}

/** Remember that a code was just sent to this address. */
export function rememberSent(address: string, now: number = Date.now(), store: Pick<Storage, 'setItem'> | undefined = globalThis.sessionStorage): void {
  try {
    store?.setItem(KEY, JSON.stringify({ address: same(address), at: now }));
  } catch {
    // No storage: the box is simply not shown again after a reload.
  }
}
