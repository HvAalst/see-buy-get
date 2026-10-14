import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { FleetManagerService } from './fleet-manager.service';
import { GlosError } from '../../foundation/http/glos-error';
import { MediaService } from './media.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { Geocoder } from './geocoder';
import type { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import type { LedgerService } from '../../foundation/ledger/ledger.service';
import type { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { Signer } from '../../foundation/entity/same-person';

/**
 * A FLEET IS SET UP BY STAFF, AND IT TAKES TWO OF THEM.
 *
 * A fleet cannot sign in until it is active, so its papers are put on record by a member of staff — and then the one
 * check on those papers is that somebody ELSE looks before the fleet is approved. The first day walked from zero
 * (`test/first-day-from-zero.e2e-spec.ts`) holds that over the wire with two real sign-ins. What it cannot hold is
 * WHICH two: Amina and Brian differ in name and in account at once, so a rule that went by the name alone would pass
 * there. Here the two are pulled apart.
 */
describe('a fleet’s papers: put on record by one member of staff, approved by another', () => {
  const setUp = () => {
    const dids = new DidService({ anchor: () => 'anchor' } as unknown as LedgerService, { publish: async () => undefined } as unknown as EventBus);
    const entities = new EntityService(dids);
    entities.seed();
    const vault = { store: () => ({ vaultRef: `vault_${Math.random().toString(16).slice(2)}` }) } as unknown as IdentityVault;
    const core = { upsert: () => undefined } as unknown as OperationalStore;
    const bus = { publish: async () => undefined } as unknown as EventBus;
    const presence = { can: () => true, require: () => undefined } as unknown as PresenceService;
    const geocoder = { geocode: () => ({ location: { lat: -1.28, lng: 36.82 } }) } as unknown as Geocoder;
    const managers = new FleetManagerService(dids, vault, core, bus, entities, presence, geocoder, new MediaService());

    let n = 0;
    const draft = (companyName = 'Kilima Logistics') => {
      n += 1;
      return managers.register({
        companyName,
        jurisdiction: 'KE',
        contactPhone: `+2547110002${String(n).padStart(2, '0')}`,
        ownerFullName: 'Kilima Owner',
        ownerNationalId: `KE-ID-${n}`,
        depotAddress: 'Enterprise Road depot, Nairobi',
        requirements: { businessRegistrationNo: `BR-${n}`, transportOperatorLicence: `TOL-${n}`, taxId: `TAX-${n}` },
      });
    };
    return { managers, draft };
  };
  const PAPERS = { businessRegCertRef: 'med_reg', operatorLicenceRef: 'med_lic', ownerIdRef: 'med_id', proofOfAddressRef: 'med_addr' };
  const AMINA: Signer = { name: 'Amina Otieno', key: 'staff:1' };
  const BRIAN: Signer = { name: 'Brian Kamau', key: 'staff:2' };
  const refusal = (act: () => unknown): [string, string] => {
    try {
      act();
    } catch (e) {
      return [(e as GlosError).code, (e as GlosError).message];
    }
    return ['', 'nothing refused it'];
  };
  const NOT_YOURS = ['FORBIDDEN', 'You put these papers on record — a different person must approve them'];

  it('whoever put them on record cannot approve them, and a colleague can', () => {
    const { managers, draft } = setUp();
    const m = draft();
    managers.submitKyc(m.did, PAPERS, AMINA);
    expect(refusal(() => managers.decideKyc(m.did, true, AMINA.name, undefined, AMINA))).toEqual(NOT_YOURS);
    expect(managers.get(m.did).status).toBe('KYC_PENDING');
    expect(managers.decideKyc(m.did, true, BRIAN.name, undefined, BRIAN).status).toBe('APPROVED');
  });

  it('goes by the ACCOUNT: a namesake is another person, and a renamed account is the same one', () => {
    const { managers, draft } = setUp();
    const m = draft();
    managers.submitKyc(m.did, PAPERS, AMINA);
    // The same account under another name — a name is changed in a minute, and must not buy a second signature.
    expect(refusal(() => managers.decideKyc(m.did, true, 'A. Otieno-Kamau', undefined, { name: 'A. Otieno-Kamau', key: 'staff:1' }))).toEqual(NOT_YOURS);
    expect(managers.papersEnteredBy(managers.get(m.did), { name: 'A. Otieno-Kamau', key: 'staff:1' })).toBe(true);
    // Two colleagues who share a name are two people.
    const namesake: Signer = { name: 'Amina Otieno', key: 'staff:7' };
    expect(managers.papersEnteredBy(managers.get(m.did), namesake)).toBe(false);
    expect(managers.decideKyc(m.did, true, namesake.name, undefined, namesake).status).toBe('APPROVED');
  });

  it('where there is no account to go by, the name is compared — case and spacing aside', () => {
    const { managers, draft } = setUp();
    const m = draft();
    managers.submitKyc(m.did, PAPERS, { name: 'Amina Otieno', key: 'typed:Amina Otieno' });
    expect(refusal(() => managers.decideKyc(m.did, true, 'amina  otieno', undefined, { name: 'amina  otieno', key: 'typed:amina  otieno' }))).toEqual(NOT_YOURS);
    expect(managers.decideKyc(m.did, true, 'Brian Kamau', undefined, { name: 'Brian Kamau', key: 'typed:Brian Kamau' }).status).toBe('APPROVED');
  });

  it('sent back and put on record again by the colleague, it is the FIRST one who approves now', () => {
    const { managers, draft } = setUp();
    const m = draft();
    managers.submitKyc(m.did, PAPERS, AMINA);
    managers.decideKyc(m.did, false, BRIAN.name, 'The operator’s licence is last year’s', BRIAN);
    expect(managers.get(m.did)).toMatchObject({ status: 'DRAFT', kycRejection: { reason: 'The operator’s licence is last year’s', by: BRIAN.name } });
    expect(managers.get(m.did).kyc).toBeUndefined();
    // Nothing of the first entry is left to be held against the one who made it.
    expect(managers.papersEnteredBy(managers.get(m.did), AMINA)).toBe(false);

    managers.submitKyc(m.did, PAPERS, BRIAN);
    expect(managers.get(m.did).kycRejection).toBeUndefined();
    expect(refusal(() => managers.decideKyc(m.did, true, BRIAN.name, undefined, BRIAN))).toEqual(NOT_YOURS);
    expect(managers.decideKyc(m.did, true, AMINA.name, undefined, AMINA).status).toBe('APPROVED');
  });

  it('taking one’s own entry back is not approving it: whoever put them on record may send them back', () => {
    const { managers, draft } = setUp();
    const m = draft();
    managers.submitKyc(m.did, PAPERS, AMINA);
    expect(managers.decideKyc(m.did, false, AMINA.name, 'I attached the wrong certificate', AMINA).status).toBe('DRAFT');
  });

  it('papers cannot be put on record twice, nor decided before there are any', () => {
    const { managers, draft } = setUp();
    const m = draft();
    expect(refusal(() => managers.decideKyc(m.did, true, BRIAN.name, undefined, BRIAN))[0]).toBe('INVALID_STATE');
    expect(refusal(() => managers.submitKyc(m.did, { ...PAPERS, proofOfAddressRef: '' }, AMINA))[0]).toBe('KYC_INCOMPLETE');
    managers.submitKyc(m.did, PAPERS, AMINA);
    expect(refusal(() => managers.submitKyc(m.did, PAPERS, BRIAN))[0]).toBe('INVALID_STATE');
    // …and the second try did not make Brian the one who entered them.
    expect(managers.papersEnteredBy(managers.get(m.did), BRIAN)).toBe(false);
    expect(managers.papersEnteredBy(managers.get(m.did), AMINA)).toBe(true);
  });

  describe('the list staff set fleets up from', () => {
    it('says where each fleet stands and whether THIS reader entered its papers, newest first', () => {
      const { managers, draft } = setUp();
      const first = draft('Kilima Logistics');
      const second = draft('Twiga Haulage');
      // Registered within the same millisecond they would tie; the list goes by when each was registered.
      managers.get(first.did).createdAt = '2026-10-10T08:00:00.000Z';
      managers.get(second.did).createdAt = '2026-10-11T08:00:00.000Z';
      managers.submitKyc(first.did, PAPERS, AMINA);

      const asAmina = managers.settingUp(AMINA);
      expect(asAmina.map((r) => r.companyName)).toEqual(['Twiga Haulage', 'Kilima Logistics']);
      expect(asAmina[0]).toMatchObject({ status: 'DRAFT', jurisdiction: 'KE', depotAddress: 'Enterprise Road depot, Nairobi' });
      expect(asAmina[0]).not.toHaveProperty('papers');
      expect(asAmina[1].papers).toMatchObject({ ...PAPERS, enteredBy: 'Amina Otieno', enteredByMe: true });
      expect(managers.settingUp(BRIAN)[1].papers).toMatchObject({ enteredBy: 'Amina Otieno', enteredByMe: false });
    });

    it('never carries the account behind the name, the owner’s identity, or a code before the fleet is active', () => {
      const { managers, draft } = setUp();
      const m = draft();
      managers.submitKyc(m.did, PAPERS, AMINA);
      const row = () => managers.settingUp(BRIAN)[0];
      const ALLOWED = ['did', 'companyName', 'tradingName', 'status', 'jurisdiction', 'contactPhone', 'depotAddress', 'requirements', 'createdAt', 'papers', 'refused', 'loginCode'];
      expect(Object.keys(row()).filter((k) => !ALLOWED.includes(k))).toEqual([]);
      // The KEY that tells two namesakes apart is kept beside the record, never on it: the list is read by every
      // member of staff, and an account key is nobody's to read.
      expect(JSON.stringify(row())).not.toContain('staff:1');
      expect(JSON.stringify(managers.get(m.did))).not.toContain('staff:1');
      expect(JSON.stringify(row())).not.toContain('KE-ID-');
      expect(JSON.stringify(row())).not.toContain('vault_');

      managers.decideKyc(m.did, true, BRIAN.name, undefined, BRIAN);
      expect(row()).not.toHaveProperty('loginCode');
      managers.recordBond(m.did);
      expect(row()).toMatchObject({ status: 'ACTIVE', loginCode: expect.stringMatching(/^FM-[0-9A-F]{6}$/) });
      // A suspended fleet's code opens nothing, and is not handed out.
      managers.suspend(m.did);
      expect(row()).toMatchObject({ status: 'SUSPENDED' });
      expect(row()).not.toHaveProperty('loginCode');
    });
  });
});
