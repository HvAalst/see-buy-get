import { createHash, randomBytes } from 'crypto';
import type { DevicePasskey } from './passkeys';
import type { CarKeyFound, DeviceCarKey } from './car-keys';

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
  /**
   * 2026-11-02 — ITS FINGERPRINT-OR-FACE UNLOCK, where its owner turned one on here (the owner: "if face unlock works,
   * integrate it, but then in settings users should be able to undo it"). Kept ON the device's own record, so that it
   * goes with the device, by every path that forgets one, and there is no second place to forget it from. See passkeys.ts.
   */
  passkey?: DevicePasskey;
  /**
   * 2026-11-02 — A COLLEAGUE OPENED A COUNTER SESSION ON THIS PHONE, last when (the owner: "a 1 person shop could use
   * fingerprint to unlock as you said"). Only ever on a shop's or a hub's own phone. From then on its fingerprint-or-face
   * unlock is refused there: whoever can unlock a phone colleagues use could sign in as the shop.
   */
  counterAt?: string;
  /**
   * 2026-11-02 — ITS CAR KEY, where its driver turned "Messages in the car" on here (the owner: "we start with 2" — the
   * driver's chats read aloud in the car). Kept ON the device's own record, as the passkey is, so it goes with the device
   * by every path that forgets one. Only the key's hash. See car-keys.ts.
   */
  car?: DeviceCarKey;
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
  /**
   * 2026-11-02 — WHICH DEVICE EACH CAR KEY LIVES ON: a car key's hash → its device's hash. An index, rebuilt from the
   * durable store and kept in step as keys are set; never the truth. Every answer read through it is checked against
   * the device's own record, so a device forgotten by any path — or an index entry gone stale — finds nothing.
   */
  private readonly carIndex = new Map<string, string>();

  /** @param store keyed by the hash of a device's key. A service passes the durable store. */
  constructor(private readonly store: Map<string, KnownDevice>) {
    for (const [hash, d] of store) if (d.car) this.carIndex.set(d.car.keyHash, hash);
  }

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

  /* ---------------------------------------------- 2026-11-02: unlock with fingerprint or face, per device -- */

  /** This device's passkey, where it is a device of this person's (still known) and one was turned on here. */
  passkeyOf(personDid: string | undefined, key: string | undefined, now: number = Date.now()): DevicePasskey | undefined {
    if (!this.knows(personDid, key, now)) return undefined;
    return this.store.get(hashOf(key as string))?.passkey;
  }

  /**
   * Turn it on here: replaces any passkey this device had. False when this is not a known device of this person's — or
   * a phone colleagues have opened counter sessions on (`counterAt`), where it is never kept.
   */
  setPasskey(personDid: string, key: string, passkey: DevicePasskey, now: number = Date.now()): boolean {
    if (!this.knows(personDid, key, now)) return false;
    const hash = hashOf(key);
    if (this.store.get(hash)?.counterAt) return false;
    this.store.set(hash, { ...(this.store.get(hash) as KnownDevice), passkey });
    return true;
  }

  /** Turn it off here: the device stays one the PIN works on. The passkey it had, or undefined when it had none. */
  dropPasskey(personDid: string, key: string | undefined): DevicePasskey | undefined {
    if (!key) return undefined;
    const hash = hashOf(key);
    const d = this.store.get(hash);
    if (!d || d.personDid !== personDid || !d.passkey) return undefined;
    const { passkey, ...rest } = d;
    this.store.set(hash, rest);
    return passkey;
  }

  /**
   * 2026-11-02 — A COLLEAGUE OPENED A COUNTER SESSION ON THIS PHONE, one of the owner's own: noted, and any passkey on it
   * taken off at once. What there was to say (when the phone was confirmed, and whether a passkey went), or undefined
   * where the key is not one of this owner's phones.
   */
  noteCounter(owner: string, key: string, now: number = Date.now()): { addedAt: string; dropped?: DevicePasskey } | undefined {
    if (!this.knows(owner, key, now)) return undefined;
    const hash = hashOf(key);
    const { passkey, ...rest } = this.store.get(hash) as KnownDevice;
    this.store.set(hash, { ...rest, counterAt: new Date(now).toISOString() });
    return { addedAt: rest.addedAt, ...(passkey ? { dropped: passkey } : {}) };
  }

  /** When a colleague last opened a counter session on this phone of the owner's, if ever. */
  counterAtOf(owner: string, key: string | undefined, now: number = Date.now()): string | undefined {
    if (!this.knows(owner, key, now)) return undefined;
    return this.store.get(hashOf(key as string))?.counterAt;
  }

  /**
   * Every passkey of this owner's off every device — the PIN or the password was changed or replaced. The devices stay
   * ones it works on. How many there were.
   */
  dropAllPasskeys(owner: string): number {
    let dropped = 0;
    for (const [hash, d] of [...this.store]) {
      if (d.personDid !== owner || !d.passkey) continue;
      const { passkey: _gone, ...rest } = d;
      this.store.set(hash, rest);
      dropped += 1;
    }
    return dropped;
  }

  /** It unlocked: the phone's counter as it now stands, and the day (written once a day at most, like `used`). */
  passkeyUsed(personDid: string, key: string, counter: number, now: number = Date.now()): void {
    const hash = hashOf(key);
    const d = this.store.get(hash);
    if (!d || d.personDid !== personDid || !d.passkey) return;
    const at = new Date(now).toISOString();
    if (d.passkey.counter === counter && d.passkey.usedAt?.slice(0, 10) === at.slice(0, 10)) return;
    this.store.set(hash, { ...d, passkey: { ...d.passkey, counter, usedAt: at } });
  }

  /* -------------------------------------------------- 2026-11-02: messages in the car, per device -- */

  /** This device's car key, where it is a device of this person's (still known) and one was turned on here. */
  carOf(personDid: string | undefined, key: string | undefined, now: number = Date.now()): DeviceCarKey | undefined {
    if (!this.knows(personDid, key, now)) return undefined;
    return this.store.get(hashOf(key as string))?.car;
  }

  /** Turn it on here: replaces any car key this device had, which opens nothing from then on. False when this is not a known device of this person's. */
  setCar(personDid: string, key: string, car: DeviceCarKey, now: number = Date.now()): boolean {
    if (!this.knows(personDid, key, now)) return false;
    const hash = hashOf(key);
    const d = this.store.get(hash) as KnownDevice;
    if (d.car) this.carIndex.delete(d.car.keyHash);
    this.store.set(hash, { ...d, car });
    this.carIndex.set(car.keyHash, hash);
    return true;
  }

  /** Turn it off here: the device stays one the PIN works on. The car key it had, or undefined when it had none. */
  dropCar(personDid: string, key: string | undefined): DeviceCarKey | undefined {
    if (!key) return undefined;
    const hash = hashOf(key);
    const d = this.store.get(hash);
    if (!d || d.personDid !== personDid || !d.car) return undefined;
    const { car, ...rest } = d;
    this.store.set(hash, rest);
    this.carIndex.delete(car.keyHash);
    return car;
  }

  /** Every car key of this person's off every device — the PIN was changed or replaced. The devices stay. How many there were. */
  dropAllCars(personDid: string): number {
    let dropped = 0;
    for (const [hash, d] of [...this.store]) {
      if (d.personDid !== personDid || !d.car) continue;
      const { car, ...rest } = d;
      this.store.set(hash, rest);
      this.carIndex.delete(car.keyHash);
      dropped += 1;
    }
    return dropped;
  }

  /**
   * THE CAR KEY WHOSE HASH THIS IS — read on its device's own record, which must still be there and still say so. A device
   * unused for ninety days is forgotten as it is met here, its car key with it. A car door does NOT keep a device known:
   * only its PIN, or a code typed on it, does — a phone in a drawer that only the car still talks to goes in ninety days.
   */
  findCar(keyHash: string, now: number = Date.now()): CarKeyFound | undefined {
    const deviceHash = this.carIndex.get(keyHash);
    if (!deviceHash) return undefined;
    const d = this.store.get(deviceHash);
    if (!d?.car || d.car.keyHash !== keyHash) {
      // Forgotten by another path, or replaced: the index catches up here.
      this.carIndex.delete(keyHash);
      return undefined;
    }
    if (this.lapsed(d, now)) {
      this.store.delete(deviceHash);
      this.carIndex.delete(keyHash);
      return undefined;
    }
    return { personDid: d.personDid, deviceHash, car: d.car };
  }

  /** Change a car key in place — its Firebase token, its language, its day of use. False when it is no longer there. */
  updateCar(keyHash: string, change: (car: DeviceCarKey) => DeviceCarKey, now: number = Date.now()): boolean {
    const found = this.findCar(keyHash, now);
    if (!found) return false;
    const d = this.store.get(found.deviceHash) as KnownDevice;
    this.store.set(found.deviceHash, { ...d, car: { ...change(found.car), keyHash: found.car.keyHash } });
    return true;
  }

  /** Every car key of one driver record's, on devices still known — the phones a message to that driver wakes. */
  carsOfDriver(driverDid: string, now: number = Date.now()): CarKeyFound[] {
    const found: CarKeyFound[] = [];
    for (const keyHash of [...this.carIndex.keys()]) {
      const car = this.findCar(keyHash, now);
      if (car && car.car.driverDid === driverDid) found.push(car);
    }
    return found;
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
