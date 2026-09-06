import { describe, expect, it } from 'vitest';
import {
  apiBase,
  collectLine,
  configProblem,
  EN,
  errorLine,
  headers,
  money,
  parseAreas,
  priceLine,
  packFor,
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

  it('refuses to render at all when a SECRET key has been pasted into the page', () => {
    // Not a preference — a credential published to the world. Refusing is the only response that cannot be
    // ignored, and the message says to revoke it, because by now it is already in somebody's history.
    expect(configProblem(attrs({ key: 'sk_live_abc123' }))).toMatch(/revoke it/);
    expect(configProblem(attrs({ key: 'whatever' }))).toMatch(/not a publishable key/);
    expect(configProblem(attrs({ key: 'pk_test_abc' }))).toBeNull();
    expect(configProblem(attrs())).toBeNull(); // and no key at all is fine — the quote is public
  });

  it('sends a publishable key in a header, never in the URL', () => {
    // A query string ends up in access logs, proxies and referrers. A header does not.
    expect(headers(attrs({ key: 'pk_live_abc' }))['x-sbg-key']).toBe('pk_live_abc');
    expect(headers(attrs())['x-sbg-key']).toBeUndefined();
    expect(headers(attrs({ key: 'sk_live_abc' }))['x-sbg-key']).toBeUndefined(); // belt and braces
  });

  it('lets one embed override the baked API root, and never doubles a slash', () => {
    expect(apiBase({}, 'https://api.example/v1')).toBe('https://api.example/v1');
    expect(apiBase({ api: 'https://staging.example/v1/' }, 'https://api.example/v1')).toBe('https://staging.example/v1');
    expect(apiBase({ api: '   ' }, 'https://api.example/v1')).toBe('https://api.example/v1');
  });
});

describe('asking for a price', () => {
  it('sends whatever the buyer typed as an ADDRESS, whether it is a street or a town', () => {
    // One box covers both, because "Kisumu" and "12 Oginga Odinga St, Kisumu" should not feel like
    // different products to whoever is filling it in. The server places it, or reads it as an area.
    expect(quoteRequest(attrs(), { country: 'ET', where: '  Bole, Addis Ababa ' }).to).toEqual({ country: 'ET', address: 'Bole, Addis Ababa' });
    expect(quoteRequest(attrs(), { country: 'KE', where: 'Kisumu' }).to).toEqual({ country: 'KE', address: 'Kisumu' });
  });

  it('sends the measurements when it has them, and lets the API derive the tier', () => {
    // Sending dimensions AND a size and hoping they agree is how a quote and the shipment it becomes end
    // up different sizes — the API derives from measurements anyway, so `size` is dropped when they exist.
    const body = quoteRequest(attrs({ lengthCm: '30', widthCm: '20', heightCm: '10', weightKg: '2', size: 'S' }), { country: 'KE', where: 'Kisumu' });
    expect(body).toEqual({
      from: { country: 'KE', area: 'Nairobi' },
      to: { country: 'KE', address: 'Kisumu' },
      dimensionsCm: { l: 30, w: 20, h: 10 },
      weightKg: 2,
    });
  });

  it('falls back to a size tier when there are no measurements', () => {
    const body = quoteRequest(attrs({ size: 'l' }), { country: 'KE', where: 'Kisumu' });
    expect(body.size).toBe('L');
    expect(body.dimensionsCm).toBeUndefined();
  });

  it('ignores half-measurements and nonsense rather than sending them', () => {
    const body = quoteRequest(attrs({ lengthCm: '30', widthCm: '20', weightKg: 'about two' }), { country: 'KE', where: 'Kisumu' });
    expect(body.dimensionsCm).toBeUndefined(); // two of three is not a box
    expect(body.weightKg).toBeUndefined();
    expect(body.size).toBeUndefined(); // and nothing invented in its place
  });

  it('prefers an exact collection point over an area when the merchant gave one', () => {
    expect(quoteRequest(attrs({ fromPoint: 'did:glos:1' }), { country: 'KE', where: 'Kisumu' }).from).toEqual({ pointId: 'did:glos:1' });
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

  it('says how far it is when the buyer typed where they are', () => {
    // "1.4 km away" answers the question they were actually asking. The area name only stands in when we
    // have nothing better, which is when they picked from the list rather than typing.
    expect(collectLine(quote({ to: { name: 'Duka', area: 'Kisumu', country: 'KE', distanceKm: 1.4 } }))).toBe('Duka · 1.4 km away');
  });

  it('tells a buyer their words did not land, rather than that a lookup failed', () => {
    expect(errorLine({ code: 'NOT_FOUND', detail: 'We could not place “Nowhereville”' }, EN)).toBe(EN.notPlaced);
    expect(errorLine({ code: 'NOT_FOUND', detail: 'No collection point did:glos:x' }, EN)).toMatch(/no collection point there yet/);
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

describe('the languages the widget ships', () => {
  // NOT the network's own catalogues, deliberately: those are ~2500 English keys against ~20 stubs in
  // everything else, so wiring this to them would dress a stub up as a translation on somebody's checkout.
  // Seventeen short strings is a set that can actually be translated and checked.

  it('reads a language, not a region', () => {
    // A region tag says where somebody is; the language says what they read. A Kenyan browser asking for
    // sw-KE and a bare sw want the same words.
    expect(packFor('sw').cta).toBeDefined();
    expect(packFor('sw-KE').cta).toBe(packFor('sw').cta);
    expect(packFor('SW').cta).toBe(packFor('sw').cta);
    expect(packFor('sw_KE').cta).toBe(packFor('sw').cta);
  });

  it('falls back to English rather than guessing', () => {
    expect(packFor('de')).toEqual({});
    expect(packFor(undefined)).toEqual({});
    expect(packFor('')).toEqual({});
    expect(strings(undefined, 'de')).toEqual(EN);
  });

  it('keeps every placeholder a line depends on', () => {
    // A translated string that drops {amount} loses the number it exists to carry — the one failure here
    // that shows up as a missing PRICE rather than as odd wording.
    for (const [lang, pack] of Object.entries({ sw: packFor('sw') })) {
      expect(`${lang}:${pack.asLowAs}`).toContain('{amount}');
    }
  });

  it('translates nothing it has no word for', () => {
    // Every key in a pack must be a real key. A typo silently adds a string nothing renders, and the line
    // it was meant to translate stays English while looking translated in the source.
    for (const key of Object.keys(packFor('sw'))) {
      expect(Object.keys(EN)).toContain(key);
    }
  });

  it('lets the MERCHANT win, over both English and the pack', () => {
    // Their checkout, their voice. Somebody who wrote their own wording for a line should not have it
    // replaced because a buyer's browser asked for a language we happen to ship.
    const s = strings({ submit: 'Bei tafadhali' }, 'sw');
    expect(s.submit).toBe('Bei tafadhali');
    expect(s.close).toBe(packFor('sw').close); // …and the rest of the pack still applies
  });
});
