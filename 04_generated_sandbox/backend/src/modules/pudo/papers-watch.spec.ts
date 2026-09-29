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

  const harness = (
    over: {
      vehicles?: Array<Record<string, unknown>>;
      drivers?: Array<Record<string, unknown>>;
      onShift?: Record<string, string>;
      recent?: Record<string, string[]>;
      /** The fleet OPERATOR's own papers, and what its sister does about them. */
      carrierPapers?: Record<string, unknown>;
      enforced?: string[];
      notOffered?: string[];
      /** A fleet with no email on file: the inbox must not depend on the mail. */
      noEmail?: boolean;
    } = {},
  ) => {
    process.env.GLOS_PERSIST = 'off';
    const outbox = new OutboxMailSender();
    const inbox: Array<{ did: string; kind: string; title: string; body: string }> = [];
    const ended: string[] = [];
    const onShift = { ...(over.onShift ?? {}) }; // vehicleId → driverDid
    /*
     * One fleet, with the operator's own papers on it. `requirements` carries the licence NUMBER, which
     * was all this ever had before there was a date to go with it — the reason it could never lapse.
     */
    const managers = {
      list: () => [
        {
          did: 'did:fleet:k',
          status: 'ACTIVE',
          companyName: 'Kilima Logistics',
          contactEmail: over.noEmail ? undefined : 'ops@kilima.example',
          jurisdiction: 'KE',
          requirements: { businessRegistrationNo: 'BRS-1', transportOperatorLicence: 'TLB-77', taxId: 'P051' },
          papers: over.carrierPapers,
        },
      ],
      entityIdOrNone: () => 'sbg-ke',
      enforcedFor: () => over.enforced ?? [],
      tradingBlocks: () => over.notOffered ?? [],
    } as unknown as FleetManagerService;
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
    // `notified: 1` is the FLEET, in its own inbox. It used to be 0: the office was only ever MAILED, and there
    // is no mail transport — so the report below was counted as sent and read by nobody.
    expect(await watch.sweep(now)).toEqual({ shiftsEnded: 1, notified: 1, mails: 1 });
    expect(ended).toEqual(['d-amos']);
    expect(inbox[0]).toMatchObject({ did: 'd-amos', kind: 'papers_lapsed', title: 'Your shift was ended' });
    expect(inbox[0].body).toContain('Insurance lapsed');
    const fleetNote = inbox.find((n) => n.did === 'did:fleet:k');
    expect(fleetNote).toMatchObject({ kind: 'papers_lapsed', title: 'A paper lapsed in your fleet' });
    // Both of the fleet's papers, by name, in one message — not one notification per paper.
    expect(fleetNote?.body).toContain('KLM 002B — Insurance lapsed');
    expect(fleetNote?.body).toContain('KLM 002B — Inspection certificate runs out');
    const [mail] = outbox.recent('ops@kilima.example');
    expect(mail.subject).toBe('1 off the road at Kilima Logistics — papers lapsed');
    expect(mail.text).toContain('KLM 002B — Insurance lapsed');
    expect(mail.text).toContain('KLM 002B — Inspection certificate runs out');
    // The same papers, the next pass: nothing to end, nothing new to mail or say.
    expect(await watch.sweep(now + DAY)).toEqual({ shiftsEnded: 0, notified: 0, mails: 0 });
  });

  it('tells the fleet in its own inbox even with no email on file — the inbox never waits on the mail', async () => {
    const { watch, inbox, outbox } = harness({
      vehicles: [{ vehicleId: 'v1', plate: 'KLM 002B', status: 'ACTIVE', managerDid: 'did:fleet:k', documents: { insuranceExpiresAt: day(-2) } }],
      drivers: [],
      noEmail: true,
    });
    expect(await watch.sweep(now)).toMatchObject({ mails: 0, notified: 1 });
    expect(outbox.recent('ops@kilima.example')).toHaveLength(0);
    expect(inbox.find((n) => n.did === 'did:fleet:k')?.body).toContain('KLM 002B — Insurance lapsed');
  });

  /*
   * THE COMPANY'S OWN PAPERS, WARNED WHILE THERE IS TIME. Where its sister enforces one, the day it lapses is
   * the day the fleet's runs leave the board — a knob that did that with no warning would be a trap.
   */
  describe('the fleet’s own licence and cover', () => {
    it('warns before it runs out, and says what it will cost when the company enforces it', async () => {
      const { watch, inbox } = harness({ vehicles: [], drivers: [], carrierPapers: { licenceExpiresAt: day(11) }, enforced: ['operator_licence'] });
      await watch.sweep(now);
      const note = inbox.find((n) => n.did === 'did:fleet:k');
      expect(note).toMatchObject({ kind: 'papers_due', title: 'Your operator licence runs out in 12 days' });
      expect(note?.body).toContain('Your runs come off the board that day unless it is renewed');
      expect(note?.body).toContain('send the new document from the dashboard');
    });

    it('warns without threatening anything when nobody enforces it', async () => {
      const { watch, inbox } = harness({ vehicles: [], drivers: [], carrierPapers: { insuranceExpiresAt: day(-1) } });
      await watch.sweep(now);
      const note = inbox.find((n) => n.did === 'did:fleet:k');
      expect(note).toMatchObject({ kind: 'papers_lapsed', title: 'Your carrier insurance has lapsed' });
      expect(note?.body).not.toContain('off the board');
    });

    it('gives the licence and the cover their own push tags, so one warning never replaces the other', async () => {
      const { watch, inbox } = harness({ vehicles: [], drivers: [], carrierPapers: { licenceExpiresAt: day(11), insuranceExpiresAt: day(15) } });
      await watch.sweep(now);
      const notes = inbox.filter((n) => n.did === 'did:fleet:k') as Array<{ tag?: string }>;
      expect(notes).toHaveLength(2);
      // The tag collapses notifications on a lock screen: shared, the cover's warning would hide the licence's.
      expect(new Set(notes.map((n) => n.tag)).size).toBe(2);
    });

    it('says it once per state, not every sweep', async () => {
      const { watch, inbox } = harness({ vehicles: [], drivers: [], carrierPapers: { licenceExpiresAt: day(11) } });
      await watch.sweep(now);
      await watch.sweep(now + DAY);
      expect(inbox.filter((n) => n.did === 'did:fleet:k')).toHaveLength(1);
    });

    it('stays quiet once the fleet has SENT the renewal — it is waiting on us, not the other way round', async () => {
      const sent = { operator_licence: { copyRef: 'med_1', ownerDid: 'did:fleet:k', expiresAt: day(400), sentAt: new Date(now).toISOString() } };
      const { watch, inbox } = harness({ vehicles: [], drivers: [], carrierPapers: { licenceExpiresAt: day(11), sent } });
      await watch.sweep(now);
      expect(inbox.filter((n) => n.did === 'did:fleet:k')).toHaveLength(0);
    });

    it('never warns about a paper that was never dated', async () => {
      const { watch, inbox } = harness({ vehicles: [], drivers: [] });
      await watch.sweep(now);
      expect(inbox.filter((n) => n.did === 'did:fleet:k')).toHaveLength(0);
    });
  });

  it('tells a driver once that their licence is running out, ends their shift once it has lapsed, and mails the fleet once per state', async () => {
    const drivers = [{ did: 'd-jane', displayName: 'Jane W.', status: 'ACTIVE', managerDid: 'did:fleet:k', licence: { number: 'L', classes: ['van'], expiresAt: day(3) } }];
    const { watch, outbox, inbox, ended } = harness({ vehicles: [{ vehicleId: 'v9', plate: 'KLM 009X', status: 'ACTIVE', managerDid: 'did:fleet:k', documents: {} }], drivers, onShift: { v9: 'd-jane' } });
    // Two told: Jane, and her fleet's office in its own inbox.
    expect(await watch.sweep(now)).toEqual({ shiftsEnded: 0, notified: 2, mails: 1 });
    const jane = () => inbox.filter((n) => n.did === 'd-jane');
    const office = () => inbox.filter((n) => n.did === 'did:fleet:k');
    expect(jane()[0]).toMatchObject({ kind: 'papers_due', title: 'Your licence runs out in 4 days' });
    // Her office records it, so the message tells her where the date goes — and it is short, because the
    // place it is read is a lock screen.
    expect(jane()[0].body).toContain('Give the new date to the fleet office');
    expect(jane()[0].body.length).toBeLessThan(120);
    expect(office()[0]).toMatchObject({ kind: 'papers_due', title: 'A paper running out in your fleet' });
    expect(await watch.sweep(now + DAY)).toEqual({ shiftsEnded: 0, notified: 0, mails: 0 });
    // Five days on: lapsed. The shift ends, the driver is told (a new state, a new message), the fleet is told
    // and mailed again.
    const r = await watch.sweep(now + 5 * DAY);
    expect(r).toEqual({ shiftsEnded: 1, notified: 2, mails: 1 });
    expect(ended).toEqual(['d-jane']);
    expect(jane().map((n) => n.kind)).toEqual(['papers_due', 'papers_lapsed', 'papers_lapsed']);
    expect(office().map((n) => n.kind)).toEqual(['papers_due', 'papers_lapsed']);
    expect(outbox.recent('ops@kilima.example')).toHaveLength(2);
  });

  it('counts the days in words a person would use, and tells a courier with no fleet where the card goes', async () => {
    // ONE day is "1 day", never "1 day(s)" — the driver's own screenshot of "10 day(s)" is what this is for.
    const tomorrow = [{ did: 'd-solo', displayName: 'Solo S.', status: 'ACTIVE', licence: { number: 'L', classes: ['motorcycle'], expiresAt: day(0) } }];
    const one = harness({ vehicles: [], drivers: tomorrow });
    expect(await one.watch.sweep(now)).toMatchObject({ notified: 1 });
    expect(one.inbox[0].title).toBe('Your licence runs out in 1 day');
    // …and a courier who rides without a fleet is sent to the app, not to an office they do not have.
    expect(one.inbox[0].body).toContain('Send a photo of the new card from the app');
    expect(one.inbox[0].body.length).toBeLessThan(120);
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

  /*
   * THE OPERATOR'S OWN PAPERS ARE ON THIS SCREEN WHETHER OR NOT ANYBODY ENFORCES THEM.
   *
   * That is the whole design: a sister decides the CONSEQUENCE of a lapse, never whether we look. If
   * "not enforced" also meant "not shown", the transport-operator licence would be exactly what it was
   * before — collected at KYC, read once, and never looked at again by anything.
   */
  describe('the operators own papers', () => {
    it('lists a fleet whose dates were never recorded, rather than leaving it out', () => {
      const { watch } = harness();
      const [row] = watch.networkReport(now).carrierPapers;

      expect(row).toMatchObject({ companyName: 'Kilima Logistics', entityId: 'sbg-ke', enforced: [], notOffered: [] });
      // 'none' on both, and the licence NUMBER present without a date — the exact state that made this
      // unenforceable, now visible instead of invisible.
      expect(row.papers.map((p) => p.state)).toEqual(['none', 'none']);
      expect(row.papers[0]).toMatchObject({ kind: 'operator_licence', reference: 'TLB-77' });
    });

    it('shows a lapsed licence that nobody enforces, and says nobody is enforcing it', () => {
      const { watch } = harness({ carrierPapers: { licenceExpiresAt: day(-5) } });
      const [row] = watch.networkReport(now).carrierPapers;

      expect(row.papers[0].state).toBe('lapsed');
      // Lapsed AND still trading. A reader can tell that apart from "in date" only because both fields
      // are here: the paper is bad, and no sister has asked us to do anything about it.
      expect(row.enforced).toEqual([]);
      expect(row.notOffered).toEqual([]);
    });

    it('says so plainly when the lapse IS costing the fleet work', () => {
      const { watch } = harness({
        carrierPapers: { licenceExpiresAt: day(-5) },
        enforced: ['operator_licence'],
        notOffered: ['Operator licence lapsed 9 Sep 2026'],
      });
      const [row] = watch.networkReport(now).carrierPapers;

      expect(row).toMatchObject({ enforced: ['operator_licence'], notOffered: ['Operator licence lapsed 9 Sep 2026'] });
    });
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
