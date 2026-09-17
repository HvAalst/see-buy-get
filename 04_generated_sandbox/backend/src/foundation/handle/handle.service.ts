import { Injectable } from '@nestjs/common';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';

/** What kind of participant a handle points at. Drivers are deliberately absent — see the service doc. */
export const HANDLE_KINDS = ['shop', 'hub', 'fleet', 'company'] as const;
export type HandleKind = (typeof HANDLE_KINDS)[number];

export interface HandleRecord {
  /** The handle itself, without the '@' — lowercase, url-safe, immutable once issued. */
  handle: string;
  kind: HandleKind;
  /** The DID (shop, hub, fleet) or entityId (company) this handle addresses. */
  id: string;
  /** The name it was derived FROM, kept so a rename is visibly not a re-handle. */
  derivedFrom: string;
  issuedAt: string;
}

/** Longest handle we will mint. Long enough for a real trading name, short enough to say down a phone. */
const MAX = 30;

/**
 * Paths the web root already owns, or might. The '@' prefix means a handle can never actually collide with
 * one of these — that is the whole reason the address shape is `/@name` — but a handle that READS like a
 * system page is still a phishing surface, so they are refused at derivation and land on the discriminated
 * form instead.
 */
const SHY = new Set(['admin', 'api', 'app', 'agent', 'driver', 'mdp', 'vendor', 'fleet', 'tower', 'home', 'genesis', 'send', 'login', 'signin', 'signup', 'support', 'help', 'about', 'legal', 'privacy', 'terms', 'seebuyget', 'sbg', 'glos', 'official', 'verified', 'staff', 'security', 'billing', 'payments']);

/**
 * A HANDLE, so a participant has an address a person can type: `seebuyget.com/@fedex`.
 *
 * This is the directory, and it is deliberately not a list. A ranked list of clearing agents would impose
 * an ordering on people whether or not anything went wrong, and — while the network is the one appointing
 * them — publishing that ordering is self-dealing. A page per participant carries the same information and
 * manufactures no loser out of relative position.
 *
 * TWO RULES, and both are about impersonation rather than tidiness.
 *
 *  1. DERIVED, NEVER CLAIMED. A handle falls out of the verified record's own name, exactly as `entityId`
 *     already does and as countries and Incoterms are selected rather than invented. `@fedex` is a real
 *     company: a free-text namespace invites squatting, and on a platform whose claim is custody and money
 *     a convincing fake carrying a performance record is a serious harm. Nobody can ask for a handle, so
 *     there is no reservation queue, no first-come land-grab and no disputes process to run.
 *  2. IMMUTABLE ONCE ISSUED. A handle that follows a rename is a rotted link and a way to inherit somebody
 *     else's reputation; `derivedFrom` keeps the name it came from so the two are visibly different things.
 *
 * NO DRIVERS. A driver's rating is already public by DID, but a searchable identity tied to their delivery
 * and hazard record is a different object: it is employment-adjacent, which this network does not model,
 * and the constraint map depends on a driver NOT being identifiable as the one who slowed a corridor down.
 * Revisit as an explicit opt-in if drivers ask for it.
 */
@Injectable()
export class HandleService {
  private readonly handles = new PersistentMap<string, HandleRecord>('handles');
  /** Reverse index, so a page for a known DID does not scan the world. Rebuilt from the store on demand. */
  private byId?: Map<string, HandleRecord>;

  /** The url-safe stem of a name: `FedEx Kenya Ltd` → `fedex-kenya-ltd`. Empty when nothing survives. */
  static stem(name: string): string {
    return (name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX)
      .replace(/-+$/g, '');
  }

  /**
   * Issue a handle for a participant, or return the one they already hold.
   *
   * Idempotent on `id`, so calling it again on every boot is safe and is how existing records are
   * backfilled. A collision takes the country code first (`@fedex-ke`) and only then a counter, because a
   * discriminator that means something is worth more than one that does not.
   */
  issue(input: { kind: HandleKind; id: string; name: string; country?: string }): HandleRecord {
    const held = this.forId(input.id);
    if (held) return held;

    const stem = HandleService.stem(input.name);
    // A name that survives as nothing, or as something that reads like one of our own pages, does not get
    // the bare form. It is not refused — every participant gets an address — it is discriminated.
    const base = stem && !SHY.has(stem) ? stem : `${stem || input.kind}-${(input.country || '').toLowerCase() || 'x'}`;

    let handle = base;
    if (this.handles.has(handle)) {
      const withCountry = input.country ? `${base}-${input.country.toLowerCase()}` : base;
      handle = withCountry;
      for (let n = 2; this.handles.has(handle); n += 1) handle = `${withCountry}-${n}`;
    }

    const record: HandleRecord = { handle, kind: input.kind, id: input.id, derivedFrom: input.name, issuedAt: new Date().toISOString() };
    this.handles.set(handle, record);
    this.byId?.set(input.id, record);
    return record;
  }

  /** Resolve `@handle` (with or without the '@', any case) to whoever holds it. */
  resolve(handle: string): HandleRecord | undefined {
    const key = HandleService.stem(String(handle || '').replace(/^@/, ''));
    return key ? this.handles.get(key) : undefined;
  }

  /** …and the same, refusing rather than returning undefined, for a route that must answer 404. */
  require(handle: string): HandleRecord {
    const found = this.resolve(handle);
    if (!found) throw new GlosError('NOT_FOUND', 'No such profile');
    return found;
  }

  /** The handle a participant holds, by DID or entityId. */
  forId(id: string): HandleRecord | undefined {
    if (!this.byId) {
      this.byId = new Map();
      for (const r of this.handles.values()) this.byId.set(r.id, r);
    }
    return this.byId.get(id);
  }

  /** Every handle issued. Used by the backfill and by nothing that renders a ranking. */
  list(): HandleRecord[] {
    return [...this.handles.values()].sort((a, b) => a.handle.localeCompare(b.handle));
  }
}
