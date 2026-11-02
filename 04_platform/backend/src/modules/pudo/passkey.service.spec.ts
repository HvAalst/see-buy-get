import { Test } from '@nestjs/testing';
import { PersonService } from './person.service';
import { PasskeyService } from './passkey.service';
import { AccountService } from './account.service';
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
import { GlosError } from '../../foundation/http/glos-error';
import { CHALLENGE_TTL_MS, UNLOCK_TTL_MS, relyingParty } from './passkeys';
import { SoftAuthenticator } from '../../../test/soft-authenticator';

/**
 * UNLOCK WITH FINGERPRINT OR FACE (the owner, 2026-11-02: "if face unlock works, integrate it, but then in settings
 * users should be able to undo it and get back to a preferred option").
 *
 * A phone in software (test/soft-authenticator.ts) makes the passkey and signs; the server's real checks read it. What
 * is proved: it is turned on only with the PIN, on a device the PIN works on; it unlocks for a ticket the PIN door takes
 * in the PIN's place — once, for two minutes, for that number and that device; another device, a stranger's question
 * and a turned-off passkey get nothing; a bad answer counts against the PIN's own lock; and a passkey goes with its
 * device, by every path that forgets one.
 */
describe('unlock with fingerprint or face', () => {
  let persons: PersonService;
  let passkeys: PasskeyService;
  const PIN = '48261';
  let n = 0;
  const phone = () => `+25471${String(++n).padStart(7, '0')}`;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PersonService, PasskeyService, MediaService, IdentityVault, FieldEncryption,
        AuthService, DidService, OperationalStore, LedgerService, EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        // The person's side only: a shop's, a hub's and a store's are proved over the wire (test/account-passkey.e2e-spec.ts).
        { provide: AccountService, useValue: {} },
      ],
    }).compile();
    persons = moduleRef.get(PersonService);
    passkeys = moduleRef.get(PasskeyService);
  });
  afterEach(() => jest.restoreAllMocks());

  /** Somebody with a PIN, on the device a code to their number was typed on. */
  const signedUp = (number = phone()) => {
    const { person, device } = persons.enroll(number, true, PIN);
    return { number, personDid: person.personDid, device };
  };
  /** Turned on in Settings: the PIN, then the phone's answer. */
  const turnedOn = async (who: { personDid: string; device: string }, phoneApp = new SoftAuthenticator(), keys = [who.device]) => {
    const { options } = await passkeys.turnOnOptions(who.personDid, keys, PIN);
    await passkeys.turnOn(who.personDid, keys, phoneApp.register(options) as never);
    return phoneApp;
  };
  /** At the sign-in screen: the options, the phone's signature, the ticket. */
  const unlocked = async (number: string, device: string | undefined, phoneApp: SoftAuthenticator, opts: Parameters<SoftAuthenticator['assert']>[1] = {}) => {
    const options = await passkeys.unlockOptions(number, device);
    return passkeys.unlock(number, device, phoneApp.assert(options.challenge, opts) as never);
  };
  const codeOf = async (work: () => unknown): Promise<string> => {
    try {
      await work();
      return 'in';
    } catch (err) {
      return err instanceof GlosError ? err.code : String(err);
    }
  };

  it('turns on with the PIN, on a device the PIN works on — and says so', async () => {
    const me = signedUp();
    expect(passkeys.here(me.personDid, [me.device])).toEqual({ on: false, which: 0 });
    // Not on a browser this person's PIN never worked on, and not without the right PIN (counted, as at the door).
    expect(await codeOf(() => passkeys.turnOnOptions(me.personDid, ['dvc_made-up'], PIN))).toBe('DEVICE_NOT_KNOWN');
    expect(await codeOf(() => passkeys.turnOnOptions(me.personDid, [me.device], '00000'))).toBe('PIN_WRONG');
    expect(persons.findByDid(me.personDid)?.pinAttempts).toBe(1);

    const { options, which } = await passkeys.turnOnOptions(me.personDid, ['dvc_another-number', me.device], PIN);
    expect(which).toBe(1);
    expect(options.rp.id).toBe('localhost');
    expect(options.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' });
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
    const phoneApp = new SoftAuthenticator();
    const on = await passkeys.turnOn(me.personDid, ['dvc_another-number', me.device], phoneApp.register(options) as never);
    expect(on).toMatchObject({ on: true, which: 1, id: phoneApp.id });
    expect(passkeys.here(me.personDid, [me.device])).toMatchObject({ on: true, which: 0, id: phoneApp.id });
    // The challenge answered once: the same answer again changes nothing.
    expect(await codeOf(() => passkeys.turnOn(me.personDid, [me.device], phoneApp.register(options) as never))).toBe('INVALID_STATE');
  });

  it('is not turned on by a phone that did not check the finger or face, from another site, or for another person', async () => {
    const me = signedUp();
    const other = signedUp();
    const phoneApp = new SoftAuthenticator();
    const ask = async () => (await passkeys.turnOnOptions(me.personDid, [me.device], PIN)).options;
    expect(await codeOf(async () => passkeys.turnOn(me.personDid, [me.device], phoneApp.register(await ask(), { verified: false }) as never))).toBe('INVALID_STATE');
    expect(await codeOf(async () => passkeys.turnOn(me.personDid, [me.device], phoneApp.register(await ask(), { origin: 'https://evil.example' }) as never))).toBe('INVALID_STATE');
    // A challenge handed to one person is no use to another, even on their own device.
    expect(await codeOf(async () => passkeys.turnOn(other.personDid, [other.device], phoneApp.register(await ask()) as never))).toBe('INVALID_STATE');
    expect(passkeys.here(me.personDid, [me.device]).on).toBe(false);
    expect(passkeys.here(other.personDid, [other.device]).on).toBe(false);
  });

  it('unlocks for a ticket the PIN door takes in the PIN’s place — once', async () => {
    const me = signedUp();
    const phoneApp = await turnedOn(me);
    const { unlock, expiresIn } = await unlocked(me.number, me.device, phoneApp);
    expect(unlock).toMatch(/^unl_[0-9a-f]{64}$/);
    expect(expiresIn).toBe(120);
    const door = persons.loginWithPin(me.number, undefined, me.device, unlock);
    expect(door.person.personDid).toBe(me.personDid);
    expect(door.token.access_token).toBeTruthy();
    // Once: the same ticket again opens nothing.
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, unlock))).toBe('UNLOCK_FAILED');
    // And nothing is a ticket that was not handed out: a made-up one, or a PIN sent as one.
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, `unl_${'0'.repeat(64)}`))).toBe('UNLOCK_FAILED');
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, PIN))).toBe('UNLOCK_FAILED');
    // The PIN still works, as it always did.
    expect(persons.loginWithPin(me.number, PIN, me.device).person.personDid).toBe(me.personDid);
  });

  it('a ticket runs out in two minutes; a challenge in two', async () => {
    const me = signedUp();
    const phoneApp = await turnedOn(me);
    const start = Date.now();
    const { unlock } = await unlocked(me.number, me.device, phoneApp);
    jest.spyOn(Date, 'now').mockReturnValue(start + UNLOCK_TTL_MS + 1_000);
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, unlock))).toBe('UNLOCK_FAILED');
    jest.restoreAllMocks();

    const options = await passkeys.unlockOptions(me.number, me.device);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + CHALLENGE_TTL_MS + 1_000);
    expect(await codeOf(() => passkeys.unlock(me.number, me.device, phoneApp.assert(options.challenge) as never))).toBe('UNLOCK_FAILED');
    // A slow tap is not a guess: nothing counted.
    expect(persons.findByDid(me.personDid)?.pinAttempts ?? 0).toBe(0);
  });

  it('opens only on the device it was made on, for its own number', async () => {
    const me = signedUp();
    const phoneApp = await turnedOn(me);
    // Another device of the same person's (confirmed by a code there) holds no passkey: nothing is offered, nothing opens.
    const laptop = persons.trustDevice(me.number);
    expect((await passkeys.unlockOptions(me.number, laptop)).allowCredentials).toEqual([]);
    expect(await codeOf(() => unlocked(me.number, laptop, phoneApp))).toBe('UNLOCK_OFF');
    // A ticket made on the phone is refused at the door with the laptop's key, or with another number.
    const { unlock } = await unlocked(me.number, me.device, phoneApp);
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, laptop, unlock))).toBe('UNLOCK_FAILED');
    const other = signedUp();
    const second = await unlocked(me.number, me.device, phoneApp);
    expect(await codeOf(() => persons.loginWithPin(other.number, undefined, other.device, second.unlock))).toBe('UNLOCK_FAILED');
    // Somebody else's device key, and no key at all, are not this person's devices.
    expect(await codeOf(() => unlocked(me.number, other.device, phoneApp))).toBe('DEVICE_NOT_KNOWN');
    expect(await codeOf(() => unlocked(me.number, undefined, phoneApp))).toBe('DEVICE_NOT_KNOWN');
    // A challenge asked for another number is not one for this one.
    const theirs = await passkeys.unlockOptions(other.number, other.device);
    expect(await codeOf(() => passkeys.unlock(me.number, me.device, phoneApp.assert(theirs.challenge) as never))).toBe('UNLOCK_FAILED');
  });

  it('asking tells a stranger nothing: the same shape for a number nobody has, a device not theirs, and nothing turned on', async () => {
    const me = signedUp();
    const plain = signedUp();
    const phoneApp = await turnedOn(me);
    const shapes = await Promise.all([
      passkeys.unlockOptions(phone(), undefined),
      passkeys.unlockOptions(phone(), me.device),
      passkeys.unlockOptions(me.number, undefined),
      passkeys.unlockOptions(me.number, plain.device),
      passkeys.unlockOptions(plain.number, plain.device),
      passkeys.unlockOptions('not a number', 'dvc_made-up'),
    ]);
    // What goes on the wire: the same fields, every time.
    const wire = (o: object) => Object.keys(JSON.parse(JSON.stringify(o))).sort();
    for (const s of shapes) {
      expect(wire(s)).toEqual(['allowCredentials', 'challenge', 'rpId', 'timeout', 'userVerification']);
      expect(s.allowCredentials).toEqual([]);
      expect(s.userVerification).toBe('required');
    }
    expect(new Set(shapes.map((s) => s.challenge)).size).toBe(shapes.length);
    // Only the device key it was made on is told its id.
    const mine = await passkeys.unlockOptions(me.number, me.device);
    expect(wire(mine)).toEqual(wire(shapes[0]));
    expect(mine.allowCredentials).toEqual([expect.objectContaining({ id: phoneApp.id, type: 'public-key' })]);
  });

  it('turned off: nothing offered, nothing unlocked, and a ticket already handed out is refused — the PIN is the way in', async () => {
    const me = signedUp();
    const phoneApp = await turnedOn(me);
    const { unlock } = await unlocked(me.number, me.device, phoneApp);
    const off = passkeys.turnOff(me.personDid, [me.device]);
    expect(off).toMatchObject({ on: false, which: 0, dropped: phoneApp.id, rpId: relyingParty().rpID });
    expect(passkeys.here(me.personDid, [me.device]).on).toBe(false);
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, unlock))).toBe('UNLOCK_FAILED');
    expect((await passkeys.unlockOptions(me.number, me.device)).allowCredentials).toEqual([]);
    expect(await codeOf(() => unlocked(me.number, me.device, phoneApp))).toBe('UNLOCK_OFF');
    // The device is still one the PIN works on.
    expect(persons.loginWithPin(me.number, PIN, me.device).person.personDid).toBe(me.personDid);
    // Off twice changes nothing; on again works.
    expect(passkeys.turnOff(me.personDid, [me.device])).toEqual({ on: false, which: 0 });
    const again = await turnedOn(me);
    expect(passkeys.here(me.personDid, [me.device]).id).toBe(again.id);
  });

  it('refused if the passkey on the device was replaced after the ticket was handed out', async () => {
    const me = signedUp();
    const first = await turnedOn(me);
    const { unlock } = await unlocked(me.number, me.device, first);
    await turnedOn(me, new SoftAuthenticator());
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, unlock))).toBe('UNLOCK_OFF');
  });

  it('a bad answer counts with the wrong PINs, against the same lock — and a locked PIN locks the unlock too', async () => {
    const me = signedUp();
    const phoneApp = await turnedOn(me);
    const said: string[] = [];
    // A phone that did not check the finger or face, a foreign site, a forged signature.
    said.push(await codeOf(() => unlocked(me.number, me.device, phoneApp, { verified: false })));
    said.push(await codeOf(() => unlocked(me.number, me.device, phoneApp, { origin: 'https://evil.example' })));
    said.push(await codeOf(() => unlocked(me.number, me.device, phoneApp, { rpId: 'evil.example' })));
    said.push(await codeOf(() => unlocked(me.number, me.device, phoneApp, { tamper: true })));
    expect(said).toEqual(['UNLOCK_FAILED', 'UNLOCK_FAILED', 'UNLOCK_FAILED', 'UNLOCK_FAILED']);
    expect(persons.findByDid(me.personDid)?.pinAttempts).toBe(4);
    // A ticket from before the lock…
    const { unlock } = await unlocked(me.number, me.device, phoneApp);
    // …and the right one resets the count, as the right PIN does.
    expect(persons.findByDid(me.personDid)?.pinAttempts).toBe(4);
    persons.loginWithPin(me.number, undefined, me.device, unlock);
    expect(persons.findByDid(me.personDid)?.pinAttempts).toBe(0);
    // Five wrong — PINs and unlocks together — lock it, and then neither opens.
    for (let i = 0; i < 4; i++) await codeOf(() => persons.loginWithPin(me.number, '00000', me.device));
    const held = await unlocked(me.number, me.device, phoneApp);
    expect(await codeOf(() => unlocked(me.number, me.device, phoneApp, { tamper: true }))).toBe('PIN_LOCKED');
    expect(await codeOf(() => unlocked(me.number, me.device, phoneApp))).toBe('PIN_LOCKED');
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, held.unlock))).toBe('PIN_LOCKED');
    expect(await codeOf(() => persons.loginWithPin(me.number, PIN, me.device))).toBe('PIN_LOCKED');
  });

  it('a door that mints nothing hands the next door a fresh ticket, running out when the first did', async () => {
    const me = signedUp();
    const phoneApp = await turnedOn(me);
    const start = Date.now();
    const { unlock } = await unlocked(me.number, me.device, phoneApp);
    const first = persons.loginWithPin(me.number, undefined, me.device, unlock);
    const next = persons.relayUnlock(first.unlocked!);
    expect(next).not.toBe(unlock);
    expect(persons.loginWithPin(me.number, undefined, me.device, next).person.personDid).toBe(me.personDid);
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, next))).toBe('UNLOCK_FAILED');
    const later = persons.relayUnlock(first.unlocked!);
    jest.spyOn(Date, 'now').mockReturnValue(start + UNLOCK_TTL_MS + 1_000);
    expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, later))).toBe('UNLOCK_FAILED');
  });

  describe('a passkey goes when its device goes', () => {
    const offered = async (number: string, device: string) => (await passkeys.unlockOptions(number, device)).allowCredentials?.length ?? 0;

    it('signing this device out from the devices list', async () => {
      const me = signedUp();
      await turnedOn(me);
      expect(await offered(me.number, me.device)).toBe(1);
      persons.forgetThisDevice(me.personDid, [me.device]);
      expect(await offered(me.number, me.device)).toBe(0);
    });

    it('forgetting every other device, from another', async () => {
      const me = signedUp();
      await turnedOn(me);
      const laptop = persons.trustDevice(me.number);
      persons.forgetOtherDevices(me.personDid, PIN, [laptop]);
      expect(await offered(me.number, me.device)).toBe(0);
    });

    it('a PIN replaced by a code', async () => {
      const me = signedUp();
      await turnedOn(me);
      const { device } = persons.enroll(me.number, true, '73914', me.device);
      expect(await offered(me.number, me.device)).toBe(0);
      expect(await offered(me.number, device)).toBe(0);
    });

    it('the account moved to a new number', async () => {
      const me = signedUp();
      await turnedOn(me);
      const moved = phone();
      persons.movePhone(me.personDid, moved, 'self');
      expect(await offered(moved, me.device)).toBe(0);
      expect(await offered(me.number, me.device)).toBe(0);
    });

    it('a PIN changed with the current one: the device stays, every passkey made with the old PIN goes', async () => {
      const me = signedUp();
      const phoneApp = await turnedOn(me);
      const held = await unlocked(me.number, me.device, phoneApp);
      persons.changePinForPerson(me.personDid, PIN, '73914');
      expect(await offered(me.number, me.device)).toBe(0);
      expect(await codeOf(() => persons.loginWithPin(me.number, undefined, me.device, held.unlock))).toBe('UNLOCK_FAILED');
      expect(persons.loginWithPin(me.number, '73914', me.device).person.personDid).toBe(me.personDid);
    });

    it('the account closed', async () => {
      const me = signedUp();
      await turnedOn(me);
      persons.close(me.personDid);
      expect(passkeys.here(me.personDid, [me.device])).toEqual({ on: false, which: -1 });
    });
  });
});
