import { PilotService } from './pilot.service';
import type { ParcelService } from './parcel.service';
import type { Parcel } from './pudo.types';

/**
 * WHAT EACH OF THE PILOT'S NUMBERS COUNTS (pilot.types.ts), on parcels made here rather than by a day of the network: a
 * timing nobody could have taken is not counted, a parcel that turned up is not a loss, a shop works its counter only by
 * scans it signed, and a parcel left behind at a handover counts against the handshake.
 */
describe('the pilot’s numbers, counted', () => {
  const MON = Date.parse('2026-10-12T00:00:00Z');
  const at = (h: number) => new Date(MON + h * 3_600_000).toISOString();
  const scan = (status: string, by: string, h: number) => ({ status, by, at: at(h), note: '' });
  let parcels: Parcel[];
  let pilot: PilotService;

  beforeEach(() => {
    parcels = [];
    pilot = new PilotService({ list: () => parcels } as unknown as ParcelService);
    // Fresh stores per test: the service keeps its records in maps of its own.
    for (const k of ['handovers', 'takeIns', 'weeks'] as const) (pilot as unknown as Record<string, Map<string, unknown>>)[k] = new Map();
  });

  it('times a take-in once, and never one nobody could have taken: nothing, or longer than a quarter of an hour', () => {
    pilot.noteTakeIn('P1', 'did:a', 20, MON + 1_000);
    pilot.noteTakeIn('P1', 'did:a', 40, MON + 2_000); // the same take-in, sent again from the outbox
    pilot.noteTakeIn('P2', 'did:a', 901, MON + 3_000);
    pilot.noteTakeIn('P3', 'did:a', 0, MON + 4_000);
    pilot.noteTakeIn('P4', 'did:a', 'soon', MON + 5_000);
    pilot.noteTakeIn('P5', 'did:a', 30, MON + 6_000);
    expect(pilot.board(MON + 10_000).thisWeek.takeIn).toEqual({ timed: 2, medianSeconds: 20, p90Seconds: 30 });
  });

  it('counts the handshake as the share of the parcels due onto a bus that were scanned onto it', () => {
    pilot.noteHandover('did:a', { manifestId: 'm1', expected: ['A', 'B', 'C', 'D'], handed: ['A', 'B', 'C'], missed: ['D'] }, MON + 1_000);
    pilot.noteHandover('did:a', { manifestId: 'm2', expected: [], handed: [], missed: [] }, MON + 2_000);
    expect(pilot.board(MON + 10_000).thisWeek.handshake).toEqual({ handed: 3, missed: 1, rate: 0.75 });
  });

  it('does not count a parcel that turned up as lost, and counts each problem reported as damaged', () => {
    const shop = 'did:shop:a';
    const taken = (id: string): Parcel => ({ parcelId: id, originAgentDid: shop, scans: [scan('CREATED', shop, 1)] }) as unknown as Parcel;
    parcels = [
      { ...taken('LOST'), lost: { declaredAt: at(30), reason: 'x', fromStatus: 'At_PUDO', lastSeenAt: at(1) } },
      { ...taken('FOUND'), lost: { declaredAt: at(30), reason: 'x', fromStatus: 'At_PUDO', lastSeenAt: at(1), foundAt: at(40) } },
      { ...taken('BROKEN'), dispute: { raisedAt: at(20) } },
      taken('FINE'),
    ] as unknown as Parcel[];
    expect(pilot.board(MON + 100 * 3_600_000).thisWeek.loss).toEqual({ lost: 1, damaged: 1, takenIn: 4, rate: 0.5 });
  });

  it('counts a shop as working only by the scans it signed — not a hub’s, a driver’s or the network’s', () => {
    const a = 'did:shop:a';
    const b = 'did:shop:b';
    const WEEK = 7 * 24;
    parcels = [
      // Week 1: both shops take parcels in — the original two.
      { parcelId: 'P1', originAgentDid: a, destAgentDid: b, scans: [scan('CREATED', a, 1), scan('On_Bus', 'BADGE-1', 2), scan('Ready_For_Pickup', b, 5)] },
      // Week 2: shop a's parcel is only moved by others — the hub and the network's own sweep. Shop b hands one out.
      { parcelId: 'P2', originAgentDid: a, destAgentDid: b, scans: [scan('CREATED', a, 3), scan('At_MDP', 'Central Sort', WEEK + 2), scan('Unclaimed', 'network', WEEK + 3), scan('Delivered', b, WEEK + 4)] },
    ] as unknown as Parcel[];
    expect(pilot.board(MON + (WEEK + 10) * 3_600_000).thisWeek.retention).toEqual({ pilotWeek: 2, original: 2, active: 1, rate: 0.5 });
  });
});
