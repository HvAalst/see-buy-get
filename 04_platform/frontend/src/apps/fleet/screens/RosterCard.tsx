import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { rosterChanged, rosterPicks, rosterShifts, rosterStarts, type RosterView, type ordersApi } from '../orders';

/**
 * WHO DRIVES ON A DAY, on the plan board for that day.
 *
 * The plan counted every active driver as somebody to send out. Here the office ticks who drives, and saving it plans
 * the day again with that many. Each driver whose day changed is told by the server. Nothing here stops anybody
 * starting a shift: the plan follows the vehicle, and that is said beside the button.
 */
export function RosterCard({ api, day, dayLabel, planAccepted, onSaved }: { api: ReturnType<typeof ordersApi>; day: string; dayLabel: string; planAccepted: boolean; onSaved: () => Promise<void> | void }) {
  const t = useT();
  const [view, setView] = useState<RosterView | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  // Where each driver starts that day; the choice is shown only where the fleet has more than one site.
  const [starts, setStarts] = useState<Record<string, string>>({});
  const [shifts, setShifts] = useState<Record<string, string>>({});
  const [sites, setSites] = useState<Array<{ siteId: string; name: string; shifts: Array<{ shiftId: string; name: string; start: string }> }>>([]);

  useEffect(() => {
    void api.roster(day).then((r) => {
      if (r.error || !r.data) return setError(r.error);
      setView(r.data);
      setPicked(rosterPicks(r.data));
      setStarts(rosterStarts(r.data));
      setShifts(rosterShifts(r.data));
    });
  }, [api, day]);
  useEffect(() => {
    void api.sites().then((r) => r.data && setSites(r.data.sites.map((s) => ({ siteId: s.siteId, name: s.name, shifts: [...s.shifts].sort((a, b) => a.start.localeCompare(b.start)) }))));
  }, [api]);
  // Where and on which shift each starts is asked only where there is a choice: more than one site, or a site with shifts.
  const choosing = sites.length > 1 || sites.some((s) => s.shifts.length > 0);
  const shiftsAt = (siteId: string) => sites.find((s) => s.siteId === siteId)?.shifts ?? [];

  if (!view) return error ? <ErrorNote error={error as never} /> : null;

  // From the ticks as they now stand, not as they were when the screen last drew: two taps before it draws again are
  // two taps (the walk found the second one lost).
  const toggle = (did: string) => {
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(did)) next.delete(did);
      else next.add(did);
      return next;
    });
    setSaved(false);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const on = view.list.filter((d) => picked.has(d.driverDid));
    const r = await api.setRoster(
      day,
      on.map((d) => d.driverDid),
      choosing
        ? on.map((d) => {
            const siteId = starts[d.driverDid] ?? d.siteId;
            const shiftId = shifts[d.driverDid] ?? shiftsAt(siteId)[0]?.shiftId;
            return { driverDid: d.driverDid, siteId, ...(shiftId && shiftsAt(siteId).some((x) => x.shiftId === shiftId) ? { shiftId } : {}) };
          })
        : [],
    );
    setBusy(false);
    if (r.error || !r.data) return setError(r.error);
    setView(r.data);
    setPicked(rosterPicks(r.data));
    setStarts(rosterStarts(r.data));
    setShifts(rosterShifts(r.data));
    setSaved(true);
    await onSaved();
  };

  return (
    <Card title={t('fleet.roster.title', { day: dayLabel })}>
      <p class="card__note">{view.source === 'roster' && view.setBy && view.setAt ? t('fleet.roster.set', { who: view.setBy, when: formatDate(view.setAt, { dateStyle: 'medium', timeStyle: 'short' }) }) : t('fleet.roster.notSet')}</p>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      {view.list.length === 0 ? (
        <p class="hint">{t('fleet.roster.noDrivers')}</p>
      ) : (
        <>
          <div class="chips">
            {view.list.map((d) => (
              <button key={d.driverDid} type="button" class={'chip chip--tap' + (picked.has(d.driverDid) ? ' chip--on' : '')} aria-pressed={picked.has(d.driverDid)} onClick={() => toggle(d.driverDid)}>
                {d.name}
              </button>
            ))}
          </div>
          {/* WHERE EACH STARTS, where there is more than one site: their own, unless the office says another for the day. */}
          {choosing && picked.size ? (
            <ul class="rows" style="margin-top:10px">
              {view.list
                .filter((d) => picked.has(d.driverDid))
                .map((d) => (
                  <li key={d.driverDid} class="row row--static">
                    <span class="row__body">
                      <span class="row__t">{d.name}</span>
                      {starts[d.driverDid] && starts[d.driverDid] !== d.homeSiteId ? <span class="row__s">{t('fleet.roster.away', { home: sites.find((s) => s.siteId === d.homeSiteId)?.name ?? '' })}</span> : null}
                    </span>
                    <span class="row__end" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                      {sites.length > 1 ? (
                        <select
                          class="select"
                          aria-label={t('fleet.roster.startsAria', { name: d.name })}
                          value={starts[d.driverDid] ?? d.siteId}
                          onChange={(e) => {
                            const siteId = e.currentTarget.value;
                            setStarts((was) => ({ ...was, [d.driverDid]: siteId }));
                            // Another site: its own first shift, until the office says which.
                            setShifts((was) => {
                              const next = { ...was };
                              const first = shiftsAt(siteId)[0]?.shiftId;
                              if (first) next[d.driverDid] = first;
                              else delete next[d.driverDid];
                              return next;
                            });
                            setSaved(false);
                          }}
                        >
                          {sites.map((s) => (
                            <option key={s.siteId} value={s.siteId}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {shiftsAt(starts[d.driverDid] ?? d.siteId).length ? (
                        <select
                          class="select"
                          aria-label={t('fleet.roster.shiftAria', { name: d.name })}
                          value={shifts[d.driverDid] ?? shiftsAt(starts[d.driverDid] ?? d.siteId)[0].shiftId}
                          onChange={(e) => {
                            const shiftId = e.currentTarget.value;
                            setShifts((was) => ({ ...was, [d.driverDid]: shiftId }));
                            setSaved(false);
                          }}
                        >
                          {shiftsAt(starts[d.driverDid] ?? d.siteId).map((x) => (
                            <option key={x.shiftId} value={x.shiftId}>
                              {t('fleet.roster.shiftOption', { name: x.name, start: x.start })}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
          <p class="hint">{t('fleet.roster.hint')}</p>
          <div style="margin-top:12px">
            <Button variant="outline" chevron={false} disabled={busy || !rosterChanged(view, picked, starts, shifts)} busy={busy} onClick={() => void save()}>
              {t('fleet.roster.save', { n: picked.size })}
            </Button>
          </div>
          {saved ? <p class="hint" role="status">{t(planAccepted ? 'fleet.roster.savedAccepted' : 'fleet.roster.saved')}</p> : null}
        </>
      )}
    </Card>
  );
}
