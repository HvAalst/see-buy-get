import { useCallback, useEffect, useState } from 'preact/hooks';
import { countryNameIn } from '../../../shared/documents/documents';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useLocale, useT } from '../../../shared/i18n';
import { APP_ROUTES, ROUTE_NAME, changeLine, countLine, goesByLine, moved, routeTag, type AppRoute, type CodeRoutes, type CountryRoutes, type RouteId, type RouteStatus } from '../codeRoutes';
import { momentWords } from '../connections';
import { holds } from '../staffRoles';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * 2026-11-16 — SIGN-IN CODES (the owner: "Can we build it in a way that it becomes visual and controlable from the staff
 * console? If so, we implement."; the plan "Sign-in codes beyond Twilio SMS", D1 to D4). Every route a code can go by and
 * whether it is set up; per country, the order the text routes are tried in, which are off, where codes go now, the apps
 * offered as the person's choice, and each route's last seven days — tried, delivered, typed in, not delivered.
 * Administration moves a route up or down, switches it off or on (the last one on stays on), and offers or withdraws an app.
 * Every change is listed with who made it.
 */
export function CodeRoutesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const locale = useLocale();
  const client = actions.client();
  const who = state.who?.name;
  const writer = state.who?.mode !== 'operator' || holds(state.who.roles, 'admin');
  const [view, setView] = useState<CodeRoutes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.codeRoutes();
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || t('tower.conn.unread'));
    setError(null);
    setView(r.data as unknown as CodeRoutes);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (code: string) => countryNameIn(code, locale);
  const by = who ? { by: who } : {};

  const change = async (key: string, write: () => Promise<{ error?: { detail?: string; title?: string } | null }>) => {
    setBusy(key);
    const r = await write();
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title || '');
    setError(null);
    await load();
  };
  const reorder = (c: CountryRoutes, route: RouteId, step: -1 | 1) => (client ? void change(`${c.country}:${route}:${step}`, () => client.api.setCodeRouteOrder(c.country, { order: moved(c.order, route, step), ...by })) : undefined);
  const turn = (c: CountryRoutes, route: RouteId, on: boolean) => (client ? void change(`${c.country}:${route}:on`, () => client.api.setCodeRoute(c.country, route, { on, ...by })) : undefined);
  const offer = (c: CountryRoutes, route: AppRoute, on: boolean) => (client ? void change(`${c.country}:${route}:offer`, () => client.api.setCodeRouteApp(c.country, route, { on, ...by })) : undefined);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.codes.title')}</h1>
        <p class="cons__lede">{t('tower.codes.lede', { s: view?.autoNextSeconds ?? 60 })}</p>
      </header>
      {error ? (
        <p class="cerr" role="alert">
          <Abbreviated text={error} />
        </p>
      ) : null}
      {view === null ? error ? null : <p class="cons__empty">{t('tower.imports.loading')}</p> : <CodeRoutesBody view={view} writer={writer} busy={busy} apiBase={state.apiBase} nameOf={nameOf} onMove={reorder} onTurn={turn} onOffer={offer} />}
    </>
  );
}

/** Where each route is set up, and the address it reports to where that is set in its own dashboard. */
function setupLine(r: RouteStatus, apiBase: string, t: ReturnType<typeof useT>): string {
  if (r.id === 'africastalking') return t('tower.codes.setup.africastalking', { address: `${apiBase}/v1/sms/status/africastalking` });
  if (r.id === 'whatsapp') return t('tower.codes.setup.whatsapp', { address: `${apiBase}/v1/sms/status/whatsapp` });
  if (r.id === 'telegram') return t('tower.codes.setup.telegram');
  return t('tower.codes.setup.twilio');
}

/** What the screen shows once the routes are read: each route, each country with its controls, and the changes. */
export function CodeRoutesBody({
  view,
  writer,
  busy,
  apiBase,
  nameOf,
  onMove,
  onTurn,
  onOffer,
}: {
  view: CodeRoutes;
  writer: boolean;
  busy: string | null;
  apiBase: string;
  nameOf: (code: string) => string;
  onMove: (c: CountryRoutes, route: RouteId, by: -1 | 1) => void;
  onTurn: (c: CountryRoutes, route: RouteId, on: boolean) => void;
  onOffer: (c: CountryRoutes, route: AppRoute, on: boolean) => void;
}) {
  const t = useT();
  return (
    <>
      {view.routes.map((r) => {
        const tag = routeTag(r, t);
        return (
          <section key={r.id} class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{ROUTE_NAME[r.id]}</span>
              <span class={`ctag ctag--${tag.tone}`}>{tag.tag}</span>
            </div>
            <dl class="cons__facts">
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.codes.fact.reports')}</dt>
                <dd class="cons__factv">{t(r.reportsDelivery ? 'tower.codes.fact.reportsYes' : 'tower.codes.fact.reportsNo')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.codes.fact.last')}</dt>
                <dd class="cons__factv">
                  {r.last ? t(r.last.ok ? 'tower.codes.fact.lastOk' : 'tower.codes.fact.lastFailed', { when: momentWords(r.last.at), why: r.last.failed ? t(`tower.codes.failed.${r.last.failed}`) : '' }) : t('tower.codes.fact.lastNone')}
                </dd>
              </div>
            </dl>
            <p class="chint">{setupLine(r, apiBase, t)}</p>
          </section>
        );
      })}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.codes.countries')}</span>
        </div>
        {view.countries.length === 0 ? <p class="cons__empty">{t('tower.codes.noCountries')}</p> : null}
        {view.countries.map((c) => {
          const goes = goesByLine(c, view.routes, t);
          return (
            <div key={c.country} class="cnote" style="margin-top:12px">
              <p>
                <b>{nameOf(c.country)}</b> <span class="chint">({c.country})</span> <span class={`ctag ctag--${c.switchedOn ? 'ok' : 'muted'}`}>{t(c.switchedOn ? 'tower.codes.switchedOn' : 'tower.codes.notSwitchedOn')}</span>
                {c.changed ? <span class="chint"> · {t('tower.codes.changed')}</span> : null}
              </p>
              <p class={goes.tone === 'ok' ? 'chint' : 'cerr'}>{goes.line}</p>
              <ol style="margin:8px 0 0;padding-left:20px">
                {c.order.map((route, i) => {
                  const off = c.off.includes(route);
                  return (
                    <li key={route} style="margin-top:6px">
                      <b>{ROUTE_NAME[route]}</b> <span class={`ctag ctag--${off ? 'muted' : 'ok'}`}>{t(off ? 'tower.codes.off' : 'tower.codes.on')}</span>
                      <span class="chint"> · {countLine(c.counts.find((n) => n.route === route), t)}</span>
                      {writer ? (
                        <span style="margin-left:8px">
                          <button type="button" class="cbtn cbtn--ghost" disabled={i === 0 || busy !== null} aria-label={t('tower.codes.upFor', { route: ROUTE_NAME[route], country: nameOf(c.country) })} onClick={() => onMove(c, route, -1)}>
                            {t('tower.codes.up')}
                          </button>{' '}
                          <button type="button" class="cbtn cbtn--ghost" disabled={i === c.order.length - 1 || busy !== null} aria-label={t('tower.codes.downFor', { route: ROUTE_NAME[route], country: nameOf(c.country) })} onClick={() => onMove(c, route, 1)}>
                            {t('tower.codes.down')}
                          </button>{' '}
                          <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null} onClick={() => onTurn(c, route, off)}>
                            {t(off ? 'tower.codes.turnOn' : 'tower.codes.turnOff')}
                          </button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {/* 2026-11-16 — the apps a person may choose for their code here (the plan, D2 and D3). */}
              <p class="chint" style="margin-top:10px">
                {t('tower.codes.apps')}
              </p>
              <ul style="margin:4px 0 0;padding-left:20px">
                {APP_ROUTES.map((route) => {
                  const offered = c.offer.includes(route);
                  const setUp = view.routes.find((r) => r.id === route)?.state === 'ready';
                  return (
                    <li key={route} style="margin-top:6px">
                      <b>{ROUTE_NAME[route]}</b> <span class={`ctag ctag--${offered ? (setUp ? 'ok' : 'warn') : 'muted'}`}>{t(offered ? (setUp ? 'tower.codes.offered' : 'tower.codes.offeredNotSetUp') : 'tower.codes.notOffered')}</span>
                      <span class="chint"> · {countLine(c.counts.find((n) => n.route === route), t)}</span>
                      {writer ? (
                        <span style="margin-left:8px">
                          <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null} onClick={() => onOffer(c, route, !offered)}>
                            {t(offered ? 'tower.codes.withdraw' : 'tower.codes.offer')}
                          </button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <p class="chint">{t('tower.codes.countsSince', { when: momentWords(view.since) })}</p>
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.codes.changes')}</span>
        </div>
        {view.changes.length === 0 ? <p class="cons__empty">{t('tower.codes.noChanges')}</p> : null}
        {view.changes.map((ch, i) => (
          <p key={`${ch.at}-${i}`} class="chint">
            {momentWords(ch.at)} · {changeLine(ch, nameOf, t)}
          </p>
        ))}
      </section>
    </>
  );
}
