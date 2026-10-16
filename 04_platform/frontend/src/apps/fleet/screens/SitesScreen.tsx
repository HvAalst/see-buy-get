import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Pill, PlaceMap } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { Result, SbgClient } from '../../../lib/sbg';
import type { FleetState } from '../useFleetApp';
import { pointOf, sitesApi, type FleetSite, type FleetSites } from '../sites';

/**
 * A FLEET'S SITES: the depots and yards its trucks and drivers work from, on a map; adding one, changing one, closing
 * one nobody works from; and, once there is more than one, who works from where. The day's plan starts every truck
 * from its own site, and sends out of a site no more trucks than drivers start there.
 */
export function SitesScreen({ state, sbg }: { state: FleetState; sbg: SbgClient | null }) {
  const t = useT();
  const fleetDid = state.manager?.did;
  const api = useMemo(() => (sbg && fleetDid ? sitesApi(sbg, fleetDid) : null), [sbg, fleetDid]);
  const [view, setView] = useState<FleetSites | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The site being written: a new one, or one already there.
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!api) return;
    void api.view().then((r) => (r.error || !r.data ? setError(r.error) : setView(r.data)));
  }, [api]);

  const act = async (call: () => Promise<Result<FleetSites>>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    if (r.error || !r.data) {
      setError(r.error);
      return false;
    }
    setView(r.data);
    return true;
  };
  const open = (site: FleetSite | null) => {
    setEditing(site ? site.siteId : 'new');
    setName(site?.name ?? '');
    setAddress(site?.address ?? '');
    setPoint(site ? { lat: site.location.lat, lng: site.location.lng } : null);
    setTyped('');
  };
  const save = async () => {
    const at = point ?? pointOf(typed);
    const body = { name: name.trim(), address: address.trim(), ...(at ? { lat: at.lat, lng: at.lng } : {}) };
    const done = await act(() => (editing === 'new' ? api!.add(body) : api!.update(editing!, body)));
    if (done) setEditing(null);
  };

  if (!view) return <div class="scr">{error ? <ErrorNote error={error as never} /> : <p class="hint">{t('fleet.sites.loading')}</p>}</div>;
  const many = view.sites.length > 1;

  return (
    <div class="scr">
      <Card title={t('fleet.sites.title')}>
        <p class="card__note">{t('fleet.sites.lead')}</p>
        {error ? <ErrorNote error={error as never} showDetail /> : null}
        <PlaceMap
          pins={view.sites.map((s) => ({ id: s.siteId, label: s.name, point: s.location }))}
          {...(editing ? { onDrop: (p: { lat: number; lng: number }) => setPoint(p), dropped: point } : {})}
          label={t('fleet.sites.mapAria', { n: view.sites.length })}
        />
        {editing ? (
          <div style="margin-top:12px">
            <p class="hint">{t('fleet.sites.dropHint')}</p>
            <div class="field">
              <label class="field__label" for="site-name">
                {t('fleet.sites.name')}
              </label>
              <input id="site-name" class="input" maxLength={80} value={name} placeholder={t('fleet.sites.namePh')} onInput={(e) => setName(e.currentTarget.value)} />
            </div>
            <div class="field">
              <label class="field__label" for="site-address">
                {t('fleet.sites.address')}
              </label>
              <input id="site-address" class="input" maxLength={200} value={address} onInput={(e) => setAddress(e.currentTarget.value)} />
            </div>
            <div class="field">
              <label class="field__label" for="site-point">
                {t('fleet.sites.point')}
              </label>
              <input id="site-point" class="input input--mono" value={point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : typed} placeholder="-1.29210, 36.82190" onInput={(e) => { setPoint(null); setTyped(e.currentTarget.value); }} />
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <Button full={false} chevron={false} busy={busy} disabled={busy || !name.trim() || !(point ?? pointOf(typed))} onClick={() => void save()}>
                {t(editing === 'new' ? 'fleet.sites.add' : 'fleet.sites.save')}
              </Button>
              <Button variant="link" full={false} onClick={() => setEditing(null)}>
                {t('fleet.care.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
        <ul class="rows">
          {view.sites.map((s) => (
            <li key={s.siteId} class="row row--static">
              <span class="row__body">
                <span class="row__t">{s.name}</span>
                {s.address ? <span class="row__s">{s.address}</span> : null}
                <span class="row__s">{t('fleet.sites.counts', { vehicles: s.vehicles, drivers: s.drivers })}</span>
                <span style="display:flex;gap:2px 16px;flex-wrap:wrap">
                  <Button variant="link" full={false} disabled={busy} onClick={() => open(s)}>
                    {t('fleet.sites.change')}
                  </Button>
                  {many ? (
                    <Button variant="link" full={false} disabled={busy} onClick={() => void act(() => api!.close(s.siteId))}>
                      {t('fleet.sites.close')}
                    </Button>
                  ) : null}
                </span>
              </span>
              {s.main ? (
                <span class="row__end">
                  <Pill tone="idle">{t('fleet.sites.main')}</Pill>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {editing ? null : (
          <Button variant="outline" chevron={false} onClick={() => open(null)}>
            {t('fleet.sites.addCta')}
          </Button>
        )}
      </Card>

      {/* WHO WORKS FROM WHERE — only once there is somewhere else to work from. */}
      {many ? (
        <Card title={t('fleet.sites.homesTitle')}>
          <p class="card__note">{t('fleet.sites.homesLead')}</p>
          {[
            { kind: 'vehicle' as const, title: t('fleet.sites.vehicles'), list: view.vehicles },
            { kind: 'driver' as const, title: t('fleet.sites.drivers'), list: view.drivers },
          ].map((group) => (
            <div key={group.kind} style="margin-top:12px">
              <p class="field__label">{group.title}</p>
              {group.list.length === 0 ? <p class="hint">{t('fleet.sites.none')}</p> : null}
              <ul class="rows">
                {group.list.map((h) => (
                  <li key={h.id} class="row row--static">
                    <span class="row__body">
                      <span class="row__t">{h.name}</span>
                    </span>
                    <span class="row__end">
                      <select class="select" aria-label={t('fleet.sites.homeAria', { name: h.name })} value={h.siteId} disabled={busy} onChange={(e) => void act(() => api!.setHome(group.kind, h.id, e.currentTarget.value))}>
                        {view.sites.map((s) => (
                          <option key={s.siteId} value={s.siteId}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
