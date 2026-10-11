import { DeviceBook, KnownDevice, MAX_DEVICES_PER_PERSON } from './person-devices';

const T0 = Date.parse('2026-10-11T08:00:00Z');

describe('the devices a person’s PIN works on', () => {
  it('hands a device a key that is long and random, once', () => {
    const book = new DeviceBook(new Map());
    const keys = new Set(Array.from({ length: 200 }, () => book.add('did:glos:njeri')));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(/^dvc_[0-9a-f]{64}$/);
  });

  it('keeps the HASH of a key and never the key: what is on disk signs nobody in', () => {
    const store = new Map<string, KnownDevice>();
    const book = new DeviceBook(store);
    const key = book.add('did:glos:njeri', T0);
    const kept = JSON.stringify([...store]);
    expect(kept).not.toContain(key);
    expect(kept).not.toContain(key.slice(4));
    expect([...store.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...store.values()]).toEqual([{ personDid: 'did:glos:njeri', addedAt: new Date(T0).toISOString() }]);
    // …and the hash as it is kept is not a key: showing it opens nothing.
    expect(book.knows('did:glos:njeri', [...store.keys()][0])).toBe(false);
    expect(book.knows('did:glos:njeri', key)).toBe(true);
  });

  it('knows a key only as its own person’s: nobody’s, somebody else’s and none are all "no"', () => {
    const book = new DeviceBook(new Map());
    const njeri = book.add('did:glos:njeri');
    const baraka = book.add('did:glos:baraka');
    expect(book.knows('did:glos:njeri', njeri)).toBe(true);
    expect(book.knows('did:glos:njeri', baraka)).toBe(false);
    expect(book.knows('did:glos:baraka', njeri)).toBe(false);
    for (const key of [undefined, '', 'dvc_made-up', njeri.toUpperCase(), njeri.slice(0, -1)]) expect([key, book.knows('did:glos:njeri', key)]).toEqual([key, false]);
    // A key with no person asked about — a number nobody has — is "no" too.
    expect(book.knows(undefined, njeri)).toBe(false);
  });

  it('keeps ten to a person: the eleventh puts the OLDEST out, and nobody else’s', () => {
    const book = new DeviceBook(new Map());
    const theirs = book.add('did:glos:baraka', T0);
    const mine = Array.from({ length: MAX_DEVICES_PER_PERSON }, (_, i) => book.add('did:glos:njeri', T0 + i * 1000));
    expect(book.count('did:glos:njeri')).toBe(MAX_DEVICES_PER_PERSON);
    const eleventh = book.add('did:glos:njeri', T0 + 60_000);
    expect(book.count('did:glos:njeri')).toBe(MAX_DEVICES_PER_PERSON);
    expect(book.knows('did:glos:njeri', mine[0])).toBe(false);
    for (const key of [...mine.slice(1), eleventh]) expect(book.knows('did:glos:njeri', key)).toBe(true);
    expect(book.knows('did:glos:baraka', theirs)).toBe(true);
  });

  it('forgets every device of one person — but the one that is doing it, where there is one — and nobody else’s', () => {
    const book = new DeviceBook(new Map());
    const [phone, tablet, office] = [book.add('did:glos:njeri'), book.add('did:glos:njeri'), book.add('did:glos:njeri')];
    const theirs = book.add('did:glos:baraka');
    book.forgetAll('did:glos:njeri', tablet);
    expect([phone, tablet, office].map((key) => book.knows('did:glos:njeri', key))).toEqual([false, true, false]);
    book.forgetAll('did:glos:njeri');
    expect(book.count('did:glos:njeri')).toBe(0);
    expect(book.knows('did:glos:baraka', theirs)).toBe(true);
  });
});
