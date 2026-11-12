import { useEffect, useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useT } from '../../../shared/i18n';
import { ConsoleFold } from '../ConsoleFold';
import { ConsolePick } from '../ConsolePick';
import type { TowerActions } from '../useTowerApp';
import { sizeOfStep } from '../priceCards';
import { proposalOf, termsLine, type BusinessRatesView } from '../businessRates';

/**
 * 2026-11-12 — LARGE SENDERS' OWN RATES (the owner's D3: "Large senders negotiate. On a fixed card they get their own lower
 * card — volume tiers or a contract card for one business account; on factors, a discount on the formula"). One member of
 * staff proposes a sender's contract card or discount; a second approves it; staff end it. The route says who may.
 */
export function BusinessRatesFold({ entityId, actions }: { entityId: string; actions: TowerActions }) {
  const t = useT();
  const [view, setView] = useState<BusinessRatesView | null>(null);
  const [draft, setDraft] = useState({ vendorId: '', kind: 'card' as 'card' | 'discount', prices: [] as string[], extraKg: '', pct: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = async () => {
    const client = actions.client();
    if (!client) return;
    const r = (await client.api.businessRates(entityId)) as { data?: unknown; error?: unknown };
    if (r.error) return setView(null);
    const v = r.data as BusinessRatesView;
    setView(v);
    setDraft((d) => ({ ...d, kind: v.mode === 'factors' ? 'discount' : 'card' }));
  };
  useEffect(() => {
    void load();
  }, [entityId]);
  if (!view) return null;
  const act = async (write: () => Promise<unknown>, message: string) => {
    setBusy(true);
    const r = (await write()) as { error?: { detail?: string; title?: string } | null; data?: unknown };
    setBusy(false);
    if (r.error) return setProblem(r.error.detail || r.error.title || '');
    setProblem(null);
    setSaid(message);
    setView(r.data as BusinessRatesView);
  };
  const client = actions.client();
  const body = proposalOf(draft, view.steps);
  return (
    <ConsoleFold title={t('tower.rates.big.title')} hint={t('tower.rates.big.hint', { n: view.rows.length })}>
      <div class="twr-knobs">
        <p class="chint">{t('tower.rates.big.about')}</p>
        {said ? <p class="chint" role="status">{said}</p> : null}
        {problem ? (
          <p class="cerr" role="alert">
            <Abbreviated text={problem} />
          </p>
        ) : null}
        {view.rows.length === 0 ? <p class="cons__empty">{t('tower.rates.big.none')}</p> : null}
        {view.rows.map((row) => (
          <section key={row.vendorId} class="twr-knob">
            <p class="twr-clear__t">{row.name}</p>
            {row.approved ? <p class="chint">{t('tower.rates.big.inForce', { terms: termsLine(row.approved, view.currency, t), who: row.approved.approvedBy ?? '' })}</p> : null}
            {row.idle && row.approved ? <p class="cerr">{t(row.approved.kind === 'card' ? 'tower.rates.big.idleCard' : 'tower.rates.big.idleDiscount')}</p> : null}
            {row.proposed ? <p class="chint">{t('tower.rates.big.waiting', { terms: termsLine(row.proposed, view.currency, t), who: row.proposed.proposedBy })}</p> : null}
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              {row.proposed ? (
                <button type="button" class="cbtn cbtn--sm cbtn--primary" disabled={busy || !client} onClick={() => client && void act(() => client.api.approveBusinessRate(entityId, row.vendorId), t('tower.rates.big.approved'))}>
                  {t('tower.rates.big.approve')}
                </button>
              ) : null}
              <button type="button" class="cbtn cbtn--sm cbtn--ghost" disabled={busy || !client} onClick={() => client && void act(() => client.api.endBusinessRate(entityId, row.vendorId), t('tower.rates.big.ended'))}>
                {t(row.approved ? 'tower.rates.big.end' : 'tower.rates.big.takeBack')}
              </button>
            </div>
          </section>
        ))}
        <p class="twr-clear__t">{t('tower.rates.big.new')}</p>
        <div class="twr-zonechosen__row">
          <ConsolePick label={t('tower.rates.big.sender')} value={draft.vendorId} onChange={(v) => setDraft({ ...draft, vendorId: v })} small options={view.senders.map((s) => ({ value: s.vendorId, label: s.name }))} />
          {(['card', 'discount'] as const).map((k) => (
            <button key={k} type="button" class={`cbtn cbtn--sm ${draft.kind === k ? 'cbtn--primary' : 'cbtn--ghost'}`} aria-pressed={draft.kind === k} onClick={() => setDraft({ ...draft, kind: k })}>
              {t(k === 'card' ? 'tower.rates.big.kindCard' : 'tower.rates.big.kindDiscount')}
            </button>
          ))}
        </div>
        {draft.kind === 'card' ? (
          <div class="twr-zonechosen__row">
            {view.steps.map((kg, i) => {
              const size = sizeOfStep(kg, i === view.steps.length - 1);
              return (
                <label key={kg} class="cfield">
                  <span class="cfield__label">{size ? t('tower.prices.kgSize', { kg, size: t(`tower.prices.size.${size}` as never) }) : t('tower.prices.kg', { kg })}</span>
                  <input id={`rate-price-${kg}`} class="cinput" inputMode="decimal" value={draft.prices[i] ?? ''} onInput={(e) => setDraft({ ...draft, prices: view.steps.map((_, j) => (j === i ? e.currentTarget.value : (draft.prices[j] ?? ''))) })} />
                </label>
              );
            })}
            <label class="cfield">
              <span class="cfield__label">{t('tower.rates.big.extraKg')}</span>
              <input id="rate-extra-kg" class="cinput" inputMode="decimal" value={draft.extraKg} onInput={(e) => setDraft({ ...draft, extraKg: e.currentTarget.value })} />
            </label>
          </div>
        ) : (
          <label class="cfield">
            <span class="cfield__label">{t('tower.rates.big.pct')}</span>
            <input id="rate-pct" class="cinput" inputMode="decimal" value={draft.pct} onInput={(e) => setDraft({ ...draft, pct: e.currentTarget.value })} />
          </label>
        )}
        <label class="cfield">
          <span class="cfield__label">{t('tower.rates.big.note')}</span>
          <input id="rate-note" class="cinput" maxLength={300} value={draft.note} onInput={(e) => setDraft({ ...draft, note: e.currentTarget.value })} />
        </label>
        <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || !body || !client} onClick={() => client && body && void act(() => client.api.proposeBusinessRate(entityId, body), t('tower.rates.big.proposed'))}>
          {t('tower.rates.big.propose')}
        </button>
      </div>
    </ConsoleFold>
  );
}
