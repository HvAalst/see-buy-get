import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { PapersWatchService } from './papers-watch.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { VehicleService } from './vehicle.service';
import type { DriverService } from './driver.service';
import type { FleetService } from './fleet.service';
import type { NotificationService } from './notification.service';

/** FP4 — the sweep: ends the shift a lapsed paper is still driving on, tells the driver, mails the fleet once per paper. */
describe('the papers watch', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  const DAY = 86_400_000;
  const day = (d: number) => new Date(now + d * DAY).toISOString().slice(0, 10);

  const harness = (over: { vehicles?: Array<Record<string, unknown>>; drivers?: Array<Record<string, unknown>>; onShift?: Record<string, string>; recent?: Record<string, string[]> } = {}) => {
    process.env.GLOS_PERSIST = 'off';
    const outbox = new OutboxMailSender();
    const inbox: Array<{ did: string; kind: string; title: string; body: string }> = [];
    const ended: string[] = [];
    const onShift = { ...(over.onShift ?? {}) }; // vehicleId → driverDid
    const managers = { list: () => [{ did: 'did:fleet:k', status: 'ACTIVE', companyName: 'Kilima Logistics', contactEmail: 'ops@kilima.example' }] } as unknown as FleetManagerService;
    // The mocks honour the owner filter the way the real lists do — a fleet's report must not count a courier's vehicle.
    const byOwner = <T extends { managerDid?: string }>(rows: T[], f?: { managerDid?: string }) => rows.filter((r) => !f?.managerDid || r.managerDid === f.managerDid);
    const vehicles = { list: (f?: { managerDid?: string }) => byOwner((over.vehicles ?? []) as Array<{ managerDid?: string }>, f) } as unknown as VehicleService;
    const recent = over.recent ?? {}; // driverDid → plates
    const drivers = { list: (f?: { managerDid?: string }) => byOwner((over.drivers ?? []) as Array<{ managerDid?: string }>, f) } as unknown as DriverService;
    const fleet = {
      activeForVehicle: (id: string) => (onShift[id] ? { driverDid: onShift[id], vehicleId: id } : undefined),
      activeForDriver: (did: string) => {
        const id = Object.keys(onShift).find((k) => onShift[k] === did);
        return id ? { driverDid: did, vehicleId: id } : undefined;
      },
      endSession: (did: string) => {
        ended.push(did);
        for (const k of Object.keys(onShift)) if (onShift[k] === did) delete onShift[k];
        return {};
      },
      recentVehicles: (did: string) => (recent[did] ?? []).map((plate) => ({ plate })),
    } as unknown as FleetService;
    const notifications = { notify: async (did: string, n: { kind: string; title: string; body: string }) => void inbox.push({ did, ...n }) } as unknown as NotificationService;
    const watch = new PapersWatchService(managers, vehicles, drivers, fleet, notifications, new MailService(outbox));
    return { watch, outbox, inbox, ended };
  };

  it('ends the shift on a vehicle whose insurance lapsed, tells the driver why, and mails the fleet what is off and what is due', async () => {
    const { watch, outbox, inbox, ended } = harness({
      vehicles: [
        { vehicleId: 'v1', plate: 'KLM 002B', status: 'ACTIVE', managerDid: 'did:fleet:k', documents: { insuranceExpiresAt: day(-11), inspectionExpiresAt: day(20) } },
        { vehicleId: 'v2', plate: 'KLM 001V', status: 'ACTIVE', managerDid: 'did:fleet:k', documents: { insuranceExpiresAt: day(200) } },
      ],
      drivers: [{ did: 'd-amos', displayName: 'Amos K.', status: 'ACTIVE', managerDid: 'did:fleet:k', licence: { number: 'L', classes: ['van'], expiresAt: day(400) } }],
      onShift: { v1: 'd-amos' },
    });
    const report = watch.reportFor('did:fleet:k', now);
    expect(report.lapsed).toEqual([expect.objectContaining({ subject: 'vehicle', label: 'KLM 002B', kind: 'insurance', onShift: true })]);
    expect(report.due).toEqual([expect.objectContaining({ subject: 'vehicle', label: 'KLM 002B', kind: 'inspection', daysLeft: 21 })]);
    expect(report).toMatchObject({ inDate: 2, unrecorded: 1 });
    expect(await watch.sweep(now)).toEqual({ shiftsEnded: 1, notified: 0, mails: 1 });
    expect(ended).toEqual(['d-amos']);
    expect(inbox[0]).toMatchObject({ did: 'd-amos', kind: 'papers_lapsed', title: 'Your shift was ended' });
    expect(inbox[0].body).toContain('Insurance lapsed');
    const [mail] = outbox.recent('ops@kilima.example');
    expect(mail.subject).toBe('1 off the road at Kilima Logistics — papers lapsed');
    expect(mail.text).toContain('KLM 002B — Insurance lapsed');
    expect(mail.text).toContain('KLM 002B — Inspection certificate runs out');
    // The same papers, the next pass: nothing to end, nothing new to mail.
    expect(await watch.sweep(now + DAY)).toEqual({ shiftsEnded: 0, notified: 0, mails: 0 });
  });

  it('tells a driver once that their licence is running out, ends their shift once it has lapsed, and mails the fleet once per state', async () => {
    const drivers = [{ did: 'd-jane', displayName: 'Jane W.', status: 'ACTIVE', managerDid: 'did:fleet:k', licence: { number: 'L', classes: ['van'], expiresAt: day(3) } }];
    const { watch, outbox, inbox, ended } = harness({ vehicles: [{ vehicleId: 'v9', plate: 'KLM 009X', status: 'ACTIVE', managerDid: 'did:fleet:k', documents: {} }], drivers, onShift: { v9: 'd-jane' } });
    expect(await watch.sweep(now)).toEqual({ shiftsEnded: 0, notified: 1, mails: 1 });
    expect(inbox[0]).toMatchObject({ did: 'd-jane', kind: 'papers_due', title: 'Your licence runs out in 4 day(s)' });
    expect(await watch.sweep(now + DAY)).toEqual({ shiftsEnded: 0, notified: 0, mails: 0 });
    // Five days on: lapsed. The shift ends, the driver is told (a new state, a new message), the fleet is mailed again.
    const r = await watch.sweep(now + 5 * DAY);
    expect(r).toEqual({ shiftsEnded: 1, notified: 1, mails: 1 });
    expect(ended).toEqual(['d-jane']);
    expect(inbox.map((n) => n.kind)).toEqual(['papers_due', 'papers_lapsed', 'papers_lapsed']);
    expect(outbox.recent('ops@kilima.example')).toHaveLength(2);
  });

  it('reports to the network what only an operator can put right, worst first, and when it last looked', async () => {
    const { watch } = harness({
      vehicles: [
        { vehicleId: 'v-fleet', plate: 'KLM 001V', status: 'ACTIVE', managerDid: 'did:fleet:k', documents: { insuranceExpiresAt: day(-1) } },
        { vehicleId: 'v-loose-ok', plate: 'KBX 1', status: 'ACTIVE', documents: { insuranceExpiresAt: day(300) } },
        { vehicleId: 'v-loose-bad', plate: 'KBX 2', status: 'ACTIVE', documents: { insuranceExpiresAt: day(-3) } },
        { vehicleId: 'v-retired', plate: 'KBX 9', status: 'RETIRED', documents: {} },
      ],
      drivers: [
        { did: 'd-fleet', displayName: 'Amos K.', status: 'ACTIVE', managerDid: 'did:fleet:k', licence: { number: 'L', classes: ['bike'] } },
        { did: 'd-courier-ok', displayName: 'Zed', status: 'ACTIVE', registry: 'light', licence: { number: 'n/a', classes: ['bike'] } },
        { did: 'd-courier-bad', displayName: 'Ann', status: 'ACTIVE', registry: 'heavy', jurisdiction: 'KE', licence: { number: 'L-ANN', classes: ['van'], expiresAt: day(-2) } },
        { did: 'd-courier-gone', displayName: 'Sus', status: 'SUSPENDED', registry: 'light', licence: { number: 'n/a', classes: ['bike'] } },
      ],
      onShift: { 'v-loose-bad': 'd-courier-ok' },
      recent: { 'd-courier-bad': ['KBX 2', 'KBX 1'] },
    });
    const r = watch.networkReport(now);
    expect(r.couriers.map((c) => c.displayName)).toEqual(['Ann', 'Zed']); // the fleet's driver and the suspended one are not here
    expect(r.couriers[0]).toMatchObject({ licence: { number: 'L-ANN' }, onShift: false, drives: ['KBX 2', 'KBX 1'] });
    expect(r.couriers[0].offRoad[0]).toMatch(/^Driving licence lapsed /);
    expect(r.couriers[1]).toMatchObject({ licence: {}, offRoad: [], onShift: true });
    expect(r.vehicles.map((v) => v.plate)).toEqual(['KBX 2', 'KBX 1']); // the fleet's and the retired one are not here
    expect(r.vehicles[0]).toMatchObject({ onShiftWith: 'Zed', offRoad: [expect.stringMatching(/^Insurance lapsed /)] });
    expect(r.fleets).toEqual({ count: 1, withLapsed: 1, lapsed: 1, due: 0 });
    expect(r.sweep).toBeNull();
    await watch.sweep(now);
    expect(watch.networkReport(now).sweep).toMatchObject({ at: new Date(now).toISOString(), shiftsEnded: 0 });
  });

  it('does nothing for papers in date or never recorded', async () => {
    const { watch, outbox, inbox, ended } = harness({
      vehicles: [{ vehicleId: 'v1', plate: 'P', status: 'ACTIVE', managerDid: 'did:fleet:k', documents: { insuranceExpiresAt: day(90) } }],
      drivers: [{ did: 'd', displayName: 'D', status: 'ACTIVE', managerDid: 'did:fleet:k', licence: { number: 'L', classes: ['bike'] } }],
    });
    expect(await watch.sweep(now)).toEqual({ shiftsEnded: 0, notified: 0, mails: 0 });
    expect(outbox.recent('ops@kilima.example')).toHaveLength(0);
    expect(inbox).toHaveLength(0);
    expect(ended).toHaveLength(0);
  });
});
