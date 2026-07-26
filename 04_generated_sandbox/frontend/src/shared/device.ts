/**
 * Optional mobile-device capabilities (S22+). Every function is feature-detected and safe to call
 * anywhere: on a browser that lacks the capability (iOS Safari, desktop, older Android) it resolves to
 * a graceful "not available" — false or null — so the caller always keeps its manual fallback. Nothing
 * here is REQUIRED for the app to work; these only cut typing for the phone-first consumer.
 *
 * All access to the platform APIs (which are not in the standard DOM typings) is funnelled through the
 * narrow casts here, so the rest of the app stays typed and never touches `navigator` directly.
 */

/**
 * WebOTP — auto-read an incoming SMS one-time code (Chromium on Android). The SMS must end with the
 * origin-bound line `@<host> #<code>` for the browser to release the code. Resolves the code, or null
 * when unsupported / aborted (the user left the step) / dismissed. The caller keeps the manual field.
 */
export async function readSmsOtp(signal: AbortSignal): Promise<string | null> {
  try {
    if (typeof globalThis === 'undefined' || !('OTPCredential' in globalThis)) return null;
    const creds = navigator.credentials as unknown as { get(o: unknown): Promise<{ code?: string } | null> };
    const cred = await creds.get({ otp: { transport: ['sms'] }, signal });
    return cred?.code ?? null;
  } catch {
    return null; // AbortError (step changed) or the user declined — silently fall back to typing
  }
}

/** Is the Contact Picker available (Chromium on Android)? Sync — safe for a render-time check. */
export function canPickContact(): boolean {
  return typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in globalThis;
}

/**
 * Let the user pick a phone number from their address book (e.g. to confirm their OWN number without
 * typing it). Requires a user gesture — call it from a tap handler. Returns the first phone of the
 * chosen contact, or null if cancelled / unsupported. One-shot: nothing is stored, we read one number.
 */
export async function pickPhoneFromContacts(): Promise<string | null> {
  try {
    if (!canPickContact()) return null;
    const picker = (navigator as unknown as {
      contacts: { select(props: string[], opts: { multiple: boolean }): Promise<Array<{ tel?: string[] }>> };
    }).contacts;
    const picked = await picker.select(['tel'], { multiple: false });
    return picked?.[0]?.tel?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Is the native share sheet available (most mobile browsers)? Sync — safe for a render-time check. */
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && 'share' in navigator;
}

/**
 * Share a link (S24 invite). Opens the OS share sheet where available (the growth win — one tap into
 * WhatsApp/SMS/…); otherwise copies the link to the clipboard. Returns which happened so the UI can say
 * "copied". A cancelled share counts as done (the user chose not to send), never a copy behind their back.
 */
export async function shareLink(text: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  const nav = navigator as unknown as { share?(d: { title?: string; text?: string; url?: string }): Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title: 'SeeBuyGet', text, url });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'shared'; // user cancelled — do not silently copy
      // any other share failure falls through to the clipboard
    }
  }
  try {
    await navigator.clipboard?.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
