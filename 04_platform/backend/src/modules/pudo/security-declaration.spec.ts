import { DECLARATIONS, DECLARATION_DUE_DAYS, DECLARATION_VALID_DAYS, SecurityDeclarationService, refusalWords } from './security-declaration.service';
import type { DriverService } from './driver.service';

const DAY = 86_400_000;
const t0 = Date.parse('2026-10-21T09:00:00.000Z');

/**
 * Round 39 — THE SECURITY DECLARATION (the user: "At joining and yearly (Recommended)"): signed at joining and again each
 * year, versioned; not in force, nothing new is taken on. A fleet's drivers are answered for by the fleet.
 */
describe('the yearly security declaration', () => {
  const drivers = {
    get: (did: string) => {
      if (did === 'did:driver:fleet') return { managerDid: 'did:fleet:kilima' };
      if (did === 'did:driver:own') return {};
      throw new Error('No such driver');
    },
  } as unknown as DriverService;
  let svc: SecurityDeclarationService;
  beforeEach(() => {
    svc = new SecurityDeclarationService(drivers);
  });

  it('is missing until signed; holds a year; is due in its last month; then lapses', () => {
    const did = `did:shop:${Math.random()}`;
    expect(svc.standing('shop', did, t0)).toMatchObject({ state: 'missing', version: DECLARATIONS.shop.version, lines: DECLARATIONS.shop.lines });
    expect(svc.inForce('shop', did, t0)).toBe(false);
    const signed = svc.sign('shop', did, DECLARATIONS.shop.version, '  Mama Sarah  ', t0);
    expect(signed).toMatchObject({ state: 'signed', signedBy: 'Mama Sarah', signedAt: new Date(t0).toISOString(), until: new Date(t0 + DECLARATION_VALID_DAYS * DAY).toISOString() });
    expect(svc.inForce('shop', did, t0 + 100 * DAY)).toBe(true);
    // Its last month: still in force, and said to be due.
    const due = svc.standing('shop', did, t0 + (DECLARATION_VALID_DAYS - DECLARATION_DUE_DAYS + 1) * DAY);
    expect(due.state).toBe('due');
    expect(svc.inForce('shop', did, t0 + (DECLARATION_VALID_DAYS - 1) * DAY)).toBe(true);
    // A year on: lapsed, and nothing new is taken on.
    expect(svc.standing('shop', did, t0 + DECLARATION_VALID_DAYS * DAY).state).toBe('lapsed');
    expect(() => svc.assertShopMayTakeIn(did, 'Mama Sarah Shop', t0 + DECLARATION_VALID_DAYS * DAY)).toThrow('Mama Sarah Shop has not signed its security declaration again this year: nothing new is taken on until it has. It is signed in the Shop app, on the home screen.');
    // Signed again: another year from then.
    expect(svc.sign('shop', did, DECLARATIONS.shop.version, 'Mama Sarah', t0 + DECLARATION_VALID_DAYS * DAY).state).toBe('signed');
  });

  it('is signed only as the wording in force, and by somebody', () => {
    const did = `did:hub:${Math.random()}`;
    expect(() => svc.sign('hub', did, DECLARATIONS.hub.version + 1, 'Grace', t0)).toThrow(/has changed since it was shown to you/);
    expect(() => svc.sign('hub', did, DECLARATIONS.hub.version, '   ', t0)).toThrow(/Say who is signing/);
  });

  it('asks everybody to sign again when the wording changes', () => {
    const did = `did:fleet:${Math.random()}`;
    svc.sign('fleet', did, DECLARATIONS.fleet.version, 'Kilima office', t0);
    const was = DECLARATIONS.fleet.version;
    DECLARATIONS.fleet.version = was + 1;
    try {
      expect(svc.standing('fleet', did, t0 + DAY).state).toBe('outdated');
      expect(svc.inForce('fleet', did, t0 + DAY)).toBe(false);
    } finally {
      DECLARATIONS.fleet.version = was;
    }
  });

  it('holds a fleet’s driver to the fleet’s declaration, and a rider in no fleet to their own', () => {
    expect(svc.answersFor('did:driver:fleet')).toEqual({ kind: 'fleet', did: 'did:fleet:kilima' });
    expect(svc.answersFor('did:driver:own')).toEqual({ kind: 'driver', did: 'did:driver:own' });
    expect(() => svc.assertMayCarry('did:driver:fleet', t0)).toThrow('Your fleet has not signed its security declaration: nothing new is taken on until it has. It is signed in the Fleet app, on the home screen.');
    expect(() => svc.assertMayCarry('did:driver:fleet', t0, true)).toThrow(/^This rider’s fleet has not signed its security declaration/);
    expect(() => svc.assertMayCarry('did:driver:own', t0)).toThrow('You have not signed your security declaration: nothing new is taken on until you have. It is signed in the Driver app, on the home screen.');
    expect(() => svc.assertMayCarry('did:driver:own', t0, true)).toThrow(/^This rider has not signed their security declaration: nothing new is taken on until they have/);
    svc.sign('fleet', 'did:fleet:kilima', DECLARATIONS.fleet.version, 'Kilima office', t0);
    expect(svc.mayCarry('did:driver:fleet', t0)).toBe(true);
    expect(svc.mayCarry('did:driver:own', t0)).toBe(false);
  });

  it('says what is wrong in each case, to whoever it is said to', () => {
    expect(refusalWords('hub', { name: 'Central Sort', as: 'it' }, 'outdated')).toBe('Central Sort has not signed the new wording of its security declaration: nothing new is taken on until it has. It is signed in the Hub app, on the home screen.');
  });

  it('keeps every declaration short: a handful of promises a person can read before signing', () => {
    for (const d of Object.values(DECLARATIONS)) {
      expect(d.lines.length).toBeGreaterThanOrEqual(4);
      expect(d.lines.length).toBeLessThanOrEqual(7);
      for (const line of d.lines) expect(line.length).toBeLessThan(160);
    }
  });
});
