import type { EventBus } from '../../foundation/events/event-bus.service';
import type { AgentService } from './agent.service';
import type { DispatchService } from './dispatch.service';
import type { DriverService } from './driver.service';
import type { FleetSiteService } from './fleet-site.service';
import type { FleetService } from './fleet.service';
import type { MdpService } from './mdp.service';
import type { VehicleBreakdownService } from './vehicle-breakdown.service';
import { VehicleStandstillService } from './vehicle-standstill.service';
import type { VehicleService } from './vehicle.service';

const fleetDid = 'did:glos:fleet-kilima';
const driver = 'did:glos:driver-otieno';
const t0 = Date.parse('2026-10-19T08:00:00.000Z');
const M = 60_000;
/** A road outside Nakuru, and a point 100 m along it, and one 2 km further. */
const STOP = { lat: -0.3031, lng: 36.08 };
const NEAR = { lat: -0.3022, lng: 36.08 };
const FAR = { lat: -0.285, lng: 36.08 };

function harness(over: { shift?: boolean; managerDid?: string | null; reasons?: { places: Array<{ lat: number; lng: number }>; atBorder: boolean }; sites?: Array<{ location: { lat: number; lng: number } }>; mdps?: Array<{ location: { lat: number; lng: number } }>; shops?: Array<{ location: { lat: number; lng: number } }>; brokenDown?: boolean } = {}) {
  const published: Array<{ topic: string; payload: unknown }> = [];
  const state = { shift: over.shift ?? true };
  const events = { subscribe: () => undefined, publish: (topic: string, payload: unknown) => (published.push({ topic, payload }), Promise.resolve()) } as unknown as EventBus;
  const fleet = { activeForDriver: () => (state.shift ? { assignmentId: 'asg_1', driverDid: driver, vehicleId: 'veh_1' } : undefined) } as unknown as FleetService;
  const drivers = { get: () => ({ displayName: 'Otieno', managerDid: over.managerDid === null ? undefined : (over.managerDid ?? fleetDid) }) } as unknown as DriverService;
  const vehicles = { get: () => ({ plate: 'KDA 123T' }) } as unknown as VehicleService;
  const reasonsAt: number[] = [];
  const dispatch = { reasonsToStand: (_d: string, now: number) => (reasonsAt.push(now), over.reasons ?? { places: [], atBorder: false }) } as unknown as DispatchService;
  const sites = { sitesOf: () => over.sites ?? [] } as unknown as FleetSiteService;
  const mdps = { list: () => over.mdps ?? [] } as unknown as MdpService;
  const agents = { list: () => over.shops ?? [] } as unknown as AgentService;
  const breakdowns = { openForFleet: () => (over.brokenDown ? [{ vehicleId: 'veh_1', status: 'open' }] : []) } as unknown as VehicleBreakdownService;
  const svc = new VehicleStandstillService(events, fleet, drivers, vehicles, dispatch, sites, mdps, agents, breakdowns);
  /** The phone on the shift, heard every few minutes at `where` from `from` to `to`. */
  const heard = (where: { lat: number; lng: number }, from: number, to: number) => {
    for (let t = from; t <= to; t += 4 * M) svc.track(driver, where, t);
  };
  return { svc, published, state, heard, reasonsAt };
}

describe('a vehicle standing still (round 16)', () => {
  it('each fleet sets how long is too long, starting at 45 minutes — and the driver is told', () => {
    const { svc } = harness();
    expect(svc.settingsOf(fleetDid)).toEqual({ on: true, afterMin: 45, asStarted: true, silent: { on: true, afterMin: 60, asStarted: true } });
    expect(svc.watchedFor(driver)).toBe(45);
    expect(() => svc.setSettings(fleetDid, { on: true, afterMin: 10 }, 'Amina', t0)).toThrow(/Between 15 minutes and 4 hours/);
    expect(() => svc.setSettings(fleetDid, { on: true, afterMin: 300 }, 'Amina', t0)).toThrow(/Between 15 minutes and 4 hours/);
    expect(svc.setSettings(fleetDid, { on: true, afterMin: 30 }, 'Amina', t0)).toMatchObject({ on: true, afterMin: 30, asStarted: false, setBy: 'Amina' });
    svc.setSettings(fleetDid, { on: false, afterMin: 30 }, 'Amina', t0);
    expect(svc.watchedFor(driver)).toBeUndefined();
    // An owner-driver has no fleet to tell.
    expect(harness({ managerDid: null }).svc.watchedFor(driver)).toBeUndefined();
  });

  it('a vehicle standing longer than its fleet allows, away from any stop, opens one case — over once it moves on', () => {
    const { svc, published, heard } = harness();
    heard(STOP, t0, t0 + 20 * M);
    heard(NEAR, t0 + 24 * M, t0 + 44 * M); // edging along a queue is still standing there
    expect(svc.sweep(t0 + 44 * M)).toEqual([]);
    const [opened] = svc.sweep(t0 + 46 * M);
    expect(opened).toMatchObject({ fleetDid, plate: 'KDA 123T', driverName: 'Otieno', location: STOP, since: new Date(t0).toISOString(), afterMin: 45 });
    expect(published).toEqual([{ topic: 'pudo.vehicle_standing_still', payload: { fleetDid, case: expect.objectContaining({ caseId: opened.caseId, minutes: 46, state: 'open' }) } }]);
    // Once a stop: the next sweep opens nothing more.
    expect(svc.sweep(t0 + 50 * M)).toEqual([]);
    expect(svc.casesFor(fleetDid, t0 + 50 * M)).toEqual([expect.objectContaining({ caseId: opened.caseId, state: 'open', minutes: 50 })]);
    // It moves on: the case is over, with how long it stood.
    svc.track(driver, FAR, t0 + 60 * M);
    expect(svc.casesFor(fleetDid, t0 + 61 * M)[0]).toMatchObject({ state: 'over', over: { why: 'moved' }, minutes: 60 });
    // Over for a day, then gone from the list.
    expect(svc.casesFor(fleetDid, t0 + 26 * 60 * M)).toEqual([]);
  });

  it('a phone gone dark is not a vehicle standing still', () => {
    const { svc, heard } = harness();
    heard(STOP, t0, t0 + 20 * M);
    expect(svc.sweep(t0 + 50 * M)).toEqual([]);
  });

  it('a vehicle with a reason to stand opens nothing: its load’s stop, the fleet’s site, a hub, a border post, a breakdown — or the watch off', () => {
    const at = (h: ReturnType<typeof harness>) => {
      h.heard(STOP, t0, t0 + 48 * M);
      return h.svc.sweep(t0 + 48 * M);
    };
    expect(at(harness({ reasons: { places: [{ lat: -0.3005, lng: 36.0812 }], atBorder: false } }))).toEqual([]);
    expect(at(harness({ reasons: { places: [], atBorder: true } }))).toEqual([]);
    expect(at(harness({ sites: [{ location: NEAR }] }))).toEqual([]);
    expect(at(harness({ mdps: [{ location: NEAR }] }))).toEqual([]);
    expect(at(harness({ shops: [{ location: NEAR }] }))).toEqual([]);
    expect(at(harness({ brokenDown: true }))).toEqual([]);
    expect(at(harness({ managerDid: null }))).toEqual([]);
    const off = harness();
    off.svc.setSettings(fleetDid, { on: false, afterMin: 45 }, 'Amina', t0);
    expect(at(off)).toEqual([]);
    // A stop further than half a kilometre is no reason: the case opens.
    expect(at(harness({ sites: [{ location: FAR }] }))).toHaveLength(1);
  });

  it('the office says how it was — something wrong in words — and a shift that ends closes its case', () => {
    const h = harness();
    h.heard(STOP, t0, t0 + 48 * M);
    const [c] = h.svc.sweep(t0 + 48 * M);
    expect(() => h.svc.answer('did:glos:fleet-other', c.caseId, { outcome: 'all_well' }, 'Amina', t0 + 50 * M)).toThrow(/No such case/);
    expect(() => h.svc.answer(fleetDid, c.caseId, { outcome: 'problem' }, 'Amina', t0 + 50 * M)).toThrow(/Say what is wrong/);
    expect(h.svc.answer(fleetDid, c.caseId, { outcome: 'all_well', note: ' Queue at the Total weighbridge ' }, 'Amina', t0 + 50 * M)).toMatchObject({ state: 'answered', answer: { outcome: 'all_well', note: 'Queue at the Total weighbridge', by: 'Amina' } });
    h.state.shift = false;
    h.svc.sweep(t0 + 70 * M);
    expect(h.svc.casesFor(fleetDid, t0 + 71 * M)[0]).toMatchObject({ state: 'over', over: { why: 'shift_ended' } });
  });
  it('a phone heard, then silent longer than its fleet allows, opens one case with where it was last heard — over when heard again, and where', () => {
    const { svc, published, heard } = harness();
    heard(STOP, t0, t0 + 4 * M);
    svc.track(driver, NEAR, t0 + 8 * M); // last heard 100 m on: still the same stop, but that is where it was heard
    // Standing an hour, but not heard: not a vehicle standing still — and silent 59 minutes is not yet a case.
    expect(svc.sweep(t0 + 67 * M)).toEqual([]);
    const [silent] = svc.sweep(t0 + 69 * M);
    expect(silent).toMatchObject({ kind: 'silent', fleetDid, plate: 'KDA 123T', driverName: 'Otieno', location: NEAR, since: new Date(t0 + 8 * M).toISOString(), afterMin: 60 });
    expect(published).toEqual([{ topic: 'pudo.vehicle_gone_silent', payload: { fleetDid, case: expect.objectContaining({ caseId: silent.caseId, kind: 'silent', minutes: 61, state: 'open' }) } }]);
    expect(svc.sweep(t0 + 75 * M)).toEqual([]);
    // Heard again, 18 km on: the case is over, with how long it said nothing and where it was heard.
    svc.track(driver, FAR, t0 + 90 * M);
    expect(svc.casesFor(fleetDid, t0 + 91 * M).find((c) => c.caseId === silent.caseId)).toMatchObject({ state: 'over', over: { why: 'heard', location: FAR }, minutes: 82 });
    // A second silence is a second case.
    expect(svc.sweep(t0 + 151 * M)).toEqual([expect.objectContaining({ kind: 'silent', location: FAR, since: new Date(t0 + 90 * M).toISOString() })]);
  });

  it('a silence last heard where it had reason to be opens nothing — judged as it was when last heard; nor after a breakdown, nor with the watch off', () => {
    const at = (h: ReturnType<typeof harness>) => {
      h.heard(STOP, t0, t0 + 4 * M);
      return h.svc.sweep(t0 + 70 * M).filter((c) => c.kind === 'silent');
    };
    expect(at(harness({ reasons: { places: [{ lat: -0.3005, lng: 36.0812 }], atBorder: false } }))).toEqual([]);
    expect(at(harness({ reasons: { places: [], atBorder: true } }))).toEqual([]);
    expect(at(harness({ sites: [{ location: NEAR }] }))).toEqual([]);
    expect(at(harness({ mdps: [{ location: NEAR }] }))).toEqual([]);
    expect(at(harness({ shops: [{ location: NEAR }] }))).toEqual([]);
    expect(at(harness({ brokenDown: true }))).toEqual([]);
    expect(at(harness({ managerDid: null }))).toEqual([]);
    const off = harness();
    off.svc.setSilence(fleetDid, { on: false, afterMin: 60 }, 'Amina', t0);
    expect(at(off)).toEqual([]);
    expect(off.svc.silenceFor(driver)).toBeUndefined();
    // Its reasons are asked as they were when the phone was last heard, not an hour later.
    const h = harness();
    expect(at(h)).toHaveLength(1);
    expect(h.reasonsAt).toContain(t0 + 4 * M);
  });

  it('a silence over, the vehicle still standing where it went quiet: the standing case still opens', () => {
    const { svc } = harness();
    svc.track(driver, STOP, t0); // heard once, then nothing
    expect(svc.sweep(t0 + 61 * M)).toEqual([expect.objectContaining({ kind: 'silent', since: new Date(t0).toISOString() })]);
    for (let m = 62; m <= 70; m += 4) svc.track(driver, STOP, t0 + m * M);
    expect(svc.sweep(t0 + 70 * M)).toEqual([expect.objectContaining({ kind: 'standing', since: new Date(t0).toISOString() })]);
  });

  it('each fleet sets its silence apart from its standing minutes — neither write touches the other — and the driver is told', () => {
    const { svc, heard } = harness();
    expect(svc.silenceFor(driver)).toBe(60);
    expect(() => svc.setSilence(fleetDid, { on: true, afterMin: 5 }, 'Amina', t0)).toThrow(/Between 15 minutes and 4 hours/);
    svc.setSettings(fleetDid, { on: true, afterMin: 30 }, 'Amina', t0);
    expect(svc.setSilence(fleetDid, { on: true, afterMin: 90 }, 'Baraka', t0)).toMatchObject({ on: true, afterMin: 30, setBy: 'Amina', silent: { on: true, afterMin: 90, asStarted: false, setBy: 'Baraka' } });
    expect(svc.setSettings(fleetDid, { on: false, afterMin: 45 }, 'Amina', t0)).toMatchObject({ on: false, afterMin: 45, silent: { on: true, afterMin: 90 } });
    expect(svc.silenceFor(driver)).toBe(90);
    expect(svc.watchedFor(driver)).toBeUndefined();
    // Ninety minutes, then: an hour and a half of silence opens it, not an hour.
    heard(STOP, t0, t0 + 4 * M);
    expect(svc.sweep(t0 + 70 * M)).toEqual([]);
    expect(svc.sweep(t0 + 95 * M)).toEqual([expect.objectContaining({ kind: 'silent', afterMin: 90 })]);
  });
});
