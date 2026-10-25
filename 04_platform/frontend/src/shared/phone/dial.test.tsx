import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { HOME_COUNTRY, countryOfNumber, deviceCountry, dialCodeOf, dialCountries, firstGuess, forgetVisitorCountry, nationalOf, phoneFrom, rememberCountry, rememberedCountry, visitorCountry } from './dial';
import { PhoneField } from '../ui/PhoneField';

/*
 * A PHONE NUMBER'S COUNTRY CODE, CHOSEN FOR THE PERSON (the user, 2026-10-25: "use the country prefix based on
 * geolocation for UX"). What is held to here: the codes are the server's own; the number sent is always whole; and the
 * guess runs chosen-before → where Cloudflare reads the visitor to be → the phone's own time zone and language → Kenya.
 */

function storage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  forgetVisitorCountry();
});

describe('the country codes', () => {
  it('are the server’s own catalogue, every country of it — change one, change both', () => {
    const data = readFileSync('../backend/src/foundation/countries/catalogue.data.ts', 'utf8');
    const lines = /COUNTRY_LINES = `([\s\S]*?)`/.exec(data)![1].trim().split(/\r?\n/).map((l) => l.trim().split('|'));
    // The guard read the catalogue at all: the whole world, Kenya in it.
    expect(lines.length).toBeGreaterThan(240);
    expect(lines.find(([code]) => code === 'KE')?.[2]).toBe('254');
    expect(dialCountries().sort()).toEqual(lines.map(([code]) => code).sort());
    for (const [code, , dial] of lines) expect([code, dialCodeOf(code)]).toEqual([code, `+${dial}`]);
  });
});

describe('the number sent', () => {
  it('is whole: the country’s code and the number as typed at home', () => {
    expect(phoneFrom('UG', '0772 123 456')).toBe('+256772123456');
    expect(phoneFrom('KE', '0712345678')).toBe('+254712345678');
    expect(phoneFrom('KE', '712 345 678')).toBe('+254712345678');
    expect(phoneFrom('ET', '091 123 4567')).toBe('+251911234567');
    // Italy keeps its 0 after the code.
    expect(phoneFrom('IT', '06 1234 5678')).toBe('+390612345678');
    expect(phoneFrom('KE', '')).toBe('');
    expect(phoneFrom('KE', ' - ')).toBe('');
  });

  it('takes a number written whole as it is, whatever the box says, and never gives the code twice', () => {
    expect(phoneFrom('KE', '+256 772 123 456')).toBe('+256772123456');
    expect(phoneFrom('KE', '00256772123456')).toBe('+256772123456');
    expect(phoneFrom('KE', '254712345678')).toBe('+254712345678');
  });

  it('knows a whole number’s country by its code, keeping the chosen one where several share it', () => {
    expect(countryOfNumber('+256772123456')).toBe('UG');
    expect(countryOfNumber('+254712345678')).toBe('KE');
    expect(countryOfNumber('0712345678')).toBeUndefined();
    // +1 is the United States' unless Canada (or another +1 country) is what the box already says.
    expect(countryOfNumber('+12025550100')).toBe('US');
    expect(countryOfNumber('+14165550100', 'CA')).toBe('CA');
    // The longest code wins: +1 268 is Antigua.
    expect(countryOfNumber('+12684601234')).toBe('AG');
    expect(nationalOf('+256772123456', 'UG')).toBe('0772123456');
    expect(nationalOf('+390612345678', 'IT')).toBe('0612345678');
  });
});

describe('the first guess', () => {
  it('is the person’s own earlier choice, before anything the phone or the network says', () => {
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('navigator', { languages: ['en-US'] });
    rememberCountry('TZ');
    expect(rememberedCountry()).toBe('TZ');
    expect(firstGuess()).toBe('TZ');
  });

  it('is then the phone’s own time zone, then its language’s region, then Kenya', () => {
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('navigator', { languages: ['sw-TZ', 'en'] });
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => ({ resolvedOptions: () => ({ timeZone: 'Africa/Kampala' }) })) as never);
    expect(deviceCountry()).toBe('UG');
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => ({ resolvedOptions: () => ({ timeZone: 'UTC' }) })) as never);
    expect(deviceCountry()).toBe('TZ');
    vi.stubGlobal('navigator', { languages: ['en'] });
    expect(deviceCountry()).toBeUndefined();
    expect(firstGuess()).toBe(HOME_COUNTRY);
  });

  it('asks the network once where Cloudflare reads the visitor to be — and takes nothing it does not know', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ country: 'UG' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await visitorCountry()).toBe('UG');
    expect(await visitorCountry()).toBe('UG');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toMatch(/\/v1\/sbg\/visitor$/);
    forgetVisitorCountry();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    expect(await visitorCountry()).toBeUndefined();
    forgetVisitorCountry();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('no signal'))));
    expect(await visitorCountry()).toBeUndefined();
  });
});

describe('the phone box', () => {
  it('shows the code short beside the number, the whole world a tap away, on the box’s own id', () => {
    vi.stubGlobal('localStorage', storage());
    rememberCountry('UG');
    const html = renderToString(<PhoneField id="enroll-phone" value="" onInput={() => undefined} />);
    expect(html).toContain('id="enroll-phone"');
    expect(html).toContain('+256');
    expect((html.match(/<option /g) ?? []).length).toBe(dialCountries().length);
  });

  it('opens on a number it is given, in that number’s country, as it is typed at home', () => {
    vi.stubGlobal('localStorage', storage());
    const html = renderToString(<PhoneField id="p" value="+256772123456" onInput={() => undefined} />);
    expect(html).toContain('value="0772123456"');
    expect(html).toMatch(/<span aria-hidden="true">\+256<\/span>/);
  });
});
