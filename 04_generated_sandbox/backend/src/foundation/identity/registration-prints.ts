import { createHmac } from 'crypto';
import { PersistentMap } from '../store/persistent-map';
import { isPlausiblePhone, normalizePhone } from './phone';

/**
 * ONE NATIONAL ID, ONE PHONE, ONE LICENCE — AND IT STAYS TRUE AFTER A RESTART.
 *
 * Driver and shop registration each refused a second account with somebody's details, against a set of
 * fingerprints held in memory. Every restart — which is every deploy — emptied the set, so the rule quietly
 * lapsed and the same person could register again. The sandbox's three couriers called "Peer D." are that.
 * It also undid the rules built on top of it: a suspended driver, or one whose papers lapsed, could simply
 * register again after the next deploy, and everything keyed to a person's history (a carry cap counted in
 * completed legs, a reputation) is escaped by a fresh identity.
 *
 * WHY NOT JUST WRITE THE OLD FINGERPRINTS TO DISK. They were bare SHA-256 of the value, and a bare hash of a
 * phone number or a national ID is reversible by trying every number — there are not many. So each print is
 * an HMAC keyed with a server secret, the way the phone join key is peppered: a copy of the file alone says
 * nothing about anybody. And the value is NORMALISED first — `0712 345 678` and `+254712345678` are one
 * phone, and the old check counted them as two people even without a restart.
 *
 * TWO REGISTERS, NOT ONE. A person may drive AND run a shop — one person, many roles — so a driver's ID does
 * not stop them opening a shop. The register is part of what is keyed, so a driver's print and the same
 * person's shop print are unlinkable: nobody holding the file can join the two.
 *
 * WHO HOLDS EACH PRINT is kept beside it (the account's DID, never the value), so a print can be released by
 * its holder alone — a renewed licence number frees the old one — and so the day staff can move a lost
 * account to a new phone, there is something to find it by.
 */

/** Which register a print belongs to. */
export type Register = 'driver' | 'shop';

/** The identifying details a register keeps one of each. */
export type PrintField = 'nationalId' | 'phone' | 'licence' | 'device';

/** What is asked, in the order it is asked — the first one already held is the one the refusal names. */
export type IdentityFields = ReadonlyArray<readonly [PrintField, string | undefined]>;

/**
 * The server secret the prints are keyed with. A dev default keeps the sandbox working; production injects a
 * real one. Changing it re-keys every print — a deliberate, operator-gated migration — so it is read once here.
 */
const IDENTITY_PEPPER = process.env.GLOS_IDENTITY_PEPPER || 'glos-dev-identity-pepper-change-me';

/**
 * The same detail typed two ways is the same detail. A phone goes through the one normaliser the OTP service,
 * the person record and the parcel links already share. An ID or a licence number keeps its characters and
 * loses what people type differently: case, spaces, dashes, dots and slashes.
 */
export function normalizeIdentifier(field: PrintField, value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if (field === 'phone') {
    // Something that is not a usable number is kept as typed rather than collapsed: stripped of its letters it
    // would shrink to a bare dialling code, and every such entry would then "be" the same phone.
    const e164 = normalizePhone(raw);
    return isPlausiblePhone(raw) ? e164 : raw.toLowerCase().replace(/\s/g, '');
  }
  if (field === 'device') return raw.toLowerCase();
  return raw.toUpperCase().replace(/[\s\-./]/g, '');
}

/** The keyed print of one detail in one register, or '' when there is nothing to print. */
export function printOf(register: Register, field: PrintField, value: string | undefined): string {
  const normalized = normalizeIdentifier(field, value);
  return normalized ? createHmac('sha256', IDENTITY_PEPPER).update(`${register}:${field}:${normalized}`).digest('hex') : '';
}

interface PrintRecord {
  field: PrintField;
  /** The account that holds it — a DID, never the detail itself. */
  ownerDid: string;
  at: string;
  /**
   * KEPT FOR SOMEBODY WHO HAS NOT REGISTERED YET: the keyed print of the phone they will register with. A decision
   * gave them this detail (id-dispute.service.ts) and they have no registration to hold it — so it is held for
   * them, and only a registration made with that phone gets past it.
   */
  forPhone?: string;
}

export class RegistrationPrints {
  private readonly prints: PersistentMap<string, PrintRecord>;

  constructor(private readonly register: Register) {
    this.prints = new PersistentMap<string, PrintRecord>(`identity-prints-${register}`);
  }

  /**
   * The first of these details somebody ELSE already holds, or nothing. A print the asker holds themselves is
   * not a clash: a licence number re-typed with a space is still their licence.
   */
  taken(fields: IdentityFields, askerDid?: string): PrintField | undefined {
    const phone = fields.find(([field]) => field === 'phone')?.[1];
    const phonePrint = printOf(this.register, 'phone', phone);
    for (const [field, value] of fields) {
      const held = this.prints.get(printOf(this.register, field, value));
      if (!held || held.ownerDid === askerDid) continue;
      // Kept for whoever registers with this phone — and this is them.
      if (held.forPhone && phonePrint && held.forPhone === phonePrint) continue;
      return field;
    }
    return undefined;
  }

  /** Record these details as held by this account. Asked after `taken`, in the same synchronous turn. */
  claim(fields: IdentityFields, ownerDid: string): void {
    const at = new Date().toISOString();
    for (const [field, value] of fields) {
      const key = printOf(this.register, field, value);
      if (key) this.prints.set(key, { field, ownerDid, at });
    }
  }

  /** The key a detail is held under — kept by a caller that must free it LATER, after the detail itself is gone from its hands. */
  keyOf(field: PrintField, value: string | undefined): string {
    return printOf(this.register, field, value);
  }

  /** Free a detail by its key — only by the account holding it. */
  releaseKey(key: string, ownerDid: string): void {
    if (key && this.prints.get(key)?.ownerDid === ownerDid) this.prints.delete(key);
  }

  /** Which account holds this detail, if any. */
  holder(field: PrintField, value: string | undefined): string | undefined {
    return this.prints.get(printOf(this.register, field, value))?.ownerDid;
  }

  /* --- a detail passes from one account to another BY A DECISION (id-dispute.service.ts) — never by either of them --- */

  /** Who holds the detail kept under this key: an account's DID, a keeping for somebody not yet registered, or nobody. */
  holderOfKey(key: string): string | undefined {
    return key ? this.prints.get(key)?.ownerDid : undefined;
  }

  /** The detail under this key is now this account's. Whoever held it before no longer does. */
  moveKey(key: string, field: PrintField, toDid: string): void {
    if (key) this.prints.set(key, { field, ownerDid: toDid, at: new Date().toISOString() });
  }

  /** Keep the detail under this key for whoever registers with this phone. `by` names what decided it. */
  keepFor(key: string, field: PrintField, phone: string, by: string): void {
    const forPhone = printOf(this.register, 'phone', phone);
    if (key && forPhone) this.prints.set(key, { field, ownerDid: by, at: new Date().toISOString(), forPhone });
  }

  /** Free one detail — only by the account holding it, so nobody can release somebody else's. */
  release(field: PrintField, value: string | undefined, ownerDid: string): void {
    const key = printOf(this.register, field, value);
    if (key && this.prints.get(key)?.ownerDid === ownerDid) this.prints.delete(key);
  }
}
