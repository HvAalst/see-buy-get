import { useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient } from '../../../lib/sbg';
import { useT, type MessageKey } from '../../../shared/i18n';
import { Button, Card, Note, refusalSentence } from '../../../shared/ui';
import type { HubZoneLine, HubZonesView } from '../types';

/**
 * 2026-11-09 — THE ZONES A HUB SERVES (a net of hubs; the owner: "Own zone + hub adds"). The zone it stands in is always
 * its own; it adds zones near it and stops serving them; a zone SeeBuyGet's staff took away it cannot add back. Shops in a
 * zone send their parcels to the nearest of its hubs that has room. Its owner decides; its floor people read it. Nothing
 * where its country keeps no zones yet.
 */
export function ZonesServedCard({ sbg, mdpId, staff }: { sbg: SbgClient | null; mdpId?: string; staff: boolean }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [view, setView] = useState<HubZonesView | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !mdpId) return;
    let live = true;
    void api.zonesServed(mdpId).then((r) => {
      if (live && r.data) setView(r.data as unknown as HubZonesView);
    });
    return () => {
      live = false;
    };
  }, [api, mdpId]);

  if (!view || view.mapVersion == null || !mdpId || !api) return null;

  const change = async (zone: HubZoneLine, serve: boolean) => {
    setBusy(zone.code);
    setSaid(null);
    const r = await api.serveZone(mdpId, zone.code, serve);
    setBusy(null);
    if (r.error) return setProblem(refusalSentence(r.error));
    setProblem(null);
    setView(r.data as unknown as HubZonesView);
    setSaid(t(serve ? 'mdp.zones.added' : 'mdp.zones.stopped', { zone: zone.name }));
  };
  const others = view.serves.filter((z) => z.code !== view.standsIn?.code);
  const km = (z: HubZoneLine) => (z.km != null ? t('mdp.zones.km', { km: z.km.toLocaleString() }) : '');

  return (
    <Card title={t('mdp.zones.title')}>
      <p class="card__note">{t('mdp.zones.lede')}</p>
      {said ? <Note tone="ok" icon="check" title={said} /> : null}
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      {view.standsIn ? <p class="t-body">{t(view.standsIn.how ? 'mdp.zones.standsIn' : 'mdp.zones.standsTaken', { zone: view.standsIn.name })}</p> : null}
      {others.length ? (
        <ul class="hubzones">
          {others.map((z) => (
            <li key={z.code}>
              <span>
                <b>{z.name}</b> <span class="hint">{[km(z), z.how ? t(`mdp.zones.how.${z.how}` as MessageKey) : ''].filter(Boolean).join(' · ')}</span>
              </span>
              {!staff ? (
                <Button variant="link" full={false} busy={busy === z.code} onClick={() => void change(z, false)}>
                  {t('mdp.zones.stop')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {view.taken.length ? <p class="hint">{t('mdp.zones.taken', { zones: view.taken.map((z) => z.name).join(', ') })}</p> : null}
      {staff ? (
        <p class="hint">{t('mdp.zones.ownerDecides')}</p>
      ) : view.nearby.length ? (
        <>
          <p class="t-body">
            <b>{t('mdp.zones.nearTitle')}</b>
          </p>
          <ul class="hubzones">
            {view.nearby.map((z) => (
              <li key={z.code}>
                <span>
                  {z.name} <span class="hint">{km(z)}</span>
                </span>
                <Button variant="link" full={false} busy={busy === z.code} onClick={() => void change(z, true)}>
                  {t('mdp.zones.serve')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
