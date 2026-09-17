import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { EntityPicker } from './EntityPicker';
import { amount, money } from '../queues';
import { PAYOUT_ACTIONS, payoutTone } from '../settlement';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * Money — what a company holds, what it owes, and paying the people it owes it to.
 *
 * The books have accrued a payable for every driver, hub and shop since the postings were wired. The
 * question this screen exists to answer, in this order:
 *
 *   1. CAN we pay everybody — cash held against everything owed. It sits at the top because pressing
 *      the run button without it is how a company spends the shops' float on its drivers.
 *   2. WHO is waiting, and what state is each payment in.
 *   3. And only then, the button.
 *
 * NOTHING HERE SETTLES ANYTHING BY ITSELF. The run RAISES payouts, a rail carries them, and only the
 * rail's answer moves money — in this sandbox that answer is a person pressing Settle, in a live
 * deployment it is the provider's callback, and it is deliberately the same door.
 */
export function MoneyScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const pricing = state.pricing;
  const books = state.books;
  const isOperator = state.who?.mode === 'operator';

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.money.title')}</h1>
        <p class="cons__lede">{t('tower.money.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="wallet" size={18} />
        <span>
          <b>{t('tower.money.caveatLead')}</b> {t('tower.money.caveat')}
        </span>
      </p>

      {/* The same company selection as the rates screen: one "which company am I looking at" for the
          whole console, because two would be two answers to one question. */}
      <EntityPicker
        entities={state.entities ?? []}
        chosen={state.entityId}
        onChoose={(id) => void actions.chooseEntity(id)}
        label={t('tower.rates.pickSister')}
      />

      {state.error ? (
        <p class="cerr" style="max-width:96ch">
          <b>{t('tower.money.failedTitle')}</b> — {state.error.detail || state.error.title}
        </p>
      ) : null}

      {/* Can this company pay everybody? Cover is held MINUS owed, and it deliberately excludes credit
          out with shops: money in a shopkeeper's trade line cannot pay a driver this afternoon. */}
      <div class="twr-kpis">
        <Kpi label={t('tower.money.held')} value={books ? amount(books.coverage.held, books.coverage.currency) : '—'} />
        <Kpi label={t('tower.money.owed')} value={books ? amount(books.coverage.owed, books.coverage.currency) : '—'} />
        <Kpi
          label={t('tower.money.cover')}
          value={books ? amount(books.coverage.cover, books.coverage.currency) : '—'}
          risk={Boolean(books && books.coverage.cover < 0)}
        />
        <Kpi label={t('tower.money.lent')} value={books ? amount(books.coverage.lent, books.coverage.currency) : '—'} />
      </div>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.money.payoutsTitle', { name: pricing?.name ?? '' })}</span>
          {/* The run is an OPERATIONAL act on a payment rail, so it belongs to network staff. A company
              administrator reads what it owes and who is waiting; they do not press the button that
              tells the network money has left. */}
          {isOperator && state.entityId ? (
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={state.busyId === 'run'} onClick={() => void actions.runPayouts()}>
              {t('tower.money.run')}
            </button>
          ) : null}
        </div>

        {state.done ? (
          <p class="twr-done">
            <Icon name="check" size={16} />
            {state.done}
          </p>
        ) : null}

        {state.queueError ? <p class="cerr" style="margin:12px 16px">{state.queueError}</p> : null}

        {state.payouts === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : state.payouts.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.money.emptyTitle')}</p>
            <p>{t('tower.money.emptyBody')}</p>
          </div>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.money.col.payee')}</th>
                <th class="ctbl__num">{t('tower.money.col.amount')}</th>
                <th>{t('tower.money.col.day')}</th>
                <th>{t('tower.money.col.state')}</th>
                <th>{t('tower.money.col.ref')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.payouts.map((row) => (
                <tr key={row.payoutId}>
                  <td class="ctbl__mono">{row.payeeDid?.slice(0, 22) ?? '—'}…</td>
                  <td class="ctbl__num ctbl__strong">{amount(row.amount, row.currency ?? books?.coverage.currency)}</td>
                  <td class="ctbl__sub">{row.day}</td>
                  <td>
                    <span class={`ctag ctag--${payoutTone(row.status)}`}>{t(`tower.money.state.${row.status}` as never)}</span>
                  </td>
                  <td class="ctbl__mono">{row.providerRef || '—'}</td>
                  <td class="ctbl__num">
                    {/* ONE action per state, because there is only ever one honest next step: a payout
                        that has been requested is submitted, a submitted one either settles or fails,
                        and a settled one can only be reversed. */}
                    {isOperator ? (
                      <span class="twr-clear__act">
                        {(PAYOUT_ACTIONS[row.status] ?? []).map((act) => (
                          <button
                            key={act.action}
                            type="button"
                            class={`cbtn cbtn--sm ${act.tone === 'danger' ? 'cbtn--danger' : 'cbtn--ghost'}`}
                            disabled={state.busyId === row.payoutId}
                            onClick={() => void actions.movePayout(row.payoutId, act.action, act.reasonKey ? t(act.reasonKey) : undefined)}
                          >
                            {t(act.labelKey)}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* The network's own ledger. Operator-only, and network-wide rather than per company — which is
          why the float is stated per currency: two sisters settle in different money, and a total across
          them would be a figure denominated in nothing. */}
      {isOperator ? <NetworkLedger state={state} /> : null}
    </>
  );
}

function NetworkLedger({ state }: { state: TowerState }) {
  const t = useT();
  const f = state.finance;
  const [showAll, setShowAll] = useState(false);
  const rows = f?.recentLedger ?? [];
  const shown = showAll ? rows : rows.slice(0, 8);

  return (
    <section class="cons__panel" style="margin-top:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.money.ledgerTitle')}</span>
        <span class="ctbl__sub">
          {f
            ? `${(f.floats ?? []).map((x) => amount(x.amount, x.currency)).join(' · ') || t('tower.money.noFloat')} · ${t('tower.money.todayRevenue', {
                amount: amount(f.todayRevenue, f.currency),
              })}`
            : ''}
        </span>
      </div>
      {!f ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : rows.length === 0 ? (
        <div class="cons__empty">
          <p class="cons__emptyt">{t('tower.money.noLedgerTitle')}</p>
          <p>{t('tower.money.noLedgerBody')}</p>
        </div>
      ) : (
        <>
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.money.col.type')}</th>
                <th class="ctbl__num">{t('tower.money.col.amount')}</th>
                <th>{t('tower.money.col.ref')}</th>
                <th>{t('tower.money.col.when')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span class={`ctag ctag--${e.sign === '+' ? 'ok' : 'quiet'}`}>{e.type.replace(/_/g, ' ')}</span>
                  </td>
                  <td class="ctbl__num ctbl__strong">
                    {e.sign}
                    {money(e.amount)} {e.currency ?? ''}
                  </td>
                  <td class="ctbl__mono">{e.reference?.slice(0, 24) ?? '—'}</td>
                  <td class="ctbl__sub">{new Date(e.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 8 ? (
            <p style="padding:8px 16px 12px">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setShowAll(!showAll)}>
                {showAll ? t('tower.money.showFewer') : t('tower.money.showAll', { n: rows.length })}
              </button>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, risk }: { label: string; value: string; risk?: boolean }) {
  return (
    <div class={`twr-kpi${risk ? ' twr-kpi--risk' : ''}`}>
      <div class="twr-kpi__v">{value}</div>
      <div class="twr-kpi__l">{label}</div>
    </div>
  );
}
