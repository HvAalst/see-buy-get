import type { Freight } from './dispatch.types';
import { keyOf, LoadSealService, sealCheck } from './load-seal.service';
import type { MediaService } from './media.service';

const shipper = 'did:glos:biz-jenga';
const driver = 'did:glos:driver-otieno';
const other = 'did:glos:driver-kamau';
const t0 = Date.parse('2026-10-19T06:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** Photographs on record, by owner; what was attached to the load. */
function mediaStub() {
  const owners = new Map<string, string>();
  const adopted: Array<{ id: string; kind: string }> = [];
  let n = 0;
  const media = {
    get: (id: string) => (owners.has(id) ? { mediaId: id, ownerDid: owners.get(id), status: 'active' } : undefined),
    adopt: (id: string, owner: string, _link: unknown, kind: string) => {
      if (owners.get(id) !== owner) return false;
      adopted.push({ id, kind });
      return true;
    },
  } as unknown as MediaService;
  const photo = (owner: string) => {
    n += 1;
    const id = `med_${n}`;
    owners.set(id, owner);
    return id;
  };
  return { media, photo, adopted };
}

const load = (over: Partial<Freight> = {}): Freight => ({ freightId: 'frt_1', code: 'FRT-1', status: 'claimed', claimedBy: driver, postedByDid: shipper, ...over }) as unknown as Freight;
const three = (photo: (o: string) => string) => ({ loadedOpen: photo(shipper), closedWithSeal: photo(shipper), sealCloseUp: photo(shipper) });

describe('a seal on a load (round 15)', () => {
  it('the shipper writes it before pickup, with its ISO 17712 class and the three photographs — each its own', () => {
    const { media, photo, adopted } = mediaStub();
    const svc = new LoadSealService(media);
    const f = load();
    const writer = { did: shipper, name: 'Wanjiku' };
    const good = { number: 'KE 1234-567', sealClass: 'H' as const, maker: 'Leghorn', appliedBy: 'sender' as const, photos: three(photo) };
    expect(() => svc.write(load({ status: 'in_transit' }), writer, good, t0)).toThrow(/taken over/);
    expect(() => svc.write(f, writer, { ...good, number: '  ' }, t0)).toThrow(/number as it is printed/);
    expect(() => svc.write(f, writer, { ...good, sealClass: 'X' as never }, t0)).toThrow(/I, S or H/);
    expect(() => svc.write(f, writer, { ...good, photos: { ...good.photos, sealCloseUp: undefined as never } }, t0)).toThrow(/close up/);
    expect(() => svc.write(f, writer, { ...good, photos: { ...good.photos, loadedOpen: photo(driver) } }, t0)).toThrow(/not one of yours/);
    expect(svc.of(f.freightId)).toHaveLength(0);
    expect(adopted).toHaveLength(0);

    const seal = svc.write(f, writer, good, t0);
    expect(seal).toMatchObject({ number: 'KE 1234-567', key: 'KE1234567', sealClass: 'H', maker: 'Leghorn', appliedBy: 'sender', state: 'on', writtenBy: 'Wanjiku' });
    expect(adopted.map((a) => a.kind)).toEqual(['seal', 'seal', 'seal']);
    // The same seal twice, however it is spaced.
    expect(() => svc.write(f, writer, { ...good, number: 'ke1234567', photos: three(photo) }, t0)).toThrow(/on this load already/);
    // The driver's app: which seal to find and what it is — never its number; a fingerprint to check a reading against.
    const [find] = svc.toFind(f.freightId);
    expect(find).toEqual({ sealId: seal.sealId, no: 1, sealClass: 'H', maker: 'Leghorn', appliedBy: 'sender', state: 'on', check: sealCheck(f.freightId, 'KE1234567') });
    expect(JSON.stringify(find)).not.toContain('1234');
    // The fingerprint the phone checks a reading against — the same value the driver app's own test pins (shared/seals).
    expect(sealCheck('frt_1', 'KE1234567')).toBe('41f5b3d6143aa2cf96c45494677275519c5a9341b92e5e63ecc2bf9dd822af5c');
    // Taken off again before pickup; not after.
    svc.remove(f, seal.sealId);
    expect(svc.of(f.freightId)).toHaveLength(0);
    const again = svc.write(f, writer, { ...good, photos: three(photo) }, t0);
    expect(() => svc.remove(load({ status: 'in_transit' }), again.sealId)).toThrow(/stay on the record/);
  });

  it('at pickup every seal is read off the door: a number that is not the one written and the load does not leave', () => {
    const { media, photo, adopted } = mediaStub();
    const svc = new LoadSealService(media);
    const f = load();
    expect(svc.checkAtPickup(f, driver, undefined)).toBeInstanceOf(Function); // nothing sealed: nothing to read
    const seal = svc.write(f, { did: shipper, name: 'Wanjiku' }, { number: 'KE1234567', sealClass: 'H', appliedBy: 'sender', photos: three(photo) }, t0);
    adopted.length = 0;
    expect(() => svc.checkAtPickup(f, driver, [])).toThrow(/Read seal 1 off the door/);
    expect(() => svc.checkAtPickup(f, driver, [{ sealId: seal.sealId, number: 'KE1234568', photoRef: photo(driver) }])).toThrow(/not the one the shipper wrote/);
    expect(() => svc.checkAtPickup(f, driver, [{ sealId: seal.sealId, number: 'KE1234567', photoRef: photo(other) }])).toThrow(/not one of yours/);
    expect(svc.of(f.freightId)[0].readings).toEqual([]);
    expect(adopted).toHaveLength(0);
    // Read as a person reads it — spaces, dashes, small letters — it is the same seal.
    const close = photo(driver);
    const keep = svc.checkAtPickup(f, driver, [{ sealId: seal.sealId, number: 'ke 123-4567', photoRef: close }]);
    keep(iso(t0 + 3_600_000));
    expect(svc.of(f.freightId)[0].readings).toEqual([{ at: iso(t0 + 3_600_000), stage: 'pickup', result: 'matched', photoRef: close, by: driver }]);
    expect(svc.views(f.freightId)[0]).toMatchObject({ matchedAt: iso(t0 + 3_600_000) });
    expect(keyOf('ke 123-4567')).toBe('KE1234567');
  });

  it('at a post, cleared asks what became of the seals: as they were, or which customs replaced — the new number, its photograph, the officer', () => {
    const { media, photo } = mediaStub();
    const svc = new LoadSealService(media);
    const f = load({ status: 'in_transit' });
    expect(svc.checkAtPost(f, driver, undefined)).toBeUndefined(); // nothing sealed: nothing to ask
    const a = svc.write(load(), { did: shipper, name: 'Wanjiku' }, { number: 'KE1234567', sealClass: 'H', appliedBy: 'sender', photos: three(photo) }, t0);
    const b = svc.write(load(), { did: shipper, name: 'Wanjiku' }, { number: 'KE7654321', sealClass: 'H', appliedBy: 'sender', photos: three(photo) }, t0);
    expect(() => svc.checkAtPost(f, driver, {})).toThrow(/as they were/);
    expect(() => svc.checkAtPost(f, driver, { asTheyWere: true, replaced: [{ sealId: a.sealId, newNumber: 'UG1', photoRef: photo(driver) }] })).toThrow(/not both/);
    expect(() => svc.checkAtPost(f, driver, { replaced: [{ sealId: 'seal_nope', newNumber: 'UG1', photoRef: photo(driver) }] })).toThrow(/not on this load/);
    expect(() => svc.checkAtPost(f, driver, { replaced: [{ sealId: a.sealId, newNumber: 'KE 765 4321', photoRef: photo(driver) }] })).toThrow(/on this load already/);
    expect(svc.checkAtPost(f, driver, { asTheyWere: true })!.says).toEqual({ asTheyWere: true });

    const atPost = svc.checkAtPost(f, driver, { replaced: [{ sealId: a.sealId, newNumber: 'UG 990011', photoRef: photo(driver), officer: ' J. Okello, badge 4471 ' }] })!;
    expect(atPost.says).toEqual({ resealed: [{ from: 'KE1234567', to: 'UG 990011', officer: 'J. Okello, badge 4471' }] });
    expect(svc.of(f.freightId).every((s) => s.state === 'on')).toBe(true); // nothing kept until the step is
    atPost.keep(iso(t0 + 9 * 3_600_000), 'Malaba');
    const views = svc.views(f.freightId);
    expect(views.map((v) => [v.number, v.state])).toEqual([
      ['KE1234567', 'replaced'],
      ['KE7654321', 'on'],
      ['UG 990011', 'on'],
    ]);
    expect(views[0].replaced).toEqual({ at: iso(t0 + 9 * 3_600_000), post: 'Malaba', officer: 'J. Okello, badge 4471', by: 'UG 990011' });
    expect(views[2]).toMatchObject({ appliedBy: 'customs', replaces: 'KE1234567' });
    expect(svc.on(f.freightId).map((s) => s.number)).toEqual(['KE7654321', 'UG 990011']);
    expect(b.state).toBe('on');
  });

  it('a seal found broken on the road is reported by the driver carrying the load, with photographs — and said on the note', () => {
    const { media, photo } = mediaStub();
    const svc = new LoadSealService(media);
    const seal = svc.write(load(), { did: shipper, name: 'Wanjiku' }, { number: 'KE1234567', sealClass: 'H', maker: 'Leghorn', appliedBy: 'sender', photos: three(photo) }, t0);
    const onRoad = load({ status: 'in_transit', pickedUpAt: iso(t0) });
    const report = { cause: 'police' as const, note: 'Opened at a roadblock near Bungoma', photoRefs: [photo(driver)], paperRef: photo(driver) };
    expect(() => svc.reportBroken(onRoad, other, seal.sealId, report, t0 + 7_200_000)).toThrow(/another driver/);
    expect(() => svc.reportBroken(load({ status: 'claimed' }), driver, seal.sealId, report, t0)).toThrow(/while the load is on the road/);
    expect(() => svc.reportBroken(onRoad, driver, seal.sealId, { ...report, photoRefs: [] }, t0 + 7_200_000)).toThrow(/Photograph the broken seal/);
    expect(() => svc.reportBroken(onRoad, driver, seal.sealId, { ...report, paperRef: photo(other) }, t0 + 7_200_000)).toThrow(/official paper/);
    expect(svc.of(onRoad.freightId)[0].state).toBe('on');
    const broken = svc.reportBroken(onRoad, driver, seal.sealId, report, t0 + 7_200_000);
    expect(broken).toMatchObject({ state: 'broken', broken: { cause: 'police', note: 'Opened at a roadblock near Bungoma', by: driver } });
    expect(() => svc.reportBroken(onRoad, driver, seal.sealId, report, t0 + 7_300_000)).toThrow(/broken already/);
    expect(svc.views(onRoad.freightId)[0]).toMatchObject({ state: 'broken', broken: { cause: 'police' } });
    expect(JSON.stringify(svc.views(onRoad.freightId))).not.toContain(driver);
    expect(svc.noteLines(onRoad.freightId)[0]).toMatch(/Seal 1: KE1234567 · ISO 17712 class H · Leghorn · the sender’s seal — written by Wanjiku.*FOUND BROKEN on the road.*broken by the police.*the official paper is photographed/);
    expect(svc.noteObservations(onRoad.freightId)).toEqual([expect.stringMatching(/^Seal 1 \(KE1234567\) found broken on the road/)]);
    expect(svc.photosOf(onRoad.freightId)).toHaveLength(5);
  });

  it('at delivery the receiver looks at the seals with the driver; one not as written is the carrier’s observation', () => {
    const { media, photo } = mediaStub();
    const svc = new LoadSealService(media);
    expect(svc.checkAtDelivery(load({ status: 'in_transit' }), driver, undefined)).toBeUndefined();
    svc.write(load(), { did: shipper, name: 'Wanjiku' }, { number: 'KE1234567', sealClass: 'S', appliedBy: 'customs', photos: three(photo) }, t0);
    const f = load({ status: 'in_transit' });
    expect(() => svc.checkAtDelivery(f, driver, undefined)).toThrow(/Look at the seals with the receiver/);
    svc.checkAtDelivery(f, driver, 'not_as_on_the_note')!(iso(t0 + 20 * 3_600_000));
    expect(svc.views(f.freightId)[0].atDelivery).toEqual({ at: iso(t0 + 20 * 3_600_000), result: 'not_as_on_the_note' });
    expect(svc.noteObservations(f.freightId)).toEqual([expect.stringMatching(/not as on this note at delivery/)]);
    expect(svc.noteLines(f.freightId)[0]).toMatch(/customs seal/);
  });
});
