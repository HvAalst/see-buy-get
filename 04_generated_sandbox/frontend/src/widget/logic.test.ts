import { describe, expect, it } from 'vitest';
import {
  apiBase,
  collectLine,
  configProblem,
  EN,
  errorLine,
  money,
  parseAreas,
  priceLine,
  quoteRequest,
  readyLine,
  savingLine,
  strings,
  type QuoteResponse,
  type WidgetAttrs,
} from './logic';

const attrs = (over: Partial<WidgetAttrs> = {}): WidgetAttrs => ({ fromCountry: 'KE', fromArea: 'Nairobi', ...over });

const quote = (over: Partial<QuoteResponse> = {}): QuoteResponse => ({
  to: { name: 'Kisumu Duka', area: 'Kisumu', country: 'KE', landmark: 'by the market' },
  parcel: { size: 'M', weightKg: 2 },
  price: { currency: 'KES', amount: 32.13, minimum: 32.13 },
  eta: { readyAt: '2026-08-28T08:00:00.000Z', hours: 13.6, arrivesWhileOpen: false },
  route: { hops: ['Nairobi CBD', 'Kisumu Duka'], km: 356.2, crossesBorder: false },
  requires: [],
  ...over,
});

describe('setting the widget up', () => {
  it('needs to be told where the shop ships from, and says so to the developer', () => {
    // Never to the buyer: a shopper who reads "from-area is missing" learns nothing and trusts the shop less.
    expect(configProblem(attrs())).toBeNull();
    expect(configProblem({ fromPoint: 'did:glos:1' })).toBeNull();
    expect(configProblem({ fromCountry: 'KE' })).toMatch(/from-point, or both/);
    expect(configProblem({})).toMatch(/cannot guess where you ship from/);
  });

  it('lets one embed override the baked API root, and never doubles a slash', () => {
    expect(apiBase({}, 'https://api.example/v1')).toBe('https://api.example/v1');
    expect(apiBase({ api: 'https://staging.example/v1/' }, 'https://api.example/v1')).toBe('https://staging.example/v1');
    expect(apiBase({ api: '   ' }, 'https://api.example/v1')).toBe('https://api.example/v1');
  });
});

describe('asking for a price', () => {
  it('sends the measurements when it has them, and lets the API derive the tier', () => {
    // Sending dimensions AND a size and hoping they agree is how a quote and the shipment it becomes end
    // up different sizes — the API derives from measurements anyway, so `size` is dropped when they exist.
    const body = quoteRequest(attrs({ lengthCm: '30', widthCm: '20', heightCm: '10', weightKg: '2', size: 'S' }), { country: 'KE', area: 'Kisumu' });
    expect(body).toEqual({
      from: { country: 'KE', area: 'Nairobi' },
      to: { country: 'KE', area: 'Kisumu' },
      dimensionsCm: { l: 30, w: 20, h: 10 },
      weightKg: 2,
    });
  });

  it('falls back to a size tier when there are no measurements', () => {
    const body = quoteRequest(attrs({ size: 'l' }), { country: 'KE', area: 'Kisumu' });
    expect(body.size).toBe('L');
    expect(body.dimensionsCm).toBeUndefined();
  });

  it('ignores half-measurements and nonsense rather than sending them', () => {
    const body = quoteRequest(attrs({ lengthCm: '30', widthCm: '20', weightKg: 'about two' }), { country: 'KE', area: 'Kisumu' });
    expect(body.dimensionsCm).toBeUndefined(); // two of three is not a box
    expect(body.weightKg).toBeUndefined();
    expect(body.size).toBeUndefined(); // and nothing invented in its place
  });

  it('prefers an exact collection point over an area when the merchant gave one', () => {
    expect(quoteRequest(attrs({ fromPoint: 'did:glos:1' }), { country: 'KE', area: 'Kisumu' }).from).toEqual({ pointId: 'did:glos:1' });
  });
});

describe('showing the answer', () => {
  it('shows the ceiling, in the currency the API named', () => {
    expect(priceLine(quote(), 'en-GB')).toContain('32.13');
    expect(money(32.13, 'KES', 'en-GB')).toContain('32.13');
  });

  it('falls back to the plain number when a currency code is not one', () => {
    // An unknown code must not blank the price — the number is the point.
    expect(money(32.13, 'NOTACURRENCY', 'en-GB')).toBe('NOTACURRENCY 32.13');
  });

  it('mentions the cheaper figure only when there IS one', () => {
    // "as little as 32.13" under a headline of 32.13 is noise, and a single-carrier sandbox produces exactly that.
    expect(savingLine(quote(), EN, 'en-GB')).toBeNull();
    expect(savingLine(quote({ price: { currency: 'KES', amount: 40, minimum: 32 } }), EN, 'en-GB')).toMatch(/as little as/);
  });

  it('reads the date a person can plan around, not a timestamp', () => {
    expect(readyLine(quote(), 'en-GB')).toMatch(/Aug/);
    expect(readyLine(quote({ eta: { readyAt: 'not a date', hours: 0, arrivesWhileOpen: true } }))).toBe('');
  });

  it('names the collection point the way somebody would look for it', () => {
    expect(collectLine(quote())).toBe('Kisumu Duka · by the market · Kisumu');
    expect(collectLine(quote({ to: { name: 'Duka', area: 'Kisumu', country: 'KE' } }))).toBe('Duka · Kisumu');
  });
});

describe('when it goes wrong', () => {
  it('tells the buyer about their situation, not about our internals', () => {
    // The server's `detail` is written for a developer and can name our own machinery. The stable CODE is
    // what maps to a sentence about them.
    expect(errorLine({ code: 'NO_CAPACITY_AVAILABLE', detail: 'Every collection point in Kisumu is full right now' }, EN)).toMatch(/try a nearby area/);
    expect(errorLine({ code: 'CARGO_REQUIRES_DEDICATED' }, EN)).toMatch(/too big/);
    expect(errorLine({ code: 'RATE_LIMITED' }, EN)).toMatch(/too many requests/i);
  });

  it('falls back to the server title, then to the one thing certainly true', () => {
    expect(errorLine({ code: 'SOMETHING_NEW', title: 'A new kind of problem' }, EN)).toBe('A new kind of problem');
    expect(errorLine({ code: 'SOMETHING_NEW' }, EN)).toBe(EN.offline);
    expect(errorLine(null, EN)).toBe(EN.offline); // the network never answered
  });
});

describe('the copy', () => {
  it('takes a merchant’s overrides, and ignores anything that is not one', () => {
    const s = strings({ cta: 'Bereken verzendkosten', nope: 'ignored', submit: '', panelTitle: 42 });
    expect(s.cta).toBe('Bereken verzendkosten');
    expect(s.submit).toBe(EN.submit); // blank is not an override
    expect(s.panelTitle).toBe(EN.panelTitle); // nor is a number
    expect('nope' in s).toBe(false);
  });

  it('survives being handed nothing at all', () => {
    expect(strings(undefined)).toEqual(EN);
    expect(strings('not an object')).toEqual(EN);
  });
});

describe('the destination list', () => {
  it('sorts countries and their areas, and drops anything malformed', () => {
    expect(parseAreas([{ country: 'KE', areas: ['Nairobi', 'Kisumu'] }, { country: 'ET', areas: ['AddisAbaba'] }])).toEqual([
      { country: 'ET', areas: ['AddisAbaba'] },
      { country: 'KE', areas: ['Kisumu', 'Nairobi'] },
    ]);
    expect(parseAreas([{ country: 'KE', areas: [] }, { country: 'ZZ' }, null, 'nope'])).toEqual([]);
    expect(parseAreas({ not: 'a list' })).toEqual([]);
  });
});
