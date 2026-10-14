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
 *
 * A DEVICE DOES NOT STAY KNOWN FOR EVER. One whose key has not come with the right PIN, or with a code, for
 * `DEVICE_UNUSED_DAYS` is forgotten: the phone that was sold, the browser at a job somebody left. And its owner can
 * see how many there are and forget them — all the others, or the one in their hand (`PersonService.devicesOf`).
 */
export interface KnownDevice {
  personDid: string;
  addedAt: string;
  /** When its key last came with the right PIN, or with a code typed on it again. Absent: not since it was confirmed. */
  usedAt?: string;
}

/** The least recently used goes when an eleventh is added: a phone, a tablet, the office computer, and room to replace each twice. */
export const MAX_DEVICES_PER_PERSON = 10;
/** A device nobody has signed in on for this long is one its owner no longer has, more often than not. */
export const DEVICE_UNUSED_DAYS = 90;
const DAY_MS = 86_400_000;

/** A device as its owner is shown it. Never its key, never the hash of it: neither is theirs to read back. */
export interface DeviceSeen {
  addedAt: string;
  usedAt?: string;
  /** The one that is asking. */
  here: boolean;
}

const hashOf = (key: string) => createHash('sha256').update(key).digest('hex');
const lastUse = (d: KnownDevice) => d.usedAt ?? d.addedAt;

export class DeviceBook {
  /** @param store keyed by the hash of a device's key. A service passes the durable store. */
  constructor(private readonly store: Map<string, KnownDevice>) {}

  /** A new key for a device of this person's. Returned ONCE; only its hash is kept. */
  add(personDid: string, now: number = Date.now()): string {
    const key = `dvc_${randomBytes(32).toString('hex')}`;
    const mine = this.mine(personDid, now).sort((a, b) => lastUse(a[1]).localeCompare(lastUse(b[1])));
    for (const [hash] of mine.slice(0, Math.max(0, mine.length - (MAX_DEVICES_PER_PERSON - 1)))) this.store.delete(hash);
    this.store.set(hashOf(key), { personDid, addedAt: new Date(now).toISOString() });
    return key;
  }

  /**
   * Is this the key of a device of THIS person's? Nobody's key, somebody else's key and no key are all "no" — and so
   * is the key of a device that has not been used for `DEVICE_UNUSED_DAYS`, which is forgotten as it is asked about.
   */
  knows(personDid: string | undefined, key: string | undefined, now: number = Date.now()): boolean {
    if (!personDid || !key) return false;
    const hash = hashOf(key);
    const d = this.store.get(hash);
    if (!d || d.personDid !== personDid) return false;
    if (this.lapsed(d, now)) {
      this.store.delete(hash);
      return false;
    }
    return true;
  }

  /**
   * Which of these keys is a device of this person's: its place in the list, or -1. A browser keeps one key per
   * number that signed in on it, and an account does not know its own number — so the browser sends what it has.
   */
  whichOf(personDid: string, keys: string[] | undefined, now: number = Date.now()): number {
    return (keys ?? []).findIndex((key) => this.knows(personDid, key, now));
  }

  /**
   * Its key came with the right PIN, or a code was typed on it again. Written once a day at most: the day is what
   * its owner is shown, and what ninety days are counted from.
   */
  used(personDid: string, key: string | undefined, now: number = Date.now()): void {
    if (!key) return;
    const hash = hashOf(key);
    const d = this.store.get(hash);
    if (!d || d.personDid !== personDid) return;
    const at = new Date(now).toISOString();
    if (d.usedAt?.slice(0, 10) === at.slice(0, 10)) return;
    this.store.set(hash, { ...d, usedAt: at });
  }

  /** How many devices this person's PIN works on. */
  count(personDid: string, now: number = Date.now()): number {
    return this.mine(personDid, now).length;
  }

  /** This person's devices, the one last used first — as dates, and which one is asking. */
  list(personDid: string, hereKey?: string, now: number = Date.now()): DeviceSeen[] {
    const here = hereKey ? hashOf(hereKey) : undefined;
    return this.mine(personDid, now)
      .sort((a, b) => lastUse(b[1]).localeCompare(lastUse(a[1])))
      .map(([hash, d]) => ({ addedAt: d.addedAt, ...(d.usedAt ? { usedAt: d.usedAt } : {}), here: hash === here }));
  }

  /** One device of this person's is forgotten: its key opens nothing from now on. Whether there was one. */
  forget(personDid: string, key: string | undefined): boolean {
    if (!key) return false;
    const hash = hashOf(key);
    if (this.store.get(hash)?.personDid !== personDid) return false;
    this.store.delete(hash);
    return true;
  }

  /**
   * Every device of this person's is forgotten — each has to be confirmed by a code again. `exceptKey` keeps the one
   * that is doing it. How many were forgotten.
   */
  forgetAll(personDid: string, exceptKey?: string): number {
    const keep = exceptKey ? hashOf(exceptKey) : undefined;
    let forgotten = 0;
    for (const [hash, d] of [...this.store]) {
      if (d.personDid !== personDid || hash === keep) continue;
      this.store.delete(hash);
      forgotten += 1;
    }
    return forgotten;
  }

  /** This person's devices that are still known. One that has lapsed is forgotten here, as anywhere it is met. */
  private mine(personDid: string, now: number): Array<[string, KnownDevice]> {
    const still: Array<[string, KnownDevice]> = [];
    for (const [hash, d] of [...this.store]) {
      if (d.personDid !== personDid) continue;
      if (this.lapsed(d, now)) this.store.delete(hash);
      else still.push([hash, d]);
    }
    return still;
  }

  private lapsed(d: KnownDevice, now: number): boolean {
    return now - Date.parse(lastUse(d)) > DEVICE_UNUSED_DAYS * DAY_MS;
  }
}
