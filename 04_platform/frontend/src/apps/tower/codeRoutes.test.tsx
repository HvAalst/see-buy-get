import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { changeLine, countLine, goesByLine, moved, routeTag, type CodeRoutes, type CountryRoutes, type RouteStatus } from './codeRoutes';
import { CodeRoutesBody, CodeRoutesScreen } from './screens/CodeRoutesScreen';
import type { TowerActions, TowerState } from './useTowerApp';

/*
 * 2026-11-16 — SIGN-IN CODES ON THE STAFF CONSOLE (the owner: "Can we build it in a way that it becomes visual and controlable
 * from the staff console? If so, we implement."). Each route and whether it sends; per country the order, what is off, where
 * codes go now and why a first route is passed over; the week's counts; the changes and who made them.
 */
const routes: RouteStatus[] = [
  { id: 'africastalking', state: 'not_set_up', reportsDelivery: false },
  { id: 'twilio', state: 'ready', reportsDelivery: true, last: { at: '2026-11-16T10:00:00.000Z', ok: true } },
];
const ke: CountryRoutes = {
  country: 'KE',
  switchedOn: true,
  order: ['africastalking', 'twilio'],
  off: [],
  changed: false,
  goesBy: 'twilio',
  counts: [
    { route: 'africastalking', asked: 0, delivered: 0, failed: 0, entered: 0 },
    { route: 'twilio', asked: 40, delivered: 37, failed: 3, entered: 35 },
  ],
};

describe('the words of the Sign-in codes screen', () => {
  it('moves a route one place, and not past an end', () => {
    expect(moved(['africastalking', 'twilio'], 'twilio', -1)).toEqual(['twilio', 'africastalking']);
    expect(moved(['africastalking', 'twilio'], 'africastalking', -1)).toEqual(['africastalking', 'twilio']);
    expect(moved(['africastalking', 'twilio'], 'twilio', 1)).toEqual(['africastalking', 'twilio']);
  });

  it('says where codes go now, and why the first route is passed over', () => {
    expect(goesByLine(ke, routes, t)).toEqual({ tone: 'warn', line: t('tower.codes.goesByInstead', { route: 'Twilio', first: 'Africa’s Talking', why: t('tower.codes.passed.notSetUp') }) });
    expect(goesByLine({ ...ke, order: ['twilio', 'africastalking'] }, routes, t)).toEqual({ tone: 'ok', line: t('tower.codes.goesBy', { route: 'Twilio' }) });
    expect(goesByLine({ ...ke, goesBy: undefined }, routes, t).line).toBe(t('tower.codes.goesNone'));
  });

  it('a route as a tag, a week as a line, a change as who did what where', () => {
    expect(routeTag(routes[1], t)).toEqual({ tone: 'ok', tag: t('tower.codes.state.ready') });
    expect(routeTag(routes[0], t).tone).toBe('muted');
    expect(countLine(ke.counts[1], t)).toBe(t('tower.codes.count', { asked: 40, delivered: 37, entered: 35, failed: 3 }));
    expect(countLine(ke.counts[0], t)).toBe(t('tower.codes.count.none'));
    const name = (c: string) => (c === 'KE' ? 'Kenya' : c);
    expect(changeLine({ at: '2026-11-16T10:00:00.000Z', by: 'Amina Staff', country: 'KE', what: 'order', order: ['twilio', 'africastalking'] }, name, t)).toBe(t('tower.codes.change.order', { who: 'Amina Staff', country: 'Kenya', order: 'Twilio, Africa’s Talking' }));
    expect(changeLine({ at: '2026-11-16T10:00:00.000Z', by: 'Brian Staff', country: 'KE', what: 'off', route: 'twilio' }, name, t)).toBe(t('tower.codes.change.off', { who: 'Brian Staff', country: 'Kenya', route: 'Twilio' }));
  });
});

describe('the Sign-in codes screen', () => {
  const view: CodeRoutes = { routes, countries: [ke], changes: [{ at: '2026-11-16T09:00:00.000Z', by: 'Amina Staff', country: 'KE', what: 'on', route: 'africastalking' }], since: '2026-11-09T10:00:00.000Z', autoNextSeconds: 60 };
  const state = { who: { mode: 'operator', roles: ['admin'], name: 'Amina Staff' }, apiBase: 'https://seebuyget.com' } as unknown as TowerState;
  const actions = { client: () => null } as unknown as TowerActions;

  it('renders its title and lede before the routes arrive', () => {
    const html = renderToString(<CodeRoutesScreen state={state} actions={actions} />);
    expect(html).toContain(t('tower.codes.title'));
    expect(html).toContain(t('tower.codes.lede', { s: 60 }).slice(0, 40));
  });

  const body = (writer: boolean) => renderToString(<CodeRoutesBody view={view} writer={writer} busy={null} apiBase="https://seebuyget.com" nameOf={(c) => (c === 'KE' ? 'Kenya' : c)} onMove={() => undefined} onTurn={() => undefined} />);

  it('shows each route, the address Africa’s Talking reports to, each country with where codes go, and the changes', () => {
    const html = body(true);
    expect(html).toContain('Africa’s Talking');
    expect(html).toContain(t('tower.codes.state.ready'));
    expect(html).toContain('https://seebuyget.com/v1/sms/status/africastalking');
    expect(html).toContain('Kenya');
    expect(html).toContain(t('tower.codes.count', { asked: 40, delivered: 37, entered: 35, failed: 3 }));
    expect(html).toContain(t('tower.codes.change.on', { who: 'Amina Staff', country: 'Kenya', route: 'Africa’s Talking' }));
  });

  it('administration gets the controls; anyone else reads only', () => {
    expect(body(true)).toContain(`>${t('tower.codes.turnOff')}<`);
    expect(body(true)).toContain(`>${t('tower.codes.up')}<`);
    expect(body(false)).not.toContain(`>${t('tower.codes.turnOff')}<`);
    expect(body(false)).not.toContain(`>${t('tower.codes.up')}<`);
  });
});
