import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { EntityService } from '../../foundation/entity/entity.service';
import { AgentService } from './agent.service';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import type { Freight } from './dispatch.types';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import type { GeoPoint } from './pudo.types';
import { VendorService } from './vendor.service';

/**
 * Where a business's parcel stands on its way to its own door: `waiting` for it to be ready at the shop; `short` ready, but
 * the balance did not cover the most it allows, so no load is posted until it does; `posted` a load waits for a driver;
 * `handed` the shop gave it to that load's driver; `delivered` at its door; `collected` taken at the shop with its code
 * instead, and the load withdrawn.
 */
export const DOOR_STATES = ['waiting', 'short', 'posted', 'handed', 'delivered', 'collected'] as const;
export type DoorState = (typeof DOOR_STATES)[number];

/** One business parcel's last leg to its own door — kept beside the parcel and the load, never on them. */
export interface BusinessDoor {
  parcelId: string;
  entityId: string;
  vendorId: string;
  siteId: string;
  label: string;
  location: GeoPoint;
  country: string;
  shopDid: string;
  shopName: string;
  maxSpend: number;
  currency: string;
  state: DoorState;
  freightId?: string;
  code?: string;
  openedAt: string;
  postedAt?: string;
  handedAt?: string;
  deliveredAt?: string;
  receivedBy?: string;
}

/** As a shop's counter reads one: the parcel, the load, and whether a driver has taken it yet. */
export interface ShopDoorHandover {
  parcelId: string;
  binSlot?: string;
  business: string;
  load: { freightId: string; code: string; status: string; driverName?: string };
}

/** As the business reads its parcel's last leg. */
export interface DoorView {
  label: string;
  via: string;
  maxSpend: number;
  currency: string;
  state: DoorState;
  loadCode?: string;
  loadStatus?: string;
  driverName?: string;
  receivedBy?: string;
}

/**
 * A BUSINESS'S PARCEL, DELIVERED TO ITS OWN PLACE (the user, 2026-10-29: "A driver's last leg, priced on the day"; "At the
 * nearest shop").
 *
 * The parcel goes to the shop nearest the business's place, as every parcel goes to a shop. When it is ready there, a load
 * is posted from that shop to the place: the first driver whose vehicle fits takes it at their own price, never above what
 * the business allows, billed to its parcel balance when taken (as a store's load to its door is). The shop keeps the box
 * on its shelf and hands it to nobody but that load's driver, by their pass; from there the parcel goes on under the load,
 * and at the door its chain ends with whoever signed. Everything the business paid for is done: nothing is given back.
 *
 * If nobody takes the load, the parcel is still at the shop and can be collected there with its code like any other — and
 * then the load is withdrawn. Its money is never taken before a driver takes the load.
 */
@Injectable()
export class BusinessDoorService implements OnModuleInit {
  private readonly logger = new Logger(BusinessDoorService.name);
  private readonly doors = new PersistentMap<string, BusinessDoor>('business-parcel-doors');

  constructor(
    private readonly dispatch: DispatchService,
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
    private readonly agents: AgentService,
    private readonly entities: EntityService,
    private readonly events: EventBus,
    private readonly drivers: DriverService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    // Ready at its shop: the last leg is posted.
    this.events.subscribe<{ parcelId?: string }>(GlosEvent.Pudo.ParcelReadyForPickup, (e) => {
      if (e.payload?.parcelId) this.tryPost(String(e.payload.parcelId));
    });
    // Collected at the shop with its code instead: the load has nothing to carry.
    this.events.subscribe<{ parcelId?: string }>(GlosEvent.Pudo.ParcelDelivered, (e) => {
      if (e.payload?.parcelId) this.collectedAtShop(String(e.payload.parcelId));
    });
    // Delivered at its door.
    this.events.subscribe<{ freightId?: string }>(GlosEvent.Pudo.FreightDelivered, (e) => {
      if (e.payload?.freightId) this.arrived(String(e.payload.freightId));
    });
  }

  /** The last leg, asked for when the parcel is sent. */
  open(door: Omit<BusinessDoor, 'state' | 'openedAt'>, now: number = Date.now()): BusinessDoor {
    const kept: BusinessDoor = { ...door, state: 'waiting', openedAt: new Date(now).toISOString() };
    this.doors.set(door.parcelId, kept);
    return kept;
  }

  /** The last leg of one parcel, as its business reads it — nothing where it goes to a shop for collection. */
  viewOf(parcelId: string): DoorView | undefined {
    const d = this.doors.get(parcelId);
    if (!d) return undefined;
    const f = this.loadOf(d);
    const driver = f?.claimedBy ? this.nameOf(f.claimedBy) : undefined;
    return {
      label: d.label,
      via: d.shopName,
      maxSpend: f?.maxSpend ?? d.maxSpend,
      currency: d.currency,
      state: d.state,
      ...(d.code ? { loadCode: d.code } : {}),
      ...(f ? { loadStatus: f.status } : {}),
      ...(driver ? { driverName: driver } : {}),
      ...(d.receivedBy ? { receivedBy: d.receivedBy } : {}),
    };
  }

  /**
   * POST THE LAST LEG, once the parcel is ready at its shop. Not before — a driver must not wait for a box still on its way
   * — and not without the money for the most the business allows: then it waits, `short`, and the business is told.
   */
  tryPost(parcelId: string, now: number = Date.now()): BusinessDoor | undefined {
    const d = this.doors.get(parcelId);
    if (!d || (d.state !== 'waiting' && d.state !== 'short')) return d;
    let p;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      return d;
    }
    if (p.status !== 'Ready_For_Pickup' || p.destAgentDid !== d.shopDid) return d;
    if (this.vendors.balanceOf(d.vendorId) + 1e-9 < d.maxSpend) {
      if (d.state !== 'short') {
        this.doors.set(parcelId, { ...d, state: 'short' });
        this.tellShort(d);
      }
      return this.doors.get(parcelId);
    }
    try {
      const shop = this.agents.get(d.shopDid);
      const vendor = this.vendors.get(d.vendorId);
      const load = this.dispatch.registerFreight(
        {
          description: `Parcel ${p.parcelId} for ${vendor.name}: from ${shop.shopName} to its own door`,
          pickupLocation: shop.location,
          pickupLabel: shop.shopName,
          destLabel: d.label,
          destLocation: d.location,
          weightKg: p.weightKg,
          fragile: p.fragile,
          packaging: 'piece',
          packages: 1,
          natureCode: p.natureCode,
          ...(p.dimensionsCm ? { dimensionsCm: [p.dimensionsCm.l, p.dimensionsCm.w, p.dimensionsCm.h] as [number, number, number] } : {}),
          shipperDid: d.vendorId,
          pickupCountry: this.agents.countryOf(shop),
          destCountry: d.country,
          ...(p.externalOrderId ? { externalOrderId: p.externalOrderId } : {}),
          maxSpend: d.maxSpend,
          // Who receives it at the door: the driver calls them, as the receiver of the parcel.
          contactName: vendor.name,
          ...(p.receiverMobile ? { contactPhone: p.receiverMobile } : {}),
          deliversParcel: { parcelId: p.parcelId, atShopDid: d.shopDid, shopName: d.shopName },
        },
        now,
      );
      const posted: BusinessDoor = { ...d, state: 'posted', freightId: load.freightId, code: load.code, postedAt: new Date(now).toISOString() };
      this.doors.set(parcelId, posted);
      return posted;
    } catch (err) {
      this.logger.warn(`last leg of ${parcelId} not posted: ${(err as Error).message}`);
      return d;
    }
  }

  /** The business posts the last leg itself — after topping up, once it was `short`. */
  postNow(vendorId: string, parcelId: string, now: number = Date.now()): BusinessDoor {
    const d = this.requireOwn(vendorId, parcelId);
    if (d.state === 'posted' || d.state === 'handed' || d.state === 'delivered') throw new GlosError('INVALID_STATE', `Its last leg is posted already${d.code ? `: load ${d.code}` : ''}`);
    if (d.state === 'collected') throw new GlosError('INVALID_STATE', 'It was collected at the shop');
    const after = this.tryPost(parcelId, now)!;
    if (after.state === 'waiting') throw new GlosError('INVALID_STATE', `It is not at ${d.shopName} yet: its last leg is posted once it is`);
    if (after.state === 'short') throw new GlosError('WALLET_INSUFFICIENT', `Top up first: the last leg needs up to ${d.maxSpend.toFixed(2)} ${d.currency} in your balance`);
    return after;
  }

  /** Raise the most it pays a driver for the last leg, while nobody has taken it. */
  raise(vendorId: string, parcelId: string, amount: number): BusinessDoor {
    const d = this.requireOwn(vendorId, parcelId);
    if (!d.freightId || d.state !== 'posted') {
      // Not posted yet: the most is simply changed, and asked for when the parcel is ready.
      if (d.state === 'waiting' || d.state === 'short') {
        const most = Math.round(Number(amount) * 100) / 100;
        if (!Number.isFinite(most) || most <= 0) throw new GlosError('INVALID_INPUT', 'Say the most you will pay a driver for the last leg', { field: 'maxSpend' });
        const next = { ...d, maxSpend: most };
        this.doors.set(parcelId, next);
        return this.tryPost(parcelId) ?? next;
      }
      throw new GlosError('INVALID_STATE', 'Its last leg is under way: its price is fixed');
    }
    const f = this.dispatch.raiseMaxSpend(d.freightId, vendorId, amount);
    const next = { ...d, maxSpend: f.maxSpend ?? d.maxSpend };
    this.doors.set(parcelId, next);
    return next;
  }

  /** At this shop: the parcels whose load to their business's door is posted, not yet handed over. */
  handoversAt(shopDid: string): ShopDoorHandover[] {
    const out: ShopDoorHandover[] = [];
    for (const d of this.doors.values()) {
      if (d.shopDid !== shopDid || d.state !== 'posted') continue;
      const f = this.loadOf(d);
      if (!f || f.status === 'cancelled') continue;
      let binSlot: string | undefined;
      try {
        binSlot = this.parcels.get(d.parcelId).binSlot;
      } catch {
        binSlot = undefined;
      }
      const driver = f.claimedBy ? this.nameOf(f.claimedBy) : undefined;
      out.push({ parcelId: d.parcelId, ...(binSlot ? { binSlot } : {}), business: this.vendors.get(d.vendorId).name, load: { freightId: f.freightId, code: f.code, status: f.status, ...(driver ? { driverName: driver } : {}) } });
    }
    return out.sort((a, b) => a.parcelId.localeCompare(b.parcelId));
  }

  /** The shop hands one to the driver who took its load — by their pass, and to nobody else. */
  hand(shopDid: string, parcelId: string, badgeId: string, byName: string, now: number = Date.now()): ShopDoorHandover[] {
    const d = this.doors.get(parcelId);
    if (!d || d.shopDid !== shopDid || d.state !== 'posted' || !d.freightId) throw new GlosError('NOT_FOUND', `No parcel for a door waits here as ${parcelId}`);
    const { load, driverDid } = this.dispatch.handDeliversParcel(d.freightId, shopDid, badgeId, byName, now);
    this.parcels.releaseToDoorDriver(parcelId, shopDid, driverDid, { freightId: load.freightId, code: load.code }, now);
    this.doors.set(parcelId, { ...d, state: 'handed', handedAt: new Date(now).toISOString() });
    return this.handoversAt(shopDid);
  }

  /** Collected at the shop with its code instead: its load is withdrawn — before the driver had it, nothing was paid. */
  private collectedAtShop(parcelId: string): void {
    const d = this.doors.get(parcelId);
    if (!d || d.state === 'handed' || d.state === 'delivered' || d.state === 'collected') return;
    try {
      // Handed to its door driver: that is the shop's step above, never a collection.
      if (this.parcels.get(parcelId).doorLoad) return;
      if (d.freightId) this.dispatch.withdrawDeliversParcel(d.freightId, 'its parcel was collected at the shop');
    } catch (err) {
      this.logger.warn(`door load of ${parcelId} not withdrawn: ${(err as Error).message}`);
    }
    this.doors.set(parcelId, { ...d, state: 'collected' });
  }

  /** At its door: the parcel's chain ends with whoever signed, and its business — and its system — hear it. */
  private arrived(freightId: string): void {
    const d = [...this.doors.values()].find((x) => x.freightId === freightId);
    if (!d || d.state !== 'handed') return;
    try {
      const f = this.dispatch.requireFreightPublic(freightId);
      const at = f.deliveredAt ?? new Date().toISOString();
      const receivedBy = f.proofOfDelivery?.receiverName;
      this.parcels.atItsDoor(d.parcelId, receivedBy, at);
      this.doors.set(d.parcelId, { ...d, state: 'delivered', deliveredAt: at, ...(receivedBy ? { receivedBy } : {}) });
      void this.events.publish(GlosEvent.Pudo.ParcelAtDoor, { parcelId: d.parcelId, freightId, receivedBy }, { source: 'pudo' }).catch(() => undefined);
    } catch (err) {
      this.logger.warn(`door of ${d.parcelId} not written: ${(err as Error).message}`);
    }
  }

  private requireOwn(vendorId: string, parcelId: string): BusinessDoor {
    const d = this.doors.get(parcelId);
    if (!d || d.vendorId !== vendorId) throw new GlosError('NOT_FOUND', `No parcel ${parcelId} goes to a door of yours`);
    return d;
  }

  private loadOf(d: BusinessDoor): Freight | undefined {
    if (!d.freightId) return undefined;
    try {
      return this.dispatch.requireFreightPublic(d.freightId);
    } catch {
      return undefined;
    }
  }

  private nameOf(driverDid: string): string | undefined {
    try {
      return this.drivers.get(driverDid).displayName ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Its bell: the last leg waits for money. */
  private tellShort(d: BusinessDoor): void {
    const entity = this.entities.find(d.entityId);
    if (!entity) return;
    void this.notifications
      ?.notify(entity.did, {
        kind: 'parcel_door_short',
        title: `Top up so ${d.parcelId} can come to your door`,
        body: `It is ready at ${d.shopName}. Its last leg to ${d.label} needs up to ${d.maxSpend.toFixed(2)} ${d.currency} in your parcel balance before a driver is asked. Top up, then post it under Parcels — or collect it at the shop with its code.`,
        link: '/',
        data: { parcelId: d.parcelId },
      })
      .catch((err: Error) => this.logger.warn(`door-short notice not sent: ${err.message}`));
  }
}
