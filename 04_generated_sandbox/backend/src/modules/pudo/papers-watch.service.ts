import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { MailService } from '../../foundation/mail/mail.service';
import { TransitAuthorityService, type TransitAuthorityRow, type CarrierOption } from './transit-authority.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { NotificationService } from './notification.service';
import { driverPapers, lapsedOf, offRoadLine, paperDay, paperLabel, PaperStatus, vehiclePapers } from './papers';
import { VehicleService } from './vehicle.service';

const SWEEP_MS = 6 * 60 * 60 * 1000;

/** One paper on one thing, as the fleet's dashboard lists it. */
export interface PaperRow {
  subject: 'vehicle' | 'driver';
  id: string;
  /** The plate, or the driver's display name. */
  label: string;
  kind: PaperStatus['kind'];
  state: 'due' | 'lapsed';
  expiresAt?: string;
  daysLeft?: number;
  /** Whether the thing is on a shift right now — a lapsed paper here means a shift the sweep will end. */
  onShift: boolean;
}

export interface PapersReport {
  lapsed: PaperRow[];
  due: PaperRow[];
  /** Papers with a date that is neither due nor lapsed — so "nothing listed" can be told from "nothing recorded". */
  inDate: number;
  /** Papers with no date recorded at all. */
  unrecorded: number;
}

/** A courier who rides without a fleet — nobody's office records their renewal, so the network's staff do. */
export interface CourierPaperRow {
  did: string;
  displayName: string;
  badgeId?: string;
  status: string;
  registry: string;
  jurisdiction?: string;
  /** What they are cleared to ride or drive — whether a licence is even the question starts here. */
  classes: string[];
  /** Their badge portrait, when they have one: the face on the row, and something to check a card against. */
  portraitRef?: string;
  /**
   * The licence on record, and — the half that makes the date checkable — the photograph it was READ from
   * and who read it. No copyRef means the date was typed on somebody's word.
   */
  licence: { number?: string; expiresAt?: string; copyRef?: string; recordedBy?: string; recordedAt?: string };
  /** A renewed licence they sent and nobody has checked yet. This is the work: the card is here to read. */
  renewal?: { copyRef: string; expiresAt: string; number?: string; sentAt: string };
  /** Why the last card they sent was not accepted — so the next member of staff knows what was asked. */
  renewalRefusal?: { reason: string; at: string; by?: string };
  /**
   * The licence and ID the driver actually submitted, so a new expiry date is typed while LOOKING at the
   * document it came from.
   *
   * Without these the screen asked an operator to put a driver back on the road on the strength of a date
   * they had no way to check — which makes the control a formality rather than a check, and the one thing
   * it is guarding is whether somebody may legally drive. The refs ride on the row; whether there are
   * bytes behind them is the media route's answer, and the screen says plainly when there are none.
   */
  documents?: { licenceCopyRef?: string; idCopyRef?: string; submittedAt?: string };
  papers: PaperStatus[];
  offRoad: string[];
  onShift: boolean;
  /** The plates they have driven, newest first — where their vehicle's papers will be found. */
  drives: string[];
}

/** A vehicle no fleet owns — registered by a courier, so only an operator can touch its papers. */
export interface LooseVehicleRow {
  vehicleId: string;
  plate: string;
  vehicleClass: string;
  status: string;
  documents: { insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string };
  papers: PaperStatus[];
  offRoad: string[];
  /** Who is on a shift with it right now, by display name. */
  onShiftWith?: string;
}

export interface SweepRun {
  at: string;
  shiftsEnded: number;
  notified: number;
  mails: number;
}

/**
 * The network's view: what only an operator can put right, plus what the fleets are handling themselves.
 * Sorted worst first — a lapsed paper before a due one before an undated one — because the list is a
 * queue of people who cannot work until somebody here types a date.
 */
export interface PapersNetworkReport {
  couriers: CourierPaperRow[];
  vehicles: LooseVehicleRow[];
  fleets: { count: number; withLapsed: number; lapsed: number; due: number };
  sweep: SweepRun | null;
  sweepEveryHours: number;
  /**
   * BL1 — permission to move goods that have not been cleared.
   *
   * It lives in THIS report rather than one of its own because it is exactly what this screen is for:
   * a paper only network staff can put right. A fleet records its own renewals in the fleet app; nobody
   * records a customs transit licence but us, and a lapsed one silently stops a carrier being offered
   * bonded work — which is the quietest way for a container to sit on a quay.
   */
  transit: TransitAuthorityRow[];
  /** Who one can be recorded against, by NAME. Fleets, and drivers who are their own carrier. */
  carriers: CarrierOption[];
}

const RANK: Record<PaperStatus['state'], number> = { lapsed: 0, due: 1, none: 2, ok: 3 };
const worst = (papers: PaperStatus[]): number => Math.min(...papers.map((p) => RANK[p.state]), RANK.ok);

/**
 * FP4 — the six-hourly look at every fleet's papers.
 *
 * The date switches the thing off by itself (papers.ts); what needs a sweep is everything the switch does not
 * do on its own: a vehicle already ON a shift when its insurance lapses at midnight is still driving, and
 * nobody has been told. So, each pass: end the shift of anything whose paper has lapsed and tell the driver why;
 * tell the driver whose licence is running out; and mail the fleet's contact address what is due and what is
 * off — once per paper per expiry date, so a renewed paper starts a new clock and an ignored mail is never
 * repeated. The dashboard reads the same report live, so the app and the mail cannot disagree.
 */
@Injectable()
export class PapersWatchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PapersWatchService.name);
  private readonly told = new PersistentMap<string, string>('papers-reminders');
  private timer?: ReturnType<typeof setInterval>;
  /** The last pass, so a screen can say when the network last looked rather than implying it always is. */
  lastRun: SweepRun | null = null;

  constructor(
    private readonly managers: FleetManagerService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly fleet: FleetService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly mail?: MailService,
    // BL1 — optional for the same reason as the two above: the specs that build this by hand keep
    // working, and app.boot.spec is what catches it missing from the module.
    @Optional() private readonly transit?: TransitAuthorityService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep().catch(() => undefined);
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** What is due and what is off, for one fleet, as of now. */
  reportFor(managerDid: string, now: number = Date.now()): PapersReport {
    const report: PapersReport = { lapsed: [], due: [], inDate: 0, unrecorded: 0 };
    const take = (subject: PaperRow['subject'], id: string, label: string, papers: PaperStatus[], onShift: boolean) => {
      for (const p of papers) {
        if (p.state === 'ok') report.inDate++;
        else if (p.state === 'none') report.unrecorded++;
        else (p.state === 'lapsed' ? report.lapsed : report.due).push({ subject, id, label, kind: p.kind, state: p.state, expiresAt: p.expiresAt, daysLeft: p.daysLeft, onShift });
      }
    };
    for (const v of this.vehicles.list({ managerDid })) {
      if (v.status !== 'ACTIVE') continue;
      take('vehicle', v.vehicleId, v.plate, vehiclePapers(v, now), Boolean(this.fleet.activeForVehicle(v.vehicleId)));
    }
    for (const d of this.drivers.list({ managerDid })) {
      if (d.status !== 'ACTIVE') continue;
      take('driver', d.did, d.displayName, driverPapers(d, now), Boolean(this.fleet.activeForDriver(d.did)));
    }
    const soonest = (a: PaperRow, b: PaperRow) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
    report.lapsed.sort(soonest);
    report.due.sort(soonest);
    return report;
  }

  /**
   * What only the network's staff can act on, as of now: couriers without a fleet, vehicles without an
   * owner, and how the fleets are doing with their own. The same date rules as everything else.
   */
  networkReport(now: number = Date.now()): PapersNetworkReport {
    const nameOf = (did: string) => this.drivers.list().find((d) => d.did === did)?.displayName ?? did;
    const couriers: CourierPaperRow[] = this.drivers
      .list()
      .filter((d) => !d.managerDid && d.status !== 'SUSPENDED')
      .map((d) => {
        const papers = driverPapers(d, now);
        return {
          did: d.did,
          displayName: d.displayName,
          badgeId: d.badgeId,
          status: d.status,
          registry: d.registry,
          jurisdiction: d.jurisdiction,
          classes: d.licence?.classes ?? [],
          ...(d.portrait?.photoRef ? { portraitRef: d.portrait.photoRef } : {}),
          licence: {
            number: d.licence?.number && d.licence.number !== 'n/a' ? d.licence.number : undefined,
            expiresAt: d.licence?.expiresAt,
            ...(d.licence?.copyRef ? { copyRef: d.licence.copyRef } : {}),
            ...(d.licence?.recordedBy ? { recordedBy: d.licence.recordedBy } : {}),
            ...(d.licence?.recordedAt ? { recordedAt: d.licence.recordedAt } : {}),
          },
          ...(d.licenceRenewal ? { renewal: { ...d.licenceRenewal } } : {}),
          ...(d.licenceRenewalRefusal ? { renewalRefusal: { ...d.licenceRenewalRefusal } } : {}),
          ...(d.kyc ? { documents: { licenceCopyRef: d.kyc.licenceCopyRef, idCopyRef: d.kyc.idCopyRef, submittedAt: d.kyc.submittedAt } } : {}),
          papers,
          offRoad: lapsedOf(papers).map(offRoadLine),
          onShift: Boolean(this.fleet.activeForDriver(d.did)),
          drives: this.fleet.recentVehicles(d.did).map((v) => v.plate),
        };
      })
      // A card waiting to be read comes first: that courier has done their part and is waiting on us.
      // Then worst first, as before — lapsed, running out, undated, in date.
      .sort((a, b) => Number(Boolean(b.renewal)) - Number(Boolean(a.renewal)) || worst(a.papers) - worst(b.papers) || a.displayName.localeCompare(b.displayName));
    const vehicles: LooseVehicleRow[] = this.vehicles
      .list()
      .filter((v) => !v.managerDid && v.status !== 'RETIRED')
      .map((v) => {
        const papers = vehiclePapers(v, now);
        const active = this.fleet.activeForVehicle(v.vehicleId);
        const d = v.documents ?? {};
        return {
          vehicleId: v.vehicleId,
          plate: v.plate,
          vehicleClass: v.vehicleClass,
          status: v.status,
          documents: { insuranceRef: d.insuranceRef, insuranceExpiresAt: d.insuranceExpiresAt, inspectionRef: d.inspectionRef, inspectionExpiresAt: d.inspectionExpiresAt },
          papers,
          offRoad: lapsedOf(papers).map(offRoadLine),
          ...(active ? { onShiftWith: nameOf(active.driverDid) } : {}),
        };
      })
      .sort((a, b) => worst(a.papers) - worst(b.papers) || a.plate.localeCompare(b.plate));
    const fleets = { count: 0, withLapsed: 0, lapsed: 0, due: 0 };
    for (const m of this.managers.list()) {
      if (m.status !== 'ACTIVE') continue;
      const r = this.reportFor(m.did, now);
      fleets.count++;
      if (r.lapsed.length) fleets.withLapsed++;
      fleets.lapsed += r.lapsed.length;
      fleets.due += r.due.length;
    }
    /*
     * BL1 — the carriers, by name, and what each is licensed to move.
     *
     * A carrier is whoever CONTRACTS to carry: an active fleet, or a driver with no manager, who is their
     * own. The same line the handle rule draws, and the only list on which a transit authority can be
     * recorded without somebody typing a DID.
     */
    const carriers: CarrierOption[] = [
      ...this.managers
        .list()
        .filter((m) => m.status === 'ACTIVE')
        .map((m) => ({ did: m.did, name: m.tradingName || m.companyName, kind: 'fleet' as const })),
      ...this.drivers
        .list()
        .filter((d) => !d.managerDid && d.status === 'ACTIVE')
        .map((d) => ({ did: d.did, name: d.displayName, kind: 'owner_driver' as const })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    const byDid = new Map(carriers.map((c) => [c.did, c.name]));
    const transit = this.transit?.register((did) => byDid.get(did), now) ?? [];

    return { couriers, vehicles, fleets, transit, carriers, sweep: this.lastRun, sweepEveryHours: SWEEP_MS / 3_600_000 };
  }

  /** Returns what the pass did. */
  async sweep(now: number = Date.now()): Promise<{ shiftsEnded: number; notified: number; mails: number }> {
    const out = { shiftsEnded: 0, notified: 0, mails: 0 };
    // Every driver, fleet or independent: a lapsed licence ends the shift and tells them; a due one tells them.
    for (const d of this.drivers.list()) {
      if (d.status !== 'ACTIVE') continue;
      /*
       * WHO RECORDS IT, said to the person who has to act. A courier without a fleet was told to go to "the
       * fleet office" — an office they do not have — which is the same dead end the console had from the
       * other side. They send a photograph from the app instead, and the network's staff read it.
       */
      const own = !d.managerDid;
      const next = own ? 'send a photo of the renewed licence from the app, and the network records the new date' : 'the fleet office records the new date';
      for (const p of driverPapers(d, now)) {
        if (p.state !== 'due' && p.state !== 'lapsed') continue;
        if (p.state === 'lapsed' && this.fleet.activeForDriver(d.did)) {
          this.endShift(d.did, `Your shift was ended: ${offRoadLine(p)}. Renew it — ${next}; until then no shift can start.`);
          out.shiftsEnded++;
        }
        const body =
          p.state === 'lapsed'
            ? `${offRoadLine(p)}. No shift can start until the renewal is recorded: ${next}.`
            : `${paperLabel(p.kind)} to ${paperDay(p.expiresAt ?? '')}. Renew it in time — ${next} — or shifts stop that day.`;
        if (await this.tellOnce(`driver:${d.did}:${p.kind}:${p.expiresAt}:${p.state}`, d.did, p.state === 'lapsed' ? `Your licence has lapsed` : `Your licence runs out in ${p.daysLeft} day(s)`, body, p.state === 'lapsed' ? 'papers_lapsed' : 'papers_due', now)) out.notified++;
      }
    }
    // Every fleet: a lapsed vehicle paper ends the shift on it and tells the driver; the fleet is mailed the report once per change.
    for (const m of this.managers.list()) {
      if (m.status !== 'ACTIVE') continue;
      const report = this.reportFor(m.did, now);
      for (const row of report.lapsed) {
        if (row.subject !== 'vehicle' || !row.onShift) continue;
        const active = this.fleet.activeForVehicle(row.id);
        if (!active) continue;
        this.endShift(active.driverDid, `Your shift on ${row.label} was ended: ${paperLabel(row.kind)} lapsed ${row.expiresAt ? paperDay(row.expiresAt) : ''}. The fleet office has been told.`.replace(/\s+\./g, '.'));
        out.shiftsEnded++;
      }
      const fresh = [...report.lapsed, ...report.due].filter((r) => !this.told.has(this.mailKey(m.did, r)));
      if (fresh.length && this.mail && m.contactEmail) {
        const line = (r: PaperRow) => `${r.subject === 'vehicle' ? 'Vehicle' : 'Driver'} ${r.label} — ${paperLabel(r.kind)}${r.expiresAt ? ` ${r.state === 'lapsed' ? 'lapsed' : 'runs out'} ${paperDay(r.expiresAt)}` : ''}${r.state === 'due' && r.daysLeft != null ? ` (${r.daysLeft} day(s))` : ''}`;
        const sent = await this.mail.send('papers-due', { address: m.contactEmail, name: m.companyName }, { company: m.companyName, lapsed: report.lapsed.map(line), due: report.due.map(line) });
        if (sent) {
          for (const r of fresh) this.told.set(this.mailKey(m.did, r), new Date(now).toISOString());
          out.mails++;
        }
      }
    }
    this.lastRun = { at: new Date(now).toISOString(), ...out };
    return out;
  }

  private mailKey(managerDid: string, r: PaperRow): string {
    return `fleet:${managerDid}:${r.subject}:${r.id}:${r.kind}:${r.expiresAt}:${r.state}`;
  }

  private endShift(driverDid: string, body: string): void {
    try {
      this.fleet.endSession(driverDid);
    } catch (err) {
      this.logger.warn(`could not end the shift of ${driverDid}: ${(err as Error).message}`);
      return;
    }
    void this.notifications?.notify(driverDid, { kind: 'papers_lapsed', title: 'Your shift was ended', body, link: '/', tag: `papers:${driverDid}:shift`, data: {} }).catch(() => undefined);
  }

  private async tellOnce(key: string, did: string, title: string, body: string, kind: 'papers_lapsed' | 'papers_due', now: number): Promise<boolean> {
    if (!this.notifications || this.told.has(key)) return false;
    try {
      await this.notifications.notify(did, { kind, title, body, link: '/', tag: `papers:${did}:${kind}`, data: {} });
      this.told.set(key, new Date(now).toISOString());
      return true;
    } catch (err) {
      this.logger.warn(`papers notify failed for ${did}: ${(err as Error).message}`);
      return false;
    }
  }
}
