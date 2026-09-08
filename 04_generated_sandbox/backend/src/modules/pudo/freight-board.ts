// FB1 — why a driver cannot take a load, said out loud.
//
// The open board shows the WHOLE market and marks what an operator cannot take, rather than filtering it
// away (user, 2026-08-30: "we show everything. Information is a key for decision making and that is also true
// for investments. Entrepreneurs should get that data from us"). Hiding a job because it needs a tail-lift
// denies an operator the one thing that tells them what to buy next.
//
// Which only works if every "no" is TYPED. An untyped board is a grey wall of "can't take" and teaches an
// operator to ignore all of it. Typed, they can ask the question they actually came for: show me the loads
// I'd win if I bought a kooiaap.
//
// Pure functions over plain data — the matching predicates in DispatchService answer yes/no, and these answer
// the same questions with a reason attached. They must stay in step: a rule that filters a load out of the
// offers and does not appear here would be an invisible exclusion, which is the failure the board exists to
// remove.

import { Equipment, VehicleCapability } from './cargo.types';
import { TruckSubtype } from './fleet.config';
import { BlockerKind, BoardBlocker } from './dispatch.types';

/** What each kind means, so a screen can group and sort them without re-deciding the taxonomy. */
export const BLOCKER_KIND_MEANING: Record<BlockerKind, string> = {
  legal: 'Nobody may do this, ever',
  physical: 'It does not fit, or the vehicle cannot carry it',
  resolvable: 'You could take this if something changed — the investment signal',
  preference: 'Someone has ruled it out, and could be argued with',
  unknown: 'We could not check this, and are not pretending otherwise',
};

const EQUIPMENT_NAME: Record<Equipment, string> = {
  MAN: 'hands and a helper',
  HTR: 'a hand truck',
  PLT: 'a pallet jack',
  FLT: 'a forklift',
  TLT: 'a tail-lift',
  CRN: 'a crane or Hiab',
  RMP: 'a loading ramp',
  STR: 'securement straps',
};

// A cargo capability is not one kind of "no". Carrying hazardous goods without a certified body is illegal;
// carrying a perishable without a cold chain is merely ruinous. An operator deciding what to buy needs to
// know which of those they are looking at.
const CAPABILITY_BLOCK: Record<VehicleCapability, { kind: BlockerKind; message: string }> = {
  hazmat: { kind: 'legal', message: 'Hazardous cargo — needs a certified hazmat body' },
  coldChain: { kind: 'physical', message: 'Cold chain — needs a refrigerated or insulated body' },
  carriesBulk: { kind: 'physical', message: 'Loose bulk — needs a tipping or hopper body' },
  allowsFragile: { kind: 'physical', message: 'Fragile cargo — this vehicle class may not carry it' },
};

/** The load's facts, as the board needs them. */
export interface BoardLoad {
  weightKg: number;
  fragile: boolean;
  bulk: boolean;
  requiredCapabilities: VehicleCapability[];
  requiredEquipment: Equipment[];
  excludedBodies?: TruckSubtype[];
  maxSpend?: number;
  /** The derived body — 'lowboy' and other oversize bodies are what trigger the unchecked-route notice. */
  derivedBody?: TruckSubtype;
  indivisible?: boolean;
}

/** The vehicle being judged against, or null when the driver is not coupled to one. */
export interface BoardVehicle {
  truckSubtype?: TruckSubtype;
  capacityKg: number;
  equipment?: Equipment[];
  hazmat?: boolean;
  coldChain?: boolean;
  carriesBulk?: boolean;
  allowsFragile?: boolean;
}

// Bodies whose loads routinely meet a bridge or a tunnel. We hold no clearance or axle data for any corridor
// (see the crowd-sourced constraint map), so for these the honest answer is that the route was NOT CHECKED.
const ROUTE_SENSITIVE: TruckSubtype[] = ['lowboy', 'logging', 'car_carrier', 'skeletal', 'container_selfloader', 'crane'];

/**
 * Every reason this driver cannot take this load, typed. An empty array means they can.
 *
 * Deliberately returns ALL of them rather than short-circuiting on the first: "you need a tail-lift" is a
 * different investment decision from "you need a tail-lift AND 12 more tonnes of payload", and an operator
 * shown one reason at a time will make the wrong call about which one to fix.
 */
export function blockersFor(
  load: BoardLoad,
  vehicle: BoardVehicle | null,
  ctx: {
    remainingKg: number;
    ratingBelowFloor: boolean;
    indicativeCharge?: number;
    /**
     * What the crowd-sourced constraint map says about this road, computed by the caller.
     *
     * Passed IN rather than looked up here, because this module is pure and the map is a service. When it
     * is absent — an older caller, a load with no route — the hardcoded NOT CHECKED below still fires, so
     * the honest answer is the default and the real answer is the upgrade. Never the other way round.
     */
    routeBlockers?: BoardBlocker[];
  },
): BoardBlocker[] {
  const out: BoardBlocker[] = [];

  // Judged first and alone: with no vehicle there is nothing to judge the rest against, and inventing
  // capability failures for a vehicle that does not exist would be noise, not information.
  if (!vehicle) {
    out.push({ kind: 'resolvable', code: 'NO_VEHICLE', message: 'Couple to a vehicle to see whether you can take this' });
    return out;
  }

  if (ctx.ratingBelowFloor) {
    out.push({ kind: 'resolvable', code: 'RATING_BELOW_FLOOR', message: 'Your rating is below the network minimum — freight is paused until it recovers' });
  }
  if (load.weightKg > vehicle.capacityKg) {
    out.push({ kind: 'physical', code: 'OVER_VEHICLE_CAPACITY', message: `${fmt(load.weightKg)} kg — ${fmt(load.weightKg - vehicle.capacityKg)} kg over what your vehicle can carry` });
  } else if (load.weightKg > ctx.remainingKg) {
    // A DIFFERENT problem from the one above, and a much better one to have: the vehicle is big enough, it is
    // just full right now. Saying "too heavy" would read as "buy a bigger truck" when the answer is "deliver
    // what you are holding".
    out.push({ kind: 'resolvable', code: 'OVER_REMAINING_CAPACITY', message: `Your vehicle could carry this, but ${fmt(ctx.remainingKg)} kg of its capacity is free right now` });
  }
  if (load.bulk && !vehicle.carriesBulk) out.push({ kind: CAPABILITY_BLOCK.carriesBulk.kind, code: 'NO_BULK_BODY', message: CAPABILITY_BLOCK.carriesBulk.message });
  if (load.fragile && !vehicle.allowsFragile) out.push({ kind: CAPABILITY_BLOCK.allowsFragile.kind, code: 'NO_FRAGILE', message: CAPABILITY_BLOCK.allowsFragile.message });
  for (const cap of load.requiredCapabilities ?? []) {
    if (!vehicle[cap]) {
      const spec = CAPABILITY_BLOCK[cap];
      out.push({ kind: spec.kind, code: `MISSING_CAPABILITY_${cap}`, message: spec.message });
    }
  }
  // THE investment signal, and the reason the board shows loads at all. requiredEquipment is ANY-OF, so name
  // every piece that would unlock the load and let the operator pick the cheapest.
  const need = load.requiredEquipment ?? [];
  if (need.length > 0 && !need.some((eq) => (vehicle.equipment ?? []).includes(eq))) {
    const names = need.map((eq) => EQUIPMENT_NAME[eq] ?? eq);
    out.push({ kind: 'resolvable', code: 'MISSING_EQUIPMENT', message: `Needs ${names.join(' or ')} to load and unload — you carry none of them` });
  }
  // A PREFERENCE, and typed as one. The shipper can be argued with; an axle limit cannot, and a board that
  // shows both the same way teaches an operator to ignore both.
  if (vehicle.truckSubtype && load.excludedBodies?.includes(vehicle.truckSubtype)) {
    out.push({ kind: 'preference', code: 'BODY_EXCLUDED', message: 'The shipper has ruled out your body type for this load' });
  }
  if (load.maxSpend != null && ctx.indicativeCharge != null && ctx.indicativeCharge > load.maxSpend) {
    out.push({ kind: 'preference', code: 'OVER_BUDGET', message: `Your price comes to more than the shipper's budget of ${fmt(load.maxSpend)} — they may still raise it` });
  }
  // What the road itself says, from the drivers who reported it.
  //
  // The map answers with real constraints where it has them and with NOT CHECKED where it does not, so
  // this replaces the blanket disclaimer rather than adding to it. The disclaimer stays for callers that
  // pass nothing — absence of a report is not clearance, and a board silent about an unchecked bridge is
  // a board implying there is not one.
  if (ctx.routeBlockers?.length) {
    out.push(...ctx.routeBlockers);
  } else if (load.derivedBody && ROUTE_SENSITIVE.includes(load.derivedBody)) {
    out.push({ kind: 'unknown', code: 'ROUTE_NOT_CHECKED', message: 'Bridge heights and axle limits on this route are not known to us — check the road yourself' });
  }
  return out;
}

/** Can the driver actually take it? Only 'unknown' and nothing else still counts as takeable — an unchecked
 *  route is a warning to carry, not a refusal we are entitled to make on the operator's behalf. */
export function takeable(blockers: BoardBlocker[]): boolean {
  return blockers.every((b) => b.kind === 'unknown');
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '0';
}
