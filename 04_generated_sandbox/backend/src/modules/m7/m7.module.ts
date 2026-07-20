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
 * The apex module: a live digital twin (fed by M2/M3/M4 events), predictive ETA, proactive
 * disruption detection + blast-radius, prescriptive recommendations, and autonomous policy execution
 * behind a human-in-the-loop gate — re-matching through M3. EventBus + LedgerService are global;
 * imports M3Module for MatchingService (rebooking).
 */
@Module({
  imports: [M3Module, M2Module],
  controllers: [M7Controller],
  providers: [DigitalTwinService, EtaService, DisruptionService, OrchestrationService, SignalIngestService, AutoResponseService, ExceptionResponseService, SimulationService, CarbonService, NetworkDesignService],
  exports: [DigitalTwinService, EtaService, DisruptionService, OrchestrationService, SignalIngestService, SimulationService, CarbonService, NetworkDesignService],
})
export class M7Module {}
