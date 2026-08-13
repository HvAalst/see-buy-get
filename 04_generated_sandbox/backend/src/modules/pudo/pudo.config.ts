// PUDO Light economic + operational constants (Compendium Ch 14–17). Hard-coding these here is a
// placeholder for the admin-editable config service the playbook mandates (Risk #55).

import { ParcelSize } from './pudo.types';

export const WHOLESALE = 1.6; // credit the platform consumes per shipped parcel
export const RETAIL = 2.0; // what the agent charges a cash customer (keeps the spread)
export const LABOUR_FEE = 0.4; // paid to the agent for handling a pre-paid drop / inbound intake
export const HANDOVER_FEE = 0.5; // paid to the agent for handing a batch to the bus
export const PICKUP_FEE = 0.3; // paid to the destination agent for releasing a parcel to the customer
export const LOCK_THRESHOLD = 1.6; // wallet below this → 'no money, no scan' lockout
export const VOID_WINDOW_MS = 5 * 60 * 1000; // 5-minute reverse-logistics window
// A parcel's RELEASE SECRET — the peer-send OTP read aloud by the destination agent, or the inbound
// buyer's collection code held in their app — is the only check between a stranger and someone else's
// parcel, so wrong attempts are counted per parcel and the secret is burned. Recover with an operator
// reissue (parcels/:id/reissue-release), which rotates the secret rather than merely unlocking it.
export const OTP_MAX_ATTEMPTS = 5;

// The printed label carries the parcel's creation DATE so a shopkeeper can see at a glance that a box
// has been sitting there a week. The server clock is UTC and the label has no locale, so the date is
// rendered at the network's operating offset — a parcel minted at 01:00 in Nairobi must not print
// yesterday. Swap this for a per-zone timezone when the network leaves East Africa.
export const LABEL_TZ_OFFSET_MIN = 180; // EAT (UTC+3)

// Bus-vs-truck heuristic + size→weight tiers (Heavy > 20 kg).
export const BUS_MAX_KG = 500;
export const SIZE_WEIGHT_KG: Record<ParcelSize, number> = { S: 1, M: 5, L: 15, HEAVY: 25 };

// Size auto-classification (Risk: "small for the vendor is large for the shipper"). The merchant enters
// real dimensions (cm) + weight (kg); the tier is DERIVED, not chosen, so a parcel can't be under-declared.
// A tier fits only if every (descending-sorted) dimension is within the limit AND the weight is within it.
export interface SizeLimit { size: ParcelSize; maxCm: [number, number, number]; maxKg: number; }
export const SIZE_LIMITS: SizeLimit[] = [
  { size: 'S', maxCm: [35, 25, 10], maxKg: 2 },
  { size: 'M', maxCm: [45, 35, 25], maxKg: 5 },
  { size: 'L', maxCm: [60, 50, 40], maxKg: 15 },
  { size: 'HEAVY', maxCm: [120, 80, 80], maxKg: 30 },
];
export const MAX_PARCEL_KG = 30; // beyond this it is bulk freight, not a PUDO parcel

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Derive the size tier from dimensions (cm) + weight (kg). Throws over the heavy ceiling. */
export function classifySize(dims: { l: number; w: number; h: number; kg: number }): ParcelSize {
  const desc = [dims.l, dims.w, dims.h].sort((a, b) => b - a);
  for (const lim of SIZE_LIMITS) {
    const limDesc = [...lim.maxCm].sort((a, b) => b - a);
    if (dims.kg <= lim.maxKg && desc.every((d, i) => d <= limDesc[i])) return lim.size;
  }
  return 'HEAVY';
}

// --- Open-data, participant-set pricing (the "fuel-pump" model) ---
// Each provider publishes its own rate (visible to vendors/agents/drivers to keep competition). A
// shipment is quoted from the route: node fees (per parcel, at each PUDO + MDP passed) + transport
// (per km × distance). GLOS holds no fiat — it REPORTS the agreed price to a per-country daughter
// company and bills the vendor prepaid. The 2% is that daughter company's reporting/handling margin.
export const DEFAULT_PUDO_PRICE_PER_PARCEL = 0.5; // a PUDO agent's default handling fee per parcel
export const DEFAULT_MDP_PRICE_PER_PARCEL = 0.3; // an MDP hub's default sort fee per parcel
export const DEFAULT_PRICE_PER_KM = 0.08; // a vehicle's default transport rate per km
export const PLATFORM_FEE_PCT = 0.02; // 2% daughter-co margin on top of provider costs
export const DEFAULT_VENDOR_COUNTRY = 'KE'; // which country daughter company settles a vendor
export const round2cfg = round2;

/** Apply the platform margin to a base provider cost. */
export function withPlatformFee(base: number): number {
  return round2(base * (1 + PLATFORM_FEE_PCT));
}

// S34b — dynamic market-pulse tunables. The engine buckets the map into ~0.1° cells (a "market zone",
// mirroring the monitor heatmap), samples supply (live vehicles) vs demand (open freight) per cell, and
// derives a raw multiplier factor = 1 + K·(pressure − 1) that the freight price is flexed by — always then
// clamped to the individual vehicle's own [min,max] corridor. A thin cell (few open loads) stays neutral.
export const MARKET_CELL_DP = 1; // decimal places for the geo-cell key → 0.1° ≈ 11 km market zones
export const MARKET_MIN_DEMAND = 3; // a cell needs at least this many open loads before any surge/discount
export const MARKET_SURGE_K = 0.25; // sensitivity: factor = 1 + K·(demand/supply − 1)
export const MARKET_RAW_MIN = 0.7; // the engine's own factor floor (before the per-vehicle corridor clamp)
export const MARKET_RAW_MAX = 2.0; // …and ceiling — the market never asks for more than 2× off the base rate
export const MARKET_SUPPLY_STALE_MIN = 30; // a driver's GPS older than this no longer counts as live supply
export const MARKET_RECOMPUTE_MS = 120_000; // recompute the whole-map pulse every 2 minutes

// Heavier parcels occupy more of a vehicle — scale the per-km transport by size so a heavy isn't priced
// like a letter (keeps the per-km rate the provider advertises, multiplied by how much room it takes).
export const SIZE_TRANSPORT_FACTOR: Record<ParcelSize, number> = { S: 0.4, M: 1, L: 1.6, HEAVY: 3 };

// MDP tote-bag capacity (Compendium Ch 17 — Main Distribution Point sorting).
// A tote holds at most BAG_CAPACITY_UNITS of "fill". Per-size fill is tuned so the three field rules
// land exactly: 50 letters + 1 medium = 10, 10 mediums = 10, and a single >20 kg parcel = 10 (it
// fills a bag on its own — nothing shares with a heavy). Bulk goods never enter a tote (truck-direct).
export const BAG_CAPACITY_UNITS = 10;
export const SIZE_UNITS: Record<ParcelSize, number> = { S: 0.18, M: 1, L: 2, HEAVY: 10 };
export const TOTE_CODE_PREFIX = 'BAG';

// Tote/MDP-path settlement (parallel to the direct-path LABOUR/HANDOVER/PICKUP fees).
export const TOTE_LOAD_FEE = 0.5; // paid to the driver who scans a bag onto their vehicle
export const MDP_SORT_FEE = 0.2; // MDP labour, per parcel sorted into its next-hop bag

// Agent-eligibility filter (Ch 18.1) + onboarding (18.3).
export const MIN_SLOTS = 6; // minimum shelf capacity (rows × cols)
export const MIN_OPEN_HOURS = 10; // average open hours/day across open days
export const MIN_ANDROID_VERSION = 10;
export const EQUIPMENT_DEPOSIT_USD = 50; // refundable starter-kit deposit

// Shelf grid: columns are colour-coded, rows numbered. Supports up to 10 columns.
export const SHELF_COLORS = ['Red', 'Orange', 'Amber', 'Green', 'Teal', 'Blue', 'Indigo', 'Violet', 'Pink', 'Brown'];
// How many small (S) parcels a consolidation ("bundle") slot may pool — letters/envelopes share one slot
// instead of each burning a whole one.
export const CONSOLIDATION_MAX_ITEMS = 12;

// Routing / leg ETA.
export const VEHICLE_SPEED_KMH: Record<'bus' | 'truck', number> = { bus: 40, truck: 55 };
export const DISPATCH_BUFFER_H = 1; // time until the next scheduled departure (simplified)
export const HANDOVER_BUFFER_H = 0.5;
// G2 — road distance ≈ straight-line × this. Real roads are ~30–40% longer than the crow flies; 1.35 is
// a sane country-wide average the sandbox Router applies over haversine (a real OSRM/Valhalla adapter is
// the production swap). Legs, ETAs and freight pricing all read the routed distance, not the great circle.
export const ROAD_CIRCUITY_FACTOR = 1.35;

// Dispatch marketplace (Ch 19 — opportunistic line-haul). A filling tote is published for drivers to
// claim once it is full OR has waited this long; suggestions auto-ignore if unanswered within the TTL.
export const TOTE_MAX_WAIT_H = 24; // max time a tote waits before it is offered even if not full
export const OFFER_TTL_MIN = 10; // a suggestion auto-ignores if the driver does not answer in time
// F1 — an early-CLAIMED scheduled freight not picked up by this long AFTER its pickup date is a no-show:
// it is released back to the marketplace (and the shipper rebated) so an early reservation can't strand it.
export const FREIGHT_NOSHOW_GRACE_H = 12;
// F3 — a consolidation consignment (durable dry commodity) posts to the marketplace once it is FULL or once
// it has waited this long unfilled, mirroring a tote's full-or-aged publish. Durable goods can sit while a
// truckload builds, so the aged window is generous. MAX target caps a single lot at a sane truckload.
export const CONSIGNMENT_MAX_WAIT_H = 96; // 4 days
export const MAX_CONSIGNMENT_TARGET_KG = 40_000;
export const DISPATCH_MAX_DETOUR_KM = 8; // a pickup may be at most this far off the planned A→B route
export const DISPATCH_MAX_PICKUP_MIN = 30; // and at most this many minutes from the driver's start

// Auto-flag time windows (Ch 14).
export const STAGNANT_INVENTORY_H = 48; // At_PUDO too long
export const GHOST_BUS_H = 6; // On_Bus too long
export const MDP_DWELL_H = 12; // At_MDP (awaiting sort/load) too long
export const CONNECTIVITY_LOSS_H = 2; // agent no-ping
export const AGENT_ONLINE_H = 1; // counted "online" if pinged within this window
