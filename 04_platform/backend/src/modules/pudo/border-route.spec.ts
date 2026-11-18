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
    const entities = {
      forJurisdiction: (c: string) => (companies.includes(c) ? sister(c) : undefined),
      find: (id: string) => [agent, forwarder].find((e) => e.entityId === id),
      companies: () => [agent, forwarder, ...companies.map(sister)],
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

  /** Everything Kenya needs as an arrival country: Nairobi open with its warehouse, our company clearing, the fee. */
  const readyKenya = (svc: BorderRouteService) => {
    svc.setWarehouse('KE', 'NBO', { mdpId: 'mdp-nbo', tstLicence: 'TST-KE-0042', validUntil: '2027-06-30', agreement: 'KRA/JKIA/2026/17' }, 'Amina Staff', NOW);
    svc.setAirport('KE', 'NBO', true, 'Amina Staff', NOW);
    svc.setClearer('KE', { kind: 'company', registration: 'KRA-CR-881' }, 'Amina Staff', NOW);
    svc.setFee('KE', 350, 'Amina Staff', NOW);
  };

  it('is refused while anything is missing, each thing by name', () => {
    const svc = setup();
    expect(svc.missing('NL', 'KE', NOW)).toEqual(['clearer', 'fee', 'airport']);
    expect(() => svc.propose('NL', 'KE', AMINA, NOW)).toThrow(/nobody clears in KE yet.*clearance fee in KE is not set.*no airport in KE is open/);
    const closed = setup({ open: ['NL'], companies: ['KE'] });
    expect(closed.missing('NL', 'KE', NOW)).toEqual(['open-to', 'sells-from', 'clearer', 'fee', 'airport']);
    // Being tested is not open to everyone.
    expect(setup({ testing: ['KE'] }).missing('NL', 'KE', NOW)).toContain('open-to');
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
    ]);
  });

  it('a proposal is asked again at approval: what lapsed since refuses it', () => {
    const svc = setup();
    readyKenya(svc);
    svc.propose('NL', 'KE', AMINA, NOW);
    svc.setAirport('KE', 'NBO', false, 'Amina Staff', NOW);
    expect(() => svc.approve('NL', 'KE', BRIAN, NOW)).toThrow(/no airport in KE is open/);
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

  it('the clearance fee is in the arrival company’s money; a route needs two countries', () => {
    const svc = setup();
    expect(svc.setFee('KE', 349.999, 'Amina Staff', NOW).fee).toMatchObject({ amount: 350, currency: 'KES' });
    expect(() => setup({ companies: ['NL'] }).setFee('KE', 100, 'Amina Staff', NOW)).toThrow(/No company of ours stands in KE/);
    expect(() => svc.propose('KE', 'KE', AMINA, NOW)).toThrow(/two different countries/);
    expect(() => svc.propose('NL', 'XX', AMINA, NOW)).toThrow(/No such country/);
  });
});
