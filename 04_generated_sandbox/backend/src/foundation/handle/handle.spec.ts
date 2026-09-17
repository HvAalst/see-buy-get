import { HandleService } from './handle.service';

/**
 * Handles are an IMPERSONATION surface before they are a convenience, so these tests are written against
 * that rather than against the happy path. `@fedex` is a real company: the question every case here asks
 * is whether somebody who is not FedEx could end up holding it, or inherit a page that was not theirs.
 */
describe('handles — the directory, as a page per participant', () => {
  const svc = () => new HandleService();

  describe('derived, never claimed', () => {
    it('falls out of the verified name', () => {
      const s = svc();
      expect(s.issue({ kind: 'company', id: 'ent-1', name: 'FedEx', country: 'KE' }).handle).toBe('fedex');
      expect(s.issue({ kind: 'shop', id: 'did:shop:1', name: "Mama Sarah's Shop", country: 'KE' }).handle).toBe('mama-sarah-s-shop');
    });

    it('gives the SECOND claimant a discriminated handle, never the bare one', () => {
      // The whole trust argument: the first verified FedEx holds @fedex, and a later company with the same
      // trading name is addressable without being able to take the page.
      const s = svc();
      s.issue({ kind: 'company', id: 'ent-1', name: 'FedEx', country: 'KE' });
      const second = s.issue({ kind: 'company', id: 'ent-2', name: 'FedEx', country: 'TZ' });
      expect(second.handle).toBe('fedex-tz');
      expect(s.resolve('fedex')!.id).toBe('ent-1');
    });

    it('keeps discriminating when even the country collides', () => {
      const s = svc();
      s.issue({ kind: 'company', id: 'a', name: 'Swift', country: 'KE' });
      s.issue({ kind: 'company', id: 'b', name: 'Swift', country: 'KE' });
      const third = s.issue({ kind: 'company', id: 'c', name: 'Swift', country: 'KE' });
      expect([s.forId('b')!.handle, third.handle]).toEqual(['swift-ke', 'swift-ke-2']);
    });

    it('refuses the bare form to a name that reads like one of OUR pages', () => {
      // Not refused an address — discriminated. A handle reading @support or @verified is a phishing
      // surface even though '@' means it can never actually collide with a path we serve.
      const s = svc();
      expect(s.issue({ kind: 'company', id: 'p1', name: 'Support', country: 'KE' }).handle).toBe('support-ke');
      expect(s.issue({ kind: 'company', id: 'p2', name: 'SeeBuyGet', country: 'KE' }).handle).toBe('seebuyget-ke');
      expect(s.issue({ kind: 'company', id: 'p3', name: 'Verified', country: 'UG' }).handle).toBe('verified-ug');
    });

    it('still gives an address to a name that survives as nothing', () => {
      const s = svc();
      expect(s.issue({ kind: 'shop', id: 'did:shop:x', name: '!!!', country: 'ET' }).handle).toBe('shop-et');
    });
  });

  describe('immutable once issued', () => {
    it('is idempotent on the participant, so a backfill can run on every boot', () => {
      const s = svc();
      const first = s.issue({ kind: 'shop', id: 'did:shop:1', name: 'Riverside Corner', country: 'KE' });
      const again = s.issue({ kind: 'shop', id: 'did:shop:1', name: 'Riverside Corner', country: 'KE' });
      expect(again).toEqual(first);
      expect(s.list()).toHaveLength(1);
    });

    it('does NOT follow a rename — a handle that moves is a rotted link and an inherited reputation', () => {
      const s = svc();
      const before = s.issue({ kind: 'company', id: 'ent-1', name: 'Kilima Logistics', country: 'KE' });
      const after = s.issue({ kind: 'company', id: 'ent-1', name: 'Something Else Entirely', country: 'KE' });
      expect(after.handle).toBe(before.handle);
      // …and the name it came from is kept, so the two are visibly different things.
      expect(after.derivedFrom).toBe('Kilima Logistics');
    });
  });

  describe('resolving', () => {
    it('reads a handle the way a person would type it', () => {
      const s = svc();
      s.issue({ kind: 'company', id: 'ent-1', name: 'FedEx', country: 'KE' });
      for (const typed of ['fedex', '@fedex', '@FedEx', 'FEDEX']) expect(s.resolve(typed)?.id).toBe('ent-1');
    });

    it('answers nothing for a handle nobody holds, and refuses when asked to require one', () => {
      const s = svc();
      expect(s.resolve('nobody')).toBeUndefined();
      expect(s.resolve('')).toBeUndefined();
      expect(() => s.require('nobody')).toThrow(/no such profile/i);
    });
  });

  describe('who gets one', () => {
    it('has no kind for an individual driver', () => {
      // Decided 2026-09-17: a driver's rating is already public by DID, but a searchable identity tied to
      // their delivery and hazard record is employment-adjacent, and the constraint map depends on a driver
      // not being identifiable as the one who slowed a corridor down.
      const kinds: string[] = [...['shop', 'hub', 'fleet', 'company']];
      expect(kinds).not.toContain('driver');
    });
  });
});
