import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { MoverRow } from '../movers';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * CL4 — WHO MOVES LOADS, and the half a shipper does not see.
 *
 * The same record the public page carries, with two things added that only somebody handling a complaint
 * should have: WHY each load was handed back, and WHICH DRIVER handed it.
 *
 * NEITHER IS A SECOND VERSION OF THE TRUTH. Every number on this screen is the number on the public page.
 * The moment an operator's view can disagree with the one a shipper reads, the public one stops being
 * worth anything — so this screen adds context and never arithmetic.
 *
 * WHY THE REASONS ARE NOT PUBLIC. FP8 recorded why a load was handed back, and a great many of those
 * reasons are the safety rules working: a driver whose rest is due has done the right thing by handing it
 * back. Publishing that on a page a shipper reads would punish the honest use of a rule this network
 * wrote, and the predictable answer is drivers who stop handing back and drive tired instead.
 *
 * AND IT IS NOT A LEAGUE TABLE. Rows are ordered by how BUSY a fleet is, not by how well it did. Ordering
 * people by performance manufactures a loser out of relative position whether or not anything went wrong,
 * which is the thing §6 refuses — a table would undo on this screen what the page-per-party shape was for.
 */
export function MoversScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const view = state.movers;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.movers.title')}</h1>
        <p class="cons__lede">{t('tower.movers.lede')}</p>
      </header>

      {/* The sentence the server sends, rendered before any figure. This measure's failure mode is being
          read as a general endorsement, and an operator repeating it down a phone is how that spreads. */}
      {view?.measured ? (
        <p class="cons__caveat">
          <Icon name="info" size={18} />
          <span>{view.measured}</span>
        </p>
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.movers.count', { n: view?.items.length ?? 0 })}</span>
        </div>

        {view === null ? (
          <p class="cons__empty">{t('tower.movers.loading')}</p>
        ) : view.items.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.movers.noneTitle')}</p>
            <p>{t('tower.movers.noneBody')}</p>
          </div>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.movers.col.fleet')}</th>
                <th class="ctbl__num">{t('tower.movers.col.taken')}</th>
                <th class="ctbl__num">{t('tower.movers.col.gaveBack')}</th>
                <th class="ctbl__num">{t('tower.movers.col.delivered')}</th>
                <th>{t('tower.movers.col.rates')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.items.map((row) => (
                <MoverRowView key={row.did} row={row} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function MoverRowView({ row, state, actions }: { row: MoverRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.did;
  const m = row.moves;

  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td>
          <div class="ctbl__strong">{row.name}</div>
          <div class="ctbl__sub">
            {row.handle ? `@${row.handle}` : '—'}
            {row.jurisdiction ? ` · ${row.jurisdiction}` : ''}
            {` · ${t('tower.movers.drivers', { n: row.drivers })}`}
          </div>
        </td>
        <td class="ctbl__num">{m.claimed}</td>
        {/* Shown plainly, never softened: what happened, including the bad. */}
        <td class="ctbl__num">{m.handedBack > 0 ? <span class="ctag ctag--warn">{m.handedBack}</span> : m.handedBack}</td>
        <td class="ctbl__num">{m.delivered}</td>
        <td class="ctbl__sub">
          {/* A thin record says so instead of showing a percentage worked out from almost nothing. */}
          {m.thin ? t('tower.movers.thin', { n: m.ratesNeed }) : t('tower.movers.rates', { kept: Math.round((m.keptRate ?? 0) * 100), delivered: Math.round((m.deliveredRate ?? 0) * 100) })}
          {m.tightKept > 0 ? <div>{t('tower.movers.tight', { kept: m.tightKept, delivered: m.tightDelivered })}</div> : null}
        </td>
        <td class="ctbl__num">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => actions.open(open ? null : row.did)}>
            {open ? t('common.close') : t('tower.movers.why')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={6}>
            {/* THE OPERATOR-ONLY HALF. */}
            <h3 class="cons__panelt">{t('tower.movers.handBacksTitle')}</h3>
            <p class="chint">{t('tower.movers.handBacksWhy')}</p>
            {row.handBacks.length === 0 ? (
              <p class="cons__empty" style="text-align:left">{t('tower.movers.noHandBacks')}</p>
            ) : (
              <ul class="twr-checklist">
                {row.handBacks.map((h) => (
                  <li key={`${h.code}-${h.at}`}>
                    <b>{h.code}</b> · {h.driver} · <span class="ctbl__sub">{new Date(h.at).toLocaleDateString()}</span>
                    <div>“{h.reason}”</div>
                  </li>
                ))}
              </ul>
            )}

            <h3 class="cons__panelt" style="margin-top:16px">{t('tower.movers.perDriverTitle')}</h3>
            {row.perDriver.length === 0 ? (
              <p class="cons__empty" style="text-align:left">{t('tower.movers.noDriverWork')}</p>
            ) : (
              <table class="ctbl">
                <thead>
                  <tr>
                    <th>{t('tower.movers.col.driver')}</th>
                    <th class="ctbl__num">{t('tower.movers.col.taken')}</th>
                    <th class="ctbl__num">{t('tower.movers.col.gaveBack')}</th>
                    <th class="ctbl__num">{t('tower.movers.col.delivered')}</th>
                  </tr>
                </thead>
                <tbody>
                  {row.perDriver.map((d) => (
                    <tr key={d.driver}>
                      <td>{d.driver}</td>
                      <td class="ctbl__num">{d.claimed}</td>
                      <td class="ctbl__num">{d.handedBack}</td>
                      <td class="ctbl__num">{d.delivered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p class="chint">{t('tower.movers.perDriverWhy')}</p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
