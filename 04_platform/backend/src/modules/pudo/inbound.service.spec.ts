import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import type { Freight } from './dispatch.types';
import { InboundService } from './inbound.service';

/**
 * INBOUND, READING A — the receiving moment (D9) and the receiving place's own clock (D10), on the receiver's side: what
 * stays expected after the handover until the receiver closes it, and when a load is expected, and late, read on the
 * place's clock rather than the carrier's or UTC's. The handover itself is pinned in pudo.service.spec (deliverFreight).
 */
describe('inbound: what stays expected, and the place’s own clock', () => {
  let freights: Freight[];
  let expectedAt: number | undefined;
  let told: Array<{ did: string; title: string; body: string }>;
  let events: EventBus;

  const base = (over: Partial<Freight> = {}): Freight =>
    ({
      freightId: 'fr_1',
      code: 'FRT-101',
      description: 'Cement, 400 bags',
      weightKg: 20_000,
      pickupLabel: 'Athi River works',
      destLabel: 'Jenga Builders — Mombasa Road yard',
      status: 'in_transit',
      createdAt: '2026-10-20T08:00:00Z',
      receiver: { entityId: 'ent_jenga', siteId: 'site_1', name: 'Jenga Builders', siteName: 'Mombasa Road yard' },
      receiverRef: 'PO-7781',
      destCountry: 'KE',
      packages: 400,
      ...over,
    }) as Freight;

  const delivered = (exceptions: NonNullable<Freight['proofOfDelivery']>['exceptions'], over: Partial<Freight> = {}): Freight =>
    base({ status: 'delivered', deliveredAt: '2026-10-26T09:00:00Z', proofOfDelivery: { receiverName: 'Peter Otieno', at: '2026-10-26T09:00:00Z', ...(exceptions ? { exceptions } : {}) }, ...over });

  const service = () => {
    const s = new InboundService(
      {
        listFreight: () => freights,
        requireFreightPublic: (id: string) => {
          const f = freights.find((x) => x.freightId === id);
          if (!f) throw new Error('not found');
          return f;
        },
        expectedAtOf: () => expectedAt,
        // CL1: the term says who claims; with none, the sender.
        claimantOf: (f: Freight) => ({ party: f.incoterm === 'CPT' ? 'receiver' : 'sender', why: '' }),
      } as never,
      { receivingPoints: () => [] } as never,
      { find: (id: string) => (id === 'ent_jenga' ? { entityId: 'ent_jenga', did: 'did:ent:jenga', name: 'Jenga Builders', jurisdiction: 'KE' } : undefined), byDid: () => undefined } as never,
      // The tracking link's view, with the carrier's own reading of when and whether late — which the row must not repeat beside the place's.
      { trackView: (f: Freight) => ({ kind: 'freight', ref: f.code, status: f.status, description: f.description, weightKg: f.weightKg, pickupLabel: f.pickupLabel, destLabel: f.destLabel, steps: [], late: 'day', expectedAbout: '10:40' }) } as never,
      events,
      { notify: async (did: string, n: { title: string; body: string }) => void told.push({ did, title: n.title, body: n.body }) } as never,
    );
    s.onModuleInit();
    return s;
  };

  beforeEach(() => {
    freights = [];
    expectedAt = undefined;
    told = [];
    events = new EventBus();
  });

  /**
   * D13 — GOODS FROM ABROAD (the user, 2026-10-26: "An expected arrival from abroad shows whether it has cleared, from the
   * note. Nothing more is computed."): what customs did, as an import's agent recorded it; what the driver said at a border
   * post; a hold, a leg under bond — and who clears it in under the term. Never a guess.
   */
  describe('D13 — goods from abroad: whether they have cleared, from the note', () => {
    const NOW = Date.parse('2026-10-26T12:00:00Z');
    let road: Record<string, { passages?: Array<{ kind: string; post?: string; at: string }>; heldOnTheWay?: { since: string } }>;
    let imports: Record<string, { originCountry: string; destCountry: string; port: string; releasedAt?: string; held?: { kind: string; since: string } }>;
    const abroadOf = (f: Freight) => {
      freights = [f];
      const s = new InboundService(
        { listFreight: () => freights, expectedAtOf: () => undefined, claimantOf: () => ({ party: 'sender', why: '' }) } as never,
        { receivingPoints: () => [] } as never,
        { find: () => ({ entityId: 'ent_jenga', did: 'did:ent:jenga', name: 'Jenga Builders', jurisdiction: 'KE' }), byDid: () => undefined } as never,
        { trackView: (x: Freight) => ({ kind: 'freight', ref: x.code, status: x.status, description: x.description, weightKg: x.weightKg, pickupLabel: x.pickupLabel, destLabel: x.destLabel, steps: [], ...(road[x.freightId] ?? {}) }) } as never,
        undefined,
        undefined,
        undefined,
        { customsOnNote: (code: string) => imports[code] ?? null } as never,
      );
      return s.rowOf(f, NOW).abroad;
    };
    beforeEach(() => {
      road = {};
      imports = {};
    });

    it('says nothing of goods from inside the country', () => {
      expect(abroadOf(base({ pickupCountry: 'KE', destCountry: 'KE' }))).toBeUndefined();
      expect(abroadOf(base({ destCountry: 'KE' }))).toBeUndefined();
    });

    it('a road load from Uganda: not cleared yet, then at the border post, then cleared — as its driver said; and who clears it in under the term', () => {
      const f = base({ freightId: 'fr_ug', pickupCountry: 'UG', destCountry: 'KE', incoterm: 'DAP' });
      expect(abroadOf(f)).toEqual({ from: 'UG', state: 'not_yet', clearsIn: 'receiver' });
      road.fr_ug = { passages: [{ kind: 'at_border', post: 'Malaba', at: '2026-10-26T06:00:00Z' }] };
      expect(abroadOf(f)).toEqual({ from: 'UG', state: 'at_border', at: '2026-10-26T06:00:00Z', where: 'Malaba', clearsIn: 'receiver' });
      road.fr_ug.passages!.push({ kind: 'at_hub', at: '2026-10-26T08:00:00Z' }, { kind: 'cleared_border', post: 'Malaba', at: '2026-10-26T09:30:00Z' });
      expect(abroadOf(f)).toEqual({ from: 'UG', state: 'cleared', at: '2026-10-26T09:30:00Z', where: 'Malaba', clearsIn: 'receiver' });
      // Under DDP its supplier clears it in; with no term agreed, nobody is named.
      expect(abroadOf({ ...f, incoterm: 'DDP' })?.clearsIn).toBe('supplier');
      expect(abroadOf({ ...f, incoterm: undefined })?.clearsIn).toBeUndefined();
    });

    it('held on the way, as its driver said; under bond until it is cleared in', () => {
      road.fr_held = { heldOnTheWay: { since: '2026-10-26T07:00:00Z' } };
      expect(abroadOf(base({ freightId: 'fr_held', pickupCountry: 'TZ', destCountry: 'KE' }))).toEqual({ from: 'TZ', state: 'held', at: '2026-10-26T07:00:00Z' });
      expect(abroadOf(base({ freightId: 'fr_bond', pickupCountry: 'TZ', destCountry: 'KE', bonded: true }))).toEqual({ from: 'TZ', state: 'under_bond' });
    });

    it('delivered with nothing said of the border: nothing is said of it now — it came, and no driver’s silence reads as still at the post', () => {
      road.fr_came = { passages: [{ kind: 'at_border', post: 'Busia', at: '2026-10-25T06:00:00Z' }] };
      expect(abroadOf(base({ freightId: 'fr_came', pickupCountry: 'UG', destCountry: 'KE', status: 'delivered', deliveredAt: '2026-10-26T09:00:00Z' }))).toBeUndefined();
      road.fr_came.passages!.push({ kind: 'cleared_border', post: 'Busia', at: '2026-10-25T10:00:00Z' });
      expect(abroadOf(base({ freightId: 'fr_came', pickupCountry: 'UG', destCountry: 'KE', status: 'delivered', deliveredAt: '2026-10-26T09:00:00Z' }))).toMatchObject({ state: 'cleared', where: 'Busia' });
    });

    it('an import cleared inland: let go at its port, as its agent recorded — or held there, since when; the road leg itself is inside one country', () => {
      imports['IMP-100'] = { originCountry: 'NL', destCountry: 'ET', port: 'Modjo', releasedAt: '2026-10-24T10:00:00Z' };
      const leg = base({ freightId: 'fr_imp', externalOrderId: 'IMP-100', pickupCountry: 'ET', destCountry: 'ET', incoterm: 'DAP' });
      expect(abroadOf(leg)).toEqual({ from: 'NL', state: 'cleared', at: '2026-10-24T10:00:00Z', where: 'Modjo', clearsIn: 'receiver' });
      imports['IMP-100'] = { originCountry: 'NL', destCountry: 'ET', port: 'Modjo', held: { kind: 'physical_exam', since: '2026-10-23T08:00:00Z' } };
      expect(abroadOf(leg)).toEqual({ from: 'NL', state: 'held', at: '2026-10-23T08:00:00Z', where: 'Modjo', clearsIn: 'receiver' });
      // A shop's order number that is no consignment is no import: the road says it.
      expect(abroadOf(base({ freightId: 'fr_shop', externalOrderId: 'ORD-7', pickupCountry: 'KE', destCountry: 'KE' }))).toBeUndefined();
    });
  });

  describe('D10 — when, on the receiving place’s own clock', () => {
    it('reads the day an order was placed for on the place’s clock: past midnight in Nairobi it is the 26th there, while UTC still says the 25th', () => {
      freights = [base({ deliverOn: '2026-10-26' })];
      const s = service();
      const row = s.comingTo('ent_jenga', Date.parse('2026-10-25T21:30:00Z')).items[0]; // 00:30 on the 26th in Nairobi
      expect(row.due).toEqual({ zone: 'Africa/Nairobi', zoneName: 'East Africa Time', day: '2026-10-26', today: true });
      // The carrier's reading is the tracking link's: the row gives one answer, the place's.
      expect(row.late).toBeUndefined();
      expect(row.expectedAbout).toBeUndefined();
      // Past midnight there again, its day has gone — UTC is still on the 26th.
      expect(s.comingTo('ent_jenga', Date.parse('2026-10-26T21:30:00Z')).items[0].due).toMatchObject({ day: '2026-10-26', today: false, late: 'day' });
      // The evening before, there, it is tomorrow's.
      expect(s.comingTo('ent_jenga', Date.parse('2026-10-25T20:30:00Z')).items[0].due).toMatchObject({ day: '2026-10-26', today: false });
      expect(s.comingTo('ent_jenga', Date.parse('2026-10-25T20:30:00Z')).items[0].due?.late).toBeUndefined();
    });

    it('says about when on the place’s clock once something says the hour, and late when that hour and its grace have passed', () => {
      expectedAt = Date.parse('2026-10-26T10:00:00Z'); // 13:00 in Nairobi
      freights = [base()];
      const s = service();
      expect(s.rowOf(freights[0], Date.parse('2026-10-26T10:20:00Z')).due).toEqual({ zone: 'Africa/Nairobi', zoneName: 'East Africa Time', day: '2026-10-26', about: '13:00', today: true });
      expect(s.rowOf(freights[0], Date.parse('2026-10-26T10:31:00Z')).due).toMatchObject({ about: '13:00', late: 'hour' });
    });

    it('a place in a country of several clocks has none guessed for it — the carrier’s reading stands, as the link shows it', () => {
      freights = [base({ deliverOn: '2026-10-26', destCountry: 'CD' })];
      const row = service().rowOf(freights[0], Date.parse('2026-10-26T10:00:00Z'));
      expect(row.due).toBeUndefined();
      expect(row).toMatchObject({ late: 'day', expectedAbout: '10:40' });
    });

    it('a load from the board with nothing yet saying when it reaches the door has no day, and a delivered one is past being expected', () => {
      freights = [base({ scheduledPickupAt: '2026-10-27T06:00:00Z' }), delivered(undefined, { freightId: 'fr_2' })];
      const [coming, done] = service().comingTo('ent_jenga', Date.parse('2026-10-26T10:00:00Z')).items;
      expect(coming.due).toBeUndefined();
      expect(done.due).toBeUndefined();
    });
  });

  describe('D9 — what stays expected after the handover', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');

    it('keeps a delivered load with packages short or wrong among what is coming, until one of the receiver’s people closes it', () => {
      freights = [
        delivered([{ kind: 'short', count: 3 }, { kind: 'damaged', count: 2, photoRefs: ['med_1'] }, { kind: 'wrong', count: 1 }]),
        delivered([{ kind: 'damaged', count: 1, photoRefs: ['med_2'] }], { freightId: 'fr_clean', deliveredAt: '2026-10-26T11:00:00Z' }),
        base({ freightId: 'fr_coming', deliverOn: '2026-10-27' }),
      ];
      const s = service();
      const before = s.comingTo('ent_jenga', now).items;
      // Still expected: among the open, before what arrived whole — damaged goods came, and stay a claim's business.
      expect(before.map((r) => r.freightId)).toEqual(['fr_1', 'fr_coming', 'fr_clean']);
      expect(before[0]).toMatchObject({ exceptions: [{ kind: 'short', count: 3, photos: 0 }, { kind: 'damaged', count: 2, photos: 1 }, { kind: 'wrong', count: 1, photos: 0 }], stillExpected: 4 });
      expect(before[2]).toMatchObject({ stillExpected: 0 });
      const heard: unknown[] = [];
      events.subscribe(GlosEvent.Pudo.InboundClosed, (e) => void heard.push(e.payload));
      const closed = s.close('ent_jenga', 'fr_1', { how: 'came', note: '  On the next truck  ' }, { name: 'Grace (stores)', did: 'did:person:grace' }, now);
      expect(closed).toMatchObject({ stillExpected: 0, closed: { how: 'came', note: 'On the next truck', by: 'Grace (stores)', at: new Date(now).toISOString() } });
      expect(heard).toEqual([{ freightId: 'fr_1', entityId: 'ent_jenga', how: 'came' }]);
      // Closed, it is with what arrived — the newest first.
      expect(s.comingTo('ent_jenga', now).items.map((r) => r.freightId)).toEqual(['fr_coming', 'fr_clean', 'fr_1']);
    });

    it('closes once, only what is still expected, only the receiver’s own — and says why not', () => {
      freights = [
        delivered([{ kind: 'short', count: 3 }]),
        delivered([{ kind: 'damaged', count: 1, photoRefs: ['med_1'] }, { kind: 'over', count: 2 }], { freightId: 'fr_damaged' }),
        base({ freightId: 'fr_road' }),
        delivered([{ kind: 'short', count: 1 }], { freightId: 'fr_other', receiver: { entityId: 'ent_other', siteId: 's9', name: 'Other', siteName: 'Their yard' } }),
      ];
      const s = service();
      const by = { name: 'Grace (stores)' };
      expect(() => s.close('ent_jenga', 'fr_1', { how: 'lost' as never }, by, now)).toThrow(/came after all, or is not coming/);
      expect(() => s.close('ent_jenga', 'fr_damaged', { how: 'came' }, by, now)).toThrow(/Nothing of this load is still expected/);
      expect(() => s.close('ent_jenga', 'fr_road', { how: 'came' }, by, now)).toThrow(/Nothing of this load is still expected/);
      expect(() => s.close('ent_jenga', 'fr_other', { how: 'came' }, by, now)).toThrow(/Nothing of that is coming in to you/);
      expect(() => s.close('ent_jenga', 'fr_nowhere', { how: 'came' }, by, now)).toThrow(/Nothing of that is coming in to you/);
      s.close('ent_jenga', 'fr_1', { how: 'not_coming' }, by, now);
      expect(() => s.close('ent_jenga', 'fr_1', { how: 'came' }, by, now)).toThrow(/Grace \(stores\) closed this on 2026-10-26/);
    });

    it('what is still expected stays on the list past a fortnight; closed, it goes with the rest of what arrived', () => {
      const later = Date.parse('2026-11-20T12:00:00Z'); // 25 days after delivery
      freights = [delivered([{ kind: 'short', count: 3 }]), delivered([{ kind: 'short', count: 2 }], { freightId: 'fr_closed' })];
      const s = service();
      s.close('ent_jenga', 'fr_closed', { how: 'not_coming' }, { name: 'Grace' }, Date.parse('2026-10-27T08:00:00Z'));
      expect(s.comingTo('ent_jenga', later).items.map((r) => r.freightId)).toEqual(['fr_1']);
    });

    it('says who claims for goods lost on the road — the term says, with none the supplier — and whether the receiver may now', () => {
      freights = [
        delivered(undefined),
        delivered(undefined, { freightId: 'fr_cpt', incoterm: 'CPT' }),
        delivered(undefined, { freightId: 'fr_old', incoterm: 'CPT', deliveredAt: '2026-10-10T09:00:00Z' }),
        delivered(undefined, { freightId: 'fr_claimed', incoterm: 'CPT', claim: { state: 'resolved', kind: 'damaged', description: 'Bent', raisedBy: 'did:ent:jenga', raisedAt: '2026-10-26T10:00:00Z', decision: 'report_only', award: 900, decidedAt: '2026-10-26T10:00:00Z' } }),
        delivered(undefined, { freightId: 'fr_theirs', claim: { state: 'open', kind: 'short', description: 'Three missing', raisedBy: 'did:ent:supplier', raisedAt: '2026-10-26T10:00:00Z' } }),
      ];
      const s = service();
      const row = (id: string) => s.rowOf(freights.find((f) => f.freightId === id)!, now);
      expect(row('fr_1')).toMatchObject({ claimant: 'sender', canClaim: false });
      expect(row('fr_cpt')).toMatchObject({ claimant: 'receiver', canClaim: true, incoterm: 'CPT' });
      expect(row('fr_old')).toMatchObject({ claimant: 'receiver', canClaim: false }); // past the window
      expect(row('fr_claimed')).toMatchObject({ canClaim: false, claim: { kind: 'damaged', by: 'receiver', decision: 'report_only' } });
      expect(JSON.stringify(row('fr_claimed'))).not.toMatch(/award|900/);
      expect(row('fr_theirs').claim).toMatchObject({ kind: 'short', by: 'sender', state: 'open' });
      // Still on the road: nobody claims yet.
      freights = [base({ freightId: 'fr_road', incoterm: 'CPT' })];
      expect(service().rowOf(freights[0], now)).not.toHaveProperty('claimant');
    });

    it('tells the receiver’s bell what was found, and what stays expected until it closes it', async () => {
      freights = [delivered([{ kind: 'short', count: 3 }, { kind: 'damaged', count: 2, photoRefs: ['med_1'] }])];
      service();
      await events.publish(GlosEvent.Pudo.FreightDelivered, { freightId: 'fr_1' });
      await new Promise((r) => setImmediate(r));
      expect(told).toEqual([
        {
          did: 'did:ent:jenga',
          title: 'Order PO-7781 was delivered, not all as the note says',
          body: 'At Mombasa Road yard, received by Peter Otieno. Peter Otieno found 3 packages short, 2 packages damaged: it is on the consignment note. 3 packages stay expected until you close them under Coming in.',
        },
      ]);
    });
  });
});
