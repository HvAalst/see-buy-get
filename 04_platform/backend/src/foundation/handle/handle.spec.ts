import { HANDLE_KINDS, HandleService } from './handle.service';
import { FLEET_APPROVED, SHOP_APPROVED, ownerDrivers } from '../../modules/pudo/handle-directory.service';

/**
 * Handles are an IMPERSONATION surface before they are a convenience, so these tests are written against
 * that rather than against the happy path. `@fedex` is a real company: the question every case here asks
 * is whether somebody who is not FedEx could end up holding it, or inherit a page that was not theirs.
 */
describe('handles — the directory, as a page per participant', () => {
  const svc = () => new HandleService();
  const mk = svc;

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
    it('has a kind for an owner-driver', () => {
      /*
       * REVERSED 2026-09-20, by the user: "owner driver deserves a public page as well. we do exist for
       * the underprivileged don't we?" The rule it replaces excluded every driver as employment-adjacent,
       * which is true of a driver EMPLOYED by a fleet and false of one who is their own business — and
       * giving the incorporated an address while the individual gets none is backwards on a network
       * built for informal carriers. See the HandleService doc for what happened to the old reasons.
       *
       * And this reads HANDLE_KINDS. The test it replaces built its own array of four strings and
       * asserted that array did not contain 'driver' — which was true of the literal on the line above
       * it and said nothing whatever about the code.
       */
      expect([...HANDLE_KINDS]).toContain('driver');
    });

    it('issues to an owner-driver and never to one who drives for a fleet', () => {
      // The line the MONEY already draws: the network contracts a fleet and pays it one invoice, and an
      // independent courier is contracted directly. A handle follows the contract.
      const drivers = [
        { did: 'did:driver:amos', displayName: 'Amos', status: 'ACTIVE' },
        { did: 'did:driver:employed', displayName: 'Driver J.', status: 'ACTIVE', managerDid: 'fleet-a' },
        { did: 'did:driver:waiting', displayName: 'Waiting', status: 'KYC_PENDING' },
        { did: 'did:driver:refused', displayName: 'Refused', status: 'DRAFT' },
      ];
      // Only the active owner-driver: an address for somebody still being vetted, or refused, would
      // publish a decision that is nobody's business but ours and theirs.
      expect(ownerDrivers(drivers).map((d) => d.did)).toEqual(['did:driver:amos']);
    });

    it('issues to a shop and a fleet only once staff approved it — never on signing up, never to one closed before that', () => {
      // A handle is never taken back: one given at sign-up let anybody hold @dhl for good before a paper was looked at
      // (the owner, 2026-10-30). Closing a shop LOCKS it and closing a fleet SUSPENDS it, so neither of those counts.
      expect([...SHOP_APPROVED].sort()).toEqual(['ACTIVE', 'APPROVED_UNFUNDED']);
      expect([...FLEET_APPROVED].sort()).toEqual(['ACTIVE', 'APPROVED']);
    });

    it('keeps an accented word whole — the mark dropped, never a hyphen in the middle of a name', () => {
      const cases: Array<[string, string]> = [
        ['Citroën Garage', 'citroen-garage'],
        ['Société Générale', 'societe-generale'],
        ['Ölçü Kargo', 'olcu-kargo'],
        ['Café Mbeya', 'cafe-mbeya'],
        ['Straße & Söhne', 'strasse-sohne'],
        ['Ærø Færge', 'aero-faerge'],
        ['Łódź Spedycja', 'lodz-spedycja'],
        ['FedEx Kenya Ltd', 'fedex-kenya-ltd'],
      ];
      for (const [name, stem] of cases) expect([name, HandleService.stem(name)]).toEqual([name, stem]);
      // One issued the old way still answers to its own address.
      const svc = mk();
      const old = svc.issue({ kind: 'shop', id: 'did:shop:old', name: 'citroe-n garage' });
      expect(svc.resolve(`@${old.handle}`)?.id).toBe('did:shop:old');
    });

    it('gives an owner-driver a handle from the non-PII display name, like any other participant', () => {
      const svc = mk();
      const issued = svc.issue({ kind: 'driver', id: 'did:driver:amos', name: 'Amos Transport', country: 'KE' });
      expect(issued).toMatchObject({ handle: 'amos-transport', kind: 'driver' });
      // Idempotent on the id, so the boot sweep can run for ever without minting a second one.
      expect(svc.issue({ kind: 'driver', id: 'did:driver:amos', name: 'Amos Transport' }).handle).toBe('amos-transport');
    });
  });
});
