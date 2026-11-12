import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { components } from '../../../lib/sbg';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { Icon } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { ConsolePick } from '../ConsolePick';
import { ConsoleFold } from '../ConsoleFold';
import { holds } from '../staffRoles';
import type { TowerActions, TowerState } from '../useTowerApp';
import type { ZoneAreaShape, ZoneShapes } from '../zones';
import { ZoneAreaMap } from './ZoneAreaMap';
import type { MapLine, MapPin } from './ZoneAreaMapLeaflet';
import { densityFill, suggestionLine, type HubDensity } from '../hubDensity';
import { HubListFold } from './HubListFold';

type Reach = components['schemas']['DensityReach'];
type HubList = components['schemas']['HubListView'];

/**
 * 2026-11-12 — WHERE HUBS ARE NEEDED (the owner, 2026-11-11: "each country staff should have a part in their system where they
 * have a hub density optimiser on a map. It would show them where hubs are needed or needed extra"; the plan "Hubs on the
 * Road", step 3). A country's zones coloured by how far their shops are from a hub, or by their parcels; its hubs, their roads
 * and how full they run; and what the map suggests, each with its reason and numbers — shared as an invitation to the hub
 * sign-up with the place filled in, or set aside with why. It suggests; staff decide.
 */
export function HubDensityScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const sisters = (state.entities ?? []).filter((e) => e.kind === 'sister');
  const own = state.who?.entityId && sisters.some((s) => s.entityId === state.who?.entityId) ? state.who.entityId : undefined;
  const [entityId, setEntityId] = useState<string | null>(own ?? sisters[0]?.entityId ?? null);
  useEffect(() => {
    if (!entityId && (own ?? sisters[0]?.entityId)) setEntityId(own ?? sisters[0].entityId);
  }, [own, sisters.length]);
  const writer = state.who?.mode !== 'operator' || holds(state.who.roles, 'admin');
  const [view, setView] = useState<HubDensity | null>(null);
  const [shapes, setShapes] = useState<ZoneShapes | null>(null);
  const [layer, setLayer] = useState<'coverage' | 'demand'>('coverage');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reach, setReach] = useState<Reach | null>(null);
  const [list, setList] = useState<HubList | null>(null);

  const load = useCallback(async () => {
    if (!client || !entityId) return;
    const r = await client.api.hubDensity(entityId);
    if (r.error) return setError(r.error.detail || r.error.title || '');
    const v = r.data as unknown as HubDensity;
    setError(null);
    setView(v);
    setReach(v.reach);
    // 2026-11-12 — the country's hub list (the owner's D2 and D7), beside the map.
    void client.api.hubList(entityId).then((l) => setList(l.error ? null : (l.data as unknown as HubList)));
    if (v.mapVersion != null) {
      const s = await client.api.zoneShapes(entityId, v.mapVersion);
      setShapes(s.error ? null : (s.data as unknown as ZoneShapes));
    } else setShapes(null);
  }, [client, entityId]);
  useEffect(() => {
    setView(null);
    setShapes(null);
    setList(null);
    setDone(null);
    void load();
  }, [load]);

  const run = async (key: string, write: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    const r = (await write()) as { error?: { detail?: string; title?: string } | null; data?: unknown };
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title || '');
    const v = r.data as unknown as HubDensity;
    setView(v);
    setReach(v.reach);
    setDone(message);
  };

  const byZone = useMemo(() => new Map((view?.zones ?? []).map((z) => [z.code, z])), [view]);
  const maxParcels = useMemo(() => Math.max(1, ...(view?.zones ?? []).map((z) => z.sent30 + z.received30)), [view]);
  const fillOf = useCallback((area: ZoneAreaShape) => densityFill(byZone.get(area.zone), layer, maxParcels), [byZone, layer, maxParcels]);
  const labelOf = useCallback(
    (area: ZoneAreaShape) => {
      const z = byZone.get(area.zone);
      if (!z) return area.name;
      return t('tower.density.areaLabel', { area: area.name, zone: z.name, shops: z.shops, parcels: z.sent30 + z.received30, km: z.km != null ? Math.round(z.km) : '—', coverage: t(`tower.density.coverage.${z.coverage}` as MessageKey) });
    },
    [byZone, t],
  );
  const pins: MapPin[] = useMemo(() => {
    if (!view) return [];
    const hubs: MapPin[] = view.hubs.map((h) => ({ id: h.mdpId, lat: h.location.lat, lng: h.location.lng, label: t('tower.density.hubLabel', { hub: h.name, full: h.fullDays }), kind: h.down ? 'down' : h.role === 'local' ? 'local' : 'stop' }));
    const marks: MapPin[] = view.suggestions.filter((s) => s.kind === 'hub_needed' || s.kind === 'extra_hub' || s.kind === 'road_gap').map((s) => ({ id: s.id, lat: s.place.lat, lng: s.place.lng, label: suggestionLine(s, t), kind: 'suggested' }));
    return [...hubs, ...marks];
  }, [view, t]);
  const lines: MapLine[] = useMemo(() => {
    if (!view) return [];
    const at = new Map(view.hubs.map((h) => [h.mdpId, h.location]));
    return view.links.flatMap((l) => {
      const [a, b] = [at.get(l.a), at.get(l.b)];
      return a && b ? [{ from: [a.lat, a.lng] as [number, number], to: [b.lat, b.lng] as [number, number], kind: 'road' as const }] : [];
    });
  }, [view]);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.density.title')}</h1>
        <p class="cons__lede">{t('tower.density.lede')}</p>
      </header>
      {sisters.length > 1 ? (
        <section class="cons__panel">
          <div class="twr-corridorform">
            <ConsolePick label={t('tower.zones.choose')} value={entityId ?? ''} onChange={(v) => setEntityId(v || null)} options={sisters.map((c) => ({ value: c.entityId, label: c.name, tag: c.jurisdiction }))} />
          </div>
        </section>
      ) : null}
      {done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {done}
        </p>
      ) : null}
      {error ? (
        <p class="cerr">
          <Abbreviated text={error} />
        </p>
      ) : null}
      {!view ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : (
        <>
          <section class="cons__panel">
            {view.mapVersion == null ? <p class="chint">{t('tower.density.noZones')}</p> : null}
            <div class="twr-panelend">
              {(['coverage', 'demand'] as const).map((l) => (
                <button key={l} type="button" class={`cbtn cbtn--sm ${layer === l ? 'cbtn--primary' : 'cbtn--ghost'}`} aria-pressed={layer === l} onClick={() => setLayer(l)}>
                  {t(`tower.density.layer.${l}` as MessageKey)}
                </button>
              ))}
            </div>
            <div class="twr-zonemap">
              <ZoneAreaMap areas={shapes?.areas ?? []} setId={shapes?.setId ?? `density:${view.entityId}`} fillOf={fillOf} labelOf={labelOf} chosen={new Set<string>()} pins={pins} lines={lines} />
              <p class="chint">{t(layer === 'coverage' ? 'tower.density.keyCoverage' : 'tower.density.keyDemand', view.reach)}</p>
            </div>
          </section>

          {entityId ? <HubListFold entityId={entityId} writer={writer} actions={actions} list={list} onList={setList} /> : null}
          {/* Two stops kept too close are not a place to recruit: said here, for the road map. */}
          {view.suggestions.some((s) => s.kind === 'too_close') ? (
            <section class="cons__panel">
              <p class="twr-clear__t">{t('tower.density.kind.too_close')}</p>
              {view.suggestions.filter((s) => s.kind === 'too_close').map((s) => (
                <p key={s.id} class="chint">{suggestionLine(s, t)}</p>
              ))}
            </section>
          ) : null}

          <ConsoleFold title={t('tower.density.hubsTitle')} hint={t('tower.density.hubsHint', { n: view.hubs.length })}>
            <table class="ctbl ctbl--stack">
              <thead>
                <tr>
                  <th>{t('tower.density.col.hub')}</th>
                  <th>{t('tower.density.col.full')}</th>
                  <th>{t('tower.density.col.sorted')}</th>
                  <th>{t('tower.density.col.waiting')}</th>
                </tr>
              </thead>
              <tbody>
                {view.hubs.map((h) => (
                  <tr key={h.mdpId}>
                    <td class="ctbl__strong">
                      <span class="ctbl__lbl">{t('tower.density.col.hub')}</span>
                      {h.name} <span class="ctbl__sub">{h.down ? t('tower.roadMap.kind.down') : h.role ? t(h.role === 'stop' ? 'tower.roadMap.kind.stop' : 'tower.roadMap.kind.local') : ''}</span>
                    </td>
                    <td class="ctbl__num">
                      <span class="ctbl__lbl">{t('tower.density.col.full')}</span>
                      {t('tower.density.fullOf', { n: h.fullDays })}
                    </td>
                    <td class="ctbl__num">
                      <span class="ctbl__lbl">{t('tower.density.col.sorted')}</span>
                      {h.sortPerDay != null ? t('tower.density.sortedOf', { n: h.sortedPerDay, of: h.sortPerDay }) : h.sortedPerDay}
                    </td>
                    <td class="ctbl__num">
                      <span class="ctbl__lbl">{t('tower.density.col.waiting')}</span>
                      {h.waiting}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ConsoleFold>

          {reach ? (
            <ConsoleFold title={t('tower.density.reachTitle')} hint={t('tower.density.reachHint', view.reach)}>
              <p class="chint">{t('tower.density.reachLede', view.reachStart)}</p>
              <div class="twr-knobs__row">
                {(['urban', 'rural', 'remote'] as const).map((g) => (
                  <label key={g} class="cfield">
                    <span class="cfield__label">{t(`tower.density.reach.${g}` as MessageKey)}</span>
                    <input class="cinput" type="number" min={1} max={1000} inputMode="numeric" disabled={!writer} value={String(reach[g])} onInput={(e) => setReach({ ...reach, [g]: Number(e.currentTarget.value) })} />
                  </label>
                ))}
              </div>
              {writer && client && entityId ? (
                <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null || !reach.urban || !reach.rural || !reach.remote || (reach.urban === view.reach.urban && reach.rural === view.reach.rural && reach.remote === view.reach.remote)} onClick={() => void run('reach', () => client.api.setDensityReach(entityId, { urban: Math.round(reach.urban), rural: Math.round(reach.rural), remote: Math.round(reach.remote) }), t('tower.density.reachSaved'))}>
                  {t('tower.rates.save')}
                </button>
              ) : null}
            </ConsoleFold>
          ) : null}
        </>
      )}
    </>
  );
}
