import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DidService } from '../../foundation/did/did.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { CheckoutHandoff, CollectionPoint, GeoPoint, ShippingPolicy, Vendor } from './pudo.types';
import { DEFAULT_BAG_BAYS, DEFAULT_VENDOR_COUNTRY, MAX_BAG_BAYS, NETWORK_CURRENCY } from './pudo.config';
import { countryOfSite, requireCountryCode } from './country';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { EntityService } from '../../foundation/entity/entity.service';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES, type AccountCode } from '../../foundation/books/books.types';
import { paginate, textMatch, toCsv, withinDates, type Page } from './query';

/** One entry in a vendor's prepaid book with the per-country daughter company (GLOS reports, never escrows). */
export interface VendorSettlement {
  id: string;
  vendorId: string;
  country: string;
  type: 'TOP_UP' | 'BILLING' | 'REBATE';
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

export interface VendorCallback {
  id: string;
  vendorId: string;
  url: string;
  event: string;
  signature: string; // HMAC-SHA256 of the body
  body: string;
  at: string;
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

/** The merchant's word for an entry type — also the fourth thing the search matches. */
export function ledgerTypeWord(type: VendorSettlement['type']): string {
  return type === 'TOP_UP' ? 'Top-up' : type === 'BILLING' ? 'Shipment' : 'Rebate';
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
  if (q.q) out = out.filter((s) => textMatch([s.parcelId, s.note, ledgerTypeWord(s.type)], q.q));
  return [...out].sort(ledgerSort(q.sort));
}

/** Render matched entries as the vendor's bookkeeping CSV. Amount is a SIGNED number (a real negative for
 *  money out) so a spreadsheet reads it as a value, not a formula — and a Direction column spells it out. */
export function vendorLedgerToCsv(rows: VendorSettlement[]): string {
  return toCsv(
    ['Date', 'Type', 'Direction', 'Amount', 'Currency', 'Parcel', 'Note'],
    rows.map((s) => [s.at, ledgerTypeWord(s.type), s.sign === '+' ? 'in' : 'out', s.sign === '+' ? s.amount : -s.amount, settlementCurrencyOf(s), s.parcelId ?? '', s.note ?? '']),
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
  private readonly outbox: VendorCallback[] = [];
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
  ) {}

  /**
   * The sister company that settles this vendor. Records written before entities existed carry no
   * entityId, so they resolve from the country they already recorded — the same shape as the currency
   * backfill, and for the same reason: the answer was always implied, it was just never named.
   */
  entityIdOf(vendor: Vendor): string {
    return vendor.entityId ?? this.entities.requireForJurisdiction(vendor.country).entityId;
  }

  private static policy(p?: Partial<ShippingPolicy>): ShippingPolicy {
    // S34c — carry the freight-spend cap. A zero/negative/non-finite value means "no cap" (never a shipment
    // nobody can afford to move), so it is normalised to undefined here at the single policy chokepoint.
    const cap = p?.maxTransportSpend;
    const maxTransportSpend = cap != null && Number.isFinite(cap) && cap > 0 ? Math.round(cap * 100) / 100 : undefined;
    return { mode: p?.mode === 'full' ? 'full' : 'capped', freeOverSubtotal: p?.freeOverSubtotal ?? 50, buyerContributionCap: p?.buyerContributionCap ?? 3, maxTransportSpend };
  }

  register(input: { name: string; callbackUrl?: string; secret?: string; location?: { lat: number; lng: number }; address?: string; country?: string; shippingPolicy?: Partial<ShippingPolicy> }): Vendor {
    const country = requireCountryCode(input.country, DEFAULT_VENDOR_COUNTRY);
    // Which sister company will settle this store — refused outright if the network has no daughter
    // company there. Registering a vendor we cannot lawfully invoice is not a favour to anyone.
    const entity = this.entities.requireForJurisdiction(country);
    // A real DID (S2 pattern — mdp got the same treatment): the vendorId stays the domain
    // key; the DID is what the vendors/login token binds to. No PII goes to the core.
    const did = this.dids.generate(`vendor:${input.name}`, { role: 'vendor' }).id;
    this.core.upsert({ did, tier: 2, status: 'active', capabilities: ['vendor'], metadata: { country } });
    const vendor: Vendor = { vendorId: `ven_${randomBytes(6).toString('hex')}`, did, name: input.name, callbackUrl: input.callbackUrl, secret: input.secret ?? `whsec_${randomBytes(12).toString('hex')}`, location: input.location, address: input.address, country, entityId: entity.entityId, balance: 0, shippingPolicy: VendorService.policy(input.shippingPolicy), createdAt: new Date().toISOString() };
    this.vendors.set(vendor.vendorId, vendor);
    return vendor;
  }

  /**
   * Sign a merchant console in: vendorId + the signing secret (issued once, at registration).
   * One AUTH_FAILED for both an unknown id and a wrong secret — no oracle for guessing ids.
   * Constant-time compare, same as the account service's password check.
   */
  login(vendorId: string, secret: string): Vendor {
    const vendor = this.vendors.get(vendorId);
    if (!vendor) throw new GlosError('AUTH_FAILED', 'Wrong store ID or secret');
    const a = Buffer.from(String(secret ?? ''));
    const b = Buffer.from(vendor.secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new GlosError('AUTH_FAILED', 'Wrong store ID or secret');
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

  /** Real money in — the vendor prepays the daughter company. */
  topUp(vendorId: string, amount: number): Vendor {
    if (amount <= 0) throw new GlosError('AMOUNT_INVALID', 'Top-up must be positive');
    const vendor = this.get(vendorId);
    // The store's float is a DEPOSIT: the sister holds the money and owes it back as shipping. Nothing
    // is earned until a parcel moves — we charge for service, not for balance.
    const entryId = this.post(vendor, 'top-up', vendorId, [
      { code: ACCOUNT_CODES.CASH_CUSTODY, amount },
      { code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount: -amount },
    ]);
    this.book(vendor, 'TOP_UP', '+', amount, undefined, 'prepay', entryId);
    return this.syncBalance(vendor);
  }

  /**
   * Bill the full shipment cost. Returns whether the prepaid balance covered it (the 'ParcelPaid' gate).
   *
   * `fxBuffer` is the part of the price that came from the exchange-rate buffer rather than from selling a
   * service. It is split out of revenue here, at the only moment the whole price passes through one entry,
   * because **SBG is not a bank profiting from exchange rates**: what the buffer absorbs belongs in FX
   * gain/loss, where a buffer that is consistently too fat is a number somebody has to answer for.
   */
  billShipment(vendorId: string, parcelId: string, amount: number, fxBuffer = 0): { paid: boolean; balance: number } {
    const vendor = this.get(vendorId);
    if (this.balanceOf(vendorId) + 1e-9 < amount) return { paid: false, balance: this.balanceOf(vendorId) };
    // Clamped rather than trusted: a buffer larger than the price, or a negative one, would move money
    // between two of our own accounts on a caller's arithmetic mistake. It can only ever be a slice of this.
    const buffer = Number.isFinite(fxBuffer) ? Math.min(Math.max(Math.round(fxBuffer * 100) / 100, 0), amount) : 0;
    // The service is delivered: the deposit is drawn down and the sister recognises the revenue HERE —
    // all of it, less whatever of it was only ever a hedge against the rate moving.
    const entryId = this.post(vendor, 'shipping', parcelId, [
      { code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount },
      { code: ACCOUNT_CODES.REVENUE, amount: -(Math.round((amount - buffer) * 100) / 100) },
      ...(buffer > 0 ? [{ code: ACCOUNT_CODES.FX_GAINLOSS, amount: -buffer }] : []),
    ]);
    this.book(vendor, 'BILLING', '-', amount, parcelId, 'shipment', entryId);
    return { paid: true, balance: this.syncBalance(vendor).balance };
  }

  /** Refund a flexible parcel's over-hold (ceiling − actual) back to the vendor after delivery. */
  rebate(vendorId: string, parcelId: string, amount: number, note = 'flexible-route rebate'): Vendor {
    const vendor = this.get(vendorId);
    if (amount <= 0) return vendor;
    // The over-hold was never earned: revenue is given back and the deposit restored.
    const entryId = this.post(vendor, 'rebate', parcelId, [
      { code: ACCOUNT_CODES.REVENUE, amount },
      { code: ACCOUNT_CODES.DEPOSIT_VENDOR, counterparty: vendorId, amount: -amount },
    ]);
    this.book(vendor, 'REBATE', '+', amount, parcelId, note, entryId);
    return this.syncBalance(vendor);
  }

  /** Derived from the books — the store's float IS its deposit account, flipped for a human to read. */
  balanceOf(vendorId: string): number {
    return this.derivedBalance(this.get(vendorId));
  }

  private derivedBalance(vendor: Vendor): number {
    return -this.books.balance(this.entityIdOf(vendor), ACCOUNT_CODES.DEPOSIT_VENDOR, undefined, vendor.vendorId) || 0;
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
    vendor.balance = this.derivedBalance(vendor);
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
  updateProfile(vendorId: string, patch: { callbackUrl?: string; location?: { lat: number; lng: number }; address?: string; shippingPolicy?: Partial<ShippingPolicy> }): Vendor {
    const vendor = this.get(vendorId);
    if (patch.callbackUrl !== undefined) vendor.callbackUrl = patch.callbackUrl || undefined;
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
  setCollectionPoint(vendorId: string, input: { label: string; zone: string; country?: string; location: GeoPoint; bays?: number }): Vendor {
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
    const derived = this.derivedBalance(vendor);
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
    const handoff: CheckoutHandoff = { id: `chk_${randomBytes(6).toString('hex')}`, vendorId: input.vendorId, destAgentDid: input.destAgentDid, buyerEmail: input.buyerEmail, buyerMobile: input.buyerMobile, externalOrderId: input.externalOrderId, items: input.items, subtotal: input.subtotal, source: input.source ?? 'node', consumed: false, at: new Date().toISOString() };
    this.checkouts.set(handoff.id, handoff);
    return handoff;
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

  /** Push an HMAC-signed status callback to the vendor (recorded in the outbox; real HTTP in prod). */
  notify(vendorId: string, event: string, payload: Record<string, unknown>): VendorCallback | null {
    const vendor = this.vendors.get(vendorId);
    if (!vendor?.callbackUrl) return null;
    const body = JSON.stringify({ event, data: payload, at: new Date().toISOString() });
    const signature = createHmac('sha256', vendor.secret).update(body).digest('hex');
    const callback: VendorCallback = { id: `cb_${randomBytes(6).toString('hex')}`, vendorId, url: vendor.callbackUrl, event, signature, body, at: new Date().toISOString() };
    this.outbox.push(callback);
    return callback;
  }

  outboxFor(vendorId?: string): VendorCallback[] {
    return (vendorId ? this.outbox.filter((c) => c.vendorId === vendorId) : this.outbox).slice(-100).reverse();
  }
}
