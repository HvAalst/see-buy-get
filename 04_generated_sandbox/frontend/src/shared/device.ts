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

/** A contact the user picked to invite — name + first number/email. Kept ON-DEVICE only (never sent to the server). */
export interface PickedContact {
  name: string;
  tel: string;
  email?: string;
}

/**
 * Multi-select from the address book (S28 invite). Returns the chosen contacts' name + first number, or
 * an empty list if cancelled / unsupported. The numbers live only on this device — they drive the deep
 * links and the local "pending → joined" map, and are never uploaded (the server holds only opaque tokens).
 */
export async function pickContacts(): Promise<PickedContact[]> {
  try {
    if (!canPickContact()) return [];
    const picker = (navigator as unknown as {
      contacts: { select(props: string[], opts: { multiple: boolean }): Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>> };
    }).contacts;
    const picked = await picker.select(['name', 'tel', 'email'], { multiple: true });
    return (picked ?? [])
      .map((c) => ({ name: (c.name?.[0] ?? '').trim(), tel: (c.tel?.[0] ?? '').trim(), email: (c.email?.[0] ?? '').trim() || undefined }))
      .filter((c) => c.name || c.tel);
  } catch {
    return [];
  }
}

/** Is the native share sheet available (most mobile browsers)? Sync — safe for a render-time check. */
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && 'share' in navigator;
}

/** The channels the invite sheet offers. `copy`/`system` are handled locally; the rest are deep links. */
export type ShareChannel = 'whatsapp' | 'telegram' | 'sms' | 'email' | 'copy' | 'system';

export interface ShareTarget {
  text: string;
  url: string;
  tel?: string; // the picked contact's number — used to open WhatsApp/SMS straight to them
  email?: string;
}

const digits = (tel: string): string => (tel || '').replace(/[^\d]/g, '');

/**
 * Build the deep link that opens a channel — to the specific contact where the channel supports it
 * (WhatsApp/SMS/email), or to the channel's own chat-picker (Telegram). Returns null for copy/system,
 * which openChannel handles directly.
 */
export function channelUrl(channel: ShareChannel, t: ShareTarget): string | null {
  const msg = `${t.text} ${t.url}`;
  switch (channel) {
    case 'whatsapp':
      return t.tel ? `https://wa.me/${digits(t.tel)}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    case 'telegram':
      return `https://t.me/share/url?url=${encodeURIComponent(t.url)}&text=${encodeURIComponent(t.text)}`;
    case 'sms':
      return `sms:${digits(t.tel ?? '')}?body=${encodeURIComponent(msg)}`;
    case 'email':
      return `mailto:${t.email ?? ''}?subject=${encodeURIComponent('Join me on SeeBuyGet')}&body=${encodeURIComponent(msg)}`;
    default:
      return null;
  }
}

/**
 * Open a share channel. `copy` writes the clipboard; `system` opens the OS share sheet; the rest open
 * their deep link in a new context so the SPA is not navigated away. Returns what happened, for feedback.
 */
export async function openChannel(channel: ShareChannel, t: ShareTarget): Promise<'opened' | 'copied' | 'shared' | 'failed'> {
  if (channel === 'copy') {
    try {
      await navigator.clipboard?.writeText(`${t.text} ${t.url}`);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  if (channel === 'system') {
    const r = await shareLink(t.text, t.url);
    return r === 'failed' ? 'failed' : r; // 'shared' | 'copied'
  }
  const href = channelUrl(channel, t);
  if (!href) return 'failed';
  try {
    const opened = globalThis.open?.(href, '_blank', 'noopener');
    if (!opened) globalThis.location?.assign(href); // popup blocked → navigate; the app scheme still intercepts
    return 'opened';
  } catch {
    return 'failed';
  }
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
