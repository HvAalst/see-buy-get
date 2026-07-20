import { BadRequestException, Injectable } from '@nestjs/common';
import { DigitalTwinService } from './digital-twin.service';
import { DisruptionService } from './disruption.service';
import { EtaService } from './eta.service';
import { OrchestrationService } from './orchestration.service';
import { ScenarioInput, ScenarioReport, SimulatedShipment } from './simulation.types';
import { Disruption, ImpactedShipment } from './twin.types';

/**
 * SimulationService (M7-040). The control tower's rehearsal tool: replay one or more hypothetical
 * disruptions against the CURRENT digital twin and project the blast radius, the ETA hit, the best
 * prescriptive response, and what each shipper policy would do — all read-only. Nothing is stored,
 * no disruption is detected, no action is executed; the live state is untouched.
 */
@Injectable()
export class SimulationService {
  constructor(
    private readonly twin: DigitalTwinService,
    private readonly disruption: DisruptionService,
    private readonly eta: EtaService,
    private readonly orchestration: OrchestrationService,
  ) {}

  run(input: ScenarioInput): ScenarioReport {
    if (!input.disruptions?.length) throw new BadRequestException('A scenario needs at least one disruption.');

    // Normalise + classify each hypothetical disruption WITHOUT storing or emitting.
    const drafts = input.disruptions.map((d) => this.disruption.draft(d));

    // Union the blast radius across all scenario disruptions, keeping the worst hit per shipment.
    const worst = new Map<string, { imp: ImpactedShipment; draft: Disruption }>();
    for (const draft of drafts) {
      for (const imp of this.disruption.assess(draft)) {
        const prev = worst.get(imp.glosShipmentId);
        if (!prev || imp.criticality > prev.imp.criticality) worst.set(imp.glosShipmentId, { imp, draft });
      }
    }

    const totals = { impacted: 0, addedHours: 0, autonomousActions: 0, approvalsRequired: 0, frozen: 0, autonomousCost: 0, recommendedCost: 0, unprotected: 0 };
    const impacted: SimulatedShipment[] = [];

    for (const { imp } of worst.values()) {
      const id = imp.glosShipmentId;
      const baselineHours = this.eta.projectHours(id, false);
      const projectedHours = this.eta.projectHours(id, true);
      const deltaHours = Math.round((projectedHours - baselineHours) * 10) / 10;

      const options = this.orchestration.recommendForDelay(id, deltaHours);
      const recommended = options[0] ?? null;
      const disp = this.orchestration.simulateDisposition(id, options, projectedHours);

      totals.impacted += 1;
      totals.addedHours += deltaHours;
      if (recommended) totals.recommendedCost += recommended.deltaCost;
      if (disp.fires && disp.option) {
        totals.autonomousCost += disp.option.deltaCost;
        if (disp.disposition === 'auto') totals.autonomousActions += 1;
        else if (disp.disposition === 'approval') totals.approvalsRequired += 1;
        else if (disp.disposition === 'frozen') totals.frozen += 1;
      } else {
        totals.unprotected += 1;
      }

      impacted.push({
        glosShipmentId: id,
        state: imp.state,
        criticality: imp.criticality,
        baselineHours,
        projectedHours,
        deltaHours,
        recommended,
        policyWouldFire: disp.fires,
        policyAction: disp.action,
        disposition: disp.disposition,
      });
    }

    totals.addedHours = Math.round(totals.addedHours * 10) / 10;
    impacted.sort((a, b) => b.criticality - a.criticality);

    return { label: input.label ?? 'Scenario', disruptions: input.disruptions, impacted, totals, at: new Date().toISOString() };
  }
}
