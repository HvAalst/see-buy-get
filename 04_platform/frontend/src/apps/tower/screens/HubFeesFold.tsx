import { useEffect, useState } from 'preact/hooks';
import { formatDate, useT } from '../../../shared/i18n';
import { ConsoleFold } from '../ConsoleFold';
import type { TowerActions, TowerState } from '../useTowerApp';
import type { components } from '../../../lib/sbg';

type EntityPricing = components['schemas']['EntityPricing'];
/** A hub's fees waiting for staff, as GET sbg/hub-fees says them. */
export type HubFeeAsk = {
  mdpId: string;
  name: string;
  country?: string;
  currency?: string;
  pricePerParcel: number;
  passOnFee: number;
  asked: { pricePerParcel?: number; passOnFee?: number; at: string };
  ceiling: { sort: number; passOn: number; multiple: number };
};

/**
 * 2026-11-12 — the owner's weakness 1: a hub list figure still the network's starting number, not one in the company's money —
 * every real hub fee above the ceiling it makes then waits for approval. The sort fee's row, where it is one of them.
 */
export function startingListFigure(amounts: Array<{ key: string; amount: number; own: boolean }> | undefined): { amount: number } | null {
  const rows = (amounts ?? []).filter((a) => a.key === 'mdpSortFee' || a.key === 'mdpPassOnFee');
  if (!rows.length || rows.every((a) => a.own)) return null;
  return { amount: rows.find((a) => a.key === 'mdpSortFee')?.amount ?? rows[0].amount };
}

/** The asks for one country: the console's company's own, the oldest first. */
export function asksFor(rows: HubFeeAsk[], country: string | undefined): HubFeeAsk[] {
  return rows.filter((r) => !country || r.country === country).sort((a, b) => a.asked.at.localeCompare(b.asked.at));
}

/**
 * 2026-11-12 — HUB FEES (the owner's D3 on the plan "Hubs on the Road": "A hub sets its own sort and pass-on fees, up to a
 * multiple of its country's list figure (starting at 1.5 times); above that needs staff approval"). The country's multiple,
 * and the fees hubs asked for above it: approved, they are the hub's from now; refused, with why — the hub is told either way.
 */
export function HubFeesFold({ pricing, state, actions }: { pricing: EntityPricing; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const stored = pricing.hubFeeCeiling ?? 1.5;
  const [draft, setDraft] = useState(String(stored));
  useEffect(() => setDraft(String(pricing.hubFeeCeiling ?? 1.5)), [pricing]);
  const [asks, setAsks] = useState<HubFeeAsk[]>([]);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = async () => {
    const client = actions.client();
    if (!client) return;
    const r = (await client.api.hubFeesAsked()) as { data?: unknown; error?: unknown };
    if (!r.error) setAsks(asksFor((r.data ?? []) as HubFeeAsk[], pricing.jurisdiction));
  };
  useEffect(() => {
    void load();
  }, [pricing.entityId]);
  const decide = async (a: HubFeeAsk, approve: boolean) => {
    const client = actions.client();
    if (!client) return;
    setBusy(true);
    const r = (await client.api.decideHubFees(a.mdpId, approve, approve ? undefined : reason.trim())) as { error?: { detail?: string; title?: string } | null };
    setBusy(false);
    if (r.error) return setProblem(r.error.detail || r.error.title || '');
    setProblem(null);
    setSaid(t(approve ? 'tower.hubFees.approved' : 'tower.hubFees.refused', { hub: a.name }));
    setRefusing(null);
    setReason('');
    await load();
  };
  const value = Number(draft);
  const money = (n: number | undefined, currency?: string) => (n == null ? '—' : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? pricing.currency ?? ''}`.trim());
  const knobBusy = state.busyId === 'hubFeeCeiling';
  return (
    <ConsoleFold title={t('tower.hubFees.title')} hint={asks.length ? t('tower.hubFees.waitingCount', { n: asks.length }) : t('tower.hubFees.current', { multiple: stored })}>
      <div class="twr-knobs">
        <p class="chint">{t('tower.hubFees.about')}</p>
        {(() => {
          const start = startingListFigure(pricing.amounts);
          return start ? (
            <p class="cerr" role="status">
              {t('tower.hubFees.listAtStart', { list: money(start.amount), ceiling: money(Math.round(start.amount * stored * 100) / 100) })}
            </p>
          ) : null;
        })()}
        <div class="twr-knobs__row">
          <section class="twr-knob">
            <label class="twr-clear__t" for="hub-fee-ceiling">
              {t('tower.hubFees.question')}
            </label>
            <input id="hub-fee-ceiling" class="cinput" type="number" inputMode="decimal" min="1" max="10" step="0.1" value={draft} disabled={!pricing.editable || knobBusy} onInput={(e) => setDraft(e.currentTarget.value)} />
            <button type="button" class="cbtn cbtn--primary" disabled={!pricing.editable || knobBusy || !(value >= 1 && value <= 10) || value === stored} onClick={() => void actions.saveHubFeeCeiling(Math.round(value * 100) / 100)}>
              {t('tower.rates.save')}
            </button>
          </section>
        </div>
        <p class="twr-clear__t">{t('tower.hubFees.waitingTitle')}</p>
        {said ? <p class="chint" role="status">{said}</p> : null}
        {problem ? <p class="cerr" role="alert">{problem}</p> : null}
        {asks.length === 0 ? <p class="chint">{t('tower.hubFees.none')}</p> : null}
        {asks.map((a) => (
          <section key={a.mdpId} class="twr-knob">
            <p class="twr-clear__t">
              {a.name} <span class="ctbl__sub">{t('tower.hubFees.askedOn', { date: formatDate(a.asked.at) })}</span>
            </p>
            {a.asked.pricePerParcel != null ? <p class="chint">{t('tower.hubFees.askSort', { now: money(a.pricePerParcel, a.currency), asked: money(a.asked.pricePerParcel, a.currency), ceiling: money(a.ceiling.sort, a.currency) })}</p> : null}
            {a.asked.passOnFee != null ? <p class="chint">{t('tower.hubFees.askPassOn', { now: money(a.passOnFee, a.currency), asked: money(a.asked.passOnFee, a.currency), ceiling: money(a.ceiling.passOn, a.currency) })}</p> : null}
            {refusing === a.mdpId ? (
              <div>
                <label class="chint" for={`refuse-${a.mdpId}`}>
                  {t('tower.hubFees.reason')}
                </label>
                <input id={`refuse-${a.mdpId}`} class="cinput" value={reason} maxLength={300} onInput={(e) => setReason(e.currentTarget.value)} />
                <button type="button" class="cbtn cbtn--sm cbtn--primary" disabled={busy || reason.trim().length < 3} onClick={() => void decide(a, false)}>
                  {t('tower.hubFees.refuseSend')}
                </button>
              </div>
            ) : (
              <div style="display:flex;flex-wrap:wrap;gap:8px">
                <button type="button" class="cbtn cbtn--sm cbtn--primary" disabled={busy} onClick={() => void decide(a, true)}>
                  {t('tower.hubFees.approve')}
                </button>
                <button type="button" class="cbtn cbtn--sm cbtn--ghost" disabled={busy} onClick={() => setRefusing(a.mdpId)}>
                  {t('tower.hubFees.refuse')}
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
    </ConsoleFold>
  );
}
