import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { EntityPicker } from './EntityPicker';
import { amount, money } from '../queues';
import { FUNDING_ACTIONS, PAYOUT_ACTIONS, fundingLine, fundingTone, needsReceipt, payoutHow, payoutTone, payoutWho, waitsForRail, type FundingAction, type FundingRow, type UnmatchedRow } from '../settlement';
import { ConsoleDetail } from '../ConsoleDetail';
import { TaxInvoicesPanel } from './TaxInvoicesPanel';
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
  // M-Pesa's receipt, asked in the row before an M-Pesa payout is said to be paid.
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [receipt, setReceipt] = useState('');

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

        {state.queueError ? <p class="cerr" style="margin:12px 0">{state.queueError}</p> : null}

        {state.payouts === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : state.payouts.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.money.emptyTitle')}</p>
            <p>{t('tower.money.emptyBody')}</p>
          </div>
        ) : (
          <table class="ctbl ctbl--stack">
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
                  <td>
                    <span class="ctbl__mono">{row.payeeDid?.slice(0, 22) ?? '—'}…</span>
                    {payoutHow(row, t) ? <span class="ctbl__sub" style="display:block">{payoutHow(row, t)}</span> : null}
                  </td>
                  <td class="ctbl__num ctbl__strong">
                    <span class="ctbl__lbl">{t('tower.money.col.amount')}</span>
                    {amount(row.amount, row.currency ?? books?.coverage.currency)}
                  </td>
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.money.col.day')}</span>
                    {row.day}
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.money.col.state')}</span>
                    <span class={`ctag ctag--${payoutTone(row.status)}`}>{t(`tower.money.state.${row.status}` as never)}</span>
                    {payoutWho(row, t) ? <span class="ctbl__sub" style="display:block">{payoutWho(row, t)}</span> : null}
                    {row.railNote ? <span class="ctbl__sub ctbl__sub--warn" style="display:block">{row.railNote}</span> : null}
                  </td>
                  <td class="ctbl__mono">
                    <span class="ctbl__lbl">{t('tower.money.col.ref')}</span>
                    {row.providerRef || '—'}
                  </td>
                  <td class="ctbl__num">
                    {/* ONE action per state, because there is only ever one honest next step: a payout
                        that has been requested is submitted, a submitted one either settles or fails,
                        and a settled one can only be reversed. */}
                    {isOperator && receiptFor === row.payoutId ? (
                      <span class="twr-clear__act">
                        <input
                          class="cinput"
                          aria-label={t('tower.money.receipt')}
                          placeholder={t('tower.money.receipt')}
                          value={receipt}
                          maxLength={40}
                          onInput={(e) => setReceipt((e.target as HTMLInputElement).value)}
                        />
                        <button
                          type="button"
                          class="cbtn cbtn--sm cbtn--primary"
                          disabled={state.busyId === row.payoutId || receipt.trim().length < 6}
                          onClick={async () => {
                            await actions.movePayout(row.payoutId, 'settle', undefined, receipt.trim());
                            setReceiptFor(null);
                            setReceipt('');
                          }}
                        >
                          {t('tower.money.receiptConfirm')}
                        </button>
                        <button type="button" class="cbtn cbtn--sm cbtn--ghost" onClick={() => setReceiptFor(null)}>
                          {t('common.back')}
                        </button>
                      </span>
                    ) : isOperator && waitsForRail(row) ? (
                      <span class="ctbl__sub">{t('tower.money.waitsForMpesa')}</span>
                    ) : isOperator ? (
                      <span class="twr-clear__act">
                        {(PAYOUT_ACTIONS[row.status] ?? []).map((act) => (
                          <button
                            key={act.action}
                            type="button"
                            class={`cbtn cbtn--sm ${act.tone === 'danger' ? 'cbtn--danger' : 'cbtn--ghost'}`}
                            disabled={state.busyId === row.payoutId}
                            onClick={() => {
                              if (needsReceipt(row, act.action)) {
                                setReceiptFor(row.payoutId);
                                setReceipt('');
                                return;
                              }
                              void actions.movePayout(row.payoutId, act.action, act.reasonKey ? t(act.reasonKey) : undefined);
                            }}
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

      {/* Money coming IN — the mirror of the panel above, and the reason the two KPIs at the top can be
          believed at all. Placed after the payouts because a company reads "can I pay everybody" first
          and "who still owes us a top-up" second. */}
      <MoneyIn state={state} actions={actions} />

      {/* Its tax invoices, where its country's tax authority keeps them: Kenya's eTIMS, and nowhere else. */}
      <TaxInvoicesPanel state={state} actions={actions} />

      {/* The network's own ledger. Operator-only, and network-wide rather than per company — which is
          why the float is stated per currency: two sisters settle in different money, and a total across
          them would be a figure denominated in nothing. */}
      {isOperator ? <NetworkLedger state={state} /> : null}
    </>
  );
}

/**
 * MONEY COMING IN — and the rule this panel exists to make visible.
 *
 * Until 2026-09-22 a shop's own app created the entry that put cash in the held figure at the top of this
 * screen. There was nothing to look at here because there was nothing to wait for: asking WAS paying.
 * Now a request sits in this table with the reference the payer was told to quote, and it only becomes
 * money when a payment provider confirms it — at the amount the provider confirms.
 *
 * Neither button on a row declares a payment. Confirm asks for the statement line; the sandbox one signs
 * a callback and sends it through the provider's own door.
 */
function MoneyIn({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [asking, setAsking] = useState<{ row: FundingRow; action: FundingAction } | null>(null);
  const [attributing, setAttributing] = useState<UnmatchedRow | null>(null);
  const rows = state.funding;

  return (
    <>
      <section class="cons__panel" style="margin-top:18px">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.money.in.title')}</span>
        </div>
        <p class="cons__caveat">
          <Icon name="wallet" size={18} />
          <span>{t('tower.money.in.lede')}</span>
        </p>

        {rows === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : rows.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.money.in.emptyTitle')}</p>
            <p>{t('tower.money.in.emptyBody')}</p>
          </div>
        ) : (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.money.in.col.payer')}</th>
                <th>{t('tower.money.in.col.what')}</th>
                <th>{t('tower.money.in.col.ref')}</th>
                <th>{t('tower.money.col.state')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.fundingId}>
                  <td class="ctbl__strong">{row.payerName ?? `${row.payerDid?.slice(0, 22) ?? "—"}…`}</td>
                  <td class="ctbl__strong">
                    <span class="ctbl__lbl">{t('tower.money.in.col.what')}</span>
                    {fundingLine(row, t)}
                  </td>
                  <td class="ctbl__mono">
                    <span class="ctbl__lbl">{t('tower.money.in.col.ref')}</span>
                    {/* Their reference while they are still paying; the PROVIDER's once it has been paid —
                        which is the one an auditor is given when somebody says they were never credited. */}
                    {row.providerRef || row.reference || '—'}
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.money.col.state')}</span>
                    <span class={`ctag ctag--${fundingTone(row.status)}`}>{t(`tower.money.in.state.${row.status}` as never)}</span>
                  </td>
                  <td class="ctbl__num">
                    <span class="twr-clear__act">
                      {(FUNDING_ACTIONS[row.status] ?? []).map((act) => (
                        <button
                          key={act.action}
                          type="button"
                          class={`cbtn cbtn--sm ${act.tone === 'danger' ? 'cbtn--danger' : 'cbtn--ghost'}`}
                          disabled={state.busyId === row.fundingId}
                          onClick={() =>
                            act.needsRef
                              ? setAsking({ row, action: act.action })
                              : void actions.moveFunding(row.fundingId, act.action, { reason: act.reasonKey ? t(act.reasonKey) : '' })
                          }
                        >
                          {t(act.labelKey)}
                        </button>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Payments with nobody's name on them. Shown even when empty is NOT the choice here — an empty
          section would be noise; what matters is that they are never silently dropped. */}
      {state.unmatched.length ? (
        <section class="cons__panel" style="margin-top:18px">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.money.in.unmatchedTitle')}</span>
            <span class="ctbl__sub">{state.unmatched.length}</span>
          </div>
          <p class="cons__caveat">
            <Icon name="warning" size={18} />
            <span>{t('tower.money.in.unmatchedLede')}</span>
          </p>
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.money.in.unmatchedCol.from')}</th>
                <th class="ctbl__num">{t('tower.money.col.amount')}</th>
                <th>{t('tower.money.col.ref')}</th>
                <th>{t('tower.money.in.unmatchedCol.why')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.unmatched.map((u) => (
                <tr key={u.id}>
                  <td>{u.payerLabel || u.provider || '—'}</td>
                  <td class="ctbl__num ctbl__strong">
                    <span class="ctbl__lbl">{t('tower.money.col.amount')}</span>
                    {amount(u.amount ?? 0, u.currency)}
                  </td>
                  <td class="ctbl__mono">
                    <span class="ctbl__lbl">{t('tower.money.col.ref')}</span>
                    {u.providerRef || '—'}
                  </td>
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.money.in.unmatchedCol.why')}</span>
                    {u.reason}
                  </td>
                  <td class="ctbl__num">
                    {/* The ONE way out of this list, and it is deliberately a person's judgement. */}
                    <button type="button" class="cbtn cbtn--sm cbtn--ghost" disabled={state.busyId === u.id} onClick={() => setAttributing(u)}>
                      {t('tower.money.in.act.apply')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {asking ? <ConfirmFundingSheet ask={asking} onClose={() => setAsking(null)} state={state} actions={actions} /> : null}
      {attributing ? <AttributePaymentPanel payment={attributing} onClose={() => setAttributing(null)} state={state} actions={actions} /> : null}
    </>
  );
}

/**
 * THE REFERENCE IS THE WHOLE FORM.
 *
 * Both confirm paths ask for it and neither will proceed without one, because a payment nobody can look
 * up afterwards is the payer's own word with a member of staff's name on it. The amount is asked for
 * separately and defaults to what was requested — it must be what ARRIVED, which is not always the same
 * number, and typing it is how somebody notices.
 */
function ConfirmFundingSheet({ ask, onClose, state, actions }: { ask: { row: FundingRow; action: FundingAction }; onClose: () => void; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [ref, setRef] = useState('');
  const [value, setValue] = useState(String(ask.row.amount ?? 0));
  const amountNum = Number(value);
  const ready = ref.trim().length >= 3 && amountNum > 0;

  return (
    <ConsoleDetail openKey={ask.row.fundingId} title={t('tower.money.in.refTitle')} onClose={onClose}>
      {/* Its own heading, because at desk width ConsoleDetail renders a panel and not a titled sheet —
          and because the one thing this form must not be is ambiguous about WHOSE payment it records. */}
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.money.in.refTitle')}</span>
        <span class="ctbl__sub">{ask.row.payerName ?? ask.row.payerDid?.slice(0, 22)}</span>
      </div>
      <p class="cons__lede">{t('tower.money.in.refBody')}</p>
      {ask.action === 'simulate' ? (
        <p class="cons__caveat">
          <Icon name="warning" size={18} />
          <span>{t('tower.money.in.sandboxNote')}</span>
        </p>
      ) : null}
      <label class="cfield">
        <span class="cfield__label">{t('tower.money.in.refLabel')}</span>
        <input class="cinput" value={ref} onInput={(e) => setRef((e.target as HTMLInputElement).value)} />
      </label>
      <label class="cfield">
        <span class="cfield__label">{t('tower.money.in.amountLabel')}</span>
        <input class="cinput" type="number" step="0.01" min="0" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
      </label>
      <div class="twr-clear__act">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={!ready || state.busyId === ask.row.fundingId}
          onClick={async () => {
            await actions.moveFunding(ask.row.fundingId, ask.action, { providerRef: ref.trim(), amount: amountNum });
            onClose();
          }}
        >
          {t('tower.money.in.refConfirm')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onClose}>
          {t('tower.money.in.cancel')}
        </button>
      </div>
    </ConsoleDetail>
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
          <table class="ctbl ctbl--stack">
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
                    <span class="ctbl__lbl">{t('tower.money.col.amount')}</span>
                    {e.sign}
                    {money(e.amount)} {e.currency ?? ''}
                  </td>
                  <td class="ctbl__mono">
                    <span class="ctbl__lbl">{t('tower.money.col.ref')}</span>
                    {e.reference?.slice(0, 24) ?? '—'}
                  </td>
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.money.col.when')}</span>
                    {new Date(e.at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 8 ? (
            <p style="padding:8px 0 12px">
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

/**
 * WHOSE PAYMENT WAS THIS? — the one way out of the unattributed list.
 *
 * Real money arrived and we could not say whose. Somebody has to decide, and the screen's job is to make
 * the likely answer one tap away and the unlikely answer possible.
 *
 * SO THE SUGGESTIONS COME FIRST, and they are not a ranking. A shop that asked to pay in 400 and mistyped
 * its reference is the overwhelmingly common cause of a 400 arriving unattributed — so the open requests
 * in the same currency are listed with the closest amount at the top, each showing its own figure so the
 * operator can see for themselves why it is being suggested. Nothing is pre-selected: the list narrows the
 * search, it does not make the decision.
 *
 * Below it, every shop, searchable — because somebody paying the paybill without ever opening a request is
 * the other half of real life, and a screen that only offered the suggestions would strand them.
 */
function AttributePaymentPanel({
  payment,
  onClose,
  state,
  actions,
}: {
  payment: UnmatchedRow;
  onClose: () => void;
  state: TowerState;
  actions: TowerActions;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const paid = payment.amount ?? 0;

  // Open requests in the SAME currency only: applying across currencies is refused by the server, and
  // offering it here would be offering a button that cannot work.
  const suggestions = (state.funding ?? [])
    .filter((f) => f.status === 'awaiting' && (f.currency ?? '') === (payment.currency ?? ''))
    .sort((a, b) => Math.abs((a.amount ?? 0) - paid) - Math.abs((b.amount ?? 0) - paid))
    .slice(0, 5);

  const needle = q.trim().toLowerCase();
  const shops = (state.agents ?? [])
    .filter((a) => (a.status ?? '') !== 'DRAFT' && (a.status ?? '') !== 'KYC_PENDING')
    .filter((a) => !needle || (a.shopName ?? '').toLowerCase().includes(needle) || (a.zone ?? '').toLowerCase().includes(needle))
    .slice(0, 40);

  const apply = async (payerKind: 'agent' | 'vendor', payerDid: string) => {
    await actions.applyFunding(payment.id, payerKind, payerDid);
    onClose();
  };

  return (
    <ConsoleDetail openKey={payment.id} title={t('tower.money.in.applyTitle')} onClose={onClose}>
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.money.in.applyTitle')}</span>
        <span class="ctbl__sub">{amount(paid, payment.currency)}</span>
      </div>
      {/* What is actually known about it — all of it, because the decision rests on nothing else. */}
      <p class="cons__lede">
        {t('tower.money.in.applyBody', { ref: payment.providerRef ?? '—', reason: payment.reason ?? '' })}
      </p>
      <p class="cons__caveat">
        <Icon name="warning" size={18} />
        <span>{t('tower.money.in.applyCaveat')}</span>
      </p>

      {suggestions.length ? (
        <>
          <p class="cfield__label" style="margin-top:6px">{t('tower.money.in.applySuggest')}</p>
          <div class="rows" role="list">
            {suggestions.map((f) => (
              <button
                key={f.fundingId}
                type="button"
                class="crow"
                disabled={state.busyId === payment.id}
                onClick={() => void apply((f.payerKind as 'agent' | 'vendor') ?? 'agent', f.payerDid ?? '')}
              >
                <span class="crow__body">
                  <span class="crow__t">{f.payerName ?? f.payerDid?.slice(0, 22)}</span>
                  <span class="crow__s">{t('tower.money.in.applyAsked', { amount: amount(f.amount ?? 0, f.currency), ref: f.reference ?? '' })}</span>
                </span>
                <span class="crow__end">
                  <Icon name="chevronRight" size={20} />
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p class="cfield__label" style="margin-top:14px">{t('tower.money.in.applyAnyShop')}</p>
      {state.agents === null ? (
        <p class="chint">{t('tower.queues.loading')}</p>
      ) : (
        <>
          <input class="cinput" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder={t('tower.money.in.applySearch')} aria-label={t('tower.money.in.applySearch')} />
          <div class="rows" role="list">
            {shops.map((a) => (
              <button key={a.did} type="button" class="crow" disabled={state.busyId === payment.id} onClick={() => void apply('agent', a.did)}>
                <span class="crow__body">
                  <span class="crow__t">{a.shopName ?? a.did.slice(0, 22)}</span>
                  {/* The zone, and — where it applies — the one fact that decides whether this shop can be
                      credited at all. Its BALANCE is deliberately not shown: the row does not carry a
                      currency, and a figure without one is not a figure. */}
                  <span class="crow__s">{[a.zone, a.balance === null ? t('tower.money.in.applyNoFloat') : ''].filter(Boolean).join(' · ')}</span>
                </span>
                <span class="crow__end">
                  <Icon name="chevronRight" size={20} />
                </span>
              </button>
            ))}
          </div>
          {shops.length === 0 ? <p class="chint">{t('tower.money.in.applyNoMatch')}</p> : null}
        </>
      )}

      <div class="twr-clear__act">
        <button type="button" class="cbtn cbtn--ghost" onClick={onClose}>
          {t('tower.money.in.cancel')}
        </button>
      </div>
    </ConsoleDetail>
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
