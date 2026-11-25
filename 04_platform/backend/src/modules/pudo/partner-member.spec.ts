import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AuthService } from '../../foundation/auth/auth.service';
import { ROLE_SCOPES } from '../../foundation/auth/actor-scopes';
import { STAFF_AREAS } from '../../foundation/auth/staff-areas.table';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { PersonService } from './person.service';
import { MediaService } from './media.service';
import { PartnerMemberService } from './partner-member.service';
import { PartnerAppController } from './partner-app.controller';
import { LiveService } from './live.service';
import { listenerOf } from './live.controller';

/*
 * 2026-11-20 — A PARTNER'S OWN PEOPLE, AND THE PARTNER APP'S DOORS (the payments plan, 3c; the owner: a separate Partner app,
 * with a live view). What is held to here, on the real person, entity and token services: our staff add a partner's people by
 * number, by name; a person sees an invitation only when it is theirs, says yes or no, and opens the partner with a token of
 * its own; whether they are still in it is asked on every request, so taking them out holds from their next tap; an
 * invitation follows the account when it moves to another number, and goes when the account is closed; their screens hear
 * that what the partner owes changed, and nobody else's do.
 */
describe('a partner’s own people', () => {
  let members: PartnerMemberService;
  let persons: PersonService;
  let entities: EntityService;
  let auth: AuthService;
  let partnerId: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PartnerMemberService, PersonService, MediaService, AuthService, DidService, EntityService, IdentityVault, OperationalStore, FieldEncryption, EventBus, LedgerService, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    members = moduleRef.get(PartnerMemberService);
    persons = moduleRef.get(PersonService);
    auth = moduleRef.get(AuthService);
    partnerId = entities.createCompany({ kind: 'partner', jurisdiction: 'UG', name: `Kampala Courier ${(seq += 1)}` }, 'Amina').entityId;
  });

  let seq = 0;
  const aNumber = () => `+2567010${String((seq += 1)).padStart(5, '0')}`;
  const aPerson = (phone = aNumber()) => {
    const person = persons.ensurePerson(phone);
    persons.setPin(person.personDid, '48261');
    return { personDid: person.personDid, phone };
  };
  /** Read for the partner, through the same token-and-check a request goes through. */
  const asPartner = (personDid: string, entityId = partnerId) => auth.introspect(members.session(personDid, entityId).token.access_token);

  it('added by our staff, by number and by name: the same answer whether or not the number has an account', () => {
    const before = aNumber();
    const added = members.invite(partnerId, { phone: before, name: 'Selam Tesfaye' }, 'Amina Otieno');
    expect(added).toMatchObject({ name: 'Selam Tesfaye', phoneEnds: before.slice(-3), state: 'invited', invitedBy: 'Amina Otieno' });
    expect(JSON.stringify(added)).not.toContain(before);
    expect(() => members.invite(partnerId, { phone: before, name: 'Again' }, 'Amina Otieno')).toThrow(/already in this partner/);
    expect(() => members.invite(partnerId, { phone: 'not a number', name: 'X' }, 'Amina Otieno')).toThrow(/phone number/);
    expect(() => members.invite(partnerId, { phone: aNumber(), name: '  ' }, 'Amina Otieno')).toThrow(/Say who this is/);
    // Only a partner company has a Partner app.
    expect(() => members.invite('sbg-ke', { phone: aNumber(), name: 'X' }, 'Amina Otieno')).toThrow(/no such partner/);
    expect(members.membersOf(partnerId).map((m) => m.state)).toEqual(['invited']);
  });

  it('a person sees only an invitation that is theirs, says yes, and opens the partner with a token of its own', () => {
    const selam = aPerson();
    const stranger = aPerson();
    const { memberId } = members.invite(partnerId, { phone: selam.phone, name: 'Selam Tesfaye' }, 'Amina Otieno');
    expect(members.mine(stranger.personDid)).toEqual([]);
    expect(() => members.accept(stranger.personDid, memberId)).toThrow(/No such invitation/);
    expect(members.mine(selam.personDid)).toMatchObject([{ memberId, entityId: partnerId, state: 'invited', invitedBy: 'Amina Otieno' }]);
    // Not in it yet: no session.
    expect(() => members.session(selam.personDid, partnerId)).toThrow(/No such partner/);
    expect(members.accept(selam.personDid, memberId)).toMatchObject({ state: 'joined' });
    const actor = asPartner(selam.personDid);
    expect(actor).toMatchObject({ role: 'partner', tenant: partnerId, personDid: selam.personDid, actorName: 'Selam Tesfaye' });
    expect(members.me(actor)).toMatchObject({ entityId: partnerId, country: 'UG', currency: 'UGX', memberName: 'Selam Tesfaye' });
    expect(ROLE_SCOPES.partner).toEqual(['partner:read:own']);
  });

  it('taken out by our staff: from the next request, nothing more — and kept on the record, by name', () => {
    const selam = aPerson();
    const { memberId } = members.invite(partnerId, { phone: selam.phone, name: 'Selam Tesfaye' }, 'Amina Otieno');
    members.accept(selam.personDid, memberId);
    const actor = asPartner(selam.personDid);
    expect(() => members.requireMember(actor)).not.toThrow();
    expect(members.remove(partnerId, memberId, 'Brian Otieno')).toMatchObject({ state: 'removed', removedBy: 'Brian Otieno' });
    expect(() => members.requireMember(actor)).toThrow(/no longer in this partner/);
    expect(() => members.remove(partnerId, memberId, 'Brian Otieno')).toThrow(/no such person/);
    expect(members.membersOf(partnerId)).toMatchObject([{ memberId, state: 'removed' }]);
    // A business sign-in, or anybody else's, is not a partner's.
    expect(() => members.requireMember({ role: 'business', tenant: partnerId, personDid: selam.personDid } as never)).toThrow(/Partner app sign-in/);
  });

  it('said no to: kept, so our staff see it; and never opened', () => {
    const selam = aPerson();
    const { memberId } = members.invite(partnerId, { phone: selam.phone, name: 'Selam Tesfaye' }, 'Amina Otieno');
    expect(members.decline(selam.personDid, memberId)).toEqual({ declined: true });
    expect(members.mine(selam.personDid)).toEqual([]);
    expect(members.membersOf(partnerId)).toMatchObject([{ memberId, state: 'declined' }]);
  });

  it('an invitation follows the account to another number — and is closed with the account', () => {
    // Invited before they have an account on that number…
    const phone = aNumber();
    const { memberId } = members.invite(partnerId, { phone, name: 'Selam Tesfaye' }, 'Amina Otieno');
    const selam = aPerson(phone);
    expect(members.mine(selam.personDid).map((m) => m.memberId)).toEqual([memberId]);
    // …then their account moves to another number before they answer: the invitation goes with the account.
    persons.movePhone(selam.personDid, aNumber(), 'self');
    expect(members.mine(selam.personDid).map((m) => m.memberId)).toEqual([memberId]);
    members.accept(selam.personDid, memberId);
    expect(members.forgetPerson(selam.personDid, persons.requireByDid(selam.personDid).phoneHash)).toBe(1);
    expect(members.membersOf(partnerId)).toMatchObject([{ memberId, name: 'Closed account', phoneEnds: '', state: 'removed' }]);
  });

  it('what the partner owes, read for it: the same record our staff read', () => {
    const selam = aPerson();
    const { memberId } = members.invite(partnerId, { phone: selam.phone, name: 'Selam Tesfaye' }, 'Amina Otieno');
    members.accept(selam.personDid, memberId);
    const ledger = { ledgerOf: jest.fn((id: string) => ({ partnerEntityId: id, owed: 40, byPayee: [{ payeeId: 'did:glos:shop-k', payeeKind: 'shop', amount: 40, steps: 1 }], lines: [{ payeeId: 'mdp_k', payeeKind: 'hub', amount: 0 }, { payeeId: 'did:glos:gone', payeeKind: 'driver', amount: 0 }] })) };
    const agents = { get: () => ({ shopName: 'Duka la Kampala' }) };
    const mdps = { require: () => ({ name: 'Kampala Sort' }) };
    const drivers = { get: () => { throw new Error('no such driver'); } };
    // 4c — what its payouts have paid is marked on the record it reads.
    const payouts = { paidLineIds: () => new Set<string>() };
    const doors = new PartnerAppController(members, ledger as never, agents as never, mdps as never, drivers as never, {} as never, payouts as never);
    // Each hand by its name; one that cannot be found is left without one, and nothing else is in the answer.
    expect(doors.owed(asPartner(selam.personDid))).toMatchObject({ partnerEntityId: partnerId, owed: 40, names: { 'did:glos:shop-k': 'Duka la Kampala', mdp_k: 'Kampala Sort' } });
    expect(Object.keys(doors.owed(asPartner(selam.personDid)).names)).toEqual(['did:glos:shop-k', 'mdp_k']);
    expect(ledger.ledgerOf).toHaveBeenCalledWith(partnerId, { paidLineIds: expect.any(Set) });
  });

  it('4e — its money: paid in (never a try), given back, paid out, what waits, our fee it owes — each hand by its name, never a phone', async () => {
    const selam = aPerson();
    const { memberId } = members.invite(partnerId, { phone: selam.phone, name: 'Selam Tesfaye' }, 'Amina Otieno');
    members.accept(selam.personDid, memberId);
    const at = '2026-11-20T10:00:00.000Z';
    const hub = {
      accountView: async () => ({ provider: 'stand-in', test: true, currency: 'ETB', ready: ['stand-in'], balance: 935, feeOwed: 7.5 }),
      totalsOf: () => ({ paidIn: 250, givenBack: 250, paidOut: 65 }),
      kept: () => [
        { paymentId: 'hp_1', kind: 'in', reference: 'PUD-1', amount: 250, currency: 'ETB', state: 'paid', askedAt: at, settledAt: at, phoneEnds: '123', phoneHash: 'secret-hash' },
        { paymentId: 'hp_2', kind: 'in', reference: 'try_x', amount: 5, currency: 'ETB', state: 'paid', askedAt: at, askedBy: 'Staff Ann', phoneEnds: '777', phoneHash: 'h2' },
        { paymentId: 'hp_3', kind: 'refund', reference: 'PUD-1', amount: 250, currency: 'ETB', state: 'paid', askedAt: at, refundOf: 'hp_1', phoneEnds: '123', phoneHash: 'secret-hash' },
      ],
    };
    const payouts = { paidLineIds: () => new Set<string>(), viewOf: () => ({ currency: 'ETB', waiting: 1, waitingAmount: 300, shortAmount: 300, paidAmount: 65, rows: [{ payoutId: 'pp_1', payeeId: 'did:glos:shop-k', payeeKind: 'shop', amount: 65, currency: 'ETB', steps: 2, state: 'paid', day: '2026-11-20' }] }) };
    const agents = { get: () => ({ shopName: 'Duka la Kampala' }) };
    const doors = new PartnerAppController(members, {} as never, agents as never, {} as never, {} as never, {} as never, payouts as never, hub as never);
    const money = await doors.myMoney(asPartner(selam.personDid));
    expect(money).toMatchObject({ currency: 'ETB', balance: 935, test: true, paidIn: 250, givenBack: 250, paidOut: 65, waiting: 1, waitingAmount: 300, shortAmount: 300, feeOwed: 7.5, names: { 'did:glos:shop-k': 'Duka la Kampala' } });
    expect(money.ins).toEqual([{ reference: 'PUD-1', amount: 250, currency: 'ETB', state: 'paid', at, givenBack: true }]);
    expect(JSON.stringify(money)).not.toMatch(/123|secret-hash|Staff Ann/);
  });
});

describe('the partner’s live view', () => {
  it('a step it owes is told to that partner’s screens, and nobody else’s', () => {
    const bus = new EventBus();
    const live = new LiveService(bus);
    live.onModuleInit();
    const heard: Record<string, string[][]> = { mine: [], theirs: [], console: [] };
    live.open({ kind: 'partner', partnerEntityId: 'partner-ug' }, (t) => heard.mine.push(t));
    live.open({ kind: 'partner', partnerEntityId: 'partner-et' }, (t) => heard.theirs.push(t));
    live.open({ kind: 'console' }, (t) => heard.console.push(t));
    live.toPartner('partner-ug', 'owed');
    expect(heard.mine).toEqual([['owed']]);
    expect(heard.theirs).toEqual([]);
    expect(live.count()).toEqual({ console: 1, fleets: 0, partners: 2 });
    expect(listenerOf({ role: 'partner', tenant: 'partner-ug' } as never)).toEqual({ kind: 'partner', partnerEntityId: 'partner-ug' });
    expect(() => listenerOf({ role: 'business', tenant: 'x' } as never)).toThrow();
    live.onModuleDestroy();
  });

  it('wired: the event that a step was owed reaches the partner’s screens', () => {
    const live = read('live.service.ts');
    // …and, 4c, that a payout was made, paid or is waiting.
    expect(live).toMatch(/if \(e\.type === GlosEvent\.Pudo\.PartnerOwed \|\| e\.type === GlosEvent\.Pudo\.PartnerPayout\) this\.toPartner\(\(e\.payload as \{ partnerEntityId\?: string \} \| undefined\)\?\.partnerEntityId, 'owed'\);/);
    expect(GlosEvent.Pudo.PartnerOwed).toBe('pudo.partner_owed');
    // 4e — and money asked of a phone, paid or failed, in the partner's account.
    expect(live).toContain("if (e.type === GlosEvent.Pudo.HubPayment) this.toPartner((e.payload as { ownerEntityId?: string } | undefined)?.ownerEntityId, 'owed');");
    expect(read('live.controller.ts')).toMatch(/@Roles\('fleet_manager', 'entity_admin', 'operator', 'partner'\)\s*@Sse\('live'\)/);
  });
});

const read = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf8');

describe('wired', () => {
  it('our staff add and take out; a person handles their own invitations; the partner reads its own', () => {
    expect(STAFF_AREAS['GET sbg/entities/:entityId/partner-members']).toBe('any');
    expect(STAFF_AREAS['POST sbg/entities/:entityId/partner-members']).toBe('admin');
    expect(STAFF_AREAS['DELETE sbg/entities/:entityId/partner-members/:memberId']).toBe('admin');
    for (const door of ['GET sbg/partner/mine', 'POST sbg/partner/invitations/:memberId/accept', 'POST sbg/partner/invitations/:memberId/decline', 'POST sbg/partner/:entityId/session', 'GET sbg/partner/me', 'GET sbg/partner/me/owed']) expect(STAFF_AREAS[door]).toBe('none');
    const doors = read('partner-app.controller.ts');
    expect(doors.match(/@Roles\('operator'\)\s*@(Get|Post|Delete)\('entities\/:entityId\/partner-members/g)).toHaveLength(3);
    expect(doors.match(/@Roles\('consumer'\)\s*@(Get|Post)\('partner\//g)).toHaveLength(4);
    // 4c — and its own payouts.
    // 4e — and its money. 2026-11-24 — and what our companies owe it, week by week (route plan part 4).
    expect(doors.match(/@Roles\('partner'\)\s*@Get\('partner\/me/g)).toHaveLength(5);
    expect(STAFF_AREAS['GET sbg/partner/me/statements']).toBe('none');
    expect(STAFF_AREAS['GET sbg/partner/me/payouts']).toBe('none');
    expect(STAFF_AREAS['GET sbg/partner/me/money']).toBe('none');
    expect(read('account-closing.service.ts')).toMatch(/this\.partnerMembers\?\.forgetPerson\(personDid, phoneHash, now\);/);
    expect(read('pudo.module.ts')).toMatch(/PartnerChecksService, PartnerMemberService,/);
    expect(read('pudo.module.ts')).toMatch(/PartnerLedgerController, PartnerAppController,/);
  });
});
