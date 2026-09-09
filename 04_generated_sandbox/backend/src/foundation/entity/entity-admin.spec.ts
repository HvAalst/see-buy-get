import { Test } from '@nestjs/testing';
import { EntityService } from './entity.service';
import { EntityAdminService } from './entity-admin.service';
import { AuthService } from '../auth/auth.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { OperationalStore } from '../data-firewall/operational-store.service';

/**
 * A company's own administrators — the login that lets a sister turn its own knobs.
 *
 * Until this existed the only hand that could change what a sister charges was an operator holding one
 * shared key, which is network staff making a commercial decision on a company's behalf and leaving
 * "somebody with the operator key" as the answer to who did it. These tests are written against the two
 * rules that make this a real answer instead: reach follows the company STRUCTURE, and every change
 * carries a name the token established rather than one the caller typed.
 */
describe('company administrators', () => {
  let entities: EntityService;
  let admins: EntityAdminService;
  let auth: AuthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, EntityAdminService, AuthService, DidService, LedgerService, EventBus, OperationalStore, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    admins = moduleRef.get(EntityAdminService);
    auth = moduleRef.get(AuthService);
    entities.seed();
  });

  const ke = () => entities.requireForJurisdiction('KE').entityId;
  const et = () => entities.requireForJurisdiction('ET').entityId;
  const group = () => entities.group().entityId;

  describe('reach follows the company structure, and nothing else', () => {
    it('lets a sister’s administrator reach its own company', () => {
      expect(entities.mayAdminister(ke(), ke())).toBe(true);
    });

    it('does NOT let one sister reach another', () => {
      // They are separate companies with separate books, which is the whole reason there are two of them.
      expect(entities.mayAdminister(ke(), et())).toBe(false);
      expect(entities.administrable(ke()).map((e) => e.entityId)).toEqual([ke()]);
    });

    it('lets the GROUP’s administrator reach the group and every sister under it', () => {
      // Not a permission list somebody maintains in step with the org chart — it IS the org chart, asked.
      const reach = entities.administrable(group()).map((e) => e.entityId).sort();
      expect(reach).toEqual([group(), et(), ke()].sort());
    });

    it('picks up a sister added later without anybody granting anything', () => {
      // The consequence of deriving reach from the structure rather than storing it: a company created
      // tomorrow is administrable by its parent the moment it exists.
      expect(entities.mayAdminister(group(), ke())).toBe(true);
      expect(entities.mayAdminister(undefined, ke())).toBe(false);
      expect(entities.mayAdminister(ke(), 'sbg-nowhere')).toBe(false);
    });

    it('does not let a sister reach UPWARDS into the mother company', () => {
      // The books it could read there consolidate every other sister's.
      expect(entities.mayAdminister(ke(), group())).toBe(false);
    });
  });

  describe('the login', () => {
    it('creates an administrator with a password returned exactly once', () => {
      const created = admins.create(ke(), { email: 'Ann@sbg.test', name: 'Ann Wanjiru' });
      // Named `temporaryPassword`, not `password`: the global response mask strips the latter from every
      // response, which is exactly right for a stored credential and wrong for a value that exists for
      // one reply. The distinct name keeps that guard as tight as it was written to be.
      expect(created.temporaryPassword).toHaveLength(12);
      expect(created.email).toBe('ann@sbg.test'); // lower-cased, so signing in is not case-sensitive
      // And it is never readable again — the list is a view with no credential material in it at all.
      const listed = admins.list(ke());
      expect(listed).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain(created.temporaryPassword);
      expect(Object.keys(listed[0]).sort()).toEqual(['adminId', 'createdAt', 'email', 'entityId', 'name'].sort());
    });

    it('mints a token that carries the COMPANY and the PERSON', () => {
      const created = admins.create(ke(), { email: 'ann@sbg.test', name: 'Ann Wanjiru' });
      const { token } = admins.login('ann@sbg.test', created.temporaryPassword);
      const claims = auth.introspect(token.access_token);
      expect(claims.active).toBe(true);
      expect(claims.role).toBe('entity_admin');
      expect(claims.tenant).toBe(ke()); // the company it may administer
      expect(claims.did).toBe(entities.get(ke()).did); // acting AS the company
      // The name is established here and carried by the signed token, which is what lets the audit trail
      // record a person without trusting a string from a request body.
      expect(claims.actorName).toBe('Ann Wanjiru');
    });

    it('answers the same way for a wrong password and a person who does not exist', () => {
      const created = admins.create(ke(), { email: 'ann@sbg.test', name: 'Ann' });
      // Distinguishing them tells a stranger which of our companies has an administrator called this.
      expect(() => admins.login('ann@sbg.test', 'wrong')).toThrow(/Wrong email or password/);
      expect(() => admins.login('nobody@sbg.test', created.temporaryPassword)).toThrow(/Wrong email or password/);
    });

    it('refuses a second login on the same email, and an unknown company', () => {
      admins.create(ke(), { email: 'ann@sbg.test', name: 'Ann' });
      expect(() => admins.create(et(), { email: 'ann@sbg.test', name: 'Ann' })).toThrow(/already administers/);
      expect(() => admins.create('sbg-nowhere', { email: 'b@sbg.test', name: 'B' })).toThrow();
    });

    it('insists on a name, because the audit trail is the point', () => {
      expect(() => admins.create(ke(), { email: 'b@sbg.test', name: '  ' })).toThrow(/recorded against this name/);
      expect(() => admins.create(ke(), { email: 'not-an-email', name: 'B' })).toThrow(/email/);
    });

    it('stops a revoked login working, and KEEPS the record', () => {
      const created = admins.create(ke(), { email: 'ann@sbg.test', name: 'Ann' });
      const [listed] = admins.list(ke());
      admins.revoke(ke(), listed.adminId);
      expect(() => admins.login('ann@sbg.test', created.temporaryPassword)).toThrow(/Wrong email or password/);
      // Gone from the list of who administers this company…
      expect(admins.list(ke())).toHaveLength(0);
      // …but the name is still resolvable, because "who changed this rate in March" outlives the job.
      expect(admins.nameOf('ann@sbg.test')).toBe('Ann');
    });

    it('lets somebody change the password they were handed, and refuses a weak one', () => {
      // The other half of a generated credential: without this, "have them change it" is advice nobody
      // can take, and whoever created the account keeps a working password for it forever.
      const created = admins.create(ke(), { email: 'ann@sbg.test', name: 'Ann' });
      expect(() => admins.changePassword('ann@sbg.test', created.temporaryPassword, 'short')).toThrow(/at least 10/);
      expect(() => admins.changePassword('ann@sbg.test', 'not-the-password', 'a-much-longer-one')).toThrow(/Wrong email or password/);
      admins.changePassword('ann@sbg.test', created.temporaryPassword, 'a-much-longer-one');
      expect(() => admins.login('ann@sbg.test', created.temporaryPassword)).toThrow(/Wrong email or password/);
      expect(admins.login('ann@sbg.test', 'a-much-longer-one').name).toBe('Ann');
    });

    it('will not let one company revoke another company’s administrator', () => {
      admins.create(ke(), { email: 'ann@sbg.test', name: 'Ann' });
      const [listed] = admins.list(ke());
      expect(() => admins.revoke(et(), listed.adminId)).toThrow(/No such administrator/);
    });
  });

  describe('every change carries a name', () => {
    it('records what was changed, by whom, and what it was before', () => {
      entities.setRates(ke(), { lane: 'dedicated', profitOnRiskPct: 0.04 }, 'Ann Wanjiru');
      const [change] = entities.changes(ke());
      expect(change).toMatchObject({ by: 'Ann Wanjiru', what: 'rates', lane: 'dedicated' });
      // The RESOLVED figures either side, because "what does this lane charge now" is what anybody reads
      // this to answer, and an override is only half of that answer.
      expect(change.from).toContain('2.00%');
      expect(change.to).toContain('6.00%');
      expect(change.to).toContain('return 4.00%');
    });

    it('records tax and cover the same way, whole', () => {
      entities.setTax(ke(), { ratePct: 0.16, label: 'VAT', registration: 'KE-1' }, 'Ann');
      entities.setInsurance(ke(), { freeLimit: 5000, premiumPct: 0.02 }, 'Ann');
      const [cover, tax] = entities.changes(ke());
      expect(tax).toMatchObject({ what: 'tax', by: 'Ann' });
      expect(tax.from).toBe('none');
      expect(tax.to).toBe('16.00% VAT');
      expect(cover).toMatchObject({ what: 'cover' });
      expect(cover.to).toContain('5000');
    });

    it('keeps them newest first, and keeps the old ones', () => {
      entities.setRates(ke(), { marginPct: 0.03 }, 'Ann');
      entities.setRates(ke(), { marginPct: 0.04 }, 'Ben');
      const changes = entities.changes(ke());
      expect(changes.map((c) => c.by)).toEqual(['Ben', 'Ann']);
      expect(changes[0].from).toContain('3.00%');
    });

    it('rides on the pricing read model, so the screen can say who set what is on it', () => {
      entities.setRates(ke(), { marginPct: 0.03 }, 'Ann');
      const pricing = entities.pricingFor(ke(), ['pudo'], { editable: true });
      expect(pricing.recentChanges[0].by).toBe('Ann');
      expect(pricing.editable).toBe(true);
      // The GROUP is never editable however much reach the caller has: it has no rates to set.
      expect(entities.pricingFor(group(), ['pudo'], { editable: true }).editable).toBe(false);
      // And a reader who may not change anything is told so rather than having to guess from a 403.
      expect(entities.pricingFor(ke(), ['pudo']).editable).toBe(false);
    });
  });
});
