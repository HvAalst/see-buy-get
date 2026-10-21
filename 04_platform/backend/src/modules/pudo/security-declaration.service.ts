import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DriverService } from './driver.service';

/**
 * Round 39 — A SECURITY DECLARATION FOR EACH KIND OF PARTNER (the user: "At joining and yearly (Recommended)"). A shop, a
 * hub, a fleet and a driver who rides for themselves each sign one short declaration of how they keep what is in their
 * care — at joining, and again every year. It is versioned: a new wording is signed again. Not signed, or lapsed, no NEW
 * work: what is already in their hands is finished, nothing more is taken on (lesson: a status guards new commitments,
 * never old ones finishing).
 *
 * A fleet's drivers sign nothing of their own: the fleet signs, and answers for them — as it does for their papers and
 * under the custody cap.
 */
export const DECLARATION_KINDS = ['shop', 'hub', 'fleet', 'driver'] as const;
export type DeclarationKind = (typeof DECLARATION_KINDS)[number];

/** How long a signature holds, and from how long before its end it is said to be due. */
export const DECLARATION_VALID_DAYS = 365;
export const DECLARATION_DUE_DAYS = 30;
const DAY = 86_400_000;

/** What each kind declares. A change of wording is a new version, and every signature of the old one is signed again. */
export const DECLARATIONS: Record<DeclarationKind, { version: number; title: string; lines: string[] }> = {
  shop: {
    version: 1,
    title: 'Our security declaration, as a SeeBuyGet shop',
    lines: [
      'Parcels in our care are kept out of customers’ reach, and locked away when the shop is closed.',
      'We hand a parcel only to the person the app names, against their code — never on a name, a likeness or a phone call.',
      'We open no parcel, and take in nothing we believe is dangerous or forbidden.',
      'A wrap or a seal that is not as it should be is reported in the app at once, and that parcel is held.',
      'Only the people we have named in the app work our counter, each with their own sign-in; nobody uses another’s.',
      'We tell SeeBuyGet within a day if the shop changes hands, moves or closes.',
    ],
  },
  hub: {
    version: 1,
    title: 'Our security declaration, as a SeeBuyGet hub',
    lines: [
      'Only the people we have named in the app work our floor, each with their own sign-in; visitors are kept off it.',
      'A bag is received on its seal: read and compared before it is opened, and reported at once if it is not as written.',
      'Bags and parcels are never left unattended outside the hub, and the floor is locked when nobody is on it.',
      'We open no parcel, and take in nothing we believe is dangerous or forbidden.',
      'Loss, theft or tampering is reported in the app at once.',
      'We tell SeeBuyGet within a day if the hub changes hands, moves or closes.',
    ],
  },
  fleet: {
    version: 1,
    title: 'Our security declaration, as a SeeBuyGet fleet',
    lines: [
      'Every driver we put on a load is one we have checked and named in the app, driving under their own sign-in.',
      'Vehicles are locked when the driver is away from them, and loads are never left unattended on the way.',
      'Seals are checked at pickup and at delivery, and a seal not as written is reported before the load moves on.',
      'Our drivers carry only what the consignment note says, and take on nothing and nobody else on the way.',
      'Theft, hijacking, a load held by an authority, and any demand for money on the road are reported in the app at once.',
      'We tell SeeBuyGet within a day if the company changes hands, or loses a licence or its insurance.',
    ],
  },
  driver: {
    version: 1,
    title: 'My security declaration, as a rider for SeeBuyGet',
    lines: [
      'I carry only what the app gives me, and keep it with me or locked away until it is handed on.',
      'I hand a parcel or a load on only as the app says, to the place or the person it names.',
      'I open nothing I carry, and take on nothing and nobody else on the way.',
      'A seal or a wrap that is not as it should be, and anybody holding or threatening me on the road, I report in the app at once.',
      'Nobody else uses my sign-in or my PIN.',
    ],
  },
};

/** A signature: whose, of which version, by whom, and until when it holds. */
export interface DeclarationSigned {
  kind: DeclarationKind;
  did: string;
  version: number;
  signedAt: string;
  signedBy: string;
  until: string;
}

/** Where a partner stands: the declaration in force, and whether theirs is signed, due, lapsed, outdated or missing. */
export interface DeclarationStanding {
  kind: DeclarationKind;
  version: number;
  title: string;
  lines: string[];
  state: 'signed' | 'due' | 'missing' | 'lapsed' | 'outdated';
  signedAt?: string;
  signedBy?: string;
  until?: string;
  daysLeft?: number;
}

/** The app each kind signs in, for a refusal to say where. */
const WHERE: Record<DeclarationKind, string> = { shop: 'the Shop app', hub: 'the Hub app', fleet: 'the Fleet app', driver: 'the Driver app' };

@Injectable()
export class SecurityDeclarationService {
  private readonly signatures = new PersistentMap<string, DeclarationSigned>('security-declarations');

  constructor(@Optional() private readonly drivers?: DriverService) {}

  /** Where this partner stands now. */
  standing(kind: DeclarationKind, did: string, now: number = Date.now()): DeclarationStanding {
    const current = DECLARATIONS[kind];
    const base = { kind, version: current.version, title: current.title, lines: [...current.lines] };
    const s = this.signatures.get(key(kind, did));
    if (!s) return { ...base, state: 'missing' };
    const signed = { signedAt: s.signedAt, signedBy: s.signedBy, until: s.until };
    if (s.version !== current.version) return { ...base, ...signed, state: 'outdated' };
    const left = Date.parse(s.until) - now;
    if (left <= 0) return { ...base, ...signed, state: 'lapsed' };
    const daysLeft = Math.ceil(left / DAY);
    return { ...base, ...signed, daysLeft, state: daysLeft <= DECLARATION_DUE_DAYS ? 'due' : 'signed' };
  }

  /** In force: signed, of the wording in force, and not lapsed. Due is still in force — it is a warning, not a stop. */
  inForce(kind: DeclarationKind, did: string, now: number = Date.now()): boolean {
    const state = this.standing(kind, did, now).state;
    return state === 'signed' || state === 'due';
  }

  /**
   * SIGNED — by the partner, of the wording they were shown (`version`), for a year from now. Signing again while it holds
   * starts the year again; the wording they read must be the one in force, so nobody signs what they were not shown.
   */
  sign(kind: DeclarationKind, did: string, version: number, by: string, now: number = Date.now()): DeclarationStanding {
    const current = DECLARATIONS[kind];
    if (version !== current.version) throw new GlosError('CONFLICT', 'The declaration has changed since it was shown to you: read the one in force, and sign that');
    const who = by.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is signing', { field: 'by' });
    const signedAt = new Date(now).toISOString();
    this.signatures.set(key(kind, did), { kind, did, version, signedAt, signedBy: who.slice(0, 120), until: new Date(now + DECLARATION_VALID_DAYS * DAY).toISOString() });
    return this.standing(kind, did, now);
  }

  /** Who answers for a driver: their fleet when they drive for one, themselves when they ride for themselves. */
  answersFor(driverDid: string): { kind: 'fleet' | 'driver'; did: string } {
    let managerDid: string | undefined;
    try {
      managerDid = this.drivers?.get(driverDid).managerDid;
    } catch {
      managerDid = undefined;
    }
    return managerDid ? { kind: 'fleet', did: managerDid } : { kind: 'driver', did: driverDid };
  }

  /** A shop takes nothing new in without a declaration in force. Asked before anything is written. */
  assertShopMayTakeIn(shopDid: string, shopName: string, now: number = Date.now()): void {
    this.assertInForce('shop', shopDid, { name: shopName, as: 'it' }, now);
  }

  /** A hub adds no new tote without one. */
  assertHubMayOpen(hubDid: string, hubName: string, now: number = Date.now()): void {
    this.assertInForce('hub', hubDid, { name: hubName, as: 'it' }, now);
  }

  /**
   * A driver takes on no new load, parcel or bag unless whoever answers for them — their fleet, or themselves — has one in
   * force. Said to the driver themselves, or — `atCounter` — to the shop or hub handing it to them.
   */
  assertMayCarry(driverDid: string, now: number = Date.now(), atCounter = false): void {
    const who = this.answersFor(driverDid);
    const subject: Subject = who.kind === 'fleet' ? { name: atCounter ? 'This rider’s fleet' : 'Your fleet', as: 'it' } : atCounter ? { name: 'This rider', as: 'they' } : { name: 'You', as: 'you' };
    this.assertInForce(who.kind, who.did, subject, now);
  }

  /** Why a driver may not take on new work, in the words the take would refuse with — for the board to say first. */
  carryRefusal(driverDid: string, now: number = Date.now()): string | undefined {
    try {
      this.assertMayCarry(driverDid, now);
      return undefined;
    } catch (e) {
      return e instanceof GlosError ? e.message : 'The security declaration is not signed';
    }
  }

  /** Whether a driver may take on new work: for the counter, which leaves the rest at the counter rather than refusing them all. */
  mayCarry(driverDid: string, now: number = Date.now()): boolean {
    const who = this.answersFor(driverDid);
    return this.inForce(who.kind, who.did, now);
  }

  /** Every signature, for staff: who has one in force, who is due, and who has none. */
  all(): DeclarationSigned[] {
    return [...this.signatures.values()];
  }

  private assertInForce(kind: DeclarationKind, did: string, who: Subject, now: number): void {
    const s = this.standing(kind, did, now);
    if (s.state === 'signed' || s.state === 'due') return;
    throw new GlosError('DECLARATION_REQUIRED', refusalWords(kind, who, s.state), { kind, state: s.state, version: s.version });
  }
}

/** Whose declaration a refusal speaks of, and how: to them ("you"), of a business ("it"), or of a rider at the counter ("they"). */
export interface Subject {
  name: string;
  as: 'you' | 'it' | 'they';
}

/** The words of a refusal: whose declaration, what is wrong with it, and where it is signed. */
export function refusalWords(kind: DeclarationKind, who: Subject, state: DeclarationStanding['state']): string {
  const p = who.as === 'you' ? { has: 'have', their: 'your', until: 'you have' } : who.as === 'they' ? { has: 'has', their: 'their', until: 'they have' } : { has: 'has', their: 'its', until: 'it has' };
  const what = state === 'lapsed' ? `not signed ${p.their} security declaration again this year` : state === 'outdated' ? `not signed the new wording of ${p.their} security declaration` : `not signed ${p.their} security declaration`;
  return `${who.name} ${p.has} ${what}: nothing new is taken on until ${p.until}. It is signed in ${WHERE[kind]}, on the home screen.`;
}

const key = (kind: DeclarationKind, did: string): string => `${kind}:${did}`;
