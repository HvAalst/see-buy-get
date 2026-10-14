import { Module } from '@nestjs/common';
import { M2Module } from '../m2/m2.module';
import { M3Module } from '../m3/m3.module';
import { M7Controller } from './m7.controller';
import { DigitalTwinService } from './digital-twin.service';
import { EtaService } from './eta.service';
import { DisruptionService } from './disruption.service';
import { OrchestrationService } from './orchestration.service';
import { SignalIngestService } from './signal-ingest.service';
import { AutoResponseService } from './auto-response.service';
import { ExceptionResponseService } from './exception-response.service';
import { SimulationService } from './simulation.service';
import { CarbonService } from './carbon.service';
import { NetworkDesignService } from './network-design.service';

/**
 * M7 — AI Orchestration & Control Tower (AIOCT). Epic: 02_epic_domains/epic_m7_ai_orchestration.md.
 *
 * READ THIS BEFORE BUILDING ON IT — the module is two halves, and only one is true here.
 *
 * LIVE: the DIGITAL TWIN. `graduation.service.ts` (PUDO) pushes every real parcel into it — created,
 * picked up, sorted at a hub, disputed → exception — and `digital-twin.service.ts` subscribes to the
 * shipment, match and tracking events besides. It is a current map of where everything is. Nothing
 * READS it yet: the operator console answers "where is every parcel" from the parcel store directly,
 * so the twin is a second copy of the truth, maintained and unread. The honest use for it is the
 * console's overview eventually reading it instead of computing its own answer.
 *
 * PARKED: everything else — signals, disruptions, blast radius, recommendations, simulate, carbon,
 * network design, and the approve/execute/rollback action log. It works and it is tested, and it was
 * written (June 2026, from the epic) for a GLOBAL FREIGHT FORWARDER: its only signal source is a stub
 * feed of Suez-canal and Singapore-port advisories, and the actions it can execute — reroute,
 * consolidate a hub, expand a hub, spend automatically — have no counterpart in the custody and money
 * model this network actually runs on. Its one UI, the hand-rolled `control-tower.html`, was deleted
 * rather than migrated, because dressing another company's product in this one's clothes is worse than
 * admitting there is nothing here for the current cast of shopkeepers, riders and operators.
 *
 * So: nothing in the parked half is a feature, and none of it should be cited as one. Reviving it means
 * a real signal source for THIS region and a persona who acts on it — not a screen.
 *
 * EventBus + LedgerService are global; imports M3Module for MatchingService (rebooking).
 */
@Module({
  imports: [M3Module, M2Module],
  controllers: [M7Controller],
  providers: [DigitalTwinService, EtaService, DisruptionService, OrchestrationService, SignalIngestService, AutoResponseService, ExceptionResponseService, SimulationService, CarbonService, NetworkDesignService],
  exports: [DigitalTwinService, EtaService, DisruptionService, OrchestrationService, SignalIngestService, SimulationService, CarbonService, NetworkDesignService],
})
export class M7Module {}
