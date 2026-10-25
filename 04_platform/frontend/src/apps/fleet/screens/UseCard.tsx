import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { shiftDay, useLines, weekEnding, type FleetUse, type SitesApi } from '../sites';
import { localDay } from '../../../shared/upkeep/care';

/**
 * HOW THE VEHICLES WERE USED, a week at a time: the fleet, each site, and each vehicle — days out, hours on shift, what
 * they carried and how much of their running was loaded, days off the road and idle. From what was recorded alone; a
 * vehicle's use, never how anybody drove.
 */
export function UseCard({ api }: { api: SitesApi }) {
  const t = useT();
  // The week ends on the fleet's own today — Nairobi's for a Kenyan fleet — not the reading device's.
  const [today, setToday] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [use, setUse] = useState<FleetUse | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void api.clock().then((r) => {
      const day = r.data?.today ?? localDay();
      setToday(day);
      setEnd(day);
    });
  }, [api]);

  useEffect(() => {
    if (!end) return;
    const { from, to } = weekEnding(end);
    setError(null);
    void api.use(from, to).then((r) => (r.error || !r.data ? setError(r.error) : setUse(r.data)));
  }, [api, end]);

  if (!end || !today) return null;
  const { from, to } = weekEnding(end);
  return (
    <Card title={t('fleet.use.title')}>
      <p class="card__note">{t('fleet.use.lead')}</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <Button variant="link" full={false} onClick={() => setEnd(shiftDay(end, -7))}>
          {t('fleet.use.earlier')}
        </Button>
        <span class="t-body">{t('fleet.use.span', { from, to })}</span>
        {end < today ? (
          <Button variant="link" full={false} onClick={() => setEnd(shiftDay(end, 7) > today ? today : shiftDay(end, 7))}>
            {t('fleet.use.later')}
          </Button>
        ) : null}
      </div>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      {use ? (
        <>
          <p class="field__label" style="margin-top:12px">
            {t('fleet.use.fleet', { n: use.totals.vehicles })}
          </p>
          {useLines(use.totals, use.days, t).map((line) => (
            <p key={line} class="hint" style="margin:2px 0">
              {line}
            </p>
          ))}
          {use.sites
            .filter((s) => s.vehicles > 0)
            .map((s) => (
              <div key={s.siteId} style="margin-top:14px">
                {use.sites.length > 1 ? (
                  <>
                    <p class="field__label">{t('fleet.use.site', { site: s.name, n: s.vehicles })}</p>
                    {useLines(s, use.days, t).map((line) => (
                      <p key={line} class="hint" style="margin:2px 0">
                        {line}
                      </p>
                    ))}
                  </>
                ) : null}
                <ul class="rows">
                  {use.vehicles
                    .filter((v) => v.siteId === s.siteId)
                    .map((v) => (
                      <li key={v.vehicleId} class="row row--static">
                        <span class="row__body">
                          <span class="row__t">
                            {v.plate} · {v.vehicleClass}
                          </span>
                          {useLines(v, use.days, t).map((line) => (
                            <span key={line} class="row__s">
                              {line}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
        </>
      ) : error ? null : (
        <p class="hint">{t('fleet.sites.loading')}</p>
      )}
    </Card>
  );
}
