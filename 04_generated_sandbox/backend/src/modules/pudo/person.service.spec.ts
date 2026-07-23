import { Test } from '@nestjs/testing';
import { PersonService } from './person.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { DidService } from '../../foundation/did/did.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { hashPhone } from '../../foundation/identity/phone';

describe('PersonService — the identity spine (S20)', () => {
  let persons: PersonService;
  let auth: AuthService;
  let dids: DidService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PersonService, AuthService, DidService, OperationalStore, LedgerService, EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    persons = moduleRef.get(PersonService);
    auth = moduleRef.get(AuthService);
    dids = moduleRef.get(DidService);
  });

  const PHONE = '+254700900001';

  it('creates one person per phone, idempotently, keyed by the phone hash', () => {
    const a = persons.ensurePerson('0700 900 001');
    const b = persons.ensurePerson('+254700900001'); // same number, other format
    expect(b.personDid).toBe(a.personDid);
    expect(a.phoneHash).toBe(hashPhone(PHONE));
    expect(persons.findByPhone(PHONE)!.personDid).toBe(a.personDid);
    expect(persons.findByDid(a.personDid)!.phoneHash).toBe(a.phoneHash);
    expect(dids.exists(a.personDid)).toBe(true); // a registered, pseudonymous DID
    expect(a.personDid).not.toContain('700900001'); // controller carries the hash, not the number
  });

  it('attaches many roles to one person, deduped, and never a second account', () => {
    const driverDid = dids.generate('pudo-driver:x').id;
    const agentDid = dids.generate('pudo:y').id;
    persons.attachRole(PHONE, 'driver', driverDid);
    persons.attachRole(PHONE, 'agent', agentDid);
    persons.attachRole(PHONE, 'driver', driverDid); // re-link is idempotent
    const p = persons.findByPhone(PHONE)!;
    expect(p.roles.map((r) => r.role).sort()).toEqual(['agent', 'driver']);
    expect(p.roles.filter((r) => r.role === 'driver')).toHaveLength(1);
  });

  it('the consumer role always binds to the person itself (entityDid = personDid)', () => {
    const p = persons.attachRole(PHONE, 'consumer', 'ignored-entity-did');
    const link = p.roles.find((r) => r.role === 'consumer')!;
    expect(link.entityDid).toBe(p.personDid);
  });

  it('enroll requires an OTP-verified phone, then mints a consumer token', () => {
    expect(() => persons.enroll(PHONE, false)).toThrow(/Verify your phone/);
    const { person, isNew, token } = persons.enroll(PHONE, true, '4321');
    expect(isNew).toBe(true);
    const claims = auth.introspect(token.access_token);
    expect(claims.active).toBe(true);
    expect(claims.role).toBe('consumer');
    expect(claims.did).toBe(person.personDid);
    expect(claims.scopes).toEqual(expect.arrayContaining(['shipment:create', 'parcel:read:own', 'identity:self']));
  });

  it('sets a 4-digit PIN (rejecting bad shapes) and reopens with phone + PIN', () => {
    persons.enroll(PHONE, true);
    const did = persons.findByPhone(PHONE)!.personDid;
    expect(() => persons.setPin(did, '12')).toThrow(/4 digits/);
    expect(() => persons.setPin(did, 'abcd')).toThrow(/4 digits/);
    persons.setPin(did, '2468');
    expect(persons.loginWithPin(PHONE, '2468').person.personDid).toBe(did);
  });

  it('locks the PIN after repeated wrong tries — then only OTP re-entry works', () => {
    persons.enroll(PHONE, true, '1111');
    for (let i = 0; i < 5; i++) expect(() => persons.loginWithPin(PHONE, '9999')).toThrow(/Wrong phone or PIN/);
    // Locked now: even the CORRECT PIN is refused until the lockout clears / OTP re-verifies.
    expect(() => persons.loginWithPin(PHONE, '1111')).toThrow(/Too many wrong PINs/);
    // But re-enrolling by OTP resets the lockout and the credential.
    const re = persons.enroll(PHONE, true, '1111');
    expect(re.isNew).toBe(false);
    expect(persons.loginWithPin(PHONE, '1111').person.personDid).toBe(re.person.personDid);
  });

  it('does not reveal whether a phone is registered on a failed PIN login', () => {
    expect(() => persons.loginWithPin('+254700999999', '0000')).toThrow(/Wrong phone or PIN/); // unknown phone
    persons.enroll(PHONE, true, '1234');
    expect(() => persons.loginWithPin(PHONE, '0000')).toThrow(/Wrong phone or PIN/); // known phone, wrong pin — same message
  });

  it('switches to a held role, minting that role\'s actor token; refuses a role not held', () => {
    const agentDid = dids.generate('pudo:agent-entity').id;
    persons.enroll(PHONE, true, '1234');
    persons.attachRole(PHONE, 'agent', agentDid);
    const person = persons.findByPhone(PHONE)!;

    const agentTok = persons.mintForRole(person, 'agent');
    const claims = auth.introspect(agentTok.token.access_token);
    expect(claims.role).toBe('agent');
    expect(claims.did).toBe(agentDid); // bound to the agent ENTITY, not the person
    expect(claims.scopes).toContain('parcel:accept');

    // consumer switch returns to the person identity
    expect(auth.introspect(persons.mintForRole(person, 'consumer').token.access_token).did).toBe(person.personDid);

    expect(() => persons.mintForRole(person, 'vendor')).toThrow(/do not hold/);
  });

  it('tryAttachRole is best-effort: a blank/implausible phone is skipped, not thrown', () => {
    expect(persons.tryAttachRole(undefined, 'driver', 'did:x')).toBe(false);
    expect(persons.tryAttachRole('123', 'driver', 'did:x')).toBe(false);
    expect(persons.tryAttachRole(PHONE, 'driver', dids.generate('pudo-driver:z').id)).toBe(true);
  });
});
