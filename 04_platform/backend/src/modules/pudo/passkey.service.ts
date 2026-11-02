import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { GlosError } from '../../foundation/http/glos-error';
import { hashEmail, hashPhone, isPlausiblePhone } from '../../foundation/identity/phone';
import { PersonService } from './person.service';
import { AccountService } from './account.service';
import { Challenges, PASSKEY_ALGORITHMS, PROMPT_MS, UNLOCK_TTL_MS, deviceHashOf, relyingParty, type Challenge, type DevicePasskey } from './passkeys';

/** What Settings is told about this device: on or off, which of the browser's keys is this person's, and the passkey's id. */
export interface PasskeyHere {
  on: boolean;
  /** The place of this person's key among the keys the browser sent; -1 when none of them is theirs. A shop's phone: 0, or -1. */
  which: number;
  /** The passkey's id where it is on: the browser keeps it beside the device key, to know to offer the unlock. */
  id?: string;
  /** Since when. */
  addedAt?: string;
  /** Where it was turned off just now: the site it belonged to, so the phone can be told to forget it too. */
  rpId?: string;
  dropped?: string;
}

/** A challenge as the library takes it: the bytes. Given a string, it would send the string's own bytes, re-encoded. */
const bytesOf = (challenge: string) => Uint8Array.from(Buffer.from(challenge, 'base64url'));

/** The challenge the phone signed, read from what it signed — the one thing that says which ceremony this answers. */
function challengeOf(response: { response?: { clientDataJSON?: unknown } } | undefined): string | undefined {
  try {
    const raw = response?.response?.clientDataJSON;
    if (typeof raw !== 'string' || raw.length > 4096) return undefined;
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { challenge?: unknown };
    return typeof parsed.challenge === 'string' ? parsed.challenge : undefined;
  } catch {
    return undefined;
  }
}

/** A challenge answered for exactly what it was handed out for: one kind, one purpose, one owner or address, one device. */
const answers = (asked: Challenge | undefined, want: Omit<Challenge, 'expiresAt'>): boolean =>
  Boolean(asked && asked.purpose === want.purpose && asked.holder === want.holder && asked.owner === want.owner && asked.address === want.address && asked.deviceHash === want.deviceHash);

/**
 * UNLOCK WITH FINGERPRINT OR FACE (the owner, 2026-11-02: "if face unlock works, integrate it, but then in settings
 * users should be able to undo it and get back to a preferred option"). The ceremonies — turning it on, and unlocking —
 * verified by @simplewebauthn/server; what is kept, and the ticket a door takes, are PersonService's (see passkeys.ts).
 *
 * TURNING IT ON is Settings', signed in, on a device of the person's (one a code to their number confirmed), with the
 * PIN again: a phone left signed in is not proof of who holds it, and a passkey made by whoever picked it up would open
 * the account without the PIN from then on. The PIN goes through the door's own check and counter.
 *
 * UNLOCKING is a sign-in screen's, signed out: the options are asked for by number and device key, and are answered in
 * the same shape whoever asks — a number nobody has, a device that is not theirs, a device with no passkey — so the
 * question tells a stranger nothing. A passkey's id is offered only to the device key it was made on. The phone's
 * answer is checked on that device, against the lock, and a bad one is counted with the wrong PINs.
 *
 * 2026-11-02, later (the owner: "ok go ahead with the fingerprint") — THE SAME FOR A SHOP'S, A HUB'S AND A STORE'S OWN
 * SIGN-IN, whose password is the account's (AccountService): turned on with the password, on one of the account's own
 * phones; asked for by email and that phone's key; a ticket its own doors (auth/login, vendors/session) take in the
 * password's place; a bad answer counted with the wrong passwords. Same core, separate challenges and tickets.
 */
@Injectable()
export class PasskeyService {
  private readonly challenges = new Challenges();

  constructor(
    private readonly persons: PersonService,
    private readonly accounts: AccountService,
  ) {}

  /* ------------------------------------------------------------------------------------- the core -- */

  /** What the phone needs to make a passkey: platform only, the finger or face required, ES256 or RS256, nothing to attest. */
  private registrationOptions(userKey: string, challenge: string, existing: DevicePasskey | undefined): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const rp = relyingParty();
    return generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      // What the phone's own list of passkeys shows. The app names the number or the address on the phone; we keep hashes.
      userName: 'SeeBuyGet',
      userDisplayName: 'SeeBuyGet',
      // The same handle for the same person (or account), so a passkey made again on one phone replaces the one before it.
      userID: new Uint8Array(createHash('sha256').update(userKey).digest()),
      challenge: bytesOf(challenge),
      timeout: PROMPT_MS,
      attestationType: 'none',
      excludeCredentials: existing ? [{ id: existing.id, ...(existing.transports ? { transports: existing.transports } : {}) }] : [],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
    });
  }

  /** The phone's answer to "make one": from one of our sites, with the finger or face checked. What is kept, or a refusal. */
  private async registered(response: RegistrationResponseJSON): Promise<DevicePasskey> {
    const rp = relyingParty();
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyRegistrationResponse({ response, expectedChallenge: challengeOf(response) as string, expectedOrigin: rp.origins, expectedRPID: rp.rpID, requireUserVerification: true, supportedAlgorithmIDs: PASSKEY_ALGORITHMS });
    } catch {
      throw new GlosError('INVALID_STATE', 'The phone’s answer did not check out, so nothing was turned on. Try again.');
    }
    if (!verified.verified || !verified.registrationInfo.userVerified) throw new GlosError('INVALID_STATE', 'The phone did not check your fingerprint or face, so nothing was turned on. Try again.');
    const { credential } = verified.registrationInfo;
    return {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      ...(credential.transports?.length ? { transports: credential.transports.slice(0, 8) } : {}),
      addedAt: new Date().toISOString(),
    };
  }

  /** What the phone needs to unlock: a challenge always; the passkey's id only where there is one for this device. */
  private authenticationOptions(challenge: string, passkey: DevicePasskey | undefined): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: relyingParty().rpID,
      challenge: bytesOf(challenge),
      timeout: PROMPT_MS,
      userVerification: 'required',
      allowCredentials: passkey ? [{ id: passkey.id, ...(passkey.transports ? { transports: passkey.transports } : {}) }] : [],
    });
  }

  /** The phone's signature, against the passkey it claims to be: the new counter, or undefined when it does not check out. */
  private async signed(response: AuthenticationResponseJSON, passkey: DevicePasskey): Promise<number | undefined> {
    const rp = relyingParty();
    try {
      const checked = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeOf(response) as string,
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        credential: { id: passkey.id, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')), counter: passkey.counter, ...(passkey.transports ? { transports: passkey.transports } : {}) },
        requireUserVerification: true,
      });
      return checked.verified && checked.authenticationInfo.userVerified ? checked.authenticationInfo.newCounter : undefined;
    } catch {
      return undefined;
    }
  }

  /* -------------------------------------------------------------------------- a person, by PIN -- */

  /** Settings: is it on here? Read on the device's own record, among the keys this browser holds. */
  here(personDid: string, keys: string[] | undefined): PasskeyHere {
    const { which, passkey } = this.persons.passkeyHere(personDid, keys);
    return { on: Boolean(passkey), which, ...(passkey ? { id: passkey.id, addedAt: passkey.addedAt } : {}) };
  }

  /**
   * Settings, step one: the PIN, then what the phone needs to make a passkey. Refused — before the PIN is looked at —
   * where none of the browser's keys is a device of this person's: a passkey is bound to a device the PIN works on.
   */
  async turnOnOptions(personDid: string, keys: string[] | undefined, pin: string): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; which: number }> {
    const { which, key, passkey } = this.persons.passkeyHere(personDid, keys);
    if (!key) throw new GlosError('DEVICE_NOT_KNOWN', 'Your PIN does not work on this phone or browser yet, so a fingerprint or face cannot stand in for it here. Sign in here with your PIN first.');
    this.persons.confirmPin(personDid, pin);
    const challenge = this.challenges.issue({ purpose: 'register', holder: 'person', owner: personDid, deviceHash: deviceHashOf(key) });
    return { options: await this.registrationOptions(`passkey-user:${personDid}`, challenge, passkey), which };
  }

  /**
   * Settings, step two: the phone's answer. It must answer the challenge handed out for this person on this device,
   * from one of our own sites, with the fingerprint or face checked (user verification) — then the public key is kept
   * on this device's record, in place of any it had.
   */
  async turnOn(personDid: string, keys: string[] | undefined, response: RegistrationResponseJSON): Promise<PasskeyHere> {
    const { which, key } = this.persons.passkeyHere(personDid, keys);
    if (!key) throw new GlosError('DEVICE_NOT_KNOWN', 'Your PIN does not work on this phone or browser yet. Sign in here with your PIN first.');
    if (!answers(this.challenges.take(challengeOf(response)), { purpose: 'register', holder: 'person', owner: personDid, deviceHash: deviceHashOf(key) })) {
      throw new GlosError('INVALID_STATE', 'That took too long, or it was asked on another phone. Start again.');
    }
    const passkey = await this.registered(response);
    if (!this.persons.setPasskey(personDid, key, passkey)) throw new GlosError('DEVICE_NOT_KNOWN', 'This phone or browser was forgotten meanwhile. Sign in here with your PIN first.');
    return { on: true, which, id: passkey.id, addedAt: passkey.addedAt };
  }

  /**
   * Settings: TURN IT OFF here. No PIN — it takes something away from whoever holds the phone and gives nothing. The
   * PIN works as it always did; the device stays one it works on.
   */
  turnOff(personDid: string, keys: string[] | undefined): PasskeyHere {
    const { which, key } = this.persons.passkeyHere(personDid, keys);
    const dropped = this.persons.dropPasskey(personDid, key);
    return { on: false, which, ...(dropped ? { dropped: dropped.id, rpId: relyingParty().rpID } : {}) };
  }

  /**
   * A sign-in screen: what the phone needs to unlock. The same shape for everybody — a challenge, always; the passkey's
   * id only to the device key it was made on, for the number it belongs to. Nothing here says whether the number has an
   * account, and the device key is a secret only that device holds.
   */
  async unlockOptions(phone: string, device: string | undefined): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const person = this.persons.findByPhone(phone);
    const passkey = this.persons.passkeyOf(person?.personDid, device);
    const challenge = this.challenges.issue({ purpose: 'unlock', holder: 'person', address: isPlausiblePhone(phone) ? hashPhone(phone) : '', deviceHash: deviceHashOf(device ?? '') });
    return this.authenticationOptions(challenge, passkey);
  }

  /**
   * A sign-in screen: the phone's answer → an unlock ticket for the app's own door. Asked in the PIN door's order: the
   * device first (DEVICE_NOT_KNOWN, the same answer for a number nobody has), then the lock, then whether this device
   * holds a passkey at all, then the answer itself. A stale or foreign challenge is refused and not counted — that is
   * a slow tap, not a guess; a signature that does not check out is counted with the wrong PINs.
   */
  async unlock(phone: string, device: string | undefined, response: AuthenticationResponseJSON): Promise<{ unlock: string; expiresIn: number }> {
    const person = this.persons.findByPhone(phone);
    if (!person || !device || !this.persons.knowsDevice(person.personDid, device)) {
      throw new GlosError('DEVICE_NOT_KNOWN', 'This phone or browser has not signed in to this account before. Confirm the number by the code we send to it, then use your PIN here');
    }
    if (!person.pinHash) throw new GlosError('AUTH_FAILED', 'Wrong phone or PIN');
    if (this.persons.isPinLocked(person)) throw new GlosError('PIN_LOCKED', 'Too many wrong PINs. Verify your phone by code to sign in.');
    const passkey = this.persons.passkeyOf(person.personDid, device);
    if (!passkey || response?.id !== passkey.id) throw new GlosError('UNLOCK_OFF', 'Unlocking with fingerprint or face is off on this phone or browser. Use your PIN.');
    if (!answers(this.challenges.take(challengeOf(response)), { purpose: 'unlock', holder: 'person', address: person.phoneHash, deviceHash: deviceHashOf(device) })) {
      throw new GlosError('UNLOCK_FAILED', 'That took too long. Unlock again, or use your PIN.');
    }
    const counter = await this.signed(response, passkey);
    if (counter === undefined) return this.persons.failedUnlock(person);
    this.persons.passkeyUsed(person.personDid, device, counter);
    const { ticket } = this.persons.issueUnlock(person, device, passkey.id);
    return { unlock: ticket, expiresIn: Math.round(UNLOCK_TTL_MS / 1000) };
  }

  /* ------------------------------------------------------- a shop, a hub or a store, by its password -- */

  /**
   * Settings, in the Shop, Hub or Store app: is it on, on this phone? A shop's phone has ONE key for its account (the app
   * keeps it under the account's address), so `which` is 0 for one of the account's own phones and -1 for any other.
   */
  accountHere(did: string, device: string | undefined): PasskeyHere {
    const { known, passkey } = this.accounts.passkeyHere(did, device);
    return { on: Boolean(passkey), which: known ? 0 : -1, ...(passkey ? { id: passkey.id, addedAt: passkey.addedAt } : {}) };
  }

  /**
   * Turning it on, step one: on one of the account's own phones (asked first — nothing is looked at elsewhere), then the
   * password again, through the sign-in's own count and lock.
   */
  async accountTurnOnOptions(did: string, device: string | undefined, password: string): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; which: number }> {
    const { known, passkey, accountId } = this.accounts.passkeyHere(did, device);
    if (!known || !device) throw new GlosError('DEVICE_NOT_KNOWN', 'This phone or browser is not one of the account’s own yet, so a fingerprint or face cannot stand in for its password here. Sign in here with the password first.');
    this.accounts.confirmPassword(did, password);
    const challenge = this.challenges.issue({ purpose: 'register', holder: 'account', owner: accountId, deviceHash: deviceHashOf(device) });
    return { options: await this.registrationOptions(`passkey-account:${accountId}`, challenge, passkey), which: 0 };
  }

  /** …step two: the phone's answer, for this account on this phone. Kept on the phone's own record. */
  async accountTurnOn(did: string, device: string | undefined, response: RegistrationResponseJSON): Promise<PasskeyHere> {
    const { known, accountId } = this.accounts.passkeyHere(did, device);
    if (!known || !device) throw new GlosError('DEVICE_NOT_KNOWN', 'This phone or browser is not one of the account’s own yet. Sign in here with the password first.');
    if (!answers(this.challenges.take(challengeOf(response)), { purpose: 'register', holder: 'account', owner: accountId, deviceHash: deviceHashOf(device) })) {
      throw new GlosError('INVALID_STATE', 'That took too long, or it was asked on another phone. Start again.');
    }
    const passkey = await this.registered(response);
    if (!this.accounts.setPasskey(did, device, passkey)) throw new GlosError('DEVICE_NOT_KNOWN', 'This phone or browser was forgotten meanwhile. Sign in here with the password first.');
    return { on: true, which: 0, id: passkey.id, addedAt: passkey.addedAt };
  }

  /** Turn it off on this phone. No password: it gives nothing, and the password works as it always did. */
  accountTurnOff(did: string, device: string | undefined): PasskeyHere {
    const { known } = this.accounts.passkeyHere(did, device);
    const dropped = this.accounts.dropPasskey(did, device);
    return { on: false, which: known ? 0 : -1, ...(dropped ? { dropped: dropped.id, rpId: relyingParty().rpID } : {}) };
  }

  /**
   * A sign-in screen, by email and this phone's key. The same shape for every address — an account's or nobody's, one
   * whose phones are its own or not — with the passkey's id only to the phone it was made on.
   */
  async accountUnlockOptions(email: string, device: string | undefined): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const target = this.accounts.unlockTarget(email, device);
    const challenge = this.challenges.issue({ purpose: 'unlock', holder: 'account', address: hashEmail((email || '').trim().toLowerCase()), deviceHash: deviceHashOf(device ?? '') });
    return this.authenticationOptions(challenge, target?.passkey);
  }

  /**
   * A sign-in screen: the phone's answer → a ticket the account's own door takes in the password's place. The lock is
   * asked first, of any address, as the sign-in asks it. Then ONE answer for an address nobody holds, an account whose
   * phones are not its own, a phone that is not one of them and a phone with nothing turned on — "off on this phone" —
   * so the door says nothing about who has an account. A stale challenge is not counted; a bad signature is, with the
   * wrong passwords, against the same lock.
   */
  async accountUnlock(email: string, device: string | undefined, response: AuthenticationResponseJSON): Promise<{ unlock: string; expiresIn: number }> {
    this.accounts.assertNotLocked(email);
    const target = this.accounts.unlockTarget(email, device);
    if (!target || !device || response?.id !== target.passkey.id) throw new GlosError('UNLOCK_OFF', 'Unlocking with fingerprint or face is off on this phone or browser. Use the password.');
    if (!answers(this.challenges.take(challengeOf(response)), { purpose: 'unlock', holder: 'account', address: hashEmail((email || '').trim().toLowerCase()), deviceHash: deviceHashOf(device) })) {
      throw new GlosError('UNLOCK_FAILED', 'That took too long. Unlock again, or use the password.');
    }
    const counter = await this.signed(response, target.passkey);
    if (counter === undefined) return this.accounts.failedUnlock(email);
    this.accounts.passkeyUsed(target.accountId, device, counter);
    return { unlock: this.accounts.issueUnlock(email, target.accountId, device, target.passkey.id), expiresIn: Math.round(UNLOCK_TTL_MS / 1000) };
  }
}
