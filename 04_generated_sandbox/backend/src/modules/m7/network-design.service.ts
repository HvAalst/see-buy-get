import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ShipmentService } from '../m2/shipment.service';
import { Shipment } from '../m2/shipment.types';
import { CarbonService } from './carbon.service';
import { DigitalTwinService } from './digital-twin.service';
import { DesignRecommendation, HubLoad, LaneStat, NetworkDesignReport } from './network-design.types';

const HUB_BUSY = 2; // ≥ this many shipments through a hub → capacity worth reviewing
const LANE_REPEAT = 2; // ≥ this many shipments on a corridor → a direct service is worth it
const MODE_SHIFT_KG = 100; // ≥ this much CO2e saveable on a lane → recommend a modal shift
const HIGH_CARBON_MODES = new Set(['air', 'road']);

const round = (n: number) => Math.round(n * 10) / 10;
const rid = () => `nd_${randomBytes(5).toString('hex')}`;

/**
 * NetworkDesignService (M7-041). Phase-4 strategic lens: rolls up accumulated flow across the live
 * network — lane volumes, hub throughput, mode mix — and recommends structural changes (expand a
 * congested hub, open a direct lane on a repeated corridor, shift a high-carbon lane to a greener
 * mode, consolidate an under-used hub). Read-only analytics over the digital twin + M2 shipments.
 */
@Injectable()
export class NetworkDesignService {
  constructor(
    private readonly twin: DigitalTwinService,
    private readonly shipments: ShipmentService,
    private readonly carbon: CarbonService,
  ) {}

  analyze(): NetworkDesignReport {
    const ships = this.twin
      .shipments()
      .map((n) => {
        try {
          return this.shipments.require(String(n.props.glosShipmentId));
        } catch {
          return null;
        }
      })
      .filter((s): s is Shipment => !!s && s.legs.length > 0);

    const hubMap = new Map<string, HubLoad>();
    const laneMap = new Map<string, LaneStat & { shipmentIds: string[]; modeSet: Set<string> }>();

    for (const s of ships) {
      const w = s.ewaybill.packaging.totalWeightKg;

      // Lane = end-to-end corridor.
      const key = `${s.origin} → ${s.destination}`;
      const lane = laneMap.get(key) ?? { lane: key, origin: s.origin, destination: s.destination, count: 0, weightKg: 0, modes: [], modeSet: new Set<string>(), legsPerShipment: s.legs.length, shipmentIds: [] };
      lane.count += 1;
      lane.weightKg = round(lane.weightKg + w);
      lane.legsPerShipment = Math.max(lane.legsPerShipment, s.legs.length);
      lane.shipmentIds.push(s.glosShipmentId);
      s.legs.forEach((leg) => lane.modeSet.add(leg.mode));
      laneMap.set(key, lane);

      // Hubs = intermediate handover places (not the shipment's own endpoints), counted once each.
      const hubs = new Set<string>();
      for (const leg of s.legs) {
        for (const place of [leg.origin, leg.destination]) {
          if (place !== s.origin && place !== s.destination) hubs.add(place);
        }
      }
      for (const place of hubs) {
        const hub = hubMap.get(place) ?? { location: place, throughput: 0, weightKg: 0 };
        hub.throughput += 1;
        hub.weightKg = round(hub.weightKg + w);
        hubMap.set(place, hub);
      }
    }

    const hubs = [...hubMap.values()].sort((a, b) => b.throughput - a.throughput);
    const lanes: LaneStat[] = [...laneMap.values()].map((l) => ({ lane: l.lane, origin: l.origin, destination: l.destination, count: l.count, weightKg: l.weightKg, modes: [...l.modeSet], legsPerShipment: l.legsPerShipment })).sort((a, b) => b.count - a.count || b.weightKg - a.weightKg);

    return { shipments: ships.length, hubs, lanes, recommendations: this.recommend(hubs, [...laneMap.values()]), at: new Date().toISOString() };
  }

  // --- recommendations ---

  private recommend(hubs: HubLoad[], lanes: Array<LaneStat & { shipmentIds: string[]; modeSet: Set<string> }>): DesignRecommendation[] {
    const recs: DesignRecommendation[] = [];

    // Expand the busiest hub(s); flag singletons for consolidation.
    for (const hub of hubs) {
      if (hub.throughput >= HUB_BUSY) {
        recs.push({
          id: rid(), type: 'expand_hub', subject: hub.location, priority: hub.throughput >= 3 ? 'high' : 'medium',
          rationale: `${hub.throughput} shipments (${round(hub.weightKg)}kg) route through ${hub.location}; it is a network choke point.`,
          estBenefit: `Adds resilience + throughput for ${hub.throughput} flows.`,
          metrics: { throughput: hub.throughput, weightKg: round(hub.weightKg) },
        });
      } else if (hub.throughput === 1 && hubs.length > 2) {
        recs.push({
          id: rid(), type: 'consolidate_hub', subject: hub.location, priority: 'low',
          rationale: `${hub.location} handles a single flow; consolidating it into a nearby hub cuts fixed cost.`,
          estBenefit: 'Removes an under-used node.',
          metrics: { throughput: hub.throughput },
        });
      }
    }

    for (const lane of lanes) {
      // Repeated multi-leg corridor → a direct service removes handovers.
      if (lane.count >= LANE_REPEAT && lane.legsPerShipment > 1) {
        const handoversRemoved = lane.count * (lane.legsPerShipment - 1);
        recs.push({
          id: rid(), type: 'direct_lane', subject: lane.lane, priority: lane.count >= 3 ? 'high' : 'medium',
          rationale: `${lane.count} shipments repeat ${lane.lane} via ${lane.legsPerShipment} legs; a direct service would cut transfers.`,
          estBenefit: `~${handoversRemoved} handovers removed.`,
          metrics: { count: lane.count, weightKg: round(lane.weightKg), handoversRemoved },
        });
      }

      // High-carbon lane with a worthwhile greener alternative → modal shift.
      const primary = [...lane.modeSet].find((m) => HIGH_CARBON_MODES.has(m));
      if (primary) {
        const saving = round(lane.shipmentIds.reduce((s, id) => { try { return s + this.carbon.footprint(id).greener.savingKgCo2; } catch { return s; } }, 0));
        if (saving >= MODE_SHIFT_KG) {
          recs.push({
            id: rid(), type: 'mode_shift', subject: lane.lane, priority: saving >= 1000 ? 'high' : 'medium',
            rationale: `${lane.lane} leans on ${primary}; shifting to a greener mode (ocean/rail) on this corridor cuts emissions materially.`,
            estBenefit: `~${saving}kg CO₂e saveable across ${lane.count} shipment(s).`,
            metrics: { count: lane.count, savingKgCo2: saving },
          });
        }
      }
    }

    const rank = { high: 0, medium: 1, low: 2 };
    return recs.sort((a, b) => rank[a.priority] - rank[b.priority]);
  }
}
