import { Injectable, Optional } from '@nestjs/common';
import { RestingAccounts } from '../../foundation/auth/resting-accounts';
import { GlosError } from '../../foundation/http/glos-error';
import type { HookMessage } from '../../foundation/outbound/hook-delivery';
import { PasswordTries, keptLocks } from '../../foundation/auth/password-tries';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DidService } from '../../foundation/did/did.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { CheckoutHandoff, CollectionPoint, GeoPoint, ShippingPolicy, Vendor } from './pudo.types';
import { DEFAULT_BAG_BAYS, DEFAULT_VENDOR_COUNTRY, MAX_BAG_BAYS, NETWORK_CURRENCY } from './pudo.config';
import { countryOfSite, requireCountryCode } from './country';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES, type AccountCode } from '../../foundation/books/books.types';
import { paginate, textMatch, toCsv, withinDates, type Page } from './query';

/** One entry in a vendor's prepaid book with the per-country daughter company (GLOS reports, never escrows). */
export interface VendorSettlement {
  id: string;
  vendorId: string;
  country: string;
  type: 'TOP_UP' | 'TOP_UP_FEE' | 'BILLING' | 'REBATE' | 'CLAIM';
  sign: '+' | '-';
  amount: number;
  /** What the amount IS. Absent on rows written before the field existed — read it through
   *  settlementCurrencyOf(), which resolves those from the row's country. */
  currency?: string;
  /** The journal entry this row projects. The BOOKS are the money; this row is how a merchant reads it. */
  entryId?: string;
  parcelId?: string;
  note?: string;
  at: string;
}

export const CALLBACK_STATES = ['pending', 'delivered', 'failed'] as const;
export type CallbackState = (typeof CALLBACK_STATES)[number];

/**
 * One status callback owed to a store.
 *
 * It carried no delivery state until 2026-09-28, for the honest reason that there was no delivery: the
 * record was built, signed, pushed to an in-memory array and left there. A merchant reading their outbox
 * saw a perfect list of events that had never left the building.
 */
export interface VendorCallback extends HookMessage {
  vendorId: string;
  state: CallbackState;
}

/* ------------------------------------------------------------- bookkeeping register (R3) -- */

/** The vendor bookkeeping register query — the SAME searchable / filterable / paginated / exportable shape
 *  as the shipment register (R0), over the money ledger. All fields optional (no query = the whole book,
 *  newest-first). The owner scope is applied by the caller, exactly as for the shipment register. */
export interface VendorLedgerQuery {
  q?: string; // smart search: parcel id / note / the human type word ("shipment", "top-up", "rebate")
  type?: VendorSettlement['type']; // TOP_UP | BILLING | REBATE
  direction?: 'in' | 'out'; // in = money received (sign '+'), out = money spent (sign '-')
  from?: string; // ISO or YYYY-MM-DD (inclusive)
  to?: string;
  sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  limit?: number | string;
  offset?: number | string;
}

/**
 * The merchant's word for an entry — also the fourth thing the search matches. Each type by its own word: a top-up's fee is
 * not a rebate. A charge for a hub's receiving (D12) is billed as a shipment is, against its arrival, and named for what
 * it is.
 */
export function ledgerTypeWord(type: VendorSettlement['type'], ref?: string): string {
  if (type === 'TOP_UP') return 'Top-up';
  if (type === 'TOP_UP_FEE') return 'Top-up fee';
  if (type === 'BILLING') return ref?.startsWith('arr_') ? 'Receiving at a hub' : 'Shipment';
  if (type === 'CLAIM') return 'Damage claim';
  return 'Rebate';
}

/** One row of the bookkeeping register (the entry itself — it carries no secret and no PII beyond the parcel id). */
export interface VendorLedgerRow {
  id: string;
  type: VendorSettlement['type'];
  sign: '+' | '-';
  amount: number;
  currency: string;
  parcelId?: string;
  note?: string;
  at: string;
}

/**
 * The currency of a settlement row. Rows written before the field existed carry none, so they resolve
 * from the country the row already recorded — the answer was always derivable, it was just never stated.
 */
export function settlementCurrencyOf(s: VendorSettlement): string {
  return s.currency ?? currencyForJurisdiction(s.country);
}

export function ledgerRowOf(s: VendorSettlement): VendorLedgerRow {
  return { id: s.id, type: s.type, sign: s.sign, amount: s.amount, currency: settlementCurrencyOf(s), parcelId: s.parcelId, note: s.note, at: s.at };
}

/** Running totals over a set of entries: money IN (top-ups + rebates), money OUT (shipments), and the net.
 *  Computed over whatever set the caller passes — so a FILTERED view yields that view's totals. */
export interface VendorLedgerSummary {
  in: number;
  out: number;
  net: number;
  count: number;
  /** What the totals are denominated in — taken from the rows, which all belong to one vendor. */
  currency: string;
}

export function vendorLedgerSummaryOf(rows: VendorSettlement[]): VendorLedgerSummary {
  let inSum = 0;
  let outSum = 0;
  for (const s of rows) {
    if (s.sign === '+') inSum += s.amount;
    else outSum += s.amount;
  }
  inSum = Math.round(inSum * 100) / 100;
  outSum = Math.round(outSum * 100) / 100;
  // A vendor settles with exactly one daughter company, so its rows share a currency; an empty filtered
  // set has no row to read it from and falls back to the network's.
  const currency = rows.length ? settlementCurrencyOf(rows[0]) : NETWORK_CURRENCY;
  return { in: inSum, out: outSum, net: Math.round((inSum - outSum) * 100) / 100, count: rows.length, currency };
}

function ledgerSort(sort?: VendorLedgerQuery['sort']): (a: VendorSettlement, b: VendorSettlement) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => a.at.localeCompare(b.at);
    case 'amount_desc':
      return (a, b) => b.amount - a.amount;
    case 'amount_asc':
      return (a, b) => a.amount - b.amount;
    default:
      return (a, b) => b.at.localeCompare(a.at); // newest first
  }
}

/** Filter + search + sort a vendor's ledger for the register (PURE — the owner scope is applied by the
 *  caller). Search `q` is a case-insensitive substring over the parcel id, the note, and the type word. */
export function filterVendorLedger(rows: VendorSettlement[], q: VendorLedgerQuery): VendorSettlement[] {
  let out = rows;
  if (q.type) out = out.filter((s) => s.type === q.type);
  if (q.direction) out = out.filter((s) => (q.direction === 'in' ? s.sign === '+' : s.sign === '-'));
  if (q.from || q.to) out = out.filter((s) => withinDates(s.at, q.from, q.to));
  if (q.q) out = out.filter((s) => textMatch([s.parcelId, s.note, ledgerTypeWord(s.type, s.parcelId)], q.q));
  return [...out].sort(ledgerSort(q.sort));
}

/** Render matched entries as the vendor's bookkeeping CSV. Amount is a SIGNED number (a real negative for
 *  money out) so a spreadsheet reads it as a value, not a formula — and a Direction column spells it out. */
export function vendorLedgerToCsv(rows: VendorSettlement[]): string {
  return toCsv(
    ['Date', 'Type', 'Direction', 'Amount', 'Currency', 'Parcel', 'Note'],
    rows.map((s) => [s.at, ledgerTypeWord(s.type, s.parcelId), s.sign === '+' ? 'in' : 'out', s.sign === '+' ? s.amount : -s.amount, settlementCurrencyOf(s), s.parcelId ?? '', s.note ?? '']),
  );
}

/**
 * VendorService (PUDO ↔ e-commerce). The registry of businesses that wire their checkout into PUDO
 * for click-and-collect, and the outbound status-callback channel: when a parcel reaches a milestone
 * (ready for pickup, delivered, disputed), GLOS pushes an HMAC-SHA256-signed callback to the vendor's
 * URL so their store can notify the buyer — mirroring a standard click-and-collect integration. GLOS
 * holds no fiat; this is logistics orchestration only.
 */
@Injectable()
export class VendorService {
  /**
   * Durable (S15, catching up with the S1 principle): a vendor record IS a credential (the
   * HMAC secret, issued exactly once) and money (the prepaid balance) — a restart must not
   * delete either.
   */
  private readonly vendors = new PersistentMap<string, Vendor>('pudo-vendors');
  /** Durable too: a pending handoff is a BUYER'S ORDER that has not shipped yet. */
  private readonly checkouts = new PersistentMap<string, CheckoutHandoff>('pudo-vendor-checkouts');
  /**
   * DURABLE, because it is now a delivery queue rather than a log. A restart used to lose a list nobody
   * was sending anyway; it would now lose events a merchant is waiting on.
   */
  private readonly outbox = new PersistentMap<string, VendorCallback>('pudo-vendor-outbox');
  /**
   * R3 — the settlement book is now DURABLE: it is the vendor's bookkeeping (every top-up, shipment
   * billing and rebate), the ledger behind the balance. A restart must not erase the money history the
   * merchant reconciles against. Keyed by entry id; the register queries iterate the values.
   */
  private readonly settlements = new PersistentMap<string, VendorSettlement>('pudo-vendor-settlements');

  constructor(
    private readonly dids: DidService,
    private readonly core: OperationalStore,
    private readonly entities: EntityService,
    private readonly books: BooksService,
    private readonly presence: PresenceService,
    // Optional so the specs that build this by hand keep compiling: without it no store is ever at rest.
    @Optional() private readonly rest?: RestingAccounts,
  ) {}

  /**
   * A STORE AT REST TAKES NO NEW ORDER — its owner muted their account (2026-10-22). Asked wherever a new order or a
   * new parcel for the store begins; what it already shipped goes on.
   */
  assertTakesOrders(vendorId: string): void {
    const vendor = this.vendors.get(vendorId);
    if (vendor && this.rest?.isResting(vendor.did)) {
      throw new GlosError('FORBIDDEN', `${vendor.name}'s account is muted, so it takes no new orders through SeeBuyGet for now. Its owner can unmute it in Settings.`, { reason: 'store_resting' });
    }
  }

  /**
   * The sister company that settles this vendor. Records written before entities existed carry no
   * entityId, so they resolve from the country they already recorded — the same shape as the currency
   * backfill, and for the same reason: the answer was always implied, it was just never named.
   *
   * This is the MONEY gate. A store standing in a country we only match has no sister, and the refusal is
   * the presence's, by name: we cannot hold its money there.
   */
  entityIdOf(vendor: Vendor): string {
    const own = this.entityIdOrNone(vendor);
    if (own) return own;
    this.presence.require(vendor.country, 'holdFloat');
    return this.entities.requireForJurisdiction(vendor.country).entityId;
  }

  /** The read-path twin: the sister, or nothing where the store stands in a country we only match. */
  entityIdOrNone(vendor: Pick<Vendor, 'entityId' | 'country'>): string | undefined {
    return vendor.entityId ?? this.entities.forJurisdiction(vendor.country)?.entityId;
  }

  /** The money this store's balance, its bills and its shipping policy are in: its sister's. None where the store
   *  stands in a country we only match — it keeps no till with us, and its figures are the bare ones it typed. */
  currencyOf(vendor: Pick<Vendor, 'entityId' | 'country'>): string | undefined {
    const entityId = this.entityIdOrNone(vendor);
    return entityId ? this.entities.get(entityId).currency : undefined;
  }

  /**
   * WHO SETTLES THIS STORE, by name, and in what money — for somebody reading about the store rather than
   * posting to its books. Nothing where the store stands in a country we only match: it has no till with
   * us, and a currency beside "no float held" would read as a balance of nothing.
   */
  settledBy(vendor: Pick<Vendor, 'entityId' | 'country'>): { name: string; currency: string } | null {
    const entityId = this.entityIdOrNone(vendor);
    if (!entityId) return null;
    const entity = this.entities.get(entityId);
    return { name: entity.name, currency: entity.currency ?? currencyForJurisdiction(entity.jurisdiction) };
  }

  /** Does a sister of ours settle this store at all? Where none does, its freight settles off-platform. */
  settlesWithUs(vendorId: string): boolean {
    const vendor = this.vendors.get(vendorId);
    return !!vendor && !!this.entityIdOrNone(vendor);
  }

  private static policy(p?: Partial<Omit<ShippingPolicy, 'insurer'>> & { insurer?: ShippingPolicy['insurer'] | null }): ShippingPolicy {
    // S34c — carry the freight-spend cap. A zero/negative/non-finite value means "no cap" (never a shipment
    // nobody can afford to move), so it is normalised to undefined here at the single policy chokepoint.
    const cap = p?.maxTransportSpend;
    const maxTransportSpend = cap != null && Number.isFinite(cap) && cap > 0 ? Math.round(cap * 100) / 100 : undefined;
    // The returns threshold. UNDEFINED IS NOT ZERO here, unlike the cap above: a store that has said
    // nothing has not agreed to be billed for anything, while a store that typed 0 has said "always ask
    // me" — a different sentence and a real one. So only a negative or non-finite value is normalised away.
    const recover = p?.recoverAboveValue;
    const recoverAboveValue = recover != null && Number.isFinite(recover) && recover >= 0 ? Math.round(recover * 100) / 100 : undefined;
    // The insurer: kept only whole — a name and an address — and NULL takes it off (the merge above would otherwise keep the old one).
    const named = p?.insurer;
    const insurer = named && named.name?.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(named.email?.trim() ?? '') ? { name: named.name.trim().slice(0, 80), email: named.email.trim().toLowerCase().slice(0, 254) } : undefined;
    return { mode: p?.mode === 'full' ? 'full' : 'capped', freeOverSubtotal: p?.freeOverSubtotal ?? 50, buyerContributionCap: p?.buyerContributionCap ?? 3, maxTransportSpend, recoverAboveValue, ...(insurer ? { insurer } : {}) };
  }

  register(input: { name: string; callbackUrl?: string; secret?: string; location?: { lat: number; lng: number }; address?: string; country?: string; ownerPhone?: string; shippingPolicy?: Partial<Omit<ShippingPolicy, 'insurer'>> & { insurer?: ShippingPolicy['insurer'] | null } }): Vendor {
    const country = requireCountryCode(input.country, DEFAULT_VENDOR_COUNTRY);
    // The presence decides whether a store may stand here, not the existence of a sister. Where we only match,
    // a store registers with no sister behind it: it posts freight and settles it with the carrier itself, and
    // every money path refuses by name (entityIdOf). Where the network does not operate at all, it is refused.
    // Signing up is taken where the network operates and where it is COMING (2026-10-25): the account and its papers ahead of the day it opens.
    if (!this.presence.can(country, 'signUp')) throw new GlosError('FORBIDDEN', `SeeBuyGet does not take sign-ups in ${country} yet, so a store cannot register there`);
    const entity = this.entities.forJurisdiction(country);
    // A real DID (S2 pattern — mdp got the same treatment): the vendorId stays the domain
    // key; the DID is what the vendors/login token binds to. No PII goes to the core.
    const did = this.dids.generate(`vendor:${input.name}`, { role: 'vendor' }).id;
    this.core.upsert({ did, tier: 2, status: 'active', capabilities: ['vendor'], metadata: { country } });
    const vendor: Vendor = { vendorId: `ven_${randomBytes(6).toString('hex')}`, did, name: input.name, callbackUrl: input.callbackUrl, secret: input.secret ?? `whsec_${randomBytes(12).toString('hex')}`, location: input.location, address: input.address, country, ...(entity ? { entityId: entity.entityId } : {}), contactMobile: input.ownerPhone?.trim() || undefined, balance: entity ? 0 : null, shippingPolicy: VendorService.policy(input.shippingPolicy), createdAt: new Date().toISOString() };
    this.vendors.set(vendor.vendorId, vendor);
    return vendor;
  }

  /** A business's parcel account, where it opened one (2026-10-29). */
  forBusiness(entityId: string): Vendor | undefined {
    return [...this.vendors.values()].find((v) => v.business?.entityId === entityId);
  }

  /**
   * OPEN A BUSINESS'S PARCEL ACCOUNT (the user, 2026-10-29: "Billed to the business", from "A prepaid balance"): a till
   * with the company of ours in its country, as a store has, which its parcels are paid from. Once per business — asked
   * again, it answers the one it has. Refused where we hold no money: a balance nobody can pay into is a promise nobody
   * keeps. Nobody signs in to it as a store; the business's own people and its key act on it.
   */
  openForBusiness(business: { entityId: string; did: string; name: string; country: string }): Vendor {
    const had = this.forBusiness(business.entityId);
    if (had) return had;
    const country = requireCountryCode(business.country, DEFAULT_VENDOR_COUNTRY);
    this.presence.require(country, 'holdFloat');
    if (!this.entities.forJurisdiction(country)) throw new GlosError('FORBIDDEN', `SeeBuyGet holds no money in ${country} yet, so a business there cannot pay for parcels from a balance`);
    const vendor = this.register({ name: business.name, country });
    vendor.business = { entityId: business.entityId, did: business.did };
    this.vendors.set(vendor.vendorId, vendor);
    return vendor;
  }

  /** The name a business's parcels go out under follows the business's own (it may rename itself). */
  keepBusinessName(vendorId: string, name: string): Vendor {
    const vendor = this.get(vendorId);
    if (vendor.business && name.trim() && vendor.name !== name.trim()) {
      vendor.name = name.trim();
      this.vendors.set(vendor.vendorId, vendor);
    }
    return vendor;
  }

  /**
   * Rotate the store's signing secret — proven with the CURRENT secret. The old one stops opening the console at
   * once, every session holding it is signed out, and every callback from now on is signed with the new one (so the
   * store's own system must be given it). Shown to the store exactly once, like the first.
   */
  /** Wrong secrets, counted against the store ID that was typed — whether or not there is such a store. */
  private readonly tries = new PasswordTries({ wrong: 'Wrong store ID or secret', what: 'secrets', wayBack: '' }, keptLocks('stores'));

  rotateSecret(vendorId: string, current: string): Vendor {
    return this.replaceSecret(this.login(vendorId, current).vendorId);
  }

  /**
   * A NEW SIGNING SECRET, WITH NO PROOF ASKED HERE — the caller has taken one already: the current secret
   * (`rotateSecret`), or, for a store with an account, its password. That second door is what lets a store that
   * has LOST its secret replace it; before, replacing the secret asked for the secret, and losing it was for good.
   */
  replaceSecret(vendorId: string): Vendor {
    const vendor = this.get(vendorId);
    vendor.secret = `whsec_${randomBytes(12).toString('hex')}`;
    vendor.secretRotatedAt = new Date().toISOString();
    this.vendors.set(vendor.vendorId, vendor);
    this.core.bumpTokenVersion(vendor.did);
    return vendor;
  }

  /**
   * Sign a merchant console in: vendorId + the signing secret (issued once, at registration).
   * One AUTH_FAILED for both an unknown id and a wrong secret — no oracle for guessing ids.
   * Constant-time compare, same as the account service's password check.
   */
  login(vendorId: string, secret: string): Vendor {
    // THE SAME COUNT AS A PASSWORD: five wrong secrets at one store ID lock this door, the right one included. A
    // secret we issue is ninety-six random bits and nobody guesses it; one a store chose for itself may be anything.
    this.tries.check(vendorId);
    const vendor = this.vendors.get(vendorId);
    // A business's parcel account is no store: nobody signs in to it with a store ID (2026-10-29).
    if (!vendor || vendor.business) throw this.tries.wrong(vendorId).error;
    const a = Buffer.from(String(secret ?? ''));
    const b = Buffer.from(vendor.secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw this.tries.wrong(vendorId).error;
    this.tries.forget(vendorId);
    // Backfill for records created before vendors carried DIDs (pre-S15 in-memory worlds).
    if (!vendor.did) {
      vendor.did = this.dids.generate(`vendor:${vendor.name}`, { role: 'vendor' }).id;
      this.core.upsert({ did: vendor.did, tier: 2, status: 'active', capabilities: ['vendor'], metadata: { country: vendor.country } });
      this.vendors.set(vendor.vendorId, vendor);
    }
    return vendor;
  }

  // --- prepaid settlement with the per-country daughter company (GLOS reports; holds no fiat) ---

  private book(vendor: Vendor, type: VendorSettlement['type'], sign: '+' | '-', amount: number, parcelId?: string, note?: string, entryId?: string): VendorSettlement {
    const entry: VendorSettlement = { id: `vs_${randomBytes(6).toString('hex')}`, vendorId: vendor.vendorId, country: vendor.country, type, sign, amount: Math.round(amount * 100) / 100, currency: currencyForJurisdiction(vendor.country), entryId, parcelId, note, at: new Date().toISOString() };
    this.settlements.set(entry.id, entry); // durable bookkeeping
    return entry;
  }

  /**
   * Real money in — the vendor prepays the daughter company.
   *
   * **A PAYMENT RAIL CALLS THIS, NOT A STORE.** Reached only from a confirmed funding, exactly as the
   * shop's float is: see `foundation/funding` and the twin of this method in WalletGateService, which
   * carries the full reasoning. `fee` is what the provider took; the store is credited the GROSS and the
   * fee is our expense, so custody holds the difference.
   */
  topUp(vendorId: string, amount: number, ref?: string, fee = 0): Vendor {
    return this.topUpConfirmed(vendorId, amount, ref, fee).vendor;
  }

  /** The same movement, handing back the journal entry as well: a confirmed payment keeps the entry id
   *  so an auditor can walk from the provider's reference to the books in one step, without a search. */
  topUpConfirmed(vendorId: string, amount: number, ref?: string, fee = 0): { vendor: Vendor; entryId: string } {
    if (amount <= 0) throw new GlosError('AMOUNT_INVALID', 'Top-up must be positive');
    const vendor = this.get(vendorId);
    const cost = Math.min(Math.max(Number.isFinite(fee) ? Math.round(fee * 100) / 100 : 0, 0), amount);
    // The store's float is a DEPOSIT: the sister holds the money and owes it back as shipping. Nothing
    // is earned until a parcel moves — we charge for service, not for balance.
    // What this sister charges for moving the money in — the store's half of the shop's rule. Credited
    // GROSS and charged separately, never netted: see TopUpFeeRule, and the shop's topUp for the same lines.
    // With the company's own tax on it, the same as its carriage: owed to the authority, never revenue.
    const { fee: ourFee, feeTax } = this.entities.topUpFeeFor(this.entityIdOf(vendor), amount);
    const entryId = this.post(vendor, 'top-up', ref ?? vendorId, [
      { code: ACCOUNT_CODES.CASH_CUSTODY, amount: Math.round((amount - cost) * 100) / 100 },
      ...(cost > 0 ? [{ code: ACCOUNT_CODES.EXPENSE_PAYMENT_FEES, amount: cost }] : []),
      { code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount: -amount },
      ...(ourFee > 0 ? [{ code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount: ourFee }] : []),
      ...(ourFee > 0 ? [{ code: ACCOUNT_CODES.REVENUE, amount: -(Math.round((ourFee - feeTax) * 100) / 100) }] : []),
      ...(feeTax > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: -feeTax }] : []),
    ]);
    this.book(vendor, 'TOP_UP', '+', amount, undefined, 'prepay', entryId);
    if (ourFee > 0) this.book(vendor, 'TOP_UP_FEE', '-', ourFee, undefined, 'top-up fee', entryId);
    return { vendor: this.syncBalance(vendor), entryId };
  }

  /** A confirmed prepayment that came back. The mirror of the shop's `reverseTopUp`, and for the same
   *  reasons — its own entry, and the provider's fee stays spent because it was. */
  reverseTopUp(vendorId: string, amount: number, ref: string): { vendor: Vendor; entryId: string } {
    const vendor = this.get(vendorId);
    if (amount <= 0) return { vendor, entryId: '' };
    const entryId = this.post(vendor, 'top-up-reversal', ref, [
      { code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount },
      { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -amount },
    ]);
    this.book(vendor, 'TOP_UP', '-', amount, undefined, 'prepay reversed', entryId);
    return { vendor: this.syncBalance(vendor), entryId };
  }

  /**
   * Bill the full shipment cost. Returns whether the prepaid balance covered it (the 'ParcelPaid' gate).
   *
   * `fxBuffer` is the part of the price that came from the exchange-rate buffer rather than from selling a
   * service. It is split out of revenue here, at the only moment the whole price passes through one entry,
   * because **SBG is not a bank profiting from exchange rates**: what the buffer absorbs belongs in FX
   * gain/loss, where a buffer that is consistently too fat is a number somebody has to answer for.
   */
  billShipment(vendorId: string, parcelId: string, amount: number, fxBuffer = 0, tax = 0, provision = 0, what: { kind?: string; note?: string } = {}): { paid: boolean; balance: number } {
    const vendor = this.get(vendorId);
    // `amount` is the GROSS — what actually leaves the store's float, tax included. The balance is checked
    // against it for that reason: a customer must fund the whole charge, not the part we get to keep.
    if (this.balanceOf(vendorId) + 1e-9 < amount) return { paid: false, balance: this.balanceOf(vendorId) };
    // Tax is money held for an authority and never ours, so it comes off the top before anything else is
    // apportioned. Clamped like the buffer and for the same reason — one caller's arithmetic slip must not
    // be able to move our own money between two of our own accounts.
    const collected = Number.isFinite(tax) ? Math.min(Math.max(Math.round(tax * 100) / 100, 0), amount) : 0;
    const net = Math.round((amount - collected) * 100) / 100;
    // Clamped rather than trusted: a buffer larger than the price, or a negative one, would move money
    // between two of our own accounts on a caller's arithmetic mistake. It can only ever be a slice of the
    // NET — the buffer is a hedge on what we sold, and there is nothing to hedge in somebody else's tax.
    const buffer = Number.isFinite(fxBuffer) ? Math.min(Math.max(Math.round(fxBuffer * 100) / 100, 0), net) : 0;
    // The service is delivered: the deposit is drawn down and the sister recognises the revenue HERE —
    // all of it, less whatever of it was only ever a hedge against the rate moving, and less the tax,
    // which was never revenue for a moment.
    // The cost-of-risk slice of the fee the customer already paid. Set aside rather than earned: it is
    // the price of carrying risk, so booking it as revenue would make bearing risk look like making
    // money right up until the moment somebody claims. Clamped to what is left after tax and the buffer
    // so three slices of one amount can never sum to more than the amount.
    const risk = Number.isFinite(provision) ? Math.min(Math.max(Math.round(provision * 100) / 100, 0), Math.max(0, Math.round((net - buffer) * 100) / 100)) : 0;
    // What was sold: a shipment, unless the caller names another service sold the same way (a hub's receiving, D12).
    const entryId = this.post(vendor, what.kind ?? 'shipping', parcelId, [
      { code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount },
      { code: ACCOUNT_CODES.REVENUE, amount: -(Math.round((net - buffer - risk) * 100) / 100) },
      ...(buffer > 0 ? [{ code: ACCOUNT_CODES.FX_GAINLOSS, amount: -buffer }] : []),
      ...(collected > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: -collected }] : []),
      ...(risk > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: -risk }] : []),
    ]);
    this.book(vendor, 'BILLING', '-', amount, parcelId, what.note ?? 'shipment', entryId);
    return { paid: true, balance: this.syncBalance(vendor).balance ?? 0 }; // a store that was just billed has a sister, so a till
  }

  /**
   * Refund a flexible parcel's over-hold (ceiling − actual) back to the vendor after delivery.
   *
   * `tax` is the part of that refund that was tax, and it must be named for the entry to be the mirror of
   * the billing it reverses. Give back a gross amount out of revenue alone and the tax liability stays on
   * the books for money the customer no longer paid — the sister would eventually remit tax on a sale that
   * was partly undone, out of its own pocket, and nothing would show why.
   */
  rebate(vendorId: string, parcelId: string, amount: number, note = 'flexible-route rebate', tax = 0, provision = 0, fxBuffer = 0): Vendor {
    const vendor = this.get(vendorId);
    if (amount <= 0) return vendor;
    const collected = Number.isFinite(tax) ? Math.min(Math.max(Math.round(tax * 100) / 100, 0), amount) : 0;
    const net = Math.round((amount - collected) * 100) / 100;
    // The risk cover being given back with the price. A rebate means the shipment cost less than the
    // ceiling held for it, so a slice of the cover was collected against a journey that never happened —
    // leaving it in the pool would be provisioning against a shipment nobody made.
    const risk = Number.isFinite(provision) ? Math.min(Math.max(Math.round(provision * 100) / 100, 0), Math.max(0, net)) : 0;
    // The exchange buffer it was charged, given back out of FX gain/loss, where billShipment booked it — never out of revenue.
    const buffer = Number.isFinite(fxBuffer) ? Math.min(Math.max(Math.round(fxBuffer * 100) / 100, 0), Math.max(0, Math.round((net - risk) * 100) / 100)) : 0;
    // The over-hold was never earned: revenue is given back, the tax on it is un-owed, and the deposit
    // restored.
    const entryId = this.post(vendor, 'rebate', parcelId, [
      ...(net - risk - buffer > 0 ? [{ code: ACCOUNT_CODES.REVENUE, amount: Math.round((net - risk - buffer) * 100) / 100 }] : []),
      ...(buffer > 0 ? [{ code: ACCOUNT_CODES.FX_GAINLOSS, amount: buffer }] : []),
      ...(risk > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: risk }] : []),
      ...(collected > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: collected }] : []),
      { code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount: -amount },
    ]);
    this.book(vendor, 'REBATE', '+', amount, parcelId, note, entryId);
    return this.syncBalance(vendor);
  }

  /**
   * Pay an upheld damage claim into the store's float.
   *
   * The store, and not the buyer, because the store is who we CONTRACTED with: it bought a shipment
   * from the sister, and the sister failed to deliver what it was paid to deliver. The buyer's claim
   * is against the merchant they bought from, exactly as it would be for goods broken on a shelf. That
   * is the same counterparty discipline the rest of this ledger keeps, and it is the reason a claim
   * cannot simply be pushed at whoever happens to be holding the damaged box.
   *
   * NOT a rebate. A rebate gives back a price that was never earned and reverses revenue; this is a
   * cost the sister carries for having broken something, so it lands on the provision set aside for
   * exactly that, and on claims expense for whatever the provision could not cover.
   */
  payClaim(vendorId: string, parcelId: string, amount: number, note: string): { fromProvision: number; fromExpense: number } {
    const vendor = this.get(vendorId);
    const value = Math.round((Number.isFinite(amount) ? amount : 0) * 100) / 100;
    if (value <= 0) return { fromProvision: 0, fromExpense: 0 };
    const entityId = this.entityIdOf(vendor);
    const split = this.books.provisionSplit(entityId, value);
    const entryId = this.post(vendor, 'claim', parcelId, [
      // Debits: draw down what was set aside, and carry the rest as what this claim actually cost.
      ...(split.fromProvision > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: split.fromProvision }] : []),
      ...(split.fromExpense > 0 ? [{ code: ACCOUNT_CODES.EXPENSE_CLAIMS, amount: split.fromExpense }] : []),
      // Credit: the store's float grows by the award — money it can spend on its next shipment.
      { code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount: -value },
    ]);
    this.book(vendor, 'CLAIM', '+', value, parcelId, note, entryId);
    this.syncBalance(vendor);
    return split;
  }

  /** Derived from the books — the store's float IS its deposit account, flipped for a human to read. */
  balanceOf(vendorId: string): number {
    return this.derivedBalance(this.get(vendorId));
  }

  /** The read-path twin: null where the store stands in a country we only match — having no till with us is a
   *  different fact from an empty one, and a screen must be able to say which without being refused. */
  balanceOrNone(vendorId: string): number | null {
    return this.readBalance(this.get(vendorId));
  }

  private derivedBalance(vendor: Vendor): number {
    return -this.books.balance(this.entityIdOf(vendor), ACCOUNT_CODES.DEPOSIT_VENDOR, undefined, vendor.vendorId) || 0;
  }

  private readBalance(vendor: Vendor): number | null {
    const entityId = this.entityIdOrNone(vendor);
    return entityId ? -this.books.balance(entityId, ACCOUNT_CODES.DEPOSIT_VENDOR, undefined, vendor.vendorId) || 0 : null;
  }

  /** Post to the sister that settles this store, returning the journal entry the register row points at. */
  private post(vendor: Vendor, kind: string, ref: string, lines: Array<{ code: AccountCode; counterparty?: string; amount: number }>): string {
    return this.books.post({ entityId: this.entityIdOf(vendor), kind, ref, lines }).entryId;
  }

  /**
   * Refresh the cached `balance` on the record from the books. The books are the money; this field is a
   * read-model kept in step at the only points it can change, so a console reading the vendor record can
   * never show a figure the postings disagree with.
   */
  private syncBalance(vendor: Vendor): Vendor {
    vendor.balance = this.readBalance(vendor);
    this.vendors.set(vendor.vendorId, vendor);
    return vendor;
  }

  settlementsFor(vendorId: string): VendorSettlement[] {
    return [...this.settlements.values()].filter((s) => s.vendorId === vendorId).reverse();
  }

  // --- bookkeeping register (R3): the same server-side query the shipment register uses, over the ledger ---

  /** One page of the vendor's bookkeeping register — filtered / searched / sorted / paginated. Owner scope
   *  is the caller's (the controller's assertVendorOwner), mirroring the shipment register. */
  vendorLedgerPage(vendorId: string, q: VendorLedgerQuery): Page<VendorLedgerRow> {
    const filtered = filterVendorLedger(this.settlementsFor(vendorId), q);
    const { items, total } = paginate(filtered, q.limit, q.offset);
    return { items: items.map(ledgerRowOf), total };
  }

  /** Running totals (in / out / net / count) for the CURRENT filtered view — so "August shipments" totals
   *  that view's spend. The always-current BALANCE stays on the vendor record, not here. */
  vendorLedgerSummary(vendorId: string, q: VendorLedgerQuery): VendorLedgerSummary {
    return vendorLedgerSummaryOf(filterVendorLedger(this.settlementsFor(vendorId), q));
  }

  /** The whole matching set (every page) as CSV — the vendor's bookkeeping export. */
  vendorLedgerCsv(vendorId: string, q: VendorLedgerQuery): string {
    return vendorLedgerToCsv(filterVendorLedger(this.settlementsFor(vendorId), q));
  }

  /** Update the store profile (map pin, address, callback URL, split/contribution policy). */
  updateProfile(vendorId: string, patch: { callbackUrl?: string; callbackCarriesCode?: boolean; location?: { lat: number; lng: number }; address?: string; shippingPolicy?: Partial<Omit<ShippingPolicy, 'insurer'>> & { insurer?: ShippingPolicy['insurer'] | null } }): Vendor {
    const vendor = this.get(vendorId);
    if (patch.callbackUrl !== undefined) vendor.callbackUrl = patch.callbackUrl || undefined;
    if (patch.callbackCarriesCode !== undefined) vendor.callbackCarriesCode = patch.callbackCarriesCode;
    if (patch.location !== undefined) vendor.location = patch.location;
    if (patch.address !== undefined) vendor.address = patch.address || undefined;
    if (patch.shippingPolicy !== undefined) vendor.shippingPolicy = VendorService.policy({ ...vendor.shippingPolicy, ...patch.shippingPolicy });
    this.vendors.set(vendor.vendorId, vendor);
    return vendor;
  }

  /* --- the vendor's own dock (outbound only — see CollectionPoint) --- */

  /**
   * Turn the vendor's own address into a place the network collects from, or move/resize it.
   *
   * Deliberately a small, revocable thing on the vendor's own record rather than an agent registration: it
   * grants exactly one power — a driver may be sent here to collect a sealed bag — and no other.
   */
  setCollectionPoint(vendorId: string, input: { label: string; zone: string; country?: string; location: GeoPoint; bays?: number; siteId?: string }): Vendor {
    const vendor = this.get(vendorId);
    const label = input.label?.trim();
    const zone = input.zone?.trim();
    // The dock's own country, defaulting to the store's. No sister is required for it: a dock earns
    // nothing and invoices nobody, so the network needs no company there — it only needs to know that a
    // journey leaving this door leaves a customs territory.
    const country = requireCountryCode(input.country, vendor.country);
    if (!zone) throw new GlosError('ZONES_REQUIRED', 'Name the zone the dock sits in — corridors and hubs are keyed to zones');
    if (!label) throw new GlosError('FIELD_REQUIRED', 'Name the collection point — a driver has to find the right door');
    if (!input.location || !Number.isFinite(input.location.lat) || !Number.isFinite(input.location.lng)) {
      throw new GlosError('INVALID_INPUT', 'Put the collection point on the map — a driver is sent to a point, not to a name');
    }
    const bays = input.bays ?? vendor.collection?.bays ?? DEFAULT_BAG_BAYS;
    if (!Number.isFinite(bays) || bays < 1 || bays > MAX_BAG_BAYS) {
      throw new GlosError('INVALID_INPUT', `Bag space must be between 1 and ${MAX_BAG_BAYS} bags`);
    }
    vendor.collection = {
      label,
      zone,
      country,
      location: { lat: input.location.lat, lng: input.location.lng },
      bays: Math.floor(bays),
      enabledAt: vendor.collection?.enabledAt ?? new Date().toISOString(),
      ...(input.siteId ? { siteId: input.siteId } : {}),
    };
    this.vendors.set(vendorId, vendor);
    return vendor;
  }

  /** Stop collecting here. Bags already sealed on the dock still belong to the drivers who claimed them. */
  clearCollectionPoint(vendorId: string): Vendor {
    const vendor = this.get(vendorId);
    vendor.collection = undefined;
    this.vendors.set(vendorId, vendor);
    return vendor;
  }

  /** The country a store's dock stands in — its own, or the store's when the dock never said. */
  dockCountryOf(vendor: Vendor): string {
    return countryOfSite({ country: vendor.collection?.country ?? vendor.country });
  }

  /** The dock, or a refusal that says how to get one. */
  requireCollection(vendorId: string): CollectionPoint {
    const vendor = this.get(vendorId);
    if (!vendor.collection) throw new GlosError('INVALID_STATE', 'This store has no collection point — set one up, or drop off at a PUDO');
    return vendor.collection;
  }

  /** Resolve a bag's `locationId` back to the vendor whose dock it stands on, if it is one. */
  byDid(did: string): Vendor | undefined {
    return [...this.vendors.values()].find((v) => v.did === did);
  }

  get(vendorId: string): Vendor {
    const vendor = this.vendors.get(vendorId);
    if (!vendor) throw new GlosError('NOT_FOUND', `Vendor not found: ${vendorId}`);
    // Read-repair the cached figure. The books are the money; a record written before them (or by a
    // path that somehow missed the sync) must never hand a console a number the postings disagree with.
    // A store no sister settles reads as null — never a refusal, or every screen and API call it makes would fail.
    const derived = this.readBalance(vendor);
    if (vendor.balance !== derived) {
      vendor.balance = derived;
      this.vendors.set(vendorId, vendor);
    }
    return vendor;
  }

  has(vendorId: string): boolean {
    return this.vendors.has(vendorId);
  }

  list(): Array<Omit<Vendor, 'secret'>> {
    return [...this.vendors.values()].map((v) => VendorService.publicView(v));
  }

  /**
   * The vendor as it may be returned to a client — without the HMAC signing `secret`. The secret is
   * shown exactly once, in the register() response; any later fetch (get / update / top-up) must not
   * re-expose it, or a guessed vendorId would hand over the callback-signing key. Internal callers keep
   * using get(), which returns the full record because notify() needs the secret to sign.
   */
  static publicView(vendor: Vendor): Omit<Vendor, 'secret'> {
    const { secret, ...rest } = vendor;
    void secret;
    return rest;
  }

  // --- checkout handoffs (buyer's destination-PUDO choice → merchant console) ---

  /** Capture a buyer's checkout selection (the embedded node, a webhook, or manual entry). */
  captureCheckout(input: { vendorId: string; destAgentDid: string; buyerEmail: string; buyerMobile?: string; externalOrderId?: string; items?: Array<{ name: string; qty: number }>; subtotal?: number; source?: CheckoutHandoff['source'] }): CheckoutHandoff {
    this.get(input.vendorId); // 404 if unknown
    this.assertTakesOrders(input.vendorId);
    const handoff: CheckoutHandoff = { id: `chk_${randomBytes(6).toString('hex')}`, vendorId: input.vendorId, destAgentDid: input.destAgentDid, buyerEmail: input.buyerEmail, buyerMobile: input.buyerMobile, externalOrderId: input.externalOrderId, items: input.items, subtotal: input.subtotal, source: input.source ?? 'node', consumed: false, at: new Date().toISOString() };
    this.checkouts.set(handoff.id, handoff);
    return handoff;
  }

  /** THE OWNER CLOSED THEIR ACCOUNT (2026-10-22): the store's contact number was theirs, and goes. The store stays at rest. */
  forgetOwner(vendorDid: string): void {
    const vendor = this.byDid(vendorDid);
    if (!vendor) return;
    delete vendor.contactMobile;
    this.vendors.set(vendor.vendorId, vendor);
    this.dids.forgetController(vendorDid);
  }

  /** Open (not-yet-shipped) checkout handoffs for a vendor — the console's incoming-orders inbox. */
  checkoutsFor(vendorId: string, includeConsumed = false): CheckoutHandoff[] {
    return [...this.checkouts.values()].filter((c) => c.vendorId === vendorId && (includeConsumed || !c.consumed)).sort((x, y) => y.at.localeCompare(x.at));
  }

  checkout(id: string): CheckoutHandoff {
    const c = this.checkouts.get(id);
    if (!c) throw new GlosError('NOT_FOUND', `Checkout not found: ${id}`);
    return c;
  }

  /** Mark a handoff as turned into a shipment. */
  consumeCheckout(id: string, parcelId: string): CheckoutHandoff {
    const c = this.checkout(id);
    c.consumed = true;
    c.parcelId = parcelId;
    this.checkouts.set(c.id, c); // durable order state
    return c;
  }

  /**
   * Queue an HMAC-signed status callback for the store. VendorCallbackService is what sends it.
   *
   * Signed over the EXACT body that goes on the wire, which is why the body is stored as a string
   * rather than rebuilt at send time — re-serialising JSON changes the whitespace and the signature
   * the merchant computes would not match, which is precisely what the documentation warns them about.
   */
  notify(vendorId: string, event: string, payload: Record<string, unknown>): VendorCallback | null {
    const vendor = this.vendors.get(vendorId);
    if (!vendor?.callbackUrl) return null;
    const at = new Date().toISOString();
    const body = JSON.stringify({ event, data: payload, at });
    const signature = createHmac('sha256', vendor.secret).update(body).digest('hex');
    const callback: VendorCallback = {
      id: `cb_${randomBytes(6).toString('hex')}`,
      vendorId,
      url: vendor.callbackUrl,
      event,
      signature,
      body,
      at,
      state: 'pending',
      attempts: 0,
      nextTryAt: at,
    };
    this.outbox.set(callback.id, callback);
    return callback;
  }

  /** What the merchant console shows: newest first, with whether it actually arrived. */
  outboxFor(vendorId?: string): VendorCallback[] {
    return [...this.outbox.values()]
      .filter((c) => (vendorId ? c.vendorId === vendorId : true))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 100);
  }

  /** Everything due to be sent. The sender lives in VendorCallbackService; this is the queue. */
  callbacksDue(now: number): VendorCallback[] {
    return [...this.outbox.values()].filter((c) => c.state === 'pending' && Date.parse(c.nextTryAt) <= now);
  }

  recordCallback(callback: VendorCallback): void {
    this.outbox.set(callback.id, callback);
  }

  /** One message to this store's system — and nobody else's: 404 for another store's id. */
  callbackOf(vendorId: string, callbackId: string): VendorCallback {
    const callback = this.outbox.get(callbackId);
    if (!callback || callback.vendorId !== vendorId) throw new GlosError('NOT_FOUND', 'No such message');
    return callback;
  }

  /**
   * SEND ONE AGAIN — given up on, already arrived, or still waiting: the store's own act (a store could see what was
   * sent and not whether it arrived, nor send it again; compendium check, the user's round 9).
   *
   * The SAME message: its id (`x-sbg-delivery`, so a handler that already took it skips it), its body byte for byte.
   * To the address the store has NOW, and signed with the secret it has now: one given up on a wrong address goes to
   * the one it was put right to, and one signed before the secret was turned still verifies. A fresh round of tries.
   */
  resendCallback(vendorId: string, callbackId: string, now: number = Date.now()): VendorCallback {
    const callback = this.callbackOf(vendorId, callbackId);
    const vendor = this.get(vendorId);
    if (!vendor.callbackUrl) throw new GlosError('INVALID_STATE', 'Your store has no address for its system: add one first');
    const again: VendorCallback = {
      ...callback,
      url: vendor.callbackUrl,
      signature: createHmac('sha256', vendor.secret).update(callback.body).digest('hex'),
      state: 'pending',
      attempts: 0,
      nextTryAt: new Date(now).toISOString(),
      resent: (callback.resent ?? 0) + 1,
    };
    delete again.lastError;
    this.outbox.set(again.id, again);
    return again;
  }

  /** A message that says only that it is a test: what a store sends itself to see its system take and verify ours. */
  testCallback(vendorId: string): VendorCallback {
    const sent = this.notify(vendorId, 'test', { message: 'A test message from SeeBuyGet. Verify its signature the way the guide says; then your system can read ours.' });
    if (!sent) throw new GlosError('INVALID_STATE', 'Your store has no address for its system: add one first');
    return sent;
  }
}
