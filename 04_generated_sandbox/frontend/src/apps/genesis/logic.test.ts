import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  LADDER,
  cleanPhone,
  coverLine,
  disputeOutcomeWords,
  followLanding,
  codeReady,
  dimsBlocker,
  isOffLadder,
  journeyLine,
  ladderIndex,
  lockedPrice,
  mintTaxLine,
  taxLine,
  mapsHref,
  mintChecklist,
  money,
  normalizeKey,
  parcelRowLine,
  parseDims,
  phoneBlocker,
  phoneReady,
  pinBlocker,
  pointDistance,
  pointLine,
  quoteSummary,
  reputationLine,
  servingSince,
  sizeMeta,
  relationWord,
  roleMeta,
  selectablePoints,
  sendWorkLine,
  showCollectCard,
  sortForPerson,
  statusPresentation,
  stepTime,
  dayWords,
  expectedLine,
  trackSummary,
  carrierLine,
  freightLadder,
  freightLadderIndex,
  freightStatusPresentation,
  freightWithdrawnLine,
  freightTrackSummary,
} from './logic';
import type { ConsumerParcelView, FreightTrackView, NetworkPoint, QuoteView, TrackView } from './types';
import { isFreightTrack } from './types';

const point = (over: Partial<NetworkPoint> = {}): NetworkPoint => ({
  did: 'did:a',
  shopName: 'Mama Njeri',
  zone: 'Z-A',
  openState: 'open',
  pricePerParcel: 1.5,
  ...over,
});

const quote = (over: Partial<QuoteView> = {}): QuoteView => ({
  hops: [
    { type: 'pudo', id: 'a', label: 'Mama Njeri' },
    { type: 'mdp', id: 'm', label: 'Central hub' },
    { type: 'pudo', id: 'b', label: 'Riverside' },
  ],
  nodes: [],
  legs: [],
  totalKm: 12.4,
  nodeFees: 2,
  size: 'M',
  perKm: { min: 0.2, max: 0.5 },
  platformFeePct: 10,
  // Untaxed, which is every sister until an operator says otherwise: gross IS the net, to the cent.
  flexible: { transport: 4, base: 6, total: 6.6, tax: 0, gross: 6.6 },
  locked: { transport: 2, base: 4, total: 4.4, tax: 0, gross: 4.4 },
  ...over,
});

describe('selectablePoints', () => {
  it('excludes the origin, puts open shops first, then A→Z', () => {
    const pts = [
      point({ did: 'z', shopName: 'Zed', openState: 'closed' }),
      point({ did: 'b', shopName: 'Bees' }),
      point({ did: 'a', shopName: 'Apex' }),
      point({ did: 'x', shopName: 'Excluded' }),
    ];
    expect(selectablePoints(pts, 'x').map((p) => p.shopName)).toEqual(['Apex', 'Bees', 'Zed']);
    expect(selectablePoints(null)).toEqual([]);
    // A shop that takes no new parcels is not offered at all — open or not. One that does not say is offered as before.
    expect(selectablePoints([...pts, point({ did: 'h', shopName: 'Held', takesNew: false }), point({ did: 'n', shopName: 'Named', takesNew: true })], 'x').map((p) => p.shopName)).toEqual(['Apex', 'Bees', 'Named', 'Zed']);
  });

  it('with a reference point (typed place words), open shops sort nearest-first with a distance label', () => {
    const near = { lat: -1.3, lng: 36.84 };
    const pts = [
      point({ did: 'far', shopName: 'Far', location: { lat: -1.2, lng: 36.7 } }),
      point({ did: 'close', shopName: 'Close', location: { lat: -1.301, lng: 36.841 } }),
      point({ did: 'nowhere', shopName: 'NoPin' }),
    ];
    expect(selectablePoints(pts, undefined, near).map((p) => p.did)).toEqual(['close', 'far', 'nowhere']);
    expect(pointDistance(pts[1], near)).toContain('m away');
    expect(pointDistance(pts[2], near)).toBeNull();
  });

  it('pointLine folds zone, landmark, price and rating into one sentence', () => {
    expect(pointLine(point({ landmark: 'By the mosque', rating: { count: 12, average: 4.62 } }), t)).toBe(
      'Zone Z-A · By the mosque · 1.50 handling · rated 4.6',
    );
    expect(pointLine(point(), t)).toBe('Zone Z-A · 1.50 handling');
  });
});

describe('REP1 reputation display', () => {
  it('pointLine drops the average chip for a lone/cold-start review (isNew), keeps it once reliable', () => {
    expect(pointLine(point({ rating: { count: 1, average: 5, isNew: true } }), t)).toBe('Zone Z-A · 1.50 handling'); // no chip from one review
    expect(pointLine(point({ rating: { count: 40, average: 4.5, isNew: false } }), t)).toBe('Zone Z-A · 1.50 handling · rated 4.5');
  });

  it('reputationLine is honest about the cold start (never a headline average from one review)', () => {
    expect(reputationLine(null, t)).toBe('New — no ratings yet');
    expect(reputationLine({ count: 0, average: 0, isNew: true }, t)).toBe('New — no ratings yet');
    expect(reputationLine({ count: 1, average: 5, isNew: true }, t)).toBe('New — 1 rating so far');
    expect(reputationLine({ count: 2, average: 4.5, isNew: true }, t)).toBe('New — 2 ratings so far');
    expect(reputationLine({ count: 12, average: 4.62, isNew: false }, t)).toBe('Rated 4.6 by 12');
  });

  it('servingSince renders the UTC year (tz-stable), or null when unknown/unparseable', () => {
    expect(servingSince('2026-03-09T10:00:00.000Z', t)).toBe('Serving since 2026');
    // A late-December UTC instant reads the SAME year everywhere — not the next year for a viewer east of UTC.
    expect(servingSince('2025-12-31T23:30:00.000Z', t)).toBe('Serving since 2025');
    expect(servingSince(undefined, t)).toBeNull();
    expect(servingSince('not-a-date', t)).toBeNull();
  });
});

describe('quote presentation', () => {
  it('the ONE price shown is the locked (cheapest) leg — what a booked send actually costs', () => {
    expect(lockedPrice(quote(), t).total).toBe(4.4);
  });

  it('shows the GROSS, because that is the cash handed over at the shop', () => {
    // The figure on the card is the figure the mint consents against and the counter collects. Showing the
    // net would advertise one price and take another the moment any sister charges tax.
    const taxed = quote({ locked: { transport: 2, base: 4, total: 4.4, tax: 0.7, gross: 5.1 }, tax: { ratePct: 0.16, label: 'VAT' } });
    expect(lockedPrice(taxed, t).total).toBe(5.1);
    expect(quoteSummary(taxed, t)).toContain('5.10');
  });

  it('names the tax inside the price, and says nothing at all when there is none', () => {
    // "Includes", never "plus" — the price already contains it. And a line reading zero is noise on a
    // receipt: an untaxed sale shows a price, full stop.
    const taxed = quote({ locked: { transport: 2, base: 4, total: 4.4, tax: 0.7, gross: 5.1 }, tax: { ratePct: 0.16, label: 'VAT' } });
    expect(taxLine(taxed, t)).toBe('Includes VAT 0.70');
    expect(taxLine(quote(), t)).toBeNull();
    // A sister that charges but never named its tax still gets an honest word for it.
    expect(taxLine(quote({ locked: { transport: 2, base: 4, total: 4.4, tax: 0.7, gross: 5.1 } }), t)).toBe('Includes tax 0.70');
  });

  it('says what is covered — and says it plainly when nothing is', () => {
    // The only line on the price card about things going wrong, and it must speak in BOTH directions:
    // "we did not mention it" is not a thing anybody should discover after their parcel is broken.
    expect(coverLine(quote({ insurance: { premiumPct: 0.02, freeLimit: 5000 } }), t)).toBe('Covered up to 5000.00 if it is damaged or lost');
    expect(coverLine(quote({ insurance: { premiumPct: 0, freeLimit: 0 } }), t)).toBe('Not covered against damage or loss');
    expect(coverLine(quote(), t)).toBe('Not covered against damage or loss'); // a quote from before cover existed
  });

  it('reads a receipt’s tax off the PARCEL, so it survives a rate change', () => {
    expect(mintTaxLine({ tax: 0.7, taxLabel: 'VAT' }, t)).toBe('Includes VAT 0.70');
    expect(mintTaxLine({ tax: 0 }, t)).toBeNull();
    expect(mintTaxLine({}, t)).toBeNull(); // a parcel minted before tax existed carried none
  });

  it('journeyLine names every hop', () => {
    expect(journeyLine(quote())).toBe('Mama Njeri → Central hub → Riverside');
  });

  it('quoteSummary speaks distance, stops and the price', () => {
    expect(quoteSummary(quote(), t)).toBe('12 kilometres across 3 stops. The price is 4.40.');
  });
});

describe('dims (PG3)', () => {
  it('parses only a complete, positive set of measurements', () => {
    expect(parseDims({ l: '30', w: '20', h: '10', kg: '1.6' })).toEqual({ l: 30, w: 20, h: 10, kg: 1.6 });
    expect(parseDims({ l: '30', w: '20', h: '', kg: '1.6' })).toBeNull(); // missing
    expect(parseDims({ l: '-30', w: '20', h: '10', kg: '1.6' })).toBeNull(); // a truthy negative must NOT slip through
    expect(parseDims({ l: '30', w: '20', h: '10', kg: '0' })).toBeNull(); // weightless
  });

  it('accepts a thin item (a letter at 0.5 cm) and a decimal comma, down to the 1 mm floor', () => {
    expect(parseDims({ l: '21', w: '10', h: '0.5', kg: '0.02' })).toEqual({ l: 21, w: 10, h: 0.5, kg: 0.02 }); // a letter
    expect(parseDims({ l: '21', w: '10', h: '0,5', kg: '0,02' })).toEqual({ l: 21, w: 10, h: 0.5, kg: 0.02 }); // European comma
    expect(parseDims({ l: '30', w: '20', h: '0.1', kg: '1' })).toEqual({ l: 30, w: 20, h: 0.1, kg: 1 }); // exactly the floor
    expect(parseDims({ l: '30', w: '20', h: '0.05', kg: '1' })).toBeNull(); // below the 1 mm floor
  });

  it('dimsBlocker gates the Continue in plain words', () => {
    expect(dimsBlocker({ l: '', w: '', h: '', kg: '' }, t)).toContain('Measure the parcel');
    expect(dimsBlocker({ l: '30', w: '20', h: '10', kg: '1.6' }, t)).toBe('');
  });

  it('sizeMeta gives the derived tier its plain words', () => {
    expect(sizeMeta('M', t).label).toBe('Medium');
    expect(sizeMeta('HEAVY', t).hint).toBe('Over 20 kg');
  });

  it('mintChecklist tells the sender the three things that matter', () => {
    const items = mintChecklist('Mama Njeri', 4.4, t);
    expect(items[0]).toContain('Mama Njeri');
    expect(items[1]).toContain('4.40');
    expect(items).toHaveLength(3);
  });
});

describe('track', () => {
  it('normalizeKey survives scanners and thumbs', () => {
    expect(normalizeKey('  t-9f3a ')).toBe('T-9F3A');
  });

  it('the ladder covers the happy path in order; the two failure states sit off it', () => {
    expect(LADDER).toEqual(['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Delivered']);
    expect(ladderIndex('On_Bus')).toBe(2);
    expect(ladderIndex('Disputed')).toBe(-1);
  });

  it('every status has plain words and a drawable icon', () => {
    for (const s of [...LADDER, 'Disputed', 'Voided'] as const) {
      const p = statusPresentation(s, t);
      expect(p.word.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
    }
    expect(statusPresentation('Ready_For_Pickup', t)).toEqual({ word: 'Ready to collect', icon: 'box', tone: 'ok' });
    // Not "expired" and not "overdue": nothing has expired, the parcel is still there and still theirs.
    expect(statusPresentation('Unclaimed', t)).toEqual({ word: 'Waiting for you', icon: 'clock', tone: 'danger' });
  });

  it('trackSummary names the destination only once the parcel is there', () => {
    const mkTrack = (status: TrackView['status']): TrackView => ({
      ref: 'P-1',
      status,
      size: 'M',
      destination: 'Riverside',
      destZone: 'Z-B',
      steps: [],
    });
    expect(trackSummary(mkTrack('On_Bus'), t)).toBe('Parcel P-1: on the bus.');
    expect(trackSummary(mkTrack('Ready_For_Pickup'), t)).toBe('Parcel P-1: ready to collect at Riverside.');
  });

  it('says when a load is expected: the day always, and about when only where the page was given an hour', () => {
    expect(expectedLine({}, t, 'en-GB')).toBeNull();
    expect(expectedLine({ expectedOn: '2026-10-22' }, t, 'en-GB')).toBe('Expected on Thursday 22 October.');
    expect(expectedLine({ expectedOn: '2026-10-22', expectedAbout: '10:40' }, t, 'en-GB')).toBe('Expected on Thursday 22 October. It is on the road, and its carrier planned to be at the door about 10:40. That is an estimate.');
    // An hour with no day is not a thing the page was told: it says nothing rather than half of it.
    expect(expectedLine({ expectedAbout: '10:40' }, t, 'en-GB')).toBeNull();
  });

  it('stops saying "expected" of a day that is over, and says an hour that has passed only where the hour is on the page', () => {
    expect(expectedLine({ expectedOn: '2026-10-22', late: 'day' }, t, 'en-GB')).toBe('It was expected on Thursday 22 October and has not arrived yet.');
    expect(expectedLine({ expectedOn: '2026-10-22', expectedAbout: '10:40', late: 'day' }, t, 'en-GB')).toBe('It was expected on Thursday 22 October and has not arrived yet.');
    expect(expectedLine({ expectedOn: '2026-10-22', expectedAbout: '10:40', late: 'hour' }, t, 'en-GB')).toBe('Expected on Thursday 22 October. It is on the road, and it is running late: its carrier planned to be at the door about 10:40, and that time has passed.');
    // An hour said to have passed with no hour given: the page says the day and nothing it was not told.
    expect(expectedLine({ expectedOn: '2026-10-22', late: 'hour' }, t, 'en-GB')).toBe('Expected on Thursday 22 October.');
  });

  it('reads the day aloud with the rest: whoever listens is waiting at the same door', () => {
    const load = { kind: 'freight', ref: 'FRT-018', status: 'in_transit', description: 'Bricks', weightKg: 3000, pickupLabel: 'Jenga yard', destLabel: 'Riverside Corner', steps: [] } as FreightTrackView;
    expect(freightTrackSummary(load, t, 'en-GB')).toBe('Load FRT-018: on the road, going to Riverside Corner.');
    expect(freightTrackSummary({ ...load, status: 'ordered', expectedOn: '2026-10-22' }, t, 'en-GB')).toBe('Load FRT-018: ordered with the carrier, going to Riverside Corner. Expected on Thursday 22 October.');
    expect(freightTrackSummary({ ...load, expectedOn: '2026-10-22', expectedAbout: '10:40' }, t, 'en-GB')).toBe(
      'Load FRT-018: on the road, going to Riverside Corner. Expected on Thursday 22 October. It is on the road, and its carrier planned to be at the door about 10:40. That is an estimate.',
    );
  });

  it('says a day as somebody says it, the same day in every time zone, and leaves alone what is not one', () => {
    expect(dayWords('2026-10-22', 'en-GB')).toBe('Thursday 22 October');
    expect(dayWords('2026-01-01', 'en-GB')).toBe('Thursday 1 January');
    expect(dayWords('soon', 'en-GB')).toBe('soon');
    expect(dayWords('', 'en-GB')).toBe('');
  });

  it('stepTime falls back to the raw string on garbage', () => {
    expect(stepTime('not-a-date')).toBe('not-a-date');
    expect(money(4.4)).toBe('4.40');
  });

  it('the collect card shows only when a receiver can act, and the way link needs a pin', () => {
    expect(showCollectCard('Ready_For_Pickup')).toBe(true);
    expect(showCollectCard('Delivered')).toBe(true);
    expect(showCollectCard('On_Bus')).toBe(false);
    expect(mapsHref({ destination: 'Riverside', destinationLocation: { lat: -1.3, lng: 36.84 } })).toBe(
      'https://www.google.com/maps?q=-1.3%2C36.84',
    );
    expect(mapsHref({ destination: 'Riverside' })).toBeNull();
  });
});

describe('Send app — identity + my-parcels logic (S21)', () => {
  it('cleans a typed phone to digits + a single leading plus', () => {
    expect(cleanPhone('  0712 345 678 ')).toBe('0712345678');
    expect(cleanPhone('+254 (712) 345-678')).toBe('+254712345678');
    expect(cleanPhone('++12ab34')).toBe('+1234');
  });

  it('gates the phone and PIN CTAs on readiness', () => {
    expect(phoneReady('0712345678')).toBe(true);
    expect(phoneReady('12345')).toBe(false);
    expect(phoneBlocker('0712345678', t)).toBe('');
    expect(phoneBlocker('123', t)).toMatch(/phone/i);
    expect(codeReady('1234', 4)).toBe(true);
    expect(codeReady('123', 4)).toBe(false);
    expect(codeReady('123456', 6)).toBe(true);
    expect(codeReady('12a4', 4)).toBe(false);
    // A PIN is five digits: four — the old length, and a mobile-money PIN's — is not one.
    expect(pinBlocker('48261', t)).toBe('');
    expect(pinBlocker('4826', t)).toMatch(/5-digit PIN/);
    expect(pinBlocker('482619', t)).toMatch(/PIN/);
    expect(pinBlocker('12', t)).toMatch(/PIN/);
  });

  it('gives every role a plain label + a real icon name', () => {
    expect(roleMeta('consumer', t).label).toBe('You');
    expect(roleMeta('driver', t).icon).toBe('truck');
    expect(roleMeta('fleet_manager', t).label).toBe('Fleet');
  });

  it('describes a parcel from the person\'s side', () => {
    expect(relationWord('received', t)).toMatch(/you/i);
    expect(relationWord('sent', t)).toMatch(/sending/i);
    const recv = mkParcel({ relation: 'received', originZone: 'NorthTown', vendorOrder: true });
    expect(parcelRowLine(recv, t)).toBe('From NorthTown · Store order');
    const sent = mkParcel({ relation: 'sent', destZone: 'EastTown', vendorOrder: false });
    expect(parcelRowLine(sent, t)).toBe('To EastTown · Personal send');
  });

  it('sorts a person\'s parcels: act-now first, then in-flight, then done — newest within each', () => {
    const list = [
      mkParcel({ parcelId: 'DONE', status: 'Delivered', updatedAt: '2026-07-20T10:00:00Z' }),
      mkParcel({ parcelId: 'FLYING', status: 'On_Bus', updatedAt: '2026-07-21T10:00:00Z' }),
      mkParcel({ parcelId: 'READY', status: 'Ready_For_Pickup', updatedAt: '2026-07-19T10:00:00Z' }),
      mkParcel({ parcelId: 'FLYING2', status: 'At_MDP', updatedAt: '2026-07-22T10:00:00Z' }),
    ];
    expect(sortForPerson(list).map((p) => p.parcelId)).toEqual(['READY', 'FLYING2', 'FLYING', 'DONE']);
  });

  it('marks cancelled/disputed parcels as off the ladder', () => {
    expect(isOffLadder('Voided')).toBe(true);
    expect(isOffLadder('Disputed')).toBe(true);
    expect(isOffLadder('On_Bus')).toBe(false);
  });
});

function mkParcel(over: Partial<ConsumerParcelView>): ConsumerParcelView {
  return {
    parcelId: 'P-1',
    relation: 'sent',
    direction: 'outbound',
    status: 'At_PUDO',
    originZone: 'A',
    destZone: 'B',
    size: 'M',
    vendorOrder: false,
    createdAt: '2026-07-20T09:00:00Z',
    updatedAt: '2026-07-20T09:00:00Z',
    timeline: [],
    ...over,
  };
}

/**
 * A closed collection window, from the receiver's side.
 *
 * Every case here is the same assertion wearing a different hat: the terms changed, the parcel did NOT
 * move, and nothing about the app's behaviour may suggest it has been taken away.
 */
describe('a parcel whose collection window has closed', () => {
  it('still shows the collect card, which is the whole point', () => {
    // Telling somebody to come and collect while hiding what opens the door is not a notice, it is a taunt.
    expect(showCollectCard('Unclaimed')).toBe(true);
  });

  it('sits ON the ready rung rather than falling off the ladder', () => {
    // Off the ladder means cancelled or disputed in this app, and a parcel a person can still walk in
    // and collect does not belong with either.
    expect(ladderIndex('Unclaimed')).toBe(LADDER.indexOf('Ready_For_Pickup'));
    expect(isOffLadder('Unclaimed')).toBe(false);
  });

  it('sorts above everything, including a parcel that is merely ready', () => {
    // It is the only kind of parcel in this list that is costing the reader money by sitting there.
    const list = [
      mkParcel({ parcelId: 'READY', status: 'Ready_For_Pickup', updatedAt: '2026-07-20T10:00:00Z' }),
      mkParcel({ parcelId: 'LATE', status: 'Unclaimed', updatedAt: '2026-07-01T10:00:00Z' }),
    ];
    expect(sortForPerson(list).map((p) => p.parcelId)).toEqual(['LATE', 'READY']);
  });

  it('gets its own line in the top bar rather than being counted as ready', () => {
    // "1 to collect" and "1 waiting past its date" ask a person to do the same thing with very different
    // urgency, and folding them together loses exactly the part that would make somebody get up.
    const parcels = { sent: [], received: [{ status: 'Unclaimed' }, { status: 'Ready_For_Pickup' }] };
    expect(sendWorkLine(parcels as never, t)).toBe('1 parcel waiting past its date');
  });
});

describe('FP6 — a load on the tracking page', () => {
  const view = (status: FreightTrackView['status'], over: Partial<FreightTrackView> = {}): FreightTrackView => ({ kind: 'freight', ref: 'FRT-018', status, description: 'Crates', weightKg: 6, pickupLabel: 'Mama Sarah Shop', destLabel: 'Riverside Corner', steps: [], ...over });

  it('tells a load from a parcel by its kind, and climbs its own ladder', () => {
    expect(isFreightTrack(view('claimed'))).toBe(true);
    expect(isFreightTrack({ ref: 'p', status: 'Created', size: 'S', destination: 'x', destZone: 'z', steps: [] })).toBe(false);
    expect(freightLadderIndex('scheduled')).toBe(0);
    expect(freightLadderIndex('in_transit')).toBe(2);
    expect(freightLadderIndex('cancelled')).toBe(-1);
  });

  it('says the carrier as the receiver will meet them, and nothing when none is booked', () => {
    expect(carrierLine(undefined, t)).toBeNull();
    expect(carrierLine({ name: 'Kilima Logistics', driverName: 'Amos K.', plate: 'KLM 002B', vehicleClass: 'bike' }, t)).toBe('Kilima Logistics · Amos K., in a bike KLM 002B');
    expect(carrierLine({ name: 'Amos K.', driverName: 'Amos K.' }, t)).toBe('Amos K.');
    expect(freightTrackSummary(view('in_transit'), t)).toBe('Load FRT-018: on the road, going to Riverside Corner.');
  });

  it('reads space on a run as booked from the start — it never waited for a carrier', () => {
    const run = view('claimed', { on: 'run', ref: 'Nairobi–Mombasa' });
    expect(freightLadder(run)).toEqual(['claimed', 'in_transit', 'delivered']);
    expect(freightLadderIndex('claimed', freightLadder(run))).toBe(0);
    expect(freightLadder(view('claimed'))).toContain('available');
    expect(freightStatusPresentation('claimed', t, 'run').word).toBe('Booked on the run');
    expect(freightStatusPresentation('claimed', t).word).toBe('A carrier has it booked');
    expect(freightTrackSummary(run, t)).toBe('Space on a run: booked on the run, going to Riverside Corner.');
  });

  it('reads an order under a contract as with its carrier from the start', () => {
    const ordered = view('ordered', { steps: [{ status: 'ordered', at: 'x' }] });
    expect(freightLadder(ordered)).toEqual(['ordered', 'claimed', 'in_transit', 'delivered']);
    expect(freightLadderIndex('ordered', freightLadder(ordered))).toBe(0);
    expect(freightStatusPresentation('ordered', t).word).toBe('Ordered with the carrier');
    expect(freightLadder(view('available', { steps: [{ status: 'available', at: 'x' }] }))).toContain('available');
  });

  it('says who withdrew it, the carrier included, and never why', () => {
    expect(freightWithdrawnLine({ at: 'x', by: 'carrier' }, t)).toBe('The carrier called this off on x.');
    expect(freightWithdrawnLine({ at: 'x', by: 'sender' }, t)).toBe('The sender withdrew this load on x.');
    expect(freightWithdrawnLine({ at: 'x', by: 'network' }, t)).toBe('The network withdrew this load on x.');
  });
});

/**
 * /send/?follow=1 — a buyer who followed the invitation under a price in a store's checkout widget.
 *
 * They land on My parcels; what stands in front of it is whatever this device needs, and the one sentence about the
 * shop's number is shown only to somebody who still has to say who they are.
 */
describe('followLanding — arriving from a store’s checkout', () => {
  const nobody = { session: false, knownPhone: false };
  it('is nothing without the link, whatever else the address carries', () => {
    expect(followLanding('', nobody)).toBeNull();
    expect(followLanding('?track=T-1234', nobody)).toBeNull();
    expect(followLanding('?invite=abc&parcel=PUD-1', nobody)).toBeNull();
  });
  it('somebody new is taken to signing up, and told which number', () => {
    expect(followLanding('?follow=1', nobody)).toEqual({ following: true, authMode: 'enroll' });
    // The link is its own word: no value, or beside other things, it still means the same.
    expect(followLanding('?follow', nobody)).toEqual({ following: true, authMode: 'enroll' });
    expect(followLanding('?utm_source=shop&follow=1', nobody)).toEqual({ following: true, authMode: 'enroll' });
  });
  it('a device that remembers a number is asked for its PIN, not to sign up again', () => {
    expect(followLanding('?follow=1', { session: false, knownPhone: true })).toEqual({ following: true, authMode: 'login' });
  });
  it('somebody already signed in goes straight to their parcels: no sign-in is touched, nothing is explained', () => {
    expect(followLanding('?follow=1', { session: true, knownPhone: true })).toEqual({ following: false });
    expect(followLanding('?follow=1', { session: true, knownPhone: false })).toEqual({ following: false });
  });
});

describe('how a reported problem ended, said to whoever is reading', () => {
  const cash = (amount: number, currency?: string) => `${currency ?? ''} ${amount.toFixed(2)}`.trim();

  it('tells the receiver it was upheld, why, and that the award went to the store they bought from', () => {
    const said = disputeOutcomeWords({ decision: 'upheld', note: 'Crushed on our van.', award: 40, currency: 'KES', paidTo: 'store' }, 'received', cash, t);
    expect(said).toEqual({ tone: 'ok', title: 'Your report was upheld', lines: ['Crushed on our van.', 'KES 40.00 was paid to the store you bought from, because the store is who shipped it with us. Ask the store about your refund.'] });
  });

  it('tells a walk-up sender the award is owed to THEM, and the receiver that it is the sender’s', () => {
    const outcome = { decision: 'partly_upheld' as const, note: 'The lid cracked in our hands.', award: 3, currency: 'KES', paidTo: 'sender' as const };
    expect(disputeOutcomeWords(outcome, 'sent', cash, t)).toEqual({ tone: 'ok', title: 'The receiver’s report was upheld in part', lines: ['The lid cracked in our hands.', 'KES 3.00 is owed to you, because you paid for the shipment. It is paid outside the app.'] });
    expect(disputeOutcomeWords(outcome, 'received', cash, t).lines[1]).toBe('KES 3.00 is owed to the sender, who paid for the shipment. Settle it with them.');
    expect(disputeOutcomeWords(outcome, 'received', cash, t).title).toBe('Your report was upheld in part');
  });

  it('a rejection gives the reason and names no money', () => {
    const said = disputeOutcomeWords({ decision: 'rejected', note: 'The seal is unbroken in your own photograph.' }, 'received', cash, t);
    expect(said).toEqual({ tone: 'warn', title: 'Your report was not upheld', lines: ['The seal is unbroken in your own photograph.'] });
    expect(disputeOutcomeWords({ decision: 'rejected', note: 'No damage is visible.' }, 'sent', cash, t).title).toBe('The receiver’s report was not upheld');
    // An award of nothing is not an award.
    expect(disputeOutcomeWords({ decision: 'rejected', note: 'No.', award: 0, paidTo: 'sender' }, 'sent', cash, t).lines).toEqual(['No.']);
  });

  it('a problem the SHOP raised at its counter is nobody’s “your report” — and not upheld, it is no bad news', () => {
    const fine = { origin: 'counter' as const, decision: 'rejected' as const, note: 'The tear is in the outer wrap only.' };
    expect(disputeOutcomeWords(fine, 'received', cash, t)).toEqual({ tone: 'ok', title: 'The shop reported a problem, and it was not upheld', lines: ['The tear is in the outer wrap only.'] });
    expect(disputeOutcomeWords(fine, 'sent', cash, t).title).toBe('The shop reported a problem, and it was not upheld');
    const broken = { origin: 'counter' as const, decision: 'upheld' as const, note: 'Cracked in our hands.', award: 3, currency: 'KES', paidTo: 'sender' as const };
    expect(disputeOutcomeWords(broken, 'received', cash, t)).toEqual({ tone: 'ok', title: 'The shop’s report of a problem was upheld', lines: ['Cracked in our hands.', 'KES 3.00 is owed to the sender, who paid for the shipment. Settle it with them.'] });
    expect(disputeOutcomeWords({ ...broken, decision: 'partly_upheld' }, 'sent', cash, t).title).toBe('The shop’s report of a problem was upheld in part');
    // A report filed from the app is still the receiver's own.
    expect(disputeOutcomeWords({ ...fine, origin: 'buyer' }, 'received', cash, t)).toMatchObject({ tone: 'warn', title: 'Your report was not upheld' });
  });

  it('says where the money went to the store’s buyer and to its sender in different words', () => {
    const outcome = { decision: 'upheld' as const, note: 'Ours.', award: 10, currency: 'KES', paidTo: 'store' as const };
    expect(disputeOutcomeWords(outcome, 'sent', cash, t).lines[1]).toBe('KES 10.00 was paid to the store that shipped it.');
  });
});

describe('a reported problem that nobody of ours decides: the report, said to whoever is reading', () => {
  const cash = (amount: number, currency?: string) => `${currency ?? ''} ${amount.toFixed(2)}`.trim();
  const made = (origin: 'buyer' | 'counter') => ({ origin, decision: 'report_only' as const, note: 'No company of the network decides a claim on this parcel or pays one.' });

  it('tells the receiver their problem is on record and that the report is theirs, below', () => {
    expect(disputeOutcomeWords(made('buyer'), 'received', cash, t)).toEqual({
      tone: 'info',
      title: 'Your problem is recorded, and a damage claim report was made',
      lines: ['SeeBuyGet does not judge a claim or pay one. The report is below: it is yours to keep, and to hand to an insurer or to whoever answers for the goods.'],
    });
  });

  it('tells the sender that the receiver reported it, and who holds the report', () => {
    expect(disputeOutcomeWords(made('buyer'), 'sent', cash, t)).toEqual({
      tone: 'info',
      title: 'The receiver reported a problem, and a damage claim report was made',
      lines: ['SeeBuyGet does not judge a claim or pay one. The report was made for the receiver: ask them to pass it on if you need it for a claim.'],
    });
  });

  it('says it was the shop that reported it, to both, when it was — and the report is still the receiver’s', () => {
    expect(disputeOutcomeWords(made('counter'), 'received', cash, t)).toMatchObject({ tone: 'info', title: 'The shop reported a problem, and a damage claim report was made' });
    expect(disputeOutcomeWords(made('counter'), 'received', cash, t).lines[0]).toMatch(/The report is below/);
    expect(disputeOutcomeWords(made('counter'), 'sent', cash, t).lines[0]).toMatch(/made for the receiver/);
  });

  it('says nothing was upheld, refused or owed: nobody judged anything, and the record’s own note is not shown as a reason', () => {
    for (const relation of ['sent', 'received'] as const) {
      const said = disputeOutcomeWords({ ...made('buyer'), award: 40, currency: 'KES', paidTo: 'sender' }, relation, cash, t);
      expect(`${said.title} ${said.lines.join(' ')}`).not.toMatch(/upheld|owed|paid to|40|No company of the network/);
      expect(said.lines).toHaveLength(1);
    }
  });
});
