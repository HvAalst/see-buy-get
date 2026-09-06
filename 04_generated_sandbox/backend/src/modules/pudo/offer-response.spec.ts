import 'reflect-metadata';
import { buildOfferResponse, bandIndexOf, outcomeOf, FEE_BANDS, MIN_ANSWERS } from './offer-response';
import { Offer, OfferStatus } from './dispatch.types';
import { SbgController } from './pudo.controller';
import { IS_PUBLIC_KEY } from '../../foundation/auth/public.decorator';
import { ROLES_KEY } from '../../foundation/auth/scopes.decorator';

/**
 * The fee-response curve — and mostly, the four ways it refuses to flatter itself.
 *
 * The question underneath it is a colleague's: below what fee does nobody take the hop, because that number
 * decides how dense the node network has to be. It was never answerable, and the reason was never missing
 * data — every offer this network makes already carries what it would pay and what the driver did about it.
 * Nothing read it.
 *
 * What is easy here is the arithmetic. What is hard, and what these tests are almost entirely about, is not
 * turning "we do not know" into a finding: a lapsed offer is not a refusal, two answers are not a rate, and
 * a price nobody was ever offered is not a price nobody wanted.
 */
describe('the fee-response curve', () => {
  let seq = 0;
  const HOUR = 3_600_000;
  const NOW = Date.parse('2026-09-06T12:00:00.000Z');

  /** An offer that paid `earn` and ended `status`. Expired an hour ago unless told otherwise. */
  function offer(earn: number | undefined, status: OfferStatus, over: Partial<Offer> = {}): Offer {
    seq += 1;
    return {
      offerId: `off-${seq}`,
      driverDid: 'did:glos:d1',
      kind: 'freight',
      ref: `frt-${seq}`,
      status,
      earn,
      detourKm: 1,
      message: 'a load',
      createdAt: new Date(NOW - 2 * HOUR).toISOString(),
      expiresAt: new Date(NOW - HOUR).toISOString(),
      ...over,
    } as Offer;
  }

  /** N offers at one price, all ending the same way — enough of them to clear the thinness bar. */
  const many = (n: number, earn: number, status: OfferStatus) => Array.from({ length: n }, () => offer(earn, status));

  describe('placing a fee in a band', () => {
    it('puts a fee in the band it falls in, and the top band is open-ended', () => {
      expect(bandIndexOf(0)).toBe(0);
      expect(bandIndexOf(0.5)).toBe(0);
      expect(bandIndexOf(1)).toBe(1);
      expect(bandIndexOf(4.99)).toBe(2);
      expect(bandIndexOf(5)).toBe(3);
      expect(bandIndexOf(10_000)).toBe(FEE_BANDS.length - 1); // no ceiling to fall off
    });

    it('refuses to place a fee it does not have', () => {
      // An offer we cannot price is not evidence about any price. The bottom band is the tempting place to
      // put it, and it is the wrong one: it would read as cheap work nobody took.
      expect(bandIndexOf(undefined)).toBeNull();
      expect(bandIndexOf(Number.NaN)).toBeNull();
      expect(bandIndexOf(-1)).toBeNull();
    });
  });

  describe('a refusal and a silence are different facts', () => {
    it('reads the clock, not just the stored status', () => {
      // A lapsed offer is only stamped `expired` when something happens to read it — the sweep is lazy. If
      // these figures classified on the status alone they would depend on whether anybody opened the app,
      // which is not a property a measurement is allowed to have.
      const lapsed = offer(10, 'pending', { expiresAt: new Date(NOW - HOUR).toISOString() });
      const live = offer(10, 'pending', { expiresAt: new Date(NOW + HOUR).toISOString() });
      expect(outcomeOf(lapsed, NOW)).toBe('unanswered');
      expect(outcomeOf(live, NOW)).toBe('open');
      expect(outcomeOf(offer(10, 'ignored'), NOW)).toBe('declined');
      expect(outcomeOf(offer(10, 'claimed'), NOW)).toBe('claimed');
    });

    it('never lets a lapsed offer count against the price', () => {
      // THE RULE THIS FILE EXISTS FOR. Nine drivers never answered and one said no. Folding the silence in
      // would report a 10% take-up at this price and send somebody off to redesign the network around it.
      // What actually happened is that one person refused and nine were never heard from.
      const offers = [...many(9, 10, 'expired'), offer(10, 'ignored'), offer(10, 'claimed')];
      const res = buildOfferResponse(offers, NOW);
      const band = res.bands.find((b) => b.from === 10)!;
      expect(band.unanswered).toBe(9);
      expect(band.declined).toBe(1);
      expect(band.answered).toBe(2); // the silence is NOT a denominator
      expect(res.unanswered).toBe(9);
      expect(res.declined).toBe(1);
    });

    it('excludes an offer still in flight from every figure', () => {
      // It has not happened yet. Counted separately so a reader can see what is out there rather than
      // wonder why the totals do not add up to the number of offers made.
      const res = buildOfferResponse([offer(10, 'pending', { expiresAt: new Date(NOW + HOUR).toISOString() })], NOW);
      expect(res.stillOpen).toBe(1);
      expect(res.bands).toEqual([]);
      expect(res.answered).toBe(0);
    });
  });

  describe('a count always rides with a rate', () => {
    it('suppresses the percentage while a band is thin, and says it is thin', () => {
      // A 100% take-up over two offers is a coin toss with a decimal point on it. The counts still show,
      // because hiding the band entirely would be its own kind of lie — there WAS work here.
      const res = buildOfferResponse([offer(3, 'claimed'), offer(3, 'claimed')], NOW);
      const band = res.bands.find((b) => b.from === 2)!;
      expect(band.claimed).toBe(2);
      expect(band.thin).toBe(true);
      expect(band.takeUpPct).toBeUndefined();
    });

    it('reports the rate once there are enough answers to mean something', () => {
      const offers = [...many(MIN_ANSWERS, 3, 'claimed'), ...many(MIN_ANSWERS, 3, 'ignored')];
      const band = buildOfferResponse(offers, NOW).bands.find((b) => b.from === 2)!;
      expect(band.answered).toBe(MIN_ANSWERS * 2);
      expect(band.thin).toBe(false);
      expect(band.takeUpPct).toBe(50);
    });

    it('computes no rate at all over pure silence, however much of it there is', () => {
      // Twenty offers, not one answer. There is no take-up rate here — not 0%, none.
      const band = buildOfferResponse(many(20, 3, 'expired'), NOW).bands.find((b) => b.from === 2)!;
      expect(band.offered).toBe(20);
      expect(band.answered).toBe(0);
      expect(band.takeUpPct).toBeUndefined();
      expect(band.thin).toBe(true);
    });
  });

  describe('a band nobody was offered is absent, not zero', () => {
    it('leaves out a price that was never put to anybody', () => {
      // "We never asked" and "nobody wanted it" are different sentences, and a 0% row is how the first
      // quietly becomes the second in somebody's slide.
      const res = buildOfferResponse([offer(30, 'claimed')], NOW);
      expect(res.bands.map((b) => b.from)).toEqual([20]);
      expect(res.bands.some((b) => b.offered === 0)).toBe(false);
    });

    it('drops an offer whose fee is unknown rather than calling it cheap', () => {
      const res = buildOfferResponse([offer(undefined, 'ignored'), offer(30, 'claimed')], NOW);
      expect(res.bands.map((b) => b.from)).toEqual([20]); // nothing landed in the bottom band
      expect(res.declined).toBe(0);
    });
  });

  describe('the window it actually covers', () => {
    it('reports the real edges of the data, not the period that was asked for', () => {
      // Offers live in memory, so this is usually "since the last restart" rather than the year somebody
      // typed. Reading the edges off the offers is how a reader finds that out for themselves.
      const early = offer(30, 'claimed', { createdAt: new Date(NOW - 48 * HOUR).toISOString() });
      const late = offer(30, 'ignored', { createdAt: new Date(NOW - HOUR).toISOString() });
      const res = buildOfferResponse([late, early], NOW);
      expect(res.observedFrom).toBe(early.createdAt);
      expect(res.observedTo).toBe(late.createdAt);
    });

    it('has no window when it has no data, rather than inventing one', () => {
      const res = buildOfferResponse([], NOW);
      expect(res.observedFrom).toBeUndefined();
      expect(res.observedTo).toBeUndefined();
      expect(res.bands).toEqual([]);
    });
  });

  describe('what it deliberately does not say', () => {
    it('publishes no minimum viable fee, however tempting the shape of the data', () => {
      // The whole point of asking was to get one number. It is not here, and that is the finding: the
      // bands are a legibility choice rather than a natural unit, the window resets when the process does,
      // and a threshold read off that would move every restart. The curve is reported; the reader draws
      // the line, and can see exactly how much data they are drawing it through.
      const offers = [...many(10, 0.5, 'ignored'), ...many(10, 30, 'claimed')];
      const res = buildOfferResponse(offers, NOW) as unknown as Record<string, unknown>;
      expect(res.minimumViableFee).toBeUndefined();
      expect(res.recommendedFee).toBeUndefined();
      // What it does say is where the answers actually were, with the counts beside them.
      expect((res.bands as { from: number; takeUpPct?: number }[]).map((b) => [b.from, b.takeUpPct])).toEqual([
        [0, 0],
        [20, 100],
      ]);
    });
  });
});

/**
 * Who may read the curve — pinned, because it very nearly leaked by accident.
 *
 * Adding this endpoint immediately above `market/series` put its decorators between that method and the
 * `@Public()` belonging to it. Two things went wrong at once and neither was visible in the diff: the
 * public series became gated, and THIS became public. An existing test caught the first half. Nothing
 * would have caught the second, so it is caught here.
 *
 * The distinction is real and worth keeping. The market series is counts and kilometres, given away
 * deliberately as the moat. This is how the labour market answers a price — the sort of figure that sets
 * what an independent operator can bargain for, and it is nobody's business but the operator's.
 */
describe('who may read the curve', () => {
  it('is operator-gated, and pointedly not public like the series beside it', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype.offerResponse)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.offerResponse)).toEqual(['operator']);
  });

  it('leaves the market series public, which is the half that broke', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype.marketSeries)).toBe(true);
  });
});
