import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { rosterChanged, rosterPicks, type RosterView, type ordersApi } from '../orders';

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

  useEffect(() => {
    void api.roster(day).then((r) => {
      if (r.error || !r.data) return setError(r.error);
      setView(r.data);
      setPicked(rosterPicks(r.data));
    });
  }, [api, day]);

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
    const r = await api.setRoster(day, view.list.filter((d) => picked.has(d.driverDid)).map((d) => d.driverDid));
    setBusy(false);
    if (r.error || !r.data) return setError(r.error);
    setView(r.data);
    setPicked(rosterPicks(r.data));
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
          <p class="hint">{t('fleet.roster.hint')}</p>
          <div style="margin-top:12px">
            <Button variant="outline" chevron={false} disabled={busy || !rosterChanged(view, picked)} busy={busy} onClick={() => void save()}>
              {t('fleet.roster.save', { n: picked.size })}
            </Button>
          </div>
          {saved ? <p class="hint" role="status">{t(planAccepted ? 'fleet.roster.savedAccepted' : 'fleet.roster.saved')}</p> : null}
        </>
      )}
    </Card>
  );
}
