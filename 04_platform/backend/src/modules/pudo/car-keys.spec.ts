import { DEVICE_UNUSED_DAYS, DeviceBook, MAX_DEVICES_PER_PERSON, type KnownDevice } from './person-devices';
import { carKeyFromHeader, carKeyHashOf, isCarKey, isFcmToken, newCarKey, tokenPrint, type DeviceCarKey } from './car-keys';

/*
 * 2026-11-02 — THE CAR KEY LIVES ON ITS DEVICE'S RECORD (the owner: "we start with 2" — messages read aloud in the car).
 * So it goes by every path a device goes, with nothing to remember to delete: forgotten, the others forgotten, ninety
 * days unused, the eleventh device pushing out the least used — and it is taken off every device of the person's when
 * the PIN is changed or replaced. Found again only through the device's own record: an index entry left behind opens
 * nothing.
 */
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-02T08:00:00Z');
const car = (driverDid = 'did:drv:amos', over: Partial<DeviceCarKey> = {}): { key: string; car: DeviceCarKey } => {
  const key = newCarKey();
  return { key, car: { keyHash: carKeyHashOf(key), driverDid, addedAt: new Date(T0).toISOString(), lang: 'en', ...over } };
};

describe('a car key, on its device’s own record', () => {
  let store: Map<string, KnownDevice>;
  let book: DeviceBook;
  beforeEach(() => {
    store = new Map();
    book = new DeviceBook(store);
  });

  it('is set on a device the PIN works on, found by its hash, and replaced by the next one turned on there', () => {
    const phone = book.add('did:person:amos', T0);
    const first = car();
    expect(book.setCar('did:person:amos', phone, first.car, T0)).toBe(true);
    expect(book.findCar(first.car.keyHash, T0)).toMatchObject({ personDid: 'did:person:amos', car: { driverDid: 'did:drv:amos' } });
    expect(book.carOf('did:person:amos', phone, T0)?.keyHash).toBe(first.car.keyHash);
    const second = car();
    book.setCar('did:person:amos', phone, second.car, T0);
    expect(book.findCar(first.car.keyHash, T0)).toBeUndefined();
    expect(book.findCar(second.car.keyHash, T0)).toBeDefined();
    // Only the hash is on the record: the key itself is nowhere.
    expect(JSON.stringify([...store.values()])).not.toContain(second.key);
  });

  it('is never set on somebody else’s device, a device nobody knows, or no device', () => {
    const phone = book.add('did:person:amos', T0);
    expect(book.setCar('did:person:grace', phone, car().car, T0)).toBe(false);
    expect(book.setCar('did:person:amos', 'dvc_made-up', car().car, T0)).toBe(false);
    expect([...store.values()].some((d) => d.car)).toBe(false);
  });

  it('goes with its device: forgotten, the others forgotten, or pushed out by an eleventh', () => {
    const phone = book.add('did:person:amos', T0);
    const laptop = book.add('did:person:amos', T0);
    const a = car();
    const b = car();
    book.setCar('did:person:amos', phone, a.car, T0);
    book.setCar('did:person:amos', laptop, b.car, T0);
    book.forget('did:person:amos', phone);
    expect(book.findCar(a.car.keyHash, T0)).toBeUndefined();
    book.forgetAll('did:person:amos', laptop);
    expect(book.findCar(b.car.keyHash, T0)).toBeDefined();
    book.forgetAll('did:person:amos');
    expect(book.findCar(b.car.keyHash, T0)).toBeUndefined();

    const oldest = book.add('did:person:amos', T0);
    const c = car();
    book.setCar('did:person:amos', oldest, c.car, T0);
    for (let i = 0; i < MAX_DEVICES_PER_PERSON; i++) book.add('did:person:amos', T0 + (i + 1) * 1000);
    expect(book.findCar(c.car.keyHash, T0 + 20_000)).toBeUndefined();
  });

  it('goes with a device ninety days unused — and a car calling every day does not keep the device known', () => {
    const phone = book.add('did:person:amos', T0);
    const a = car();
    book.setCar('did:person:amos', phone, a.car, T0);
    for (let day = 1; day <= DEVICE_UNUSED_DAYS; day += 10) {
      expect(book.findCar(a.car.keyHash, T0 + day * DAY)).toBeDefined();
      book.updateCar(a.car.keyHash, (c) => ({ ...c, usedAt: new Date(T0 + day * DAY).toISOString() }), T0 + day * DAY);
    }
    expect(book.findCar(a.car.keyHash, T0 + (DEVICE_UNUSED_DAYS + 1) * DAY)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('turned off: gone from the device, which stays one the PIN works on; every one of a person’s, off every device', () => {
    const phone = book.add('did:person:amos', T0);
    const tablet = book.add('did:person:amos', T0);
    const other = book.add('did:person:grace', T0);
    const a = car();
    book.setCar('did:person:amos', phone, a.car, T0);
    expect(book.dropCar('did:person:grace', phone)).toBeUndefined();
    expect(book.dropCar('did:person:amos', phone)?.keyHash).toBe(a.car.keyHash);
    expect(book.findCar(a.car.keyHash, T0)).toBeUndefined();
    expect(book.knows('did:person:amos', phone, T0)).toBe(true);

    const b = car();
    const c = car();
    const g = car('did:drv:grace');
    book.setCar('did:person:amos', phone, b.car, T0);
    book.setCar('did:person:amos', tablet, c.car, T0);
    book.setCar('did:person:grace', other, g.car, T0);
    expect(book.dropAllCars('did:person:amos')).toBe(2);
    expect(book.findCar(b.car.keyHash, T0)).toBeUndefined();
    expect(book.findCar(c.car.keyHash, T0)).toBeUndefined();
    expect(book.findCar(g.car.keyHash, T0)).toBeDefined();
    expect(book.knows('did:person:amos', tablet, T0)).toBe(true);
  });

  it('a passkey turned off, or a counter session noted, leaves the car key where it is', () => {
    const phone = book.add('did:person:amos', T0);
    const a = car();
    book.setCar('did:person:amos', phone, a.car, T0);
    book.setPasskey('did:person:amos', phone, { id: 'cred', publicKey: 'pk', counter: 0, addedAt: new Date(T0).toISOString() }, T0);
    book.dropPasskey('did:person:amos', phone);
    book.dropAllPasskeys('did:person:amos');
    book.used('did:person:amos', phone, T0 + DAY);
    expect(book.findCar(a.car.keyHash, T0 + DAY)).toBeDefined();
  });

  it('finds a driver’s keys for the wake-up, and keeps the hash whatever a change says', () => {
    const phone = book.add('did:person:amos', T0);
    const a = car('did:drv:amos');
    book.setCar('did:person:amos', phone, a.car, T0);
    expect(book.carsOfDriver('did:drv:amos', T0).map((f) => f.car.keyHash)).toEqual([a.car.keyHash]);
    expect(book.carsOfDriver('did:drv:grace', T0)).toEqual([]);
    book.updateCar(a.car.keyHash, (c) => ({ ...c, keyHash: 'something-else', fcmToken: 'tok' }), T0);
    expect(book.findCar(a.car.keyHash, T0)?.car).toMatchObject({ keyHash: a.car.keyHash, fcmToken: 'tok' });
  });

  it('is found again after a restart: the index is rebuilt from the durable records', () => {
    const phone = book.add('did:person:amos', T0);
    const a = car();
    book.setCar('did:person:amos', phone, a.car, T0);
    expect(new DeviceBook(store).findCar(a.car.keyHash, T0)).toBeDefined();
  });
});

describe('what a car key, and a Firebase token, look like', () => {
  it('a car key: car_ and 64 hex — read only from `Authorization: Car <key>`', () => {
    const key = newCarKey();
    expect(key).toMatch(/^car_[0-9a-f]{64}$/);
    expect(isCarKey(key)).toBe(true);
    expect(carKeyFromHeader(`Car ${key}`)).toBe(key);
    expect(carKeyFromHeader(`car  ${key}`)).toBe(key);
    expect(carKeyFromHeader([`Car ${key}`])).toBe(key);
    for (const header of [undefined, '', `Bearer ${key}`, key, `Car ${key} extra`, `Car dvc_${'a'.repeat(64)}`, `Car ${key.toUpperCase()}`, `Car ${key.slice(0, -1)}`]) {
      expect([header, carKeyFromHeader(header)]).toEqual([header, undefined]);
    }
  });

  it('a Firebase token: letters, digits and -_:. — nothing else is kept; and only a print of it is ever written down', () => {
    const token = `fGx7${'a'.repeat(30)}:APA91b${'Q_-'.repeat(40)}`;
    expect(isFcmToken(token)).toBe(true);
    for (const bad of ['short', 'has spaces in it for sure ok', '<script>alert(1)</script>xxxxxxxx', 'x'.repeat(5000), 42]) expect(isFcmToken(bad)).toBe(false);
    expect(tokenPrint(token)).toMatch(/^[0-9a-f]{16}$/);
    expect(tokenPrint(token)).not.toContain(token.slice(0, 8));
  });
});
