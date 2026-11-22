import type { EntityService } from '../../foundation/entity/entity.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import { BorderRouteService } from './border-route.service';
import type { DirectoryService } from './directory.service';
import type { MdpService } from './mdp.service';

/*
 * 2026-11-18 — PARCELS ACROSS A BORDER, STEP 1: THE ROUTES ON THE CONSOLE (the plan, D1–D9 "As recommended"; the owner on
 * D1: "staff can block and open airports of a single country (for example Schiphol yes, Maastricht airport block)"; on the
 * plan: an agreement with customs at each arrival airport names the warehouse, under a temporary-storage licence).
 * Route by route, off by default, two people to switch one on and one to switch it off, refused while anything it needs
 * is missing — each thing by name.
 */
describe('a route across a border', () => {
  const NOW = Date.parse('2026-11-18T10:00:00Z');
  const AMINA = { name: 'Amina Staff', key: 'acct-amina' };
  const BRIAN = { name: 'Brian Staff', key: 'acct-brian' };

  const setup = (o: { open?: string[]; testing?: string[]; companies?: string[] } = {}) => {
    const open = o.open ?? ['NL', 'KE'];
    const testing = o.testing ?? [];
    const companies = o.companies ?? ['NL', 'KE'];
    const presence = {
      resolve: (c: string) => ({ capabilities: { signUp: open.includes(c), takeIn: open.includes(c) } }),
      testing: (c: string) => testing.includes(c),
    } as unknown as PresenceService;
    const sister = (c: string) => ({ entityId: `sbg-${c.toLowerCase()}`, name: `SeeBuyGet ${c}`, kind: 'sister', jurisdiction: c, currency: c === 'KE' ? 'KES' : 'EUR' });
    const agent = { entityId: 'agent-1', name: 'Swift Clearing Ltd', kind: 'business', jurisdiction: 'KE', status: 'active' };
    const forwarder = { entityId: 'fwd-1', name: 'Freight Only Ltd', kind: 'business', jurisdiction: 'KE', status: 'active' };
    const nlForwarder = { entityId: 'fwd-nl', name: 'Holland Air Forwarding', kind: 'business', jurisdiction: 'NL', status: 'active' };
    const entities = {
      forJurisdiction: (c: string) => (companies.includes(c) ? sister(c) : undefined),
      find: (id: string) => [agent, forwarder, nlForwarder].find((e) => e.entityId === id),
      companies: () => [agent, forwarder, nlForwarder, ...companies.map(sister)],
    } as unknown as EntityService;
    const hubs = [
      { mdpId: 'mdp-nbo', name: 'Embakasi Hub', country: 'KE', approved: true },
      { mdpId: 'mdp-new', name: 'New Hub', country: 'KE', approved: false },
      { mdpId: 'mdp-ams', name: 'Schiphol Hub', country: 'NL', approved: true },
    ];
    const mdps = {
      find: (id: string) => hubs.find((h) => h.mdpId === id),
      list: () => hubs,
      countryOf: (h: { country: string }) => h.country,
      isApproved: (h: { approved: boolean }) => h.approved,
    } as unknown as MdpService;
    const directory = { kindsOfCompany: (e: { entityId: string }) => (e.entityId === 'agent-1' ? ['clearing_agent'] : ['forwarder']) } as unknown as DirectoryService;
    return new BorderRouteService(presence, entities, mdps, directory);
  };

  /** Everything Kenya needs as an arrival country — Nairobi open with its warehouse, our company clearing, the fee — and the
   *  route's own: leaving from Schiphol through our hub there, carried by a forwarder from the directory, priced per size. */
  const readyKenya = (svc: BorderRouteService) => {
    svc.setDeparture('NL', 'KE', { airport: 'AMS', mdpId: 'mdp-ams' }, 'Amina Staff', NOW);
    svc.setCarrier('NL', 'KE', 'fwd-nl', 'Amina Staff', NOW);
    svc.setArrival('NL', 'KE', 'NBO', 'Amina Staff', NOW);
    svc.setPrices('NL', 'KE', { S: 12, M: 19.5, L: 29 }, 'Amina Staff', NOW);
    svc.setWarehouse('KE', 'NBO', { mdpId: 'mdp-nbo', tstLicence: 'TST-KE-0042', validUntil: '2027-06-30', agreement: 'KRA/JKIA/2026/17' }, 'Amina Staff', NOW);
    svc.setAirport('KE', 'NBO', true, 'Amina Staff', NOW);
    svc.setClearer('KE', { kind: 'company', registration: 'KRA-CR-881' }, 'Amina Staff', NOW);
    svc.setFee('KE', 350, 'Amina Staff', NOW);
  };

  it('is refused while anything is missing, each thing by name', () => {
    const svc = setup();
    expect(svc.missing('NL', 'KE', NOW)).toEqual(['departure', 'carrier', 'price', 'clearer', 'fee', 'airport']);
    expect(() => svc.propose('NL', 'KE', AMINA, NOW)).toThrow(/no departure airport and hub in NL.*no carrier.*prices for a small.*nobody clears in KE yet.*clearance fee in KE is not set.*arrival airport in KE is not named/);
    const closed = setup({ open: ['NL'], companies: ['KE'] });
    expect(closed.missing('NL', 'KE', NOW)).toEqual(['open-to', 'sells-from', 'departure', 'carrier', 'price', 'clearer', 'fee', 'airport']);
    // Being tested is not open to everyone.
    expect(setup({ testing: ['KE'] }).missing('NL', 'KE', NOW)).toContain('open-to');
  });

  it('2026-11-22 — is not for two EU countries, where goods pass with no customs: refused when proposed, approved or booked (BG-2)', () => {
    const svc = setup({ open: ['NL', 'BE', 'KE'], companies: ['NL', 'BE', 'KE'] });
    expect(() => svc.propose('NL', 'BE', AMINA, NOW)).toThrow(/Netherlands and Belgium are both in the EU, where goods pass with no customs: a route through a customs warehouse is not for them/);
    expect(() => svc.bookable('BE', 'NL', NOW)).toThrow(/both in the EU/);
    expect(svc.isOn('NL', 'BE')).toBe(false);
    // A route out of the EU is as it was.
    readyKenya(svc);
    expect(svc.propose('NL', 'KE', AMINA, NOW)).toMatchObject({ state: 'waiting' });
  });

  it('two people switch it on: one proposes, a different one approves — one switches it off', () => {
    const svc = setup();
    readyKenya(svc);
    expect(svc.missing('NL', 'KE', NOW)).toEqual([]);
    expect(svc.propose('nl', 'ke', AMINA, NOW)).toMatchObject({ from: 'NL', to: 'KE', state: 'waiting', proposedBy: 'Amina Staff', mine: true });
    expect(svc.isOn('NL', 'KE')).toBe(false);
    expect(() => svc.approve('NL', 'KE', { name: 'amina  staff', key: 'acct-amina' }, NOW)).toThrow(/two people/);
    expect(svc.approve('NL', 'KE', BRIAN, NOW)).toMatchObject({ state: 'on', approvedBy: 'Brian Staff', mine: false });
    expect(svc.isOn('NL', 'KE')).toBe(true);
    // One direction only: Kenya to the Netherlands is its own route.
    expect(svc.isOn('KE', 'NL')).toBe(false);
    expect(svc.switchOff('NL', 'KE', AMINA, NOW + 1000).state).toBe('off');
    expect(svc.isOn('NL', 'KE')).toBe(false);
    expect(svc.view(AMINA, NOW).changes.map((c) => [c.what, c.by])).toEqual([
      ['off', 'Amina Staff'],
      ['approve', 'Brian Staff'],
      ['propose', 'Amina Staff'],
      ['fee', 'Amina Staff'],
      ['clearer', 'Amina Staff'],
      ['airport-open', 'Amina Staff'],
      ['warehouse', 'Amina Staff'],
      ['prices', 'Amina Staff'],
      ['arrival', 'Amina Staff'],
      ['carrier', 'Amina Staff'],
      ['departure', 'Amina Staff'],
    ]);
  });

  it('D16 — the route names its arrival airport; only that one, open with its licensed warehouse, counts', () => {
    const svc = setup();
    readyKenya(svc);
    expect(svc.missing('NL', 'KE', NOW)).toEqual([]);
    // Mombasa is named instead: it is not open, so the route is not ready — Nairobi being open does not count for it.
    svc.setArrival('NL', 'KE', 'MBA', 'Amina Staff', NOW);
    expect(svc.missing('NL', 'KE', NOW)).toEqual(['airport']);
    expect(() => svc.setArrival('NL', 'KE', 'AMS', 'Amina Staff', NOW)).toThrow(/not an airport we hold for KE/);
    svc.setArrival('NL', 'KE', 'NBO', 'Amina Staff', NOW);
    expect(svc.routeOf('NL', 'KE')?.arrival?.airport).toBe('NBO');
    expect(svc.warehouseAt('KE', 'NBO', NOW)).toMatchObject({ mdpId: 'mdp-nbo', tstLicence: 'TST-KE-0042' });
    expect(svc.warehouseAt('KE', 'NBO', Date.parse('2027-07-01T10:00:00Z'))).toBeUndefined();
    expect(svc.view(undefined, NOW).routes[0].arrivalAirports).toEqual(expect.arrayContaining(['NBO', 'MBA', 'KIS']));
  });

  it('2a — names where it leaves, who carries it and its prices, in the sending country; kept when it is switched off', () => {
    const svc = setup();
    expect(svc.prepare('NL', 'KE', NOW)).toMatchObject({ state: 'off', departureAirports: expect.arrayContaining(['AMS', 'MST', 'EIN']), departureHubs: [{ id: 'mdp-ams', name: 'Schiphol Hub' }], carriers: [{ id: 'fwd-nl', name: 'Holland Air Forwarding' }], currency: 'EUR' });
    // The departure is in the sending country: its airport, and an approved hub of ours there.
    expect(() => svc.setDeparture('NL', 'KE', { airport: 'NBO', mdpId: 'mdp-ams' }, 'Amina Staff', NOW)).toThrow(/not an airport we hold for NL/);
    expect(() => svc.setDeparture('NL', 'KE', { airport: 'AMS', mdpId: 'mdp-nbo' }, 'Amina Staff', NOW)).toThrow(/not in NL/);
    // The carrier is a forwarder or haulier from the sending country's directory — not a clearing agent, not another country's.
    expect(() => svc.setCarrier('NL', 'KE', 'agent-1', 'Amina Staff', NOW)).toThrow(/No forwarder or haulier/);
    expect(() => svc.setCarrier('NL', 'KE', 'fwd-1', 'Amina Staff', NOW)).toThrow(/No forwarder or haulier/);
    // The prices are the sending company's, in its money.
    expect(svc.setPrices('NL', 'KE', { S: 12.004, M: 19.5, L: 29 }, 'Amina Staff', NOW).prices).toMatchObject({ S: 12, M: 19.5, L: 29, currency: 'EUR' });
    expect(() => svc.setPrices('NL', 'KE', { S: 0, M: 1, L: 1 }, 'Amina Staff', NOW)).toThrow(/above nothing/);
    expect(() => setup({ companies: ['KE'] }).setPrices('NL', 'KE', { S: 1, M: 1, L: 1 }, 'Amina Staff', NOW)).toThrow(/No company of ours sells in NL/);
    readyKenya(svc);
    svc.propose('NL', 'KE', AMINA, NOW);
    // Not changed while waiting or on: what was approved is what parcels are booked on.
    expect(() => svc.setPrices('NL', 'KE', { S: 1, M: 1, L: 1 }, 'Amina Staff', NOW)).toThrow(/waiting for approval: switch it off or withdraw it/);
    svc.approve('NL', 'KE', BRIAN, NOW);
    expect(() => svc.setCarrier('NL', 'KE', 'fwd-nl', 'Amina Staff', NOW)).toThrow(/is on: switch it off/);
    svc.switchOff('NL', 'KE', AMINA, NOW);
    expect(svc.routeOf('NL', 'KE')).toMatchObject({ state: 'off', departure: { airport: 'AMS', mdpId: 'mdp-ams' }, carrier: { entityId: 'fwd-nl' }, prices: { M: 19.5 } });
  });

  it('a proposal is asked again at approval: what lapsed since refuses it', () => {
    const svc = setup();
    readyKenya(svc);
    svc.propose('NL', 'KE', AMINA, NOW);
    svc.setAirport('KE', 'NBO', false, 'Amina Staff', NOW);
    expect(() => svc.approve('NL', 'KE', BRIAN, NOW)).toThrow(/arrival airport in KE is not named, or not open/);
    expect(svc.decline('NL', 'KE', AMINA, NOW).state).toBe('off');
  });

  it('an airport is blocked until opened, and never opened without a licensed customs warehouse there', () => {
    const svc = setup();
    const view = svc.view(undefined, NOW);
    expect(view.arrivals).toEqual([]);
    expect(() => svc.setAirport('NL', 'MST', true, 'Amina Staff', NOW)).toThrow(/customs warehouse agreed there/);
    svc.setWarehouse('NL', 'AMS', { mdpId: 'mdp-ams', tstLicence: 'NL-TST-7', agreement: 'Douane Schiphol 2026-3' }, 'Amina Staff', NOW);
    // The owner's example: Schiphol open, Maastricht blocked.
    const nl = svc.setAirport('NL', 'AMS', true, 'Amina Staff', NOW);
    expect(nl.airports.filter((a) => ['AMS', 'MST', 'EIN'].includes(a.code)).map((a) => [a.code, a.open])).toEqual([
      ['AMS', true],
      ['MST', false],
      ['EIN', false],
    ]);
    expect(svc.openAirports('NL', NOW)).toEqual(['AMS']);
    // Not an airport of that country.
    expect(() => svc.setAirport('NL', 'NBO', true, 'Amina Staff', NOW)).toThrow(/not an airport we hold for NL/);
  });

  it('the warehouse is an approved hub of ours in the airport’s country; a licence that runs out closes the airport', () => {
    const svc = setup();
    expect(() => svc.setWarehouse('KE', 'NBO', { mdpId: 'mdp-ams', tstLicence: 'TST-1', agreement: 'AGR-1' }, 'Amina Staff', NOW)).toThrow(/not in KE/);
    expect(() => svc.setWarehouse('KE', 'NBO', { mdpId: 'mdp-new', tstLicence: 'TST-1', agreement: 'AGR-1' }, 'Amina Staff', NOW)).toThrow(/not approved/);
    expect(() => svc.setWarehouse('KE', 'NBO', { mdpId: 'mdp-nbo', tstLicence: 'TST-1', validUntil: '2026-01-01', agreement: 'AGR-1' }, 'Amina Staff', NOW)).toThrow(/already run out/);
    readyKenya(svc);
    const later = Date.parse('2027-07-01T10:00:00Z');
    expect(svc.openAirports('KE', later)).toEqual([]);
    const ke = svc.view(undefined, later).arrivals.find((a) => a.country === 'KE')!;
    expect(ke.airports.find((a) => a.code === 'NBO')).toMatchObject({ open: false, lapsed: true });
    expect(svc.missing('NL', 'KE', later)).toEqual(['airport']);
  });

  it('a clearing agent counts once it accepts, on its own side; our company clears only with its customs registration', () => {
    const svc = setup();
    expect(() => svc.setClearer('KE', { kind: 'agent', entityId: 'fwd-1' }, 'Amina Staff', NOW)).toThrow(/No clearing agent/);
    expect(svc.setClearer('KE', { kind: 'agent', entityId: 'agent-1' }, 'Amina Staff', NOW).clearer).toMatchObject({ kind: 'agent', name: 'Swift Clearing Ltd' });
    expect(svc.missing('NL', 'KE', NOW)).toContain('clearer');
    expect(() => svc.acceptAsClearer('KE', 'fwd-1', NOW)).toThrow(/not the clearing agent named/);
    svc.acceptAsClearer('KE', 'agent-1', NOW);
    expect(svc.missing('NL', 'KE', NOW)).not.toContain('clearer');
    expect(() => svc.setClearer('KE', { kind: 'company' }, 'Amina Staff', NOW)).toThrow(/registration as a customs representative/);
    expect(() => setup({ companies: ['NL'] }).setClearer('KE', { kind: 'company', registration: 'R-1' }, 'Amina Staff', NOW)).toThrow(/No company of ours stands in KE/);
  });

  it('2b — a parcel is booked on a route only while it is on and its arrival airport open; it keeps the route as it stood', () => {
    const svc = setup();
    readyKenya(svc);
    expect(() => svc.bookable('NL', 'KE', NOW)).toThrow(/Parcels to Kenya are not sent from Netherlands yet: no route between them is on/);
    expect(svc.onFrom('NL', NOW)).toEqual([]);
    svc.propose('NL', 'KE', AMINA, NOW);
    expect(() => svc.bookable('NL', 'KE', NOW)).toThrow(/no route between them is on/);
    svc.approve('NL', 'KE', BRIAN, NOW);
    const booked = svc.bookable('nl', 'ke', NOW);
    expect(booked).toEqual({
      from: 'NL',
      to: 'KE',
      departure: { airport: 'AMS', mdpId: 'mdp-ams', name: 'Schiphol Hub' },
      arrival: { airport: 'NBO', mdpId: 'mdp-nbo', name: 'Embakasi Hub' },
      carrier: { entityId: 'fwd-nl', name: 'Holland Air Forwarding' },
      prices: { S: 12, M: 19.5, L: 29, currency: 'EUR' },
    });
    expect(svc.onFrom('NL', NOW).map((r) => r.to)).toEqual(['KE']);
    expect(svc.onFrom('KE', NOW)).toEqual([]);
    // The warehouse's licence runs out while the route is on: nothing more is booked on it, and the counter is not offered it.
    const later = Date.parse('2027-07-01T10:00:00Z');
    expect(() => svc.bookable('NL', 'KE', later)).toThrow(/arrival airport is not open with its licensed customs warehouse/);
    expect(svc.onFrom('NL', later)).toEqual([]);
  });

  it('D20 — what a new receiver pays on top is set by the arrival company, in its money', () => {
    const svc = setup();
    expect(svc.readdressIn('KE')).toBeUndefined();
    expect(svc.setReaddressFees('KE', { storagePerDay: 49.999, handlingFee: 300 }, 'Amina Staff', NOW).readdress).toMatchObject({ storagePerDay: 50, handlingFee: 300, currency: 'KES' });
    expect(svc.readdressIn('ke')).toEqual({ storagePerDay: 50, handlingFee: 300, currency: 'KES' });
    expect(() => svc.setReaddressFees('KE', { storagePerDay: -1, handlingFee: 0 }, 'Amina Staff', NOW)).toThrow(/nothing or more/);
    expect(() => setup({ companies: ['NL'] }).setReaddressFees('KE', { storagePerDay: 1, handlingFee: 1 }, 'Amina Staff', NOW)).toThrow(/No company of ours stands in KE/);
  });

  it('4 — the countries a clearing agent is named for, and whether it has accepted there', () => {
    const svc = setup();
    expect(svc.clearsFor('agent-1')).toEqual([]);
    svc.setClearer('KE', { kind: 'agent', entityId: 'agent-1' }, 'Amina Staff', NOW);
    expect(svc.clearsFor('agent-1')).toEqual([{ country: 'KE', name: 'Kenya' }]);
    expect(svc.clearsIn('agent-1', 'KE')).toBe(false);
    svc.acceptAsClearer('KE', 'agent-1', NOW);
    expect(svc.clearsFor('agent-1')[0].acceptedAt).toBeDefined();
    expect(svc.clearsIn('agent-1', 'ke')).toBe(true);
    expect(svc.clearsIn('fwd-1', 'KE')).toBe(false);
    expect(svc.clearsFor('fwd-1')).toEqual([]);
  });

  it('the clearance fee is in the arrival company’s money; a route needs two countries', () => {
    const svc = setup();
    expect(svc.setFee('KE', 349.999, 'Amina Staff', NOW).fee).toMatchObject({ amount: 350, currency: 'KES' });
    expect(() => setup({ companies: ['NL'] }).setFee('KE', 100, 'Amina Staff', NOW)).toThrow(/No company of ours stands in KE/);
    expect(() => svc.propose('KE', 'KE', AMINA, NOW)).toThrow(/two different countries/);
    expect(() => svc.propose('NL', 'XX', AMINA, NOW)).toThrow(/No such country/);
  });
});
