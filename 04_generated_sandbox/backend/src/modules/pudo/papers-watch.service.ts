import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { MailService } from '../../foundation/mail/mail.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { NotificationService } from './notification.service';
import { driverPapers, offRoadLine, paperDay, paperLabel, PaperStatus, vehiclePapers } from './papers';
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

  constructor(
    private readonly managers: FleetManagerService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly fleet: FleetService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly mail?: MailService,
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

  /** Returns what the pass did. */
  async sweep(now: number = Date.now()): Promise<{ shiftsEnded: number; notified: number; mails: number }> {
    const out = { shiftsEnded: 0, notified: 0, mails: 0 };
    // Every driver, fleet or independent: a lapsed licence ends the shift and tells them; a due one tells them.
    for (const d of this.drivers.list()) {
      if (d.status !== 'ACTIVE') continue;
      for (const p of driverPapers(d, now)) {
        if (p.state !== 'due' && p.state !== 'lapsed') continue;
        if (p.state === 'lapsed' && this.fleet.activeForDriver(d.did)) {
          this.endShift(d.did, `Your shift was ended: ${offRoadLine(p)}. Renew it and the fleet office records the new date; until then no shift can start.`);
          out.shiftsEnded++;
        }
        if (await this.tellOnce(`driver:${d.did}:${p.kind}:${p.expiresAt}:${p.state}`, d.did, p.state === 'lapsed' ? `Your licence has lapsed` : `Your licence runs out in ${p.daysLeft} day(s)`, p.state === 'lapsed' ? `${offRoadLine(p)}. No shift can start until the fleet office records the renewed licence.` : `${paperLabel(p.kind)} to ${paperDay(p.expiresAt ?? '')}. Renew it in time and tell the fleet office the new date, or shifts stop that day.`, p.state === 'lapsed' ? 'papers_lapsed' : 'papers_due', now)) out.notified++;
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
