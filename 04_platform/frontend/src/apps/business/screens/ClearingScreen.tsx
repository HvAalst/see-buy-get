import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { Abbreviated } from '../../../shared/ui/Abbr';
import type { BusinessClient, BusinessView } from '../api';
import { clearingGroups, type ClearingRow, type ClearingView } from '../clearing';

/**
 * 2026-11-19 — CUSTOMS CLEARING (parcels across a border, step 4). The countries this business is named to clear in, accepted by
 * an owner; then the parcels into them: coming from abroad, waiting for customs — released, or held with what customs asks and
 * its reference — and held ones, said paid once customs released them. The parcel stays with our warehouse throughout.
 */
export function ClearingScreen({ business, client }: { business: BusinessView; client: BusinessClient | null }) {
  const [view, setView] = useState<ClearingView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.clearing.view();
    if (r.error) return setError(r.error.detail || r.error.title || null);
    setView(r.data ?? null);
  }, [client]);
  useEffect(() => void load(), [load]);
  const act = async (key: string, call: () => Promise<{ error?: { detail?: string; title?: string } | null }>) => {
    setBusy(key);
    setError(null);
    const r = await call();
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title || null);
    await load();
  };
  return (
    <ClearingPanel
      view={view}
      owner={business.you.role === 'owner'}
      mayAct={business.you.role !== 'viewer'}
      busy={busy}
      error={error}
      onAccept={(country) => void act(`accept:${country}`, () => client!.clearing.accept(country))}
      onReleased={(id) => void act(`released:${id}`, () => client!.clearing.customs(id, { outcome: 'released' }))}
      onHeld={(id, amount, reference) => void act(`held:${id}`, () => client!.clearing.customs(id, { outcome: 'held', amount, reference }))}
      onPaid={(id) => void act(`paid:${id}`, () => client!.clearing.paid(id))}
    />
  );
}

/** The screen as it reads: kept apart from its calls so it can be tested. */
export function ClearingPanel(p: {
  view: ClearingView | null;
  owner: boolean;
  mayAct: boolean;
  busy: string | null;
  error: string | null;
  onAccept: (country: string) => void;
  onReleased: (parcelId: string) => void;
  onHeld: (parcelId: string, amount: number, reference: string) => void;
  onPaid: (parcelId: string) => void;
}) {
  const t = useT();
  const [holding, setHolding] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const value = Number(amount.replace(',', '.'));
  const g = clearingGroups(p.view?.rows ?? []);
  const line = (r: ClearingRow) => t('business.clearing.row', { parcel: r.parcelId, country: r.toName, airport: r.arrival, seal: r.seal });
  const declared = (r: ClearingRow) => t('business.clearing.declared', { contents: r.contents, count: r.itemCount, value: r.value.toFixed(2), currency: r.valueCurrency });
  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.clearing.title')}</h1>
        <p class="cons__lede">{t('business.clearing.lede')}</p>
      </header>
      {p.error ? (
        <p class="cerr">
          <Abbreviated text={p.error} />
        </p>
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.clearing.countries')}</span>
        </div>
        {p.view && !p.view.countries.length ? <p class="chint">{t('business.clearing.noCountries')}</p> : null}
        <div class="crows">
          {(p.view?.countries ?? []).map((c) => (
            <div class="crow" key={c.country}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{c.name}</span>
                  <span class={`ctag ctag--${c.accepted ? 'ok' : 'warn'}`}>{t(c.accepted ? 'business.clearing.accepted' : 'business.clearing.named')}</span>
                </span>
              </span>
              {!c.accepted && p.owner ? (
                <span class="twr-panelend">
                  <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={p.busy !== null} onClick={() => p.onAccept(c.country)}>
                    {t('business.clearing.accept')}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {p.view?.countries.some((c) => !c.accepted) && !p.owner ? <p class="chint">{t('business.clearing.acceptOwner')}</p> : null}
      </section>

      {g.customs.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.clearing.customs')}</span>
          </div>
          <div class="crows">
            {g.customs.map((r) => (
              <div class="crow" key={r.parcelId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name mono">{line(r)}</span>
                  </span>
                  <span class="crow__sub">{declared(r)}</span>
                  {holding === r.parcelId ? (
                    <span class="crow__sub">
                      <label class="cfield">
                        <span class="cfield__label">{t('business.clearing.amount')}</span>
                        <input id={`clearing-amount-${r.parcelId}`} class="cinput" inputMode="decimal" value={amount} maxLength={12} onInput={(e) => setAmount(e.currentTarget.value)} />
                      </label>
                      <label class="cfield">
                        <span class="cfield__label">{t('business.clearing.reference')}</span>
                        <input id={`clearing-ref-${r.parcelId}`} class="cinput" value={reference} maxLength={60} onInput={(e) => setReference(e.currentTarget.value)} />
                      </label>
                    </span>
                  ) : null}
                </span>
                {p.mayAct ? (
                  <span class="twr-panelend">
                    {holding === r.parcelId ? (
                      <>
                        <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={p.busy !== null || !(value > 0) || reference.trim().length < 3} onClick={() => p.onHeld(r.parcelId, Math.round(value * 100) / 100, reference.trim())}>
                          {t('business.clearing.saveHold')}
                        </button>
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setHolding(null)}>
                          {t('business.clearing.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={p.busy !== null} onClick={() => p.onReleased(r.parcelId)}>
                          {t('business.clearing.released')}
                        </button>
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={p.busy !== null} onClick={() => setHolding(r.parcelId)}>
                          {t('business.clearing.held')}
                        </button>
                      </>
                    )}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {g.held.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.clearing.heldTitle', { count: g.held.length })}</span>
          </div>
          <div class="crows">
            {g.held.map((r) => (
              <div class="crow" key={r.parcelId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name mono">{line(r)}</span>
                  </span>
                  <span class="crow__sub">
                    {r.held ? t('business.clearing.heldLine', { amount: r.held.amount.toFixed(2), currency: r.held.currency, reference: r.held.reference, date: (r.held.payBy ?? '').slice(0, 10) }) : ''}
                    {r.held?.lapsed ? ` · ${t('business.clearing.lapsed')}` : ''}
                  </span>
                </span>
                {p.mayAct ? (
                  <span class="twr-panelend">
                    <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={p.busy !== null} onClick={() => p.onPaid(r.parcelId)}>
                      {t('business.clearing.paid')}
                    </button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {g.coming.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.clearing.coming')}</span>
          </div>
          <div class="crows">
            {g.coming.map((r) => (
              <div class="crow" key={r.parcelId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name mono">{line(r)}</span>
                  </span>
                  <span class="crow__sub">{t('business.clearing.comingWith', { carrier: r.carrier, reference: r.reference ?? '' })}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {p.view && p.view.countries.some((c) => c.accepted) && !(p.view.rows.length) ? <p class="chint">{t('business.clearing.nothing')}</p> : null}
    </>
  );
}
