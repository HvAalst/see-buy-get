import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { followLink, intentOf, onLaunch, resetLaunchForTests, withoutIntent, type RunAsked } from './launch';
import { bookingNamed, openLinked } from './linkedLoad';
import type { InboxItem } from './push';
import { fleetSheetFor } from '../apps/driver/notices';
import { MyBookingsSection } from '../apps/agent/screens/MyBookingsSection';
import type { AgentActions, AgentState } from '../apps/agent/useAgentApp';
import type { MyBookingRow } from '../apps/agent/types';

/*
 * 2026-11-02 — ONE TAP, AND IT OPENS (the owner: "yes, just to keep drivers' safety in mind, we must reduce the tapping,
 * so that's why it should open"). Space booked on a run, an export, an import: each notice names its record, and the
 * app that reads it opens that one. A driver's notice names the place the driver acts on it.
 */

afterEach(() => resetLaunchForTests());

describe('a booking on a run, an export, an import — named on the link', () => {
  it('reads the run and the booking on it, an export and an import — and nothing a hand-made address could add', () => {
    expect(intentOf('/?run=dep_1&booking=bk_1')).toEqual({ run: { run: 'dep_1', booking: 'bk_1' } });
    expect(intentOf('/?run=dep_1')).toEqual({ run: { run: 'dep_1' } });
    // A booking with no run is no place.
    expect(intentOf('/?booking=bk_1')).toBeNull();
    expect(intentOf('/?export=exp_1')).toEqual({ export: 'exp_1' });
    expect(intentOf('/?import=imp_1')).toEqual({ import: 'imp_1' });
    expect(intentOf('/?import=..%2Fx')).toBeNull();
    expect(withoutIntent('https://x.test/agent/?run=dep_1&booking=bk_1&y=2')).toBe('/agent/?y=2');
    expect(withoutIntent('https://x.test/business/?export=exp_1')).toBe('/business/');
  });

  it('is followed inside the page to whoever opens that record here — and nowhere in an app with none', () => {
    const runs: RunAsked[] = [];
    const imports: string[] = [];
    onLaunch('run', (r) => runs.push(r));
    onLaunch('import', (id) => imports.push(id));
    expect(followLink('/?run=dep_1&booking=bk_1')).toBe(true);
    expect(followLink('/?import=imp_1')).toBe(true);
    expect(followLink('/?export=exp_1')).toBe(false);
    expect(runs).toEqual([{ run: 'dep_1', booking: 'bk_1' }]);
    expect(imports).toEqual(['imp_1']);
  });

  it('the booking named — or, a run called off and told to every shipper on it, this account’s booking on that run', () => {
    const b = (bookingId: string, departureId: string) => ({ bookingId, departureId });
    expect(bookingNamed({ run: 'dep_1', booking: 'bk_2' })(b('bk_2', 'dep_1'))).toBe(true);
    expect(bookingNamed({ run: 'dep_1', booking: 'bk_2' })(b('bk_1', 'dep_1'))).toBe(false);
    expect(bookingNamed({ run: 'dep_1' })(b('bk_1', 'dep_1'))).toBe(true);
    expect(bookingNamed({ run: 'dep_1' })(b('bk_1', 'dep_9'))).toBe(false);
  });

  it('opens it among the account’s own read afresh, or says in words it is not among them', async () => {
    const did: string[] = [];
    const rows = [{ exportId: 'exp_1' }, { exportId: 'exp_2' }];
    const steps = { mayRead: true, fetch: async () => rows, keep: () => void did.push('keep'), open: (r: { exportId: string }) => void did.push(`open:${r.exportId}`), say: (w: string) => void did.push(`say:${w}`) };
    expect(await openLinked((r: { exportId: string }) => r.exportId === 'exp_2', steps)).toBe('opened');
    expect(await openLinked((r: { exportId: string }) => r.exportId === 'exp_9', steps)).toBe('not_yours');
    expect(did).toEqual(['keep', 'open:exp_2', 'keep', 'say:not_yours']);
    for (const k of ['business.runs.notYours', 'business.exports.notYours', 'tower.imports.notYours', 'agent.mine.notYours'] as const) expect(t(k)).toMatch(/is not among this/);
  });
});

describe('the shop brings the booking named into sight, marked', () => {
  const booking = (bookingId: string): MyBookingRow =>
    ({ bookingId, departureId: 'dep_1', company: 'Kilima', lineName: 'Nairobi–Mombasa', originZone: 'Nairobi', destZone: 'Mombasa', leavesAt: '2026-11-03T06:00:00.000Z', description: 'Bricks', weightKg: 400, price: 9000, currency: 'KES', bookingStatus: 'booked', runStatus: 'scheduled', waits: [] }) as unknown as MyBookingRow;
  it('marks the one asked for, and only that one', () => {
    const state = { myBookings: [booking('bk_1'), booking('bk_2')], myBookingsState: 'ready', soughtBooking: { id: 'bk_2', seq: 1 } } as unknown as AgentState;
    const html = renderToString(<MyBookingsSection state={state} actions={{ loadMyBookings: async () => undefined } as unknown as AgentActions} />);
    expect(html.match(/row--sought/g)?.length).toBe(1);
    expect(html).toMatch(/id="booking-bk_2"[^>]*class="row row--static row--sought"[^>]*aria-current="true"/);
  });
});

describe('a driver’s notices answered in “Your fleet” open that sheet', () => {
  const n = (kind: string, data: Record<string, unknown> = {}): InboxItem => ({ id: 'n', kind, title: 't', body: 'b', createdAt: '2026-11-02T08:00:00.000Z', data });
  it('the fleet’s offer, leaving it, a day on its roster, an ask to ride alone refused — and not what has nothing to answer', () => {
    expect(fleetSheetFor(n('fleet_offer', { offerId: 'fo_1', fleetDid: 'did:fleet:1' }))).toBe('offer');
    expect(fleetSheetFor(n('fleet_offer', { offerId: 'fo_1' }))).toBeNull();
    expect(fleetSheetFor(n('roster_changed', { fleetDid: 'did:fleet:1' }))).toBe('fleet');
    // The fleet's own side of a roster change is not the driver's.
    expect(fleetSheetFor(n('roster_changed', { driverDid: 'did:drv:1' }))).toBeNull();
    expect(fleetSheetFor(n('driver_roster', { day: '2026-11-04' }))).toBe('fleet');
    expect(fleetSheetFor(n('papers_checked', { did: 'd', about: 'ride_alone', approved: false }))).toBe('fleet');
    // Approved: a shift starts on the home screen, named on its link.
    expect(fleetSheetFor(n('papers_checked', { did: 'd', about: 'ride_alone', approved: true }))).toBeNull();
    expect(fleetSheetFor(n('papers_checked', { did: 'd' }))).toBeNull();
  });
});

describe('who opens what from a link', () => {
  const read = (p: string) => readFileSync(`src/apps/${p}`, 'utf8');
  it('the business opens a booking, an export and an import; the shop its bookings', () => {
    const shell = read('business/app.tsx');
    for (const k of ['load', 'run', 'export', 'import']) expect(shell, k).toMatch(new RegExp(`onLaunch\\('${k}'`));
    expect(read('business/screens/RunsScreen.tsx')).toMatch(/openLinked<MyBookingRow>\(bookingNamed\(want\)/);
    expect(read('business/screens/ExportsScreen.tsx')).toMatch(/openLinked<ExportRow>/);
    expect(read('tower/screens/ImportsScreen.tsx')).toMatch(/openLinked<ImportRow>/);
    expect(read('agent/useAgentApp.ts')).toMatch(/onLaunch\('run'/);
    // No other app books space on a run.
    for (const other of ['vendor/useVendorApp.ts', 'driver/useDriverApp.ts', 'fleet/useFleetApp.ts', 'genesis/useSendApp.ts']) expect(read(other), other).not.toMatch(/onLaunch\('run'/);
  });

  it('the driver off shift, sent to a load: the van’s screen, where the shift starts — never a tap that goes nowhere', () => {
    expect(read('driver/app.tsx')).toMatch(/if \(\(to === 'route' \|\| to === 'loads'\) && !state\.session\.active\) return actions\.go\('home'\);/);
  });
});
