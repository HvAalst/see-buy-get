import { ApiProperty } from '@nestjs/swagger';
import { PRESENCE_CAPABILITIES, PRESENCE_LEVELS, type PresenceCapability, type PresenceLevel } from '../../foundation/presence/presence.types';

/**
 * CA9 — WHAT LOWERING OR CLOSING A COUNTRY LEAVES BEHIND (user, 2026-09-13).
 *
 * A country can be switched down in one click by one person — refusing is the safe direction — and that is exactly
 * why the cost must be read first: the parcels already on shelves there and whose promise they were taken in
 * under, the loads starting or ending there, the money our companies still owe suppliers there, and everybody
 * registered there who will meet the change. Shown as the consequence of the move, before it is pressed, the way
 * the presence screen already shows capabilities gained and lost.
 *
 * A pure function over plain lists, so the arithmetic is tested without the services that hold them.
 */
export class ShelfImpact {
  @ApiProperty() total: number;
  /** Taken in under OUR promise — the ones a lost claims capability stops covering. */
  @ApiProperty() ours: number;
  @ApiProperty() theirs: number;
  /** Taken in before the promise was stamped. */
  @ApiProperty() unstamped: number;
}

export class FreightImpact {
  @ApiProperty() open: number;
  @ApiProperty() claimed: number;
}

export class OwedImpact {
  @ApiProperty() entityId: string;
  @ApiProperty() name: string;
  @ApiProperty() currency: string;
  @ApiProperty() amount: number;
  /** How many suppliers there it is owed to. */
  @ApiProperty() suppliers: number;
}

export class RegisteredImpact {
  @ApiProperty() shops: number;
  @ApiProperty() stores: number;
  @ApiProperty() hubs: number;
  @ApiProperty() fleets: number;
  @ApiProperty() couriers: number;
}

export class CountryImpact {
  @ApiProperty() jurisdiction: string;
  @ApiProperty({ enum: PRESENCE_LEVELS }) toLevel: PresenceLevel;
  @ApiProperty({ enum: PRESENCE_CAPABILITIES, isArray: true }) lost: PresenceCapability[];
  @ApiProperty({ enum: PRESENCE_CAPABILITIES, isArray: true }) gained: PresenceCapability[];
  /** True when the move stops goods being taken in there at all. */
  @ApiProperty() closing: boolean;
  @ApiProperty() shelves: ShelfImpact;
  /** Parcels on their way to a shop there. */
  @ApiProperty() inTransit: number;
  @ApiProperty() freight: FreightImpact;
  @ApiProperty({ type: [OwedImpact] }) owed: OwedImpact[];
  @ApiProperty() registered: RegisteredImpact;
}

/** Statuses a parcel is SITTING on a shelf in: at the shop that took it in, or waiting for its owner at the destination. */
const AT_ORIGIN_SHELF = new Set(['At_PUDO']);
const AT_DEST_SHELF = new Set(['Ready_For_Pickup', 'Unclaimed']);
const ON_ITS_WAY = new Set(['On_Bus', 'At_MDP']);
const FREIGHT_OPEN = new Set(['available', 'scheduled']);
const FREIGHT_OVER = new Set(['delivered', 'cancelled', 'expired']);

export function countryImpactOf(input: {
  jurisdiction: string;
  toLevel: PresenceLevel;
  lost: PresenceCapability[];
  gained: PresenceCapability[];
  shops: Array<{ did: string; country: string }>;
  parcels: Array<{ status: string; originAgentDid?: string; destAgentDid?: string; takeInPromise?: 'ours' | 'theirs' }>;
  stores: Array<{ country: string }>;
  hubs: Array<{ did: string; country: string }>;
  fleets: Array<{ did: string; jurisdiction?: string }>;
  couriers: Array<{ did: string; jurisdiction?: string; managerDid?: string }>;
  freight: Array<{ status: string; pickupCountry?: string; destCountry?: string }>;
  payables: Array<{ entityId: string; name: string; currency: string; outstanding: Array<{ counterparty: string; amount: number }> }>;
}): CountryImpact {
  const code = input.jurisdiction.toUpperCase();
  const here = (country?: string) => (country ?? '').toUpperCase() === code;

  const shopDids = new Set(input.shops.filter((s) => here(s.country)).map((s) => s.did));
  const hubs = input.hubs.filter((h) => here(h.country));
  const fleets = input.fleets.filter((f) => here(f.jurisdiction));
  // Only couriers the network contracts directly: a fleet's driver is its fleet's business, counted with the fleet.
  const couriers = input.couriers.filter((c) => !c.managerDid && here(c.jurisdiction));

  const onShelf = input.parcels.filter(
    (p) => (AT_ORIGIN_SHELF.has(p.status) && p.originAgentDid && shopDids.has(p.originAgentDid)) || (AT_DEST_SHELF.has(p.status) && p.destAgentDid && shopDids.has(p.destAgentDid)),
  );
  const shelves = {
    total: onShelf.length,
    ours: onShelf.filter((p) => p.takeInPromise === 'ours').length,
    theirs: onShelf.filter((p) => p.takeInPromise === 'theirs').length,
    unstamped: onShelf.filter((p) => !p.takeInPromise).length,
  };
  const inTransit = input.parcels.filter((p) => ON_ITS_WAY.has(p.status) && p.destAgentDid && shopDids.has(p.destAgentDid)).length;

  const touching = input.freight.filter((f) => here(f.pickupCountry) || here(f.destCountry));
  const freight = {
    open: touching.filter((f) => FREIGHT_OPEN.has(f.status)).length,
    claimed: touching.filter((f) => !FREIGHT_OPEN.has(f.status) && !FREIGHT_OVER.has(f.status)).length,
  };

  // Money owed stays owed whatever the level: the point of showing it is that nobody believes lowering settles it.
  const suppliers = new Set([...shopDids, ...hubs.map((h) => h.did), ...fleets.map((f) => f.did), ...couriers.map((c) => c.did)]);
  const owed = input.payables
    .map((p) => {
      const rows = p.outstanding.filter((o) => suppliers.has(o.counterparty) && o.amount > 0);
      return { entityId: p.entityId, name: p.name, currency: p.currency, amount: Math.round(rows.reduce((s, o) => s + o.amount, 0) * 100) / 100, suppliers: new Set(rows.map((o) => o.counterparty)).size };
    })
    .filter((o) => o.amount > 0);

  return {
    jurisdiction: code,
    toLevel: input.toLevel,
    lost: input.lost,
    gained: input.gained,
    closing: input.lost.includes('takeIn'),
    shelves,
    inTransit,
    freight,
    owed,
    registered: {
      shops: shopDids.size,
      stores: input.stores.filter((s) => here(s.country)).length,
      hubs: hubs.length,
      fleets: fleets.length,
      couriers: couriers.length,
    },
  };
}
