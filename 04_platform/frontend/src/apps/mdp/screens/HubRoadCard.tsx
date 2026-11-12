import { useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, type components, type SbgClient } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Card } from '../../../shared/ui';

type HubRoadView = components['schemas']['HubRoadView'];

/**
 * 2026-11-12 — A HUB'S PLACE ON THE ROAD (the plan "Hubs on the Road", step 2). Once its country's staff confirmed the road map
 * of hubs: a stop, and the hubs it sends towards — one bin towards each, and its own shops; or local only, and the stop that
 * carries its parcels passing through. Nothing while no map is confirmed: parcels go as they always have.
 */
export function HubRoadCard({ sbg, mdpId }: { sbg: SbgClient | null; mdpId?: string }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [view, setView] = useState<HubRoadView | null>(null);
  useEffect(() => {
    if (!api || !mdpId) return;
    let live = true;
    void api.road(mdpId).then((r) => {
      if (live && r.data) setView(r.data as unknown as HubRoadView);
    });
    return () => {
      live = false;
    };
  }, [api, mdpId]);
  if (!view?.inForce) return null;
  const km = (n: number) => t('mdp.road.km', { km: Math.round(n).toLocaleString() });
  return (
    <Card title={t('mdp.road.title')}>
      {view.role === 'stop' ? (
        <>
          <p class="card__note">{t(view.routing ? 'mdp.road.bins' : 'mdp.road.stop')}</p>
          <ul class="hubzones">
            {view.neighbours.map((n) => (
              <li key={n.mdpId}>
                <b>{t('mdp.road.towards', { hub: n.name })}</b> <span class="hint">{km(n.km)}</span>
              </li>
            ))}
            <li>
              <b>{t('mdp.road.ownShops')}</b>
            </li>
            {/* 2026-11-12 — whole bags for far hubs (step 5): a bin of their own, on the bin towards the next stop's road. */}
            {view.throughBins.map((b) => (
              <li key={b.mdpId}>
                <b>{t('mdp.road.wholeTo', { hub: b.name })}</b> <span class="hint">{t('mdp.road.wholeVia', { hub: b.viaName })}</span>
              </li>
            ))}
          </ul>
        </>
      ) : view.via ? (
        <p class="card__note">{t('mdp.road.local', { hub: view.via.name, km: km(view.via.km) })}</p>
      ) : null}
      <p class="hint">{t('mdp.road.byStaff')}</p>
    </Card>
  );
}
