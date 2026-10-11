import { createHash, randomBytes } from 'crypto';

/**
 * THE DEVICES A PERSON'S PIN WORKS ON (the user, 2026-10-11: "I thought that the pin was unique to the device. so
 * indeed only after a new sign in and a pin setup, the pin could unlock the app.").
 *
 * It was not. A phone number and its PIN signed in from anywhere, so a PIN — ten thousand possibilities, a hundred
 * thousand now — was a password anybody on the internet could try five times per phone, across every phone there is.
 *
 * A device becomes KNOWN when the code sent to the phone is typed on it: that is the one moment the person holding
 * the device has shown they hold the phone. It is handed a key — long, random, made here — and from then on the PIN
 * is looked at only when that key comes with it. Without the key the PIN is never looked at at all: there is nothing
 * to guess, from anywhere, and the PIN is back to being what it should be — what stops whoever picked the phone up.
 *
 * The key is shown to the device once and kept here only as a hash, like every other credential.
 */
export interface KnownDevice {
  personDid: string;
  addedAt: string;
}

/** The oldest goes when an eleventh is added: a phone, a tablet, the office computer, and room to replace each twice. */
export const MAX_DEVICES_PER_PERSON = 10;

const hashOf = (key: string) => createHash('sha256').update(key).digest('hex');

export class DeviceBook {
  /** @param store keyed by the hash of a device's key. A service passes the durable store. */
  constructor(private readonly store: Map<string, KnownDevice>) {}

  /** A new key for a device of this person's. Returned ONCE; only its hash is kept. */
  add(personDid: string, now: number = Date.now()): string {
    const key = `dvc_${randomBytes(32).toString('hex')}`;
    const mine = [...this.store].filter(([, d]) => d.personDid === personDid).sort((a, b) => a[1].addedAt.localeCompare(b[1].addedAt));
    for (const [hash] of mine.slice(0, Math.max(0, mine.length - (MAX_DEVICES_PER_PERSON - 1)))) this.store.delete(hash);
    this.store.set(hashOf(key), { personDid, addedAt: new Date(now).toISOString() });
    return key;
  }

  /** Is this the key of a device of THIS person's? Nobody's key, somebody else's key and no key are all "no". */
  knows(personDid: string | undefined, key: string | undefined): boolean {
    if (!personDid || !key) return false;
    return this.store.get(hashOf(key))?.personDid === personDid;
  }

  /** How many devices this person's PIN works on. */
  count(personDid: string): number {
    return [...this.store.values()].filter((d) => d.personDid === personDid).length;
  }

  /**
   * Every device of this person's is forgotten — each has to be confirmed by a code again. `exceptKey` keeps the one
   * that is doing it.
   */
  forgetAll(personDid: string, exceptKey?: string): void {
    const keep = exceptKey ? hashOf(exceptKey) : undefined;
    for (const [hash, d] of [...this.store]) if (d.personDid === personDid && hash !== keep) this.store.delete(hash);
  }
}
