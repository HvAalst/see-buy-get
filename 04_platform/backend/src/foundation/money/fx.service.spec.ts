import { FX_BASE, FX_RATE_MAX_AGE_H, FxService } from './fx.service';

describe('the rate book', () => {
  let fx: FxService;

  beforeEach(() => {
    fx = new FxService(); // no dependencies: a rate book needs nothing but rates
    fx.seed();
  });

  it('seeds one rate per currency, against the base', () => {
    expect(fx.point('KES')?.perBase).toBe(129.0);
    expect(fx.point(FX_BASE)?.perBase).toBe(1);
    expect(fx.rates().every((p) => p.source === 'seed' && p.perBase > 0)).toBe(true);
  });

  it('never overwrites a rate that is already there — a seed is the oldest thing in the book', () => {
    fx.setRate('KES', 131.5, 'central-bank');
    fx.seed();
    expect(fx.point('KES')?.perBase).toBe(131.5);
    expect(fx.point('KES')?.source).toBe('central-bank');
  });

  it('derives a cross-rate through the base, and the two directions undo each other', () => {
    const there = fx.rateFor('ETB', 'KES');
    const back = fx.rateFor('KES', 'ETB');
    expect(there.rate).toBeCloseTo(129.0 / 118.5, 9);
    expect(there.via).toBe('USD');
    expect(there.rate * back.rate).toBeCloseTo(1, 9);
  });

  it('answers a same-currency ask with an identity rate rather than a refusal', () => {
    // A caller converting a whole route should not have to know in advance which stops are foreign.
    expect(fx.rateFor('KES', 'KES')).toMatchObject({ rate: 1, source: 'identity', stale: false });
    expect(fx.convert(12.34, 'KES', 'KES')).toBe(12.34);
  });

  it('converts to the cent, and refuses an amount that is not one', () => {
    expect(fx.convert(60, 'ETB', 'KES')).toBe(65.32); // 60 × 129.0/118.5 = 65.3164…
    expect(fx.convert(0, 'ETB', 'KES')).toBe(0);
    expect(() => fx.convert(Number.NaN, 'ETB', 'KES')).toThrow(/Cannot convert/);
  });

  it('refuses a currency it has never heard of, by name', () => {
    expect(() => fx.rateFor('KES', 'XOF')).toThrow(/No exchange rate for XOF/);
    expect(() => fx.rateFor('XOF', 'KES')).toThrow(/No exchange rate for XOF/);
  });

  it('refuses a rate that is not a positive number', () => {
    expect(() => fx.setRate('KES', 0)).toThrow(/positive number/);
    expect(() => fx.setRate('KES', -3)).toThrow(/positive number/);
    expect(() => fx.setRate('KES', Number.NaN)).toThrow(/positive number/);
    expect(() => fx.setRate('', 5)).toThrow(/Name the currency/);
    expect(fx.setRate(' etb ', 120).currency).toBe('ETB'); // normalised, like every other code in the system
  });

  it('is only as fresh as its stalest leg — refreshing one side does not make a derived rate new', () => {
    jest.useFakeTimers({ now: new Date('2026-08-01T00:00:00Z') });
    try {
      const book = new FxService();
      book.seed();
      expect(book.rateFor('ETB', 'KES').stale).toBe(false);

      jest.setSystemTime(new Date(Date.UTC(2026, 7, 1) + (FX_RATE_MAX_AGE_H + 1) * 3_600_000));
      expect(book.rateFor('ETB', 'KES').stale).toBe(true);

      // One leg comes back from the feed. The cross-rate still stands on the other one, and says so.
      book.setRate('ETB', 118.5, 'central-bank');
      const rate = book.rateFor('ETB', 'KES');
      expect(rate.stale).toBe(true);
      expect(rate.at).toBe('2026-08-01T00:00:00.000Z'); // the KES leg, untouched
      expect(rate.source).toBe('central-bank/seed');
    } finally {
      jest.useRealTimers();
    }
  });
});
