import { Injectable, OnModuleInit } from '@nestjs/common';
import { StaffCountryRegistry, countriesPaying } from '../../foundation/auth/staff-country.registry';
import { EntityService } from '../../foundation/entity/entity.service';
import { OperatorAccountService } from '../../foundation/entity/operator-account.service';
import { FundingService } from '../../foundation/funding/funding.service';
import { InterestService } from '../../foundation/interest/interest.service';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { AccountMoveService } from './account-move.service';
import { AgentService } from './agent.service';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { ExportService } from './export.service';
import { FleetManagerService } from './fleet-manager.service';
import { IdDisputeService } from './id-dispute.service';
import { ImportService } from './import.service';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import { VehicleService } from './vehicle.service';
import { VendorService } from './vendor.service';
import { ToteService } from './tote.service';
import { FlagCaseService } from './flag-case.service';
import { NoteArchiveService } from './note-archive.service';
import { CompanyPaperReportService } from '../../foundation/entity/company-paper-reports.service';

/**
 * 2026-11-01 — WHICH COUNTRIES EACH KIND OF RECORD TOUCHES, answered by the service that keeps it, for staff separated by
 * country (staff-country.interceptor.ts). A getter that throws for a missing record reads as "no such record". Where a
 * record's country is not known, it answers none — and then only somebody who works in every country reaches it.
 */
@Injectable()
export class StaffCountryResolvers implements OnModuleInit {
  constructor(
    private readonly registry: StaffCountryRegistry,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly vendors: VendorService,
    private readonly managers: FleetManagerService,
    private readonly drivers: DriverService,
    private readonly entities: EntityService,
    private readonly parcels: ParcelService,
    private readonly dispatch: DispatchService,
    private readonly imports: ImportService,
    private readonly exports: ExportService,
    private readonly vehicles: VehicleService,
    private readonly payouts: PayoutService,
    private readonly funding: FundingService,
    private readonly staff: OperatorAccountService,
    private readonly interest: InterestService,
    private readonly presence: PresenceService,
    private readonly idDisputes: IdDisputeService,
    private readonly moves: AccountMoveService,
    private readonly totes: ToteService,
    private readonly flagCases: FlagCaseService,
    private readonly paperReports: CompanyPaperReportService,
    private readonly notes: NoteArchiveService,
  ) {}

  onModuleInit(): void {
    const r = this.registry;
    r.register('agent', (did) => {
      const agent = this.agents.find(did);
      return agent ? some(agent.country) : null;
    });
    r.register('mdp', (id) => some(this.mdps.require(id).country));
    r.register('vendor', (id) => some(this.vendors.get(id).country));
    r.register('fleet', (did) => this.fleetCountries(did));
    r.register('driver', (did) => this.driverCountries(did));
    r.register('entity', (id) => some(this.entities.get(id).jurisdiction));
    r.register('parcel', (id) => {
      const p = this.parcels.get(id);
      return [...this.placeCountries(p.originAgentDid), ...this.placeCountries(p.destAgentDid), ...this.placeCountries(p.committedNodeDid), ...this.vendorCountries(p.vendorId)];
    });
    r.register('freight', (id) => {
      const f = this.dispatch.requireFreightPublic(id);
      return [...some(f.pickupCountry), ...some(f.destCountry), ...some(f.bondCountry), ...this.entityCountries(f.driverPayee?.entityId)];
    });
    r.register('import', (id) => this.imports.countriesOf(id));
    r.register('export', (id) => this.exports.countriesOf(id));
    r.register('vehicle', (id) => {
      const v = this.vehicles.get(id);
      return [...(v.managerDid ? (this.fleetCountries(v.managerDid) ?? []) : []), ...(v.ownerDriverDid ? (this.driverCountries(v.ownerDriverDid) ?? []) : [])];
    });
    r.register('payout', (id) => this.entityCountries(this.payouts.get(id).entityId));
    r.register('funding', (id) => this.entityCountries(this.funding.get(id).entityId));
    const unnamed = (id: string) => {
      const currency = this.funding.unnamedCurrency(id);
      return currency === null ? null : countriesPaying(currency);
    };
    r.register('unmatched-payment', unnamed);
    r.register('held-payment', unnamed);
    r.register('operator', (id) => this.staff.accountCountries(id));
    r.register('staff-proposal', (id) => this.staff.proposalCountries(id));
    r.register('interest', (id) => this.interest.countriesOf(id));
    r.register('presence-proposal', (id) => this.presence.proposalCountries(id));
    r.register('id-dispute', (id) => this.idDisputes.countriesOf(id));
    r.register('account-move', (id) => this.moves.countriesOf(id));
    // 2026-11-03 — the console's daily screens, split by country (the owner: "Daily screens now"): bags, flags and their
    // cases, paper reports, consignment notes. A record whose country cannot be told answers no country ([]), which only a
    // colleague who works in every country reaches; null is kept for a record that does not exist.
    r.register('tote', (code) => this.toteCountries(code));
    r.register('flag-subject', (subject) => this.flagSubjectCountries(subject));
    r.register('flag-case', (caseId) => this.flagSubjectCountries(this.flagCases.get(caseId).subject) ?? []);
    r.register('paper-report', (caseId) => this.entityCountries(this.paperReports.entityOf(caseId)));
    r.register('consignment-note', (docId) => {
      const note = this.notes.noteOf(docId);
      if (!note) return null;
      if (!note.freightId) return []; // a departure's note: every country's staff only, for now
      const f = this.dispatch.requireFreightPublic(note.freightId);
      return [...some(f.pickupCountry), ...some(f.destCountry), ...some(f.bondCountry)];
    });
  }

  /** A bag's countries: where it stands (a hub or a shop), and where it is bound. */
  private toteCountries(code: string): string[] | null {
    const t = this.totes.byCodeMaybe(code);
    if (!t) return null;
    return [...this.placeCountries(t.locationId), ...this.placeCountries(t.destinationNodeId), ...this.placeCountries(t.toHubId)];
  }

  /**
   * What a flag is about, named as the monitor names it: a parcel by its id, a load or a bag by its code, a shop by its name.
   * Null when nothing of that name is on record (a corridor, or one gone).
   */
  private flagSubjectCountries(subject: string): string[] | null {
    try {
      const p = this.parcels.get(subject);
      return [...this.placeCountries(p.originAgentDid), ...this.placeCountries(p.destAgentDid), ...this.vendorCountries(p.vendorId)];
    } catch {
      // not a parcel
    }
    const f = this.dispatch.freightByCode(subject);
    if (f) return [...some(f.pickupCountry), ...some(f.destCountry), ...some(f.bondCountry)];
    const bag = this.toteCountries(subject);
    if (bag) return bag;
    const shop = this.agents.list().find((a) => a.shopName === subject);
    return shop ? some(shop.country) : null;
  }

  /** A fleet's country: its own, or its company's. */
  private fleetCountries(did: string): string[] {
    const fleet = this.managers.get(did);
    return fleet.jurisdiction ? [fleet.jurisdiction] : this.entityCountries(fleet.entityId);
  }

  /** A driver's: their fleet's, and their own (a courier's, or one whose fleet is gone). */
  private driverCountries(did: string): string[] {
    const driver = this.drivers.get(did) as { managerDid?: string; jurisdiction?: string };
    let fleet: string[] = [];
    if (driver.managerDid) {
      try {
        fleet = this.fleetCountries(driver.managerDid);
      } catch {
        // A fleet no longer on record: the driver's own country.
      }
    }
    return [...fleet, ...some(driver.jurisdiction)];
  }

  /** A shop's or a hub's country, by its DID — nothing when it is neither, or unknown. */
  private placeCountries(did: string | undefined): string[] {
    if (!did) return [];
    const agent = this.agents.find(did);
    if (agent) return some(agent.country);
    try {
      const hub = this.mdps.list().find((m) => m.did === did || m.mdpId === did);
      return hub ? some(hub.country) : [];
    } catch {
      return [];
    }
  }

  private vendorCountries(vendorId: string | undefined): string[] {
    if (!vendorId) return [];
    try {
      return some(this.vendors.get(vendorId).country);
    } catch {
      return [];
    }
  }

  private entityCountries(entityId: string | undefined): string[] {
    if (!entityId) return [];
    try {
      return some(this.entities.get(entityId).jurisdiction);
    } catch {
      return [];
    }
  }
}

/** One country, or none. */
function some(country: string | undefined | null): string[] {
  return country ? [country] : [];
}
