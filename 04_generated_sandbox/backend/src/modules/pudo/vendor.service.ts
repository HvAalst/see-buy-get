import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { createHmac, randomBytes } from 'crypto';
import { CheckoutHandoff, ShippingPolicy, Vendor } from './pudo.types';
import { DEFAULT_VENDOR_COUNTRY } from './pudo.config';

/** One entry in a vendor's prepaid book with the per-country daughter company (GLOS reports, never escrows). */
export interface VendorSettlement {
  id: string;
  vendorId: string;
  country: string;
  type: 'TOP_UP' | 'BILLING' | 'REBATE';
  sign: '+' | '-';
  amount: number;
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

/**
 * VendorService (PUDO ↔ e-commerce). The registry of businesses that wire their checkout into PUDO
 * for click-and-collect, and the outbound status-callback channel: when a parcel reaches a milestone
 * (ready for pickup, delivered, disputed), GLOS pushes an HMAC-SHA256-signed callback to the vendor's
 * URL so their store can notify the buyer — mirroring a standard click-and-collect integration. GLOS
 * holds no fiat; this is logistics orchestration only.
 */
@Injectable()
export class VendorService {
  private readonly vendors = new Map<string, Vendor>();
  private readonly outbox: VendorCallback[] = [];
  private readonly checkouts: CheckoutHandoff[] = [];
  private readonly settlements: VendorSettlement[] = [];

  private static policy(p?: Partial<ShippingPolicy>): ShippingPolicy {
    return { mode: p?.mode === 'full' ? 'full' : 'capped', freeOverSubtotal: p?.freeOverSubtotal ?? 50, buyerContributionCap: p?.buyerContributionCap ?? 3 };
  }

  register(input: { name: string; callbackUrl?: string; secret?: string; location?: { lat: number; lng: number }; address?: string; country?: string; shippingPolicy?: Partial<ShippingPolicy> }): Vendor {
    const vendor: Vendor = { vendorId: `ven_${randomBytes(6).toString('hex')}`, name: input.name, callbackUrl: input.callbackUrl, secret: input.secret ?? `whsec_${randomBytes(12).toString('hex')}`, location: input.location, address: input.address, country: input.country || DEFAULT_VENDOR_COUNTRY, balance: 0, shippingPolicy: VendorService.policy(input.shippingPolicy), createdAt: new Date().toISOString() };
    this.vendors.set(vendor.vendorId, vendor);
    return vendor;
  }

  // --- prepaid settlement with the per-country daughter company (GLOS reports; holds no fiat) ---

  private book(vendor: Vendor, type: VendorSettlement['type'], sign: '+' | '-', amount: number, parcelId?: string, note?: string): VendorSettlement {
    const entry: VendorSettlement = { id: `vs_${randomBytes(6).toString('hex')}`, vendorId: vendor.vendorId, country: vendor.country, type, sign, amount: Math.round(amount * 100) / 100, parcelId, note, at: new Date().toISOString() };
    this.settlements.push(entry);
    return entry;
  }

  /** Real money in — the vendor prepays the daughter company. */
  topUp(vendorId: string, amount: number): Vendor {
    if (amount <= 0) throw new GlosError('AMOUNT_INVALID', 'Top-up must be positive');
    const vendor = this.get(vendorId);
    vendor.balance = Math.round((vendor.balance + amount) * 100) / 100;
    this.book(vendor, 'TOP_UP', '+', amount, undefined, 'prepay');
    return vendor;
  }

  /** Bill the full shipment cost. Returns whether the prepaid balance covered it (the 'ParcelPaid' gate). */
  billShipment(vendorId: string, parcelId: string, amount: number): { paid: boolean; balance: number } {
    const vendor = this.get(vendorId);
    if (vendor.balance + 1e-9 < amount) return { paid: false, balance: vendor.balance };
    vendor.balance = Math.round((vendor.balance - amount) * 100) / 100;
    this.book(vendor, 'BILLING', '-', amount, parcelId, 'shipment');
    return { paid: true, balance: vendor.balance };
  }

  /** Refund a flexible parcel's over-hold (ceiling − actual) back to the vendor after delivery. */
  rebate(vendorId: string, parcelId: string, amount: number): Vendor {
    const vendor = this.get(vendorId);
    if (amount <= 0) return vendor;
    vendor.balance = Math.round((vendor.balance + amount) * 100) / 100;
    this.book(vendor, 'REBATE', '+', amount, parcelId, 'flexible-route rebate');
    return vendor;
  }

  balanceOf(vendorId: string): number {
    return this.get(vendorId).balance;
  }

  settlementsFor(vendorId: string): VendorSettlement[] {
    return this.settlements.filter((s) => s.vendorId === vendorId).slice().reverse();
  }

  /** Update the store profile (map pin, address, callback URL, split/contribution policy). */
  updateProfile(vendorId: string, patch: { callbackUrl?: string; location?: { lat: number; lng: number }; address?: string; shippingPolicy?: Partial<ShippingPolicy> }): Vendor {
    const vendor = this.get(vendorId);
    if (patch.callbackUrl !== undefined) vendor.callbackUrl = patch.callbackUrl || undefined;
    if (patch.location !== undefined) vendor.location = patch.location;
    if (patch.address !== undefined) vendor.address = patch.address || undefined;
    if (patch.shippingPolicy !== undefined) vendor.shippingPolicy = VendorService.policy({ ...vendor.shippingPolicy, ...patch.shippingPolicy });
    return vendor;
  }

  get(vendorId: string): Vendor {
    const vendor = this.vendors.get(vendorId);
    if (!vendor) throw new GlosError('NOT_FOUND', `Vendor not found: ${vendorId}`);
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
    this.checkouts.push(handoff);
    return handoff;
  }

  /** Open (not-yet-shipped) checkout handoffs for a vendor — the console's incoming-orders inbox. */
  checkoutsFor(vendorId: string, includeConsumed = false): CheckoutHandoff[] {
    return this.checkouts.filter((c) => c.vendorId === vendorId && (includeConsumed || !c.consumed)).slice().reverse();
  }

  checkout(id: string): CheckoutHandoff {
    const c = this.checkouts.find((x) => x.id === id);
    if (!c) throw new GlosError('NOT_FOUND', `Checkout not found: ${id}`);
    return c;
  }

  /** Mark a handoff as turned into a shipment. */
  consumeCheckout(id: string, parcelId: string): CheckoutHandoff {
    const c = this.checkout(id);
    c.consumed = true;
    c.parcelId = parcelId;
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
