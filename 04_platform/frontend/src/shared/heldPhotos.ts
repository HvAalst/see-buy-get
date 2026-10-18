/**
 * A PHOTO THAT WAITS FOR A SIGNAL, WITH THE TAKE-IN IT BELONGS TO.
 *
 * A parcel is not taken in without a photo of it: the photo is the baseline a later damage report is read against. The
 * photo used to upload the moment it was taken, so with no signal there was no photo, and so no take-in — the one act
 * the counter exists for stopped at the first dead spot, although the outbox (outbox.ts) could already carry the
 * take-in itself.
 *
 * So a take-in photo taken with no signal is HELD on the phone, under a `local:` reference, and the take-in goes into
 * the outbox carrying that reference. When the outbox sends it, it uploads the photo first and puts the real one in its
 * place (resolveHeld): the server only ever sees a real photo, and refuses the take-in otherwise, exactly as before.
 *
 * Only the take-in photo is held (`dropoff`). A photo for anything the outbox does not carry would wait for nothing.
 */

const STORE_KEY = 'sbg.held-photos.v1';
export const HELD_PREFIX = 'local:';

/** The photo kinds that may wait: the ones whose act the outbox carries. */
export const HELD_KINDS = ['dropoff', 'defect', 'hazard'] as const;
export type HeldKind = (typeof HELD_KINDS)[number];

export interface HeldPhoto {
  kind: HeldKind;
  dataUrl: string;
  thumbDataUrl?: string;
  at: string;
}

function read(): Record<string, HeldPhoto> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, HeldPhoto>) : {};
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

function write(all: Record<string, HeldPhoto>): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false; // the phone is full: the caller says the photo needs a signal after all
  }
}

export function isHeld(ref: unknown): ref is string {
  return typeof ref === 'string' && ref.startsWith(HELD_PREFIX);
}

export function mayHold(kind: string): kind is HeldKind {
  return (HELD_KINDS as readonly string[]).includes(kind);
}

/** Keep a prepared photo on the phone. Its reference, or null when there is no room to keep it. */
export function holdPhoto(kind: HeldKind, dataUrl: string, thumbDataUrl?: string, now = Date.now()): string | null {
  const id = `${HELD_PREFIX}${globalThis.crypto?.randomUUID?.() ?? `${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
  const all = read();
  all[id] = { kind, dataUrl, ...(thumbDataUrl ? { thumbDataUrl } : {}), at: new Date(now).toISOString() };
  return write(all) ? id : null;
}

export function heldPhoto(ref: string): HeldPhoto | undefined {
  return read()[ref];
}

export function forgetHeld(ref: string): void {
  const all = read();
  delete all[ref];
  write(all);
}

/** How many photos wait on this phone. */
export function heldCount(): number {
  return Object.keys(read()).length;
}

/** Every `local:` reference anywhere in a request body. */
export function heldRefsIn(body: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (isHeld(v)) found.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(body);
  return [...found];
}

/** The body with each held reference replaced by the real one it was uploaded as. */
export function withRefs(body: unknown, real: Record<string, string>): unknown {
  if (isHeld(body)) return real[body] ?? body;
  if (Array.isArray(body)) return body.map((v) => withRefs(v, real));
  if (body && typeof body === 'object') return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, withRefs(v, real)]));
  return body;
}
