import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { abroadChangeLine, clearerLine, routeActs, routeStateTag, type BorderArrival, type BorderRoute } from './abroad';
import { RouteRow } from './screens/AbroadScreen';
import { SCREEN_ROLES } from './staffRoles';
import { NAV_GROUPS } from './nav';

/*
 * 2026-11-18 — PARCELS ACROSS A BORDER ON THE CONSOLE (the plan, step 1). A route shows what it still needs, each thing
 * by name; it is proposed only when nothing is missing, approved only by somebody else, and switched off by one person.
 */
const route = (o: Partial<BorderRoute>): BorderRoute => ({
  from: 'NL',
  to: 'KE',
  state: 'off',
  mine: false,
  conditions: (['open-from', 'open-to', 'sells-from', 'sells-to', 'departure', 'carrier', 'price', 'clearer', 'fee', 'airport'] as const).map((key) => ({ key, met: true })),
  departureAirports: ['AMS', 'MST', 'EIN'],
  arrivalAirports: ['NBO', 'MBA', 'KIS'],
  departureHubs: [],
  carriers: [],
  by: 'air',
  fleets: [],
  arrivalHubs: [],
  ...o,
});
const nameOf = (c: string) => ({ NL: 'Netherlands', KE: 'Kenya' })[c] ?? c;

describe('a route on the console', () => {
  // 2026-11-23 — between two EU countries a route goes by road (the plan, part 3, P3-1).
  it('a road route shows and sets its fleet and its central hub — never airports or an outside carrier', () => {
    const road = route({
      to: 'BG',
      by: 'road',
      conditions: (['open-from', 'open-to', 'sells-from', 'fleet', 'hub', 'price'] as const).map((key) => ({ key, met: key !== 'hub' })),
      fleet: { managerDid: 'did:fleet:balkan', name: 'Balkan Line', by: 'Amina', at: '2026-11-23T08:00:00Z' },
      fleets: [{ id: 'did:fleet:balkan', name: 'Balkan Line' }],
      arrivalHubs: [{ id: 'mdp-sof', name: 'Sofia Central Hub' }],
    });
    const names = (c: string) => ({ NL: 'Netherlands', BG: 'Bulgaria' })[c] ?? c;
    const setUp = { api: {} as never, by: {}, change: async () => true };
    const html = renderToString(<RouteRow r={road} nameOf={names} writer busy={null} onAct={() => {}} setUp={setUp} />);
    expect(html).toContain(t('tower.abroad.byRoad'));
    expect(html).toContain('Balkan Line');
    expect(html).toContain('✗ ' + t('tower.abroad.cond.hub', { from: 'Netherlands', to: 'Bulgaria' }));
    expect(html).toContain(t('tower.abroad.hub.pick', { to: 'Bulgaria' }));
    expect(html).not.toContain(t('tower.abroad.dep.airport'));
    expect(html).not.toContain(t('tower.abroad.carrier.pick'));
    expect(routeActs(road)).toEqual([]);
    // And an air route is as it was: airports and a carrier, no fleet.
    const air = renderToString(<RouteRow r={route({ departureHubs: [{ id: 'mdp-ams', name: 'Schiphol Hub' }] })} nameOf={nameOf} writer busy={null} onAct={() => {}} setUp={setUp} />);
    expect(air).toContain(t('tower.abroad.dep.airport'));
    expect(air).not.toContain(t('tower.abroad.fleet.pick'));
  });

  it('says what it still needs, each thing by name, and offers nothing until it has it all', () => {
    const missing = route({ conditions: route({}).conditions.map((c) => ({ ...c, met: c.key !== 'airport' && c.key !== 'fee' })) });
    const html = renderToString(<RouteRow r={missing} nameOf={nameOf} writer busy={null} onAct={() => {}} />);
    expect(html).toContain('Netherlands to Kenya');
    expect(html).toContain('✗ ' + t('tower.abroad.cond.airport', { from: 'Netherlands', to: 'Kenya' }));
    expect(html).toContain('✓ ' + t('tower.abroad.cond.clearer', { from: 'Netherlands', to: 'Kenya' }));
    expect(routeActs(missing)).toEqual([]);
    expect(html).not.toContain(`>${t('tower.abroad.propose')}<`);
  });

  it('proposed when ready; approved only by somebody else; switched off by one', () => {
    expect(routeActs(route({}))).toEqual(['propose']);
    expect(routeActs(route({ state: 'waiting', mine: true }))).toEqual(['decline']);
    expect(routeActs(route({ state: 'waiting', mine: false }))).toEqual(['approve', 'decline']);
    expect(routeActs(route({ state: 'on' }))).toEqual(['off']);
    const mine = renderToString(<RouteRow r={route({ state: 'waiting', mine: true, proposedBy: 'Amina Staff', proposedAt: '2026-11-18T10:00:00Z' })} nameOf={nameOf} writer busy={null} onAct={() => {}} />);
    expect(mine).toContain(t('tower.abroad.mine'));
    expect(mine).toContain(`>${t('tower.abroad.withdraw')}<`);
    expect(mine).not.toContain(`>${t('tower.abroad.approve')}<`);
    expect(routeStateTag(route({ state: 'waiting' }), t).tag).toBe(t('tower.abroad.state.waiting'));
  });

  it('a reader without administration sees it and changes nothing', () => {
    const html = renderToString(<RouteRow r={route({ state: 'on' })} nameOf={nameOf} writer={false} busy={null} onAct={() => {}} />);
    expect(html).not.toContain(`>${t('tower.abroad.off')}<`);
    expect(SCREEN_ROLES.abroad).toEqual(['admin']);
    expect(NAV_GROUPS.find((g) => g.key === 'setup')?.screens).toContain('abroad');
  });
});

describe('an arrival country and the changes', () => {
  const arrival = (o: Partial<BorderArrival>): BorderArrival => ({ country: 'KE', payment: { dutyBy: 'agent', ourPartBy: 'collection' }, airports: [], hubs: [], agents: [], ...o });

  it('says who clears: nobody, an agent waiting to accept or accepted, or our company with its registration', () => {
    const when = () => 'today';
    expect(clearerLine(arrival({}), when, t)).toBe(t('tower.abroad.clearer.none'));
    expect(clearerLine(arrival({ clearer: { kind: 'agent', entityId: 'a', name: 'Swift Clearing', by: 'A', at: 'x' } }), when, t)).toBe(t('tower.abroad.clearer.agentWaiting', { name: 'Swift Clearing' }));
    expect(clearerLine(arrival({ clearer: { kind: 'agent', entityId: 'a', name: 'Swift Clearing', acceptedAt: 'y', by: 'A', at: 'x' } }), when, t)).toBe(t('tower.abroad.clearer.agentAccepted', { name: 'Swift Clearing', when: 'today' }));
    expect(clearerLine(arrival({ clearer: { kind: 'company', entityId: 'sbg-ke', name: 'SeeBuyGet Kenya', registration: 'KRA-CR-881', by: 'A', at: 'x' } }), when, t)).toContain('KRA-CR-881');
  });

  it('lists each change as who did what, where', () => {
    expect(abroadChangeLine({ at: 'x', by: 'Amina Staff', what: 'airport-block', country: 'NL', airport: 'MST' }, nameOf, t)).toBe(t('tower.abroad.change.airport-block', { who: 'Amina Staff', airport: 'MST', country: 'Netherlands' }));
    expect(abroadChangeLine({ at: 'x', by: 'Brian Staff', what: 'approve', country: 'NL', to: 'KE' }, nameOf, t)).toBe('Brian Staff switched on Netherlands to Kenya');
  });
});

/*
 * 2026-11-18 — step 2a: where a route leaves, who carries it and its prices (D13, D14, D10): shown on its row; set while it
 * is off; locked while it waits or is on.
 */
describe('where a route leaves, who carries it, its prices', () => {
  const setUp = { api: {} as never, by: {}, change: async () => true };
  const full = route({
    departure: { airport: 'AMS', mdpId: 'mdp-ams', name: 'Schiphol Hub', by: 'A', at: 'x' },
    carrier: { entityId: 'fwd-nl', name: 'Holland Air Forwarding', by: 'A', at: 'x' },
    prices: { S: 12, M: 19.5, L: 29, currency: 'EUR', by: 'A', at: 'x' },
    departureHubs: [{ id: 'mdp-ams', name: 'Schiphol Hub' }],
    carriers: [{ id: 'fwd-nl', name: 'Holland Air Forwarding' }],
    currency: 'EUR',
  });

  it('says them on the row', () => {
    const html = renderToString(<RouteRow r={full} nameOf={nameOf} writer busy={null} onAct={() => {}} />);
    expect(html).toContain(t('tower.abroad.departureLine', { airport: 'AMS', hub: 'Schiphol Hub' }));
    expect(html).toContain('Holland Air Forwarding');
    expect(html).toMatch(/Small €12\.00 · Medium €19\.50 · Large €29\.00/);
  });

  it('offers to set them while the route is off; locks them while it waits or is on', () => {
    const off = renderToString(<RouteRow r={full} nameOf={nameOf} writer busy={null} onAct={() => {}} setUp={setUp} />);
    expect(off).toContain(`>${t('tower.abroad.dep.save')}<`);
    expect(off).toContain(`>${t('tower.abroad.prices.save')}<`);
    const on = renderToString(<RouteRow r={{ ...full, state: 'on' }} nameOf={nameOf} writer busy={null} onAct={() => {}} setUp={setUp} />);
    expect(on).not.toContain(`>${t('tower.abroad.dep.save')}<`);
    expect(on).toContain(t('tower.abroad.locked'));
    expect(abroadChangeLine({ at: 'x', by: 'Amina Staff', what: 'prices', country: 'NL', to: 'KE' }, nameOf, t)).toBe(t('tower.abroad.change.prices', { who: 'Amina Staff', from: 'Netherlands', to: 'Kenya' }));
  });

  it('D16 — names where it arrives; says so when that airport is not open yet', () => {
    const named = renderToString(<RouteRow r={{ ...full, arrival: { airport: 'NBO', by: 'A', at: 'x' } }} nameOf={nameOf} writer busy={null} onAct={() => {}} setUp={setUp} />);
    expect(named).toContain(`>${t('tower.abroad.arrival.save')}<`);
    const shown = renderToString(<RouteRow r={{ ...full, arrival: { airport: 'NBO', by: 'A', at: 'x' } }} nameOf={nameOf} writer={false} busy={null} onAct={() => {}} />);
    expect(shown).toContain(`${t('tower.abroad.arrival')}</b> · NBO`);
    expect(named).not.toContain(t('tower.abroad.arrival.closed', { airport: 'NBO' }));
    const closed = { ...full, arrival: { airport: 'MBA', by: 'A', at: 'x' }, conditions: full.conditions.map((c) => ({ ...c, met: c.key !== 'airport' })) };
    expect(renderToString(<RouteRow r={closed} nameOf={nameOf} writer busy={null} onAct={() => {}} />)).toContain(t('tower.abroad.arrival.closed', { airport: 'MBA' }));
    expect(renderToString(<RouteRow r={route({})} nameOf={nameOf} writer busy={null} onAct={() => {}} />)).toContain(t('tower.abroad.arrival.none'));
    expect(abroadChangeLine({ at: 'x', by: 'Amina Staff', what: 'arrival', country: 'NL', to: 'KE', airport: 'NBO' }, nameOf, t)).toBe('Amina Staff named where Netherlands to Kenya arrives: NBO');
    expect(abroadChangeLine({ at: 'x', by: 'Amina Staff', what: 'readdress', country: 'KE' }, nameOf, t)).toBe('Amina Staff set the warehouse and extra handling fees in Kenya');
  });

  it('says plainly what cannot be named yet: no hub, no carrier, no company to price for', () => {
    const bare = renderToString(<RouteRow r={route({})} nameOf={nameOf} writer busy={null} onAct={() => {}} setUp={setUp} />);
    expect(bare).toContain(t('tower.abroad.dep.noHubs', { from: 'Netherlands' }));
    expect(bare).toContain(t('tower.abroad.carrier.noCarriers', { from: 'Netherlands' }));
    expect(bare).toContain(t('tower.abroad.prices.noCompany', { from: 'Netherlands' }));
  });
});
