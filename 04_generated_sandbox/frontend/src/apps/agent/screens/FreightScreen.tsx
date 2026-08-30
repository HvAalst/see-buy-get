import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, Pill, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import type { AgentActions, AgentState, FreightPrice, PostedFreight } from '../useAgentApp';

export interface FreightScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * FB2b — the other side of the negotiation: the shop that posted a load, answering the prices offered on it.
 *
 * Two views in one screen, because they are one task: the loads we sent out, and then the prices on the one
 * being decided. A shop clerk answering a driver's number does not need a second tab to get back.
 */
export function FreightScreen({ state, actions }: FreightScreenProps) {
  const load = state.posted.find((p) => p.freightId === state.pricesFor) ?? null;
  return (
    <div class="scr">
      {load ? <Prices load={load} state={state} actions={actions} /> : <PostedList state={state} actions={actions} />}
    </div>
  );
}

function PostedList({ state, actions }: FreightScreenProps) {
  const t = useT();
  const loading = state.postedState === 'idle' || state.postedState === 'loading';
  return (
    <>
      <h1 class="scr__title">{t('agent.freight.title')}</h1>
      <p class="scr__lede">{t('agent.freight.lede')}</p>
      {state.error ? <ErrorNote error={state.error} /> : null}

      {loading ? (
        <p class="scr__lede" aria-live="polite">
          {t('common.loading')}
        </p>
      ) : state.posted.length === 0 ? (
        <Card title={t('agent.freight.emptyTitle')} tone="soft">
          <p class="card__note">{t('agent.freight.emptyLede')}</p>
        </Card>
      ) : (
        <div class="rows" role="list">
          {state.posted.map((f) => (
            <PostedRow key={f.freightId} f={f} onOpen={() => void actions.openPrices(f.freightId)} />
          ))}
        </div>
      )}
    </>
  );
}

function PostedRow({ f, onOpen }: { f: PostedFreight; onOpen: () => void }) {
  const t = useT();
  return (
    <div class="row row--static" role="listitem">
      <span class="row__ic">
        <Icon name="truck" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">
          {f.code} — {f.description}
        </span>
        <span class="row__s">{t('agent.freight.statusLine', { status: f.status.replace('_', ' '), kg: f.weightKg, dest: f.destLabel })}</span>
        {f.maxSpend != null ? <span class="row__s">{t('agent.freight.budget', { amount: f.maxSpend.toFixed(2) })}</span> : null}
        {f.agreedPrice != null ? <span class="row__s">{t('agent.freight.agreed', { amount: f.agreedPrice.toFixed(2) })}</span> : null}
        {f.scheduledPickupAt ? <span class="row__s">{formatDate(f.scheduledPickupAt)}</span> : null}
        <span class="freight__tags">
          <Pill tone="idle">{f.commitMode === 'negotiate' ? t('agent.freight.negotiate') : t('agent.freight.instant')}</Pill>
          {/* The count is the reason this row is on a screen at all, so it leads in the loud tone. */}
          {f.openProposals > 0 ? <Pill tone="warn" dot>{t('agent.freight.waiting', { n: f.openProposals })}</Pill> : null}
        </span>
        {/* Offered even with nothing waiting: a shop looking at a load wants to see who declined and why it
            is still sitting there, not just be told there is nothing to do. */}
        <Button variant="link" full={false} onClick={onOpen}>
          {f.openProposals > 0 ? t('agent.freight.open') : t('agent.freight.noneWaiting')}
        </Button>
      </span>
    </div>
  );
}

function Prices({ load, state, actions }: { load: PostedFreight } & FreightScreenProps) {
  const t = useT();
  const [confirm, setConfirm] = useState<FreightPrice | null>(null);
  const loading = state.pricesState === 'loading';
  const open = state.prices.filter((p) => p.status === 'open');
  const decided = state.prices.filter((p) => p.status !== 'open');
  return (
    <>
      <h1 class="scr__title">{t('agent.freight.pricesTitle', { code: load.code })}</h1>
      <p class="scr__lede">{load.description}</p>
      {load.maxSpend != null ? <p class="scr__lede">{t('agent.freight.budget', { amount: load.maxSpend.toFixed(2) })}</p> : null}
      {state.error ? <ErrorNote error={state.error} /> : null}

      {loading ? (
        <p class="scr__lede" aria-live="polite">
          {t('common.loading')}
        </p>
      ) : state.prices.length === 0 ? (
        <Card tone="soft">
          <p class="card__note">{t('agent.freight.pricesEmpty')}</p>
        </Card>
      ) : (
        <>
          <div class="rows" role="list">
            {open.map((p) => (
              <PriceRow key={p.proposalId} p={p} load={load} state={state} actions={actions} onTake={() => setConfirm(p)} />
            ))}
          </div>
          {/* Decided prices stay visible. A shop deciding whether to hold out for a better number needs to
              see what it has already turned down, and what was withdrawn from under it. */}
          {decided.length > 0 ? (
            <div class="rows" role="list" style="margin-top:16px">
              {decided.map((p) => (
                <PriceRow key={p.proposalId} p={p} load={load} state={state} actions={actions} onTake={() => undefined} />
              ))}
            </div>
          ) : null}
        </>
      )}

      <Button variant="outline" onClick={() => void actions.openPrices(null)}>
        {t('agent.freight.back')}
      </Button>

      {/* Taking a price CLAIMS the load and settles the money, so it is confirmed in a sheet — the same
          shape the counter already uses for a claim or a bag load, and the screen's one blue CTA lives here
          rather than repeating down a list of rows. */}
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={t('agent.freight.confirmTitle')}>
        {confirm ? (
          <>
            <p class="t-body">{t('agent.freight.confirmBody', { amount: confirm.price.toFixed(2), code: load.code })}</p>
            <Checklist
              items={[
                t('agent.freight.confirmRun', { empty: confirm.deadheadKm, loaded: confirm.loadedKm }),
                ...(load.maxSpend != null ? [t('agent.freight.budget', { amount: load.maxSpend.toFixed(2) })] : []),
              ]}
            />
            <Button
              chevron={false}
              busy={state.busy === `accept-price:${confirm.proposalId}`}
              onClick={() => {
                const p = confirm;
                setConfirm(null);
                void actions.acceptPrice(p);
              }}
            >
              {t('agent.freight.accept')}
            </Button>
            <Button variant="link" onClick={() => setConfirm(null)}>
              {t('agent.cancel')}
            </Button>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

function PriceRow({ p, load, state, actions, onTake }: { p: FreightPrice; load: PostedFreight; onTake: () => void } & FreightScreenProps) {
  const t = useT();
  const decided = p.status !== 'open';
  // Named locally rather than trusted from the server's refusal: the shop should see that a price is over
  // budget BEFORE tapping accept and being told, so the conversation with the customer happens first.
  const overBudget = load.maxSpend != null && p.price > load.maxSpend;
  return (
    <div class={`row row--static${decided ? ' row--muted' : ''}`} role="listitem">
      <span class="row__ic">
        <Icon name="wallet" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{t('agent.freight.priceLine', { amount: p.price.toFixed(2) })}</span>
        <span class="row__s">{t('agent.freight.priceRun', { empty: p.deadheadKm, loaded: p.loadedKm })}</span>
        {/* The driver's own words for the number. Often the whole reason it is low. */}
        {p.note ? <span class="row__s">“{p.note}”</span> : null}
        {decided ? (
          <span class="freight__tags">
            <Pill tone="idle">{t(`agent.freight.priceStatus.${p.status}` as 'agent.freight.priceStatus.accepted')}</Pill>
          </span>
        ) : (
          <>
            {overBudget ? (
              <span class="freight__tags">
                <Pill tone="warn">{t('agent.freight.overBudget')}</Pill>
              </span>
            ) : null}
            <span class="freight__acts">
              {/* Link-weight, because the screen's one solid CTA belongs in the confirming sheet — a list of
                  blue buttons would make eight equivalent prices look like eight recommendations. */}
              <Button variant="link" full={false} disabled={overBudget} onClick={onTake}>
                {t('agent.freight.accept')}
              </Button>
              <Button variant="link" full={false} busy={state.busy === `decline-price:${p.proposalId}`} onClick={() => void actions.declinePrice(p)}>
                {t('agent.freight.decline')}
              </Button>
            </span>
          </>
        )}
      </span>
    </div>
  );
}
