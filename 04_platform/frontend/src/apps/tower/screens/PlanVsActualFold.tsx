import { useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ConsoleFold } from '../ConsoleFold';
import { laneWords, planFoldHint, type PlanLane } from '../planVsActual';

type Api = { planVsActual: (days?: number) => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }> };

/**
 * PLAN VERSUS ACTUAL, LANE BY LANE.
 *
 * Every parcel taken in at a counter is given a route and a time it should be ready to collect, and both are kept on
 * it. This reads each lane against those promises: how many were ready on time, how late the late ones usually were,
 * how many went through the shops and hubs they were planned through — and the latest one, to open. A lane that is
 * habitually wrong used to look exactly like one that is right; this is the one place it does not.
 */
export function PlanVsActualFold({ client }: { client: { api: unknown } | null }) {
  const t = useT();
  const [lanes, setLanes] = useState<PlanLane[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    void (client.api as Api).planVsActual().then((r) => {
      if (r.error || !r.data) {
        setError(r.error?.detail || r.error?.title || t('tower.plan.failed'));
        setLanes([]);
        return;
      }
      setLanes(((r.data as { lanes?: PlanLane[] }).lanes ?? []) as PlanLane[]);
    });
  }, [client]);

  return (
    <ConsoleFold title={t('tower.plan.title')} hint={planFoldHint(lanes, t)}>
      <p class="cons__lede">{t('tower.plan.hint')}</p>
      {error ? <p class="cerr">{error}</p> : null}
      {!lanes ? (
        <p class="cons__empty">{t('tower.plan.loading')}</p>
      ) : lanes.length === 0 ? (
        <p class="cons__empty">{t('tower.plan.none')}</p>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.plan.col.lane')}</th>
              <th class="ctbl__num">{t('tower.plan.col.onTime')}</th>
              <th>{t('tower.plan.col.late')}</th>
              <th class="ctbl__num">{t('tower.plan.col.route')}</th>
              <th>{t('tower.plan.col.worst')}</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((lane) => {
              const w = laneWords(lane, t);
              return (
                <tr key={`${lane.from}>${lane.to}`}>
                  <td class="ctbl__strong">{w.lane}</td>
                  <td class="ctbl__num">
                    <span class="ctbl__lbl">{t('tower.plan.col.onTime')}</span>
                    {w.onTime}
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.plan.col.late')}</span>
                    {lane.late ? <span class="ctag ctag--warn">{w.late}</span> : w.late}
                  </td>
                  <td class="ctbl__num">
                    <span class="ctbl__lbl">{t('tower.plan.col.route')}</span>
                    {w.route}
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.plan.col.worst')}</span>
                    <span class="ctbl__mono">{w.worst}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ConsoleFold>
  );
}
