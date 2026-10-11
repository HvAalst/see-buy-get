import { DEVICE_UNUSED_DAYS, DeviceBook, KnownDevice, MAX_DEVICES_PER_PERSON } from './person-devices';

// One clock for everything asked here: a device lapses by the calendar, and a test that read today's would lapse too.
const T0 = Date.parse('2026-10-11T08:00:00Z');
const DAY = 86_400_000;
const NJERI = 'did:glos:njeri';
const BARAKA = 'did:glos:baraka';

describe('the devices a person’s PIN works on', () => {
  it('hands a device a key that is long and random, once', () => {
    const book = new DeviceBook(new Map());
    const keys = new Set(Array.from({ length: 200 }, () => book.add(NJERI, T0)));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(/^dvc_[0-9a-f]{64}$/);
  });

  it('keeps the HASH of a key and never the key: what is on disk signs nobody in', () => {
    const store = new Map<string, KnownDevice>();
    const book = new DeviceBook(store);
    const key = book.add(NJERI, T0);
    const kept = JSON.stringify([...store]);
    expect(kept).not.toContain(key);
    expect(kept).not.toContain(key.slice(4));
    expect([...store.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...store.values()]).toEqual([{ personDid: NJERI, addedAt: new Date(T0).toISOString() }]);
    // …and the hash as it is kept is not a key: showing it opens nothing.
    expect(book.knows(NJERI, [...store.keys()][0], T0)).toBe(false);
    expect(book.knows(NJERI, key, T0)).toBe(true);
  });

  it('knows a key only as its own person’s: nobody’s, somebody else’s and none are all "no"', () => {
    const book = new DeviceBook(new Map());
    const njeri = book.add(NJERI, T0);
    const baraka = book.add(BARAKA, T0);
    expect(book.knows(NJERI, njeri, T0)).toBe(true);
    expect(book.knows(NJERI, baraka, T0)).toBe(false);
    expect(book.knows(BARAKA, njeri, T0)).toBe(false);
    for (const key of [undefined, '', 'dvc_made-up', njeri.toUpperCase(), njeri.slice(0, -1)]) expect([key, book.knows(NJERI, key, T0)]).toEqual([key, false]);
    // A key with no person asked about — a number nobody has — is "no" too.
    expect(book.knows(undefined, njeri, T0)).toBe(false);
  });

  it('keeps ten to a person: the eleventh puts the OLDEST out, and nobody else’s', () => {
    const book = new DeviceBook(new Map());
    const theirs = book.add(BARAKA, T0);
    const mine = Array.from({ length: MAX_DEVICES_PER_PERSON }, (_, i) => book.add(NJERI, T0 + i * 1000));
    expect(book.count(NJERI, T0 + 60_000)).toBe(MAX_DEVICES_PER_PERSON);
    const eleventh = book.add(NJERI, T0 + 60_000);
    expect(book.count(NJERI, T0 + 60_000)).toBe(MAX_DEVICES_PER_PERSON);
    expect(book.knows(NJERI, mine[0], T0 + 60_000)).toBe(false);
    for (const key of [...mine.slice(1), eleventh]) expect(book.knows(NJERI, key, T0 + 60_000)).toBe(true);
    expect(book.knows(BARAKA, theirs, T0 + 60_000)).toBe(true);
  });

  it('puts out the one used longest ago, not the one confirmed first: the phone in daily use is not the one to lose', () => {
    const book = new DeviceBook(new Map());
    const mine = Array.from({ length: MAX_DEVICES_PER_PERSON }, (_, i) => book.add(NJERI, T0 + i * 1000));
    // The first one confirmed is the one used every day.
    book.used(NJERI, mine[0], T0 + 5 * DAY);
    const eleventh = book.add(NJERI, T0 + 6 * DAY);
    expect(book.knows(NJERI, mine[0], T0 + 6 * DAY)).toBe(true);
    expect(book.knows(NJERI, mine[1], T0 + 6 * DAY)).toBe(false);
    expect(book.knows(NJERI, eleventh, T0 + 6 * DAY)).toBe(true);
  });

  it('forgets every device of one person — but the one that is doing it, where there is one — and nobody else’s', () => {
    const book = new DeviceBook(new Map());
    const [phone, tablet, office] = [book.add(NJERI, T0), book.add(NJERI, T0), book.add(NJERI, T0)];
    const theirs = book.add(BARAKA, T0);
    expect(book.forgetAll(NJERI, tablet)).toBe(2);
    expect([phone, tablet, office].map((key) => book.knows(NJERI, key, T0))).toEqual([false, true, false]);
    // A key that is not this person's keeps nothing of theirs: somebody else's key is no "this one".
    expect(book.forgetAll(NJERI, theirs)).toBe(1);
    expect(book.count(NJERI, T0)).toBe(0);
    expect(book.forgetAll(NJERI)).toBe(0);
    expect(book.knows(BARAKA, theirs, T0)).toBe(true);
  });

  it('forgets ONE device by its key — its owner’s only — and says whether there was one', () => {
    const book = new DeviceBook(new Map());
    const [phone, office] = [book.add(NJERI, T0), book.add(NJERI, T0)];
    const theirs = book.add(BARAKA, T0);
    expect(book.forget(NJERI, theirs)).toBe(false);
    expect(book.forget(BARAKA, office)).toBe(false);
    for (const not of [undefined, '', 'dvc_made-up']) expect(book.forget(NJERI, not)).toBe(false);
    expect(book.forget(NJERI, office)).toBe(true);
    expect(book.forget(NJERI, office)).toBe(false);
    expect([book.knows(NJERI, phone, T0), book.knows(NJERI, office, T0), book.knows(BARAKA, theirs, T0)]).toEqual([true, false, true]);
  });

  describe('a device nobody signs in on', () => {
    it('is forgotten after ninety days without its key being used — and not a day before', () => {
      const store = new Map<string, KnownDevice>();
      const book = new DeviceBook(store);
      const key = book.add(NJERI, T0);
      expect(DEVICE_UNUSED_DAYS).toBe(90);
      expect(book.knows(NJERI, key, T0 + 90 * DAY)).toBe(true);
      expect(book.knows(NJERI, key, T0 + 90 * DAY + 1)).toBe(false);
      // Forgotten, not only refused: the same key is "no" at any time after, and nothing of it is kept.
      expect(store.size).toBe(0);
      expect(book.knows(NJERI, key, T0)).toBe(false);
    });

    it('is counted from the last day it was USED: a phone in use never lapses', () => {
      const book = new DeviceBook(new Map());
      const key = book.add(NJERI, T0);
      for (let day = 60; day <= 600; day += 60) {
        expect([day, book.knows(NJERI, key, T0 + day * DAY)]).toEqual([day, true]);
        book.used(NJERI, key, T0 + day * DAY);
      }
      expect(book.knows(NJERI, key, T0 + 690 * DAY)).toBe(true);
      expect(book.knows(NJERI, key, T0 + 691 * DAY)).toBe(false);
    });

    it('is not counted, not listed and not what an eleventh puts out', () => {
      const book = new DeviceBook(new Map());
      const old = book.add(NJERI, T0);
      const recent = book.add(NJERI, T0 + 80 * DAY);
      const later = T0 + 100 * DAY;
      expect(book.count(NJERI, later)).toBe(1);
      expect(book.list(NJERI, recent, later)).toEqual([{ addedAt: new Date(T0 + 80 * DAY).toISOString(), here: true }]);
      expect(book.whichOf(NJERI, [old, recent], later)).toBe(1);
    });

    it('writes a use once a day at most, and only for the device’s own person', () => {
      const store = new Map<string, KnownDevice>();
      const sets = jest.spyOn(store, 'set');
      const book = new DeviceBook(store);
      const key = book.add(NJERI, T0);
      sets.mockClear();
      book.used(NJERI, key, T0 + 3_600_000);
      book.used(NJERI, key, T0 + 7_200_000);
      book.used(NJERI, key, T0 + 10_800_000);
      expect(sets).toHaveBeenCalledTimes(1);
      book.used(NJERI, key, T0 + DAY);
      expect(sets).toHaveBeenCalledTimes(2);
      // Somebody else's key, no key, a made-up key: nothing is written, and nothing is made known by it.
      book.used(BARAKA, key, T0 + 2 * DAY);
      book.used(NJERI, undefined, T0 + 2 * DAY);
      book.used(NJERI, 'dvc_made-up', T0 + 2 * DAY);
      expect(sets).toHaveBeenCalledTimes(2);
      expect(store.size).toBe(1);
      expect([...store.values()][0]).toEqual({ personDid: NJERI, addedAt: new Date(T0).toISOString(), usedAt: new Date(T0 + DAY).toISOString() });
    });
  });

  describe('as its owner is shown them', () => {
    it('lists dates and which one is asking — the one last used first — and never a key or the hash of one', () => {
      const store = new Map<string, KnownDevice>();
      const book = new DeviceBook(store);
      const phone = book.add(NJERI, T0);
      const office = book.add(NJERI, T0 + DAY);
      const tablet = book.add(NJERI, T0 + 2 * DAY);
      book.add(BARAKA, T0);
      book.used(NJERI, phone, T0 + 9 * DAY);
      const seen = book.list(NJERI, office, T0 + 10 * DAY);
      expect(seen).toEqual([
        { addedAt: new Date(T0).toISOString(), usedAt: new Date(T0 + 9 * DAY).toISOString(), here: false },
        { addedAt: new Date(T0 + 2 * DAY).toISOString(), here: false },
        { addedAt: new Date(T0 + DAY).toISOString(), here: true },
      ]);
      const shown = JSON.stringify(seen);
      for (const secret of [phone, office, tablet, ...store.keys()]) expect(shown).not.toContain(secret.replace(/^dvc_/, ''));
      // Asked from a device that is not one of them — or with somebody else's key — none is "this one".
      expect(book.list(NJERI, undefined, T0 + 10 * DAY).some((d) => d.here)).toBe(false);
      expect(book.list(BARAKA, office, T0 + 10 * DAY)).toEqual([{ addedAt: new Date(T0).toISOString(), here: false }]);
    });

    it('picks this person’s key out of what a browser holds: one per number that ever signed in on it', () => {
      const book = new DeviceBook(new Map());
      const mine = book.add(NJERI, T0);
      const theirs = book.add(BARAKA, T0);
      expect(book.whichOf(NJERI, [theirs, 'dvc_made-up', mine], T0)).toBe(2);
      expect(book.whichOf(BARAKA, [theirs, mine], T0)).toBe(0);
      expect([book.whichOf(NJERI, [theirs], T0), book.whichOf(NJERI, [], T0), book.whichOf(NJERI, undefined, T0)]).toEqual([-1, -1, -1]);
    });
  });
});
