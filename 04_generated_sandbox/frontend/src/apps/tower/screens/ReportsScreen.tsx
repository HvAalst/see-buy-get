import { Icon } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { REASON_KEY, reportedText, reportsAgainst, reportsInOrder, shortId } from '../reports';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * CV1 — messages somebody reported in a conversation about a load.
 *
 * The console never reads a conversation. A party chose to show this one message, and that choice is the only
 * reason it is on this screen. So the table shows the message and who it came from — and, beside it, how many
 * DIFFERENT people have reported that party, because one angry shopkeeper is a bad day and five is a pattern.
 */
export function ReportsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.reports ? reportsInOrder(state.reports) : null;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.reports.title')}</h1>
        <p class="cons__lede">{t('tower.reports.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="info" size={16} />
        <span>
          <b>{t('tower.reports.caveatT')}</b> {t('tower.reports.caveat')}
        </span>
      </p>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{rows === null ? t('tower.queues.loading') : t('tower.reports.count', { n: rows.length })}</span>
          <span class="twr-panelend">
            {state.readAt ? <span class="ctbl__sub">{t('tower.hazards.updatedAt', { time: new Date(state.readAt).toLocaleTimeString() })}</span> : null}
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.refresh()} disabled={state.loading}>
              <Icon name="refresh" size={16} />
              {t('tower.hazards.refresh')}
            </button>
          </span>
        </div>

        {state.queueError ? (
          <p class="cerr" style="margin:12px 16px">
            {state.queueError}
          </p>
        ) : null}

        {rows === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : rows.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.reports.emptyTitle')}</p>
            <p>{t('tower.reports.emptyBody')}</p>
          </div>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.reports.col.reason')}</th>
                <th>{t('tower.reports.col.message')}</th>
                <th>{t('tower.reports.col.from')}</th>
                <th class="ctbl__num">{t('tower.reports.col.reporters')}</th>
                <th>{t('tower.reports.col.when')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const against = reportsAgainst(state.reports ?? [], r.reportedDid);
                return (
                  <tr key={r.reportId}>
                    <td>
                      <span class={`ctag ${r.reason === 'scam' ? 'ctag--warn' : ''}`}>{t(REASON_KEY[r.reason])}</span>
                    </td>
                    <td>
                      <div class="ctbl__strong" style="white-space:pre-wrap; overflow-wrap:anywhere">
                        {reportedText(r)}
                      </div>
                      <div class="ctbl__mono">
                        {r.conversationId} · #{r.seq}
                      </div>
                    </td>
                    <td class="ctbl__mono">{shortId(r.reportedDid)}</td>
                    {/* The number that separates a bad day from a pattern. */}
                    <td class="ctbl__num">{against}</td>
                    <td class="ctbl__sub">{formatDate(r.at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
