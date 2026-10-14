import { corsDelegate, corsFor, ownOrigins } from './cors';

const LIVE = { GLOS_ENV: 'production', SBG_PUBLIC_URL: 'https://seebuyget.example/', SBG_CONSOLE_URL: 'https://console.seebuyget.example/tower/', GLOS_CORS_ORIGINS: ' https://partner.example , not-a-url, https://seebuyget.example/again ' };
const STRANGER = 'https://evil.example';

describe('which websites may call the API from a browser', () => {
  it('in a sandbox: any of them — each app is a dev server on its own port', () => {
    expect(corsFor('/v1/sbg/auth/login', 'http://localhost:5175', {})).toEqual({ origin: true });
    expect(corsFor('/v1/sbg/auth/login', STRANGER, { GLOS_ENV: 'sandbox' })).toEqual({ origin: true });
  });

  it('outside one: our own sites, read from where the apps and the console are served, and what the deployment lists', () => {
    // An address is a site by its origin: the path after it, and a second mention, change nothing. What is not an address is not a site.
    expect(ownOrigins(LIVE)).toEqual(['https://seebuyget.example', 'https://console.seebuyget.example', 'https://partner.example']);
    for (const ours of ownOrigins(LIVE)) expect([ours, corsFor('/v1/sbg/auth/login', ours, LIVE)]).toEqual([ours, { origin: true }]);
  });

  it('outside one: nobody else — at a sign-in, at a public answer, anywhere', () => {
    for (const path of ['/v1/sbg/auth/login', '/v1/sbg/identity/login', '/v1/sbg/operators/login', '/v1/sbg/countries', '/v1/sbg/track/ABC', '/v1/auth/token', '/v1/docs']) {
      expect([path, corsFor(path, STRANGER, LIVE)]).toEqual([path, { origin: false }]);
    }
    // A site that only looks like ours.
    expect(corsFor('/v1/sbg/auth/login', 'https://seebuyget.example.evil.example', LIVE)).toEqual({ origin: false });
    expect(corsFor('/v1/sbg/auth/login', 'http://seebuyget.example', LIVE)).toEqual({ origin: false });
    // With no site of ours named, no other website is answered at all.
    expect(corsFor('/v1/sbg/auth/login', 'https://seebuyget.example', { GLOS_ENV: 'production' })).toEqual({ origin: false });
  });

  it('outside one: the shipping API answers every website — it is what a store’s own page calls', () => {
    for (const path of ['/v1/sbg/shipping/quotes', '/v1/sbg/shipping/areas', '/v1/sbg/shipping/shipments/shp_1', '/v1/sbg/shipping']) {
      expect([path, corsFor(path, STRANGER, LIVE)]).toEqual([path, { origin: true }]);
    }
    // …and nothing that only starts with the same letters.
    expect(corsFor('/v1/sbg/shipping-admin/keys', STRANGER, LIVE)).toEqual({ origin: false });
    expect(corsFor('/v1/sbg/vendors/shipping', STRANGER, LIVE)).toEqual({ origin: false });
  });

  it('a call that is not from another website — the same site, a server, a script — is not this rule’s business', () => {
    // No Origin header: there is nothing to answer, and nothing is refused; the cors middleware simply adds no header.
    expect(corsFor('/v1/sbg/auth/login', undefined, LIVE)).toEqual({ origin: false });
  });

  it('reads the path and the origin off the request, whatever follows the question mark', () => {
    const ask = (url: string, origin?: string) => {
      let answer: unknown;
      corsDelegate(LIVE)({ originalUrl: url, headers: origin ? { origin } : {} }, (_err, options) => (answer = options));
      return answer;
    };
    expect(ask('/v1/sbg/shipping/areas?country=KE', STRANGER)).toEqual({ origin: true });
    expect(ask('/v1/sbg/track/ABC?next=/v1/sbg/shipping/x', STRANGER)).toEqual({ origin: false });
    expect(ask('/v1/sbg/auth/login', 'https://seebuyget.example')).toEqual({ origin: true });
  });
});
