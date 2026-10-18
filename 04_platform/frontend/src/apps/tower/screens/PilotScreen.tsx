import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { handshakeStanding, lossStanding, pct, retentionStanding, seconds, takeInStanding, type PilotBoardView, type PilotWeekRow, type Standing } from '../pilot';
import type { TowerActions } from '../useTowerApp';

const TAG: Record<Standing, string> = { ok: 'ctag ctag--ok', warn: 'ctag ctag--warn', danger: 'ctag ctag--danger', none: 'ctag' };

/**
 * THE PILOT, WEEK BY WEEK (the user, 2026-10-18: "pilot metrics + Lost"). The compendium's four numbers — the handshake
 * rate, the loss rate, the take-in time and the original shops still working — each week against its target. A finished
 * week is frozen with a fingerprint and never counted again; the week still running is "so far".
 */
export function PilotScreen({ actions }: { actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [board, setBoard] = useState<PilotBoardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.pilot();
    if (r.error) return setError(r.error.detail || r.error.title);
    setError(null);
    setBoard(r.data as unknown as PilotBoardView);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const tg = board?.targets;
  // In UTC, as the weeks are counted: a week that ends Sunday midnight UTC must not be read as ending on Monday.
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const rows: PilotWeekRow[] = board ? [board.thisWeek, ...board.weeks] : [];

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.pilot.title')}</h1>
        <p class="cons__lede">{t('tower.pilot.lede')}</p>
      </header>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.pilot.weeks')}</span>
          <span class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void load()}>
              <Icon name="refresh" size={16} />
              {t('tower.hazards.refresh')}
            </button>
          </span>
        </div>
        {error ? <p class="cerr">{error}</p> : null}
        {!board || !tg ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.pilot.col.week')}</th>
                <th>{t('tower.pilot.col.handshake')}</th>
                <th>{t('tower.pilot.col.loss')}</th>
                <th>{t('tower.pilot.col.takeIn')}</th>
                <th>{t('tower.pilot.col.retention')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.week}>
                  <td>
                    <span class="ctbl__mono">{w.week}</span>
                    <div class="ctbl__sub">
                      {t(w.frozen ? 'tower.pilot.span' : 'tower.pilot.soFar', { from: day(w.from), to: day(new Date(Date.parse(w.to) - 1).toISOString()) })}
                      {w.retention ? ` · ${t('tower.pilot.pilotWeek', { n: w.retention.pilotWeek })}` : ''}
                    </div>
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.pilot.col.handshake')}</span>
                    <span class={TAG[handshakeStanding(w.handshake.rate, tg)]}>{pct(w.handshake.rate)}</span>
                    <div class="ctbl__sub">{t('tower.pilot.handshakeSub', { handed: w.handshake.handed, missed: w.handshake.missed })}</div>
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.pilot.col.loss')}</span>
                    <span class={TAG[lossStanding(w.loss.rate, tg)]}>{pct(w.loss.rate)}</span>
                    <div class="ctbl__sub">{t('tower.pilot.lossSub', { lost: w.loss.lost, damaged: w.loss.damaged, takenIn: w.loss.takenIn })}</div>
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.pilot.col.takeIn')}</span>
                    <span class={TAG[takeInStanding(w.takeIn.medianSeconds, tg)]}>{seconds(w.takeIn.medianSeconds, t)}</span>
                    <div class="ctbl__sub">{w.takeIn.timed ? t('tower.pilot.takeInSub', { n: w.takeIn.timed, p90: seconds(w.takeIn.p90Seconds, t) }) : t('tower.pilot.notTimed')}</div>
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.pilot.col.retention')}</span>
                    <span class={TAG[retentionStanding(w.retention, tg)]}>{pct(w.retention?.rate)}</span>
                    <div class="ctbl__sub">{w.retention ? t('tower.pilot.retentionSub', { active: w.retention.active, original: w.retention.original }) : t('tower.pilot.noPilotYet')}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {tg ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.pilot.howTitle')}</span>
          </div>
          <ul class="chint" style="padding-left:18px;margin:6px 0">
            <li>{t('tower.pilot.how.handshake', { target: pct(tg.handshake), warn: pct(tg.handshakeWarn) })}</li>
            <li>{t('tower.pilot.how.loss', { target: pct(tg.loss), warn: pct(tg.lossWarn) })}</li>
            <li>{t('tower.pilot.how.takeIn', { target: tg.takeInSeconds, warn: tg.takeInWarnSeconds })}</li>
            <li>{t('tower.pilot.how.retention', { target: pct(tg.retention), week: tg.retentionAtWeek })}</li>
            <li>{t('tower.pilot.how.frozen')}</li>
          </ul>
        </section>
      ) : null}
    </>
  );
}
