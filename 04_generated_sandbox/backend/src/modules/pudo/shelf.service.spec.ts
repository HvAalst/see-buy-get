import type { AgentService } from './agent.service';
import { ShelfService } from './shelf.service';
import type { ShelfConfig } from './pudo.types';

/**
 * THE CHAOS SHELF: a parcel goes wherever there is room, and the app remembers where.
 *
 * Two things here could not be seen by the tests that existed, because each of them needs something those
 * tests never did: a server that RESTARTS, and a shop that CHANGES its shelf while parcels are standing on it.
 */
describe('the chaos shelf', () => {
  const SHOP = 'did:glos:shelf-shop';

  /** A shop whose shelf is whatever was last set — the one thing the shelf reads from the shop's record. */
  const shopWith = (start: ShelfConfig) => {
    let shelf = start;
    const agents = {
      get: () => ({ did: SHOP, shelf }),
      setShelf: (_did: string, next: ShelfConfig) => {
        shelf = next;
        return { did: SHOP, shelf };
      },
    } as unknown as AgentService;
    return { agents, shelfNow: () => shelf };
  };

  describe('a slot for each parcel', () => {
    it('gives each parcel a slot of its own, says how many are left, and gives a slot back when its parcel goes', () => {
      const shelf = new ShelfService(shopWith({ rows: 3, cols: 2 }).agents);
      expect(shelf.available(SHOP)).toBe(6);
      expect(shelf.assign(SHOP, 'P-1', 'M')).toBe('Red-1');
      expect(shelf.assign(SHOP, 'P-2', 'M')).toBe('Red-2');
      expect(shelf.available(SHOP)).toBe(4);
      expect(shelf.grid(SHOP).filter((s) => s.occupiedBy).map((s) => `${s.label}=${s.occupiedBy}`)).toEqual(['Red-1=P-1', 'Red-2=P-2']);

      shelf.release(SHOP, 'P-1');
      expect(shelf.available(SHOP)).toBe(5);
      // The slot that came free is the next one given: nothing is left standing empty behind a full shelf.
      expect(shelf.assign(SHOP, 'P-3', 'M')).toBe('Red-1');
      // A parcel that is not on this shelf frees nothing.
      shelf.release(SHOP, 'P-NOBODY');
      expect(shelf.available(SHOP)).toBe(4);
    });

    it('refuses a parcel when every slot is taken, rather than doubling one up', () => {
      const shelf = new ShelfService(shopWith({ rows: 1, cols: 2 }).agents);
      shelf.assign(SHOP, 'P-1', 'M');
      shelf.assign(SHOP, 'P-2', 'M');
      // …and says what the shopkeeper can do about it.
      expect(() => shelf.assign(SHOP, 'P-3', 'M')).toThrow('The shelf here is full. Hand over a parcel that is waiting, or add a row under “Set up shelves”, then scan this one again');
      expect(shelf.hasSpace(SHOP)).toBe(false);
    });

    it('pools small parcels in a slot marked for them, and one leaving does not take the others with it', () => {
      const shelf = new ShelfService(shopWith({ rows: 3, cols: 2, consolidationSlots: ['Red-1'] }).agents);
      expect([shelf.assign(SHOP, 'L-1', 'S'), shelf.assign(SHOP, 'L-2', 'S'), shelf.assign(SHOP, 'L-3', 'S')]).toEqual(['Red-1', 'Red-1', 'Red-1']);
      // A larger parcel never goes in with the letters.
      expect(shelf.assign(SHOP, 'BOX', 'M')).toBe('Red-2');
      shelf.release(SHOP, 'L-2');
      expect(shelf.grid(SHOP).find((s) => s.label === 'Red-1')?.items).toEqual(['L-1', 'L-3']);
    });

    it('a slot for small parcels holds twelve of them, and the thirteenth takes a slot of its own', () => {
      const shelf = new ShelfService(shopWith({ rows: 3, cols: 2, consolidationSlots: ['Red-1'] }).agents);
      const given = Array.from({ length: 13 }, (_, i) => shelf.assign(SHOP, `L-${i + 1}`, 'S'));
      expect(given.slice(0, 12)).toEqual(Array(12).fill('Red-1'));
      expect(given[12]).toBe('Red-2');
      expect(shelf.grid(SHOP).find((s) => s.label === 'Red-1')?.items).toHaveLength(12);
    });

    it('says beforehand whether a whole bag would fit: small ones pooled, everything else a slot each', () => {
      // Five slots of one, and one kept for letters.
      const shelf = new ShelfService(shopWith({ rows: 3, cols: 2, consolidationSlots: ['Red-1'] }).agents);
      expect(shelf.fits(SHOP, ['M', 'M', 'M', 'M', 'M'])).toBe(true);
      expect(shelf.fits(SHOP, ['M', 'M', 'M', 'M', 'M', 'M'])).toBe(false); // a sixth box cannot go in with the letters
      expect(shelf.fits(SHOP, ['M', 'M', 'M', 'M', 'M', 'S', 'S', 'S'])).toBe(true); // …but letters can
      shelf.assign(SHOP, 'BOX-1', 'M');
      shelf.assign(SHOP, 'BOX-2', 'M');
      expect(shelf.fits(SHOP, ['M', 'M', 'M'])).toBe(true);
      expect(shelf.fits(SHOP, ['M', 'M', 'M', 'M'])).toBe(false);
      // Asking changes nothing.
      expect(shelf.available(SHOP)).toBe(4);
      expect(shelf.assign(SHOP, 'BOX-3', 'M')).toBe('Orange-1'); // Red-1 is the letters' slot; Red-2 and Red-3 hold the two boxes

      // With no slot for letters, a letter needs a slot like anything else; and nothing always fits.
      const plain = new ShelfService(shopWith({ rows: 1, cols: 2 }).agents);
      expect(plain.fits(SHOP, ['S', 'S'])).toBe(true);
      expect(plain.fits(SHOP, ['S', 'S', 'S'])).toBe(false);
      expect(plain.fits(SHOP, [])).toBe(true);
      // Letters past what their slot still holds spill onto ordinary slots, as `assign` would put them.
      const tight = new ShelfService(shopWith({ rows: 1, cols: 2, consolidationSlots: ['Red-1'] }).agents);
      for (let i = 0; i < 11; i += 1) tight.assign(SHOP, `L-${i}`, 'S');
      expect(tight.fits(SHOP, ['S', 'S'])).toBe(true); // one more in the letters' slot, one in Orange-1
      expect(tight.fits(SHOP, ['S', 'S', 'S'])).toBe(false);
    });
  });

  describe('a shop changes the shape of its shelf', () => {
    it('may not take away a slot a parcel is standing in — and is told which slot, and which parcel', () => {
      const shop = shopWith({ rows: 3, cols: 3 });
      const shelf = new ShelfService(shop.agents);
      for (let i = 1; i <= 7; i += 1) shelf.assign(SHOP, `P-${i}`, 'M'); // Red-1..3, Orange-1..3, Amber-1
      expect(() => shelf.reconfigure(SHOP, { rows: 3, cols: 2 })).toThrow('Amber-1 holds P-7. Hand it over first, or keep the shelf large enough for that slot');
      expect(() => shelf.reconfigure(SHOP, { rows: 2, cols: 3 })).toThrow('Red-3 holds P-3; Orange-3 holds P-6. Hand those over first, or keep the shelf large enough for those slots');
      // Refused, so nothing moved: the shelf is the shape it was and every parcel is where it was.
      expect(shop.shelfNow()).toEqual({ rows: 3, cols: 3 });
      expect(shelf.grid(SHOP).filter((s) => s.occupiedBy)).toHaveLength(7);

      // Once the parcel in the third column has gone, the column can go too.
      shelf.release(SHOP, 'P-7');
      expect(shelf.reconfigure(SHOP, { rows: 3, cols: 2 }).shelf).toEqual({ rows: 3, cols: 2 });
      expect(shelf.available(SHOP)).toBe(0);
      // …and growing never strands anything.
      expect(shelf.reconfigure(SHOP, { rows: 4, cols: 4 }).shelf).toEqual({ rows: 4, cols: 4 });
      expect(shelf.available(SHOP)).toBe(10);
    });

    it('may not un-mark a slot that still holds several small parcels: all but the first would drop out of sight', () => {
      const shop = shopWith({ rows: 3, cols: 2, consolidationSlots: ['Red-1'] });
      const shelf = new ShelfService(shop.agents);
      shelf.assign(SHOP, 'L-1', 'S');
      shelf.assign(SHOP, 'L-2', 'S');
      expect(() => shelf.reconfigure(SHOP, { rows: 3, cols: 2 })).toThrow('Red-1 holds 2 parcels. It stays a slot for several small parcels until they are collected');
      expect(shop.shelfNow().consolidationSlots).toEqual(['Red-1']);
      // With one left in it, it is an ordinary slot holding an ordinary parcel.
      shelf.release(SHOP, 'L-2');
      expect(shelf.reconfigure(SHOP, { rows: 3, cols: 2 }).shelf).toEqual({ rows: 3, cols: 2 });
      expect(shelf.grid(SHOP).find((s) => s.label === 'Red-1')).toMatchObject({ occupiedBy: 'L-1' });
    });

    it('keeps the limits a shop was approved under, on this way of changing it too', () => {
      const shop = shopWith({ rows: 3, cols: 3 });
      const shelf = new ShelfService(shop.agents);
      expect(() => shelf.reconfigure(SHOP, { rows: 0, cols: 3 })).toThrow('Shelf needs at least one row and column');
      // Fewer than a shop needs to be a shop at all.
      expect(() => shelf.reconfigure(SHOP, { rows: 1, cols: 5 })).toThrow('A shop keeps at least 6 slots (rows × columns)');
      // A column is a colour; an eleventh would be a second "Red", and two slots would answer to one name.
      expect(() => shelf.reconfigure(SHOP, { rows: 2, cols: 11 })).toThrow('A shelf has at most 10 columns: each column is a colour, and there are 10');
      expect(() => shelf.reconfigure(SHOP, { rows: 3, cols: 2, consolidationSlots: ['Blue-9'] })).toThrow('Blue-9 is not a slot of a 3 × 2 shelf');
      expect(shop.shelfNow()).toEqual({ rows: 3, cols: 3 });
      // What is kept is what was meant: whole numbers, and each bundle slot once.
      expect(shelf.reconfigure(SHOP, { rows: 3.9, cols: 2, consolidationSlots: [' Red-1 ', 'Red-1', ''] }).shelf).toEqual({ rows: 3, cols: 2, consolidationSlots: ['Red-1'] });
      // The labels of the largest shelf there can be are all different.
      shelf.reconfigure(SHOP, { rows: 4, cols: 10 });
      const labels = shelf.grid(SHOP).map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
    });
  });

  /**
   * THE DEFECT ITSELF. What stood on each shelf was kept in memory only, so after any restart every shelf read
   * as empty. Persistence is off under Jest by design, so the guard is lifted and the data directory pointed at
   * a temp folder for this test alone; the module is loaded fresh so it reads that directory.
   */
  describe('after a restart', () => {
    const origWorker = process.env.JEST_WORKER_ID;
    const origDir = process.env.GLOS_DATA_DIR;
    let dir: string;

    beforeEach(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { mkdtempSync } = require('fs') as typeof import('fs');
      const { tmpdir } = require('os') as typeof import('os');
      const { join } = require('path') as typeof import('path');
      /* eslint-enable @typescript-eslint/no-require-imports */
      dir = mkdtempSync(join(tmpdir(), 'glos-shelf-'));
      process.env.GLOS_DATA_DIR = dir;
      delete process.env.JEST_WORKER_ID;
    });
    afterEach(() => {
      if (origWorker !== undefined) process.env.JEST_WORKER_ID = origWorker;
      if (origDir === undefined) delete process.env.GLOS_DATA_DIR;
      else process.env.GLOS_DATA_DIR = origDir;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('fs') as typeof import('fs')).rmSync(dir, { recursive: true, force: true });
    });

    it('still knows which slots are taken: the next parcel is not sent to a slot that is full, and the shop is not read as empty', () => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ShelfService: Shelf } = require('./shelf.service') as typeof import('./shelf.service');
        const { agents } = shopWith({ rows: 3, cols: 2, consolidationSlots: ['Orange-3'] });
        const before = new Shelf(agents);
        expect(before.assign(SHOP, 'P-1', 'M')).toBe('Red-1');
        expect(before.assign(SHOP, 'P-2', 'M')).toBe('Red-2');
        expect(before.assign(SHOP, 'L-1', 'S')).toBe('Orange-3');
        expect(before.assign(SHOP, 'L-2', 'S')).toBe('Orange-3');
        before.release(SHOP, 'P-1');

        // A new process: nothing carried over in memory.
        const after = new Shelf(agents);
        expect(after.grid(SHOP).filter((s) => s.occupiedBy || s.items?.length).map((s) => `${s.label}=${s.occupiedBy ?? s.items!.join('+')}`)).toEqual(['Red-2=P-2', 'Orange-3=L-1+L-2']);
        expect(after.available(SHOP)).toBe(5); // four empty slots, and the letters' slot still has room
        // The slot freed before the restart is free; the one still holding a parcel is not handed out again.
        expect(after.assign(SHOP, 'P-3', 'M')).toBe('Red-1');
        expect(after.assign(SHOP, 'P-4', 'M')).toBe('Red-3');
        // A parcel shelved before the restart is found, and its slot given back, after it.
        after.release(SHOP, 'P-2');
        expect(new Shelf(agents).grid(SHOP).find((s) => s.label === 'Red-2')?.occupiedBy).toBeUndefined();
        // And a shelf emptied before a restart is empty after it, not remembered full.
        for (const id of ['P-3', 'P-4', 'L-1', 'L-2']) after.release(SHOP, id);
        expect(new Shelf(agents).available(SHOP)).toBe(6);
      });
    });
  });
});
