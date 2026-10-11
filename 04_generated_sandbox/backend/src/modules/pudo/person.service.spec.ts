import { Test } from '@nestjs/testing';
import { PersonService } from './person.service';
import { toView } from './person.types';
import { MediaService } from './media.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { DidService } from '../../foundation/did/did.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { hashPhone } from '../../foundation/identity/phone';

describe('PersonService — the identity spine (S20)', () => {
  let persons: PersonService;
  let media: MediaService;
  let auth: AuthService;
  let dids: DidService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PersonService, MediaService, IdentityVault, FieldEncryption,
        AuthService, DidService, OperationalStore, LedgerService, EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    persons = moduleRef.get(PersonService);
    media = moduleRef.get(MediaService);
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
    const { person, isNew, token } = persons.enroll(PHONE, true, '48261');
    expect(isNew).toBe(true);
    const claims = auth.introspect(token.access_token);
    expect(claims.active).toBe(true);
    expect(claims.role).toBe('consumer');
    expect(claims.did).toBe(person.personDid);
    expect(claims.scopes).toEqual(expect.arrayContaining(['shipment:create', 'parcel:read:own', 'identity:self']));
  });

  it('sets a 5-digit PIN (rejecting bad shapes) and reopens with phone + PIN on the device the code was typed on', () => {
    const { device } = persons.enroll(PHONE, true);
    const did = persons.findByPhone(PHONE)!.personDid;
    expect(() => persons.setPin(did, '12')).toThrow(/5 digits/);
    expect(() => persons.setPin(did, 'abcde')).toThrow(/5 digits/);
    // Four was the length of a PIN — and is the length of a mobile-money PIN and a bank card's. Not of this one.
    expect(() => persons.setPin(did, '2468')).toThrow(/5 digits/);
    expect(() => persons.setPin(did, '246890')).toThrow(/5 digits/);
    persons.setPin(did, '24689');
    expect(persons.loginWithPin(PHONE, '24689', device).person.personDid).toBe(did);
  });

  it('locks the PIN after repeated wrong tries — then only OTP re-entry works', () => {
    persons.enroll(PHONE, true, '35792');
    for (let i = 0; i < 4; i++) expect(() => persons.loginWithPin(PHONE, '99999', persons.trustDevice(PHONE))).toThrow(/Wrong phone or PIN/);
    // The fifth wrong one locks it, and says so — the owner learns at once what will get them back in.
    expect(() => persons.loginWithPin(PHONE, '99999', persons.trustDevice(PHONE))).toThrow(/Too many wrong PINs/);
    // Locked now: even the CORRECT PIN is refused until the phone is verified by code again.
    expect(() => persons.loginWithPin(PHONE, '35792', persons.trustDevice(PHONE))).toThrow(/Too many wrong PINs/);
    // But re-enrolling by OTP resets the lockout and the credential.
    const re = persons.enroll(PHONE, true, '35792');
    expect(re.isNew).toBe(false);
    expect(persons.loginWithPin(PHONE, '35792', persons.trustDevice(PHONE)).person.personDid).toBe(re.person.personDid);
  });

  /** What a sign-in was refused with — or that it was not. */
  const refused = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      return (e as { code?: string }).code ?? 'threw something else';
    }
    return 'let in';
  };

  describe('a PIN works only on a device a code to the phone confirmed', () => {
    it('is not looked at anywhere else — right or wrong, and whoever has an account', () => {
      const mine = persons.enroll(PHONE, true, '24689');
      const theirs = persons.enroll('+254700888888', true, '48261');
      // No key, an empty one, a made-up one, and a real one that is somebody else's: the same answer, the right PIN included.
      for (const key of [undefined, '', 'dvc_made-up', theirs.device]) {
        expect([key, refused(() => persons.loginWithPin(PHONE, '24689', key))]).toEqual([key, 'DEVICE_NOT_KNOWN']);
        expect([key, refused(() => persons.loginWithPin(PHONE, '00000', key))]).toEqual([key, 'DEVICE_NOT_KNOWN']);
      }
      // A number nobody has is answered the same way: this door does not say who has an account.
      expect(refused(() => persons.loginWithPin('+254700999999', '00000', mine.device))).toBe('DEVICE_NOT_KNOWN');
      expect(refused(() => persons.loginWithPin('+254700999999', '00000'))).toBe('DEVICE_NOT_KNOWN');
      // NOTHING WAS COUNTED: nine tries from nowhere have not brought the PIN one step nearer its lock.
      expect(persons.findByPhone(PHONE)!.pinAttempts ?? 0).toBe(0);
      expect(persons.loginWithPin(PHONE, '24689', mine.device).person.personDid).toBe(mine.person.personDid);
    });

    it('on that device a wrong PIN is a wrong PIN, counted as it always was', () => {
      const { device } = persons.enroll(PHONE, true, '24689');
      expect(refused(() => persons.loginWithPin(PHONE, '00000', device))).toBe('AUTH_FAILED');
      expect(persons.findByPhone(PHONE)!.pinAttempts).toBe(1);
      expect(refused(() => persons.loginWithPin(PHONE, '24689', device))).toBe('let in');
    });

    it('a second device is confirmed by a code and changes nothing about the account; both then work', () => {
      const { device: phone, person } = persons.enroll(PHONE, true, '24689');
      const tablet = persons.trustDevice(PHONE);
      expect(tablet).toMatch(/^dvc_[0-9a-f]{64}$/);
      expect(tablet).not.toBe(phone);
      expect(persons.deviceCount(person.personDid)).toBe(2);
      for (const key of [phone, tablet]) expect(refused(() => persons.loginWithPin(PHONE, '24689', key))).toBe('let in');
      // A number with no account has no device to confirm: said to somebody who has just proved the number is theirs.
      expect(refused(() => persons.trustDevice('+254700999999'))).toBe('NOT_FOUND');
    });

    it('a PIN replaced by a code leaves it working on the device that did it, and on no other', () => {
      const { device: old, person } = persons.enroll(PHONE, true, '24689');
      const tablet = persons.trustDevice(PHONE);
      // Forgotten, or locked by wrong tries: the code again, and a new PIN.
      const again = persons.enroll(PHONE, true, '73914');
      expect(persons.deviceCount(person.personDid)).toBe(1);
      for (const key of [old, tablet]) expect(refused(() => persons.loginWithPin(PHONE, '73914', key))).toBe('DEVICE_NOT_KNOWN');
      expect(refused(() => persons.loginWithPin(PHONE, '73914', again.device))).toBe('let in');
      // The code alone, with no new PIN, confirms a device and forgets none.
      const third = persons.enroll(PHONE, true);
      expect(persons.deviceCount(person.personDid)).toBe(2);
      expect(refused(() => persons.loginWithPin(PHONE, '73914', third.device))).toBe('let in');
    });

    it('keeps ten devices to a person: the eleventh puts the oldest out', () => {
      const { device: first, person } = persons.enroll(PHONE, true, '24689');
      let last = first;
      for (let i = 0; i < 10; i++) last = persons.trustDevice(PHONE);
      expect(persons.deviceCount(person.personDid)).toBe(10);
      expect(refused(() => persons.loginWithPin(PHONE, '24689', first))).toBe('DEVICE_NOT_KNOWN');
      expect(refused(() => persons.loginWithPin(PHONE, '24689', last))).toBe('let in');
    });
  });

  it('switches to a held role, minting that role\'s actor token; refuses a role not held', () => {
    const agentDid = dids.generate('pudo:agent-entity').id;
    persons.enroll(PHONE, true, '24689');
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

  describe('self-managed profile (S29): a display name + an avatar', () => {
    // A minimal valid 1×1 PNG (real magic bytes, so it passes the MediaService signature check).
    const PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const avatarFor = (ownerDid: string) => media.upload({ ownerDid, kind: 'avatar', dataUrl: PNG }).mediaId;

    it('stores a display NAME in the vault (never the core) and reveals it only in the self-view', () => {
      const { person } = persons.enroll(PHONE, true, '24689');
      persons.setProfile(person.personDid, { displayName: '  Hans  ' });
      const p = persons.findByDid(person.personDid)!;
      expect(p.vaultRef).toBeTruthy(); // the name went to the vault, not onto the person/core
      expect(persons.view(p).displayName).toBe('Hans'); // trimmed on the way in
      expect(toViewHasName(p)).toBe(false); // the PII-free projection never carries the name
    });

    it('rejects an empty or over-long display name', () => {
      const { person } = persons.enroll(PHONE, true, '24689');
      expect(() => persons.setProfile(person.personDid, { displayName: '   ' })).toThrow(/cannot be empty/);
      expect(() => persons.setProfile(person.personDid, { displayName: 'x'.repeat(81) })).toThrow(/too long/);
    });

    it('updates the name IN PLACE (stable vault handle) rather than orphaning a record', () => {
      const { person } = persons.enroll(PHONE, true, '24689');
      persons.setProfile(person.personDid, { displayName: 'First' });
      const ref1 = persons.findByDid(person.personDid)!.vaultRef;
      persons.setProfile(person.personDid, { displayName: 'Second' });
      const p = persons.findByDid(person.personDid)!;
      expect(p.vaultRef).toBe(ref1);
      expect(persons.view(p).displayName).toBe('Second');
    });

    it('links an OWNED avatar to the person and purges the previous one on replace', () => {
      const { person } = persons.enroll(PHONE, true, '24689');
      const first = avatarFor(person.personDid);
      persons.setProfile(person.personDid, { avatarMediaId: first });
      expect(persons.view(persons.findByDid(person.personDid)!).avatarMediaId).toBe(first);
      expect(media.get(first)!.link).toEqual({ type: 'person', id: person.personDid });

      const second = avatarFor(person.personDid);
      persons.setProfile(person.personDid, { avatarMediaId: second });
      expect(persons.findByDid(person.personDid)!.avatarMediaId).toBe(second);
      expect(media.get(first)).toBeUndefined(); // the old avatar's bytes + ref are gone
    });

    it('refuses an avatar the person does not own (no cross-owner pinning)', () => {
      const { person } = persons.enroll(PHONE, true, '24689');
      const notMine = avatarFor(dids.generate('person:stranger').id);
      expect(() => persons.setProfile(person.personDid, { avatarMediaId: notMine })).toThrow(/not yours/);
      expect(persons.findByDid(person.personDid)!.avatarMediaId).toBeUndefined();
    });

    it('refuses a media the person owns but did NOT upload as an avatar (no evidence-photo laundering)', () => {
      const { person } = persons.enroll(PHONE, true, '24689');
      // A PoD/dispute photo the receiver owns lives in a LOCKED evidence bin. Pinning it as an avatar would
      // re-kind it out of that bin and let a later replace hard-delete it — the setProfile guard forbids it.
      const podId = media.upload({ ownerDid: person.personDid, kind: 'pod', dataUrl: PNG }).mediaId;
      expect(() => persons.setProfile(person.personDid, { avatarMediaId: podId })).toThrow(/profile photo/i);
      expect(media.get(podId)!.kind).toBe('pod'); // untouched: not re-kinded
      expect(media.get(podId)!.link).toBeUndefined(); // untouched: not re-linked to the person
      expect(persons.findByDid(person.personDid)!.avatarMediaId).toBeUndefined();
    });

    it('degrades gracefully when the vault entry is gone (in-memory vault lost on restart, vaultRef persisted)', () => {
      const { person } = persons.enroll(PHONE, true, '24689');
      persons.setProfile(person.personDid, { displayName: 'Hans' });
      const p = persons.findByDid(person.personDid)!;
      p.vaultRef = 'vault_gone'; // simulate a restart: the Person persisted, the in-memory vault did not
      expect(() => persons.view(p)).not.toThrow(); // me()/login/enroll must NOT 404 the whole surface
      expect(persons.view(p).displayName).toBeUndefined();
      // and a returning consumer can re-seed the vault instead of hitting vault.update's NotFoundException
      expect(() => persons.setProfile(person.personDid, { displayName: 'Hans again' })).not.toThrow();
      expect(persons.view(persons.findByDid(person.personDid)!).displayName).toBe('Hans again');
    });
  });
});

/** The pure PII-free projection must never carry the display name — only the revealing view() does. */
function toViewHasName(person: Parameters<typeof toView>[0]): boolean {
  return 'displayName' in toView(person) && toView(person).displayName !== undefined;
}
