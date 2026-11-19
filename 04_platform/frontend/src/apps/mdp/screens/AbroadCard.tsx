import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient, type SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Button, Card, ErrorNote } from '../../../shared/ui';
import { abroadGroups, abroadLine, heldAbroadLine, type AbroadRow } from '../abroad';

/**
 * 2026-11-18 — PARCELS ABROAD AT THIS HUB (parcels across a border, step 2c). Where a route leaves from here: its parcels set
 * aside from the sort, handed together to the route's carrier under the carrier's reference. Where a route arrives here, at
 * the customs warehouse: each parcel received from the carrier, then what customs decided — released, it is sorted as any
 * parcel; held, with what customs asks and its reference, it stays on the customs shelf until that is paid. Shown only while
 * there is something to do.
 */
export function AbroadCard({ sbg, mdpId, onChanged }: { sbg: SbgClient | null; mdpId?: string; onChanged?: () => void }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [rows, setRows] = useState<AbroadRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<Record<string, boolean>>({});
  const [holding, setHolding] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [customsRef, setCustomsRef] = useState('');

  const load = useCallback(async () => {
    if (!api || !mdpId) return;
    const r = (await api.abroad(mdpId)) as { data?: { rows?: AbroadRow[] }; error?: SbgError | null };
    if (!r.error) setRows(r.data?.rows ?? []);
  }, [api, mdpId]);
  useEffect(() => void load(), [load]);

  const act = async (key: string, call: () => Promise<{ error?: SbgError | null }>) => {
    setBusy(key);
    setError(null);
    const r = await call();
    setBusy(null);
    if (r.error) return setError(r.error);
    setHolding(null);
    setAmount('');
    setCustomsRef('');
    await load();
    onChanged?.();
  };

  if (!rows.length || !api || !mdpId) return null;
  const g = abroadGroups(rows);
  const value = Number(amount.replace(',', '.'));
  return (
    <Card title={t('mdp.abroad.title')} tone="soft">
      {error ? <ErrorNote error={error} showDetail /> : null}

      {g.toHand.map(({ carrier, rows: list }) => {
        const chosen = list.filter((r) => !left[r.parcelId]).map((r) => r.parcelId);
        const ref = refs[carrier] ?? '';
        return (
          <section key={carrier} style="margin-bottom:16px">
            <p class="t-body">
              <b>{t('mdp.abroad.toHand', { carrier })}</b>
            </p>
            <p class="hint">{t('mdp.abroad.toHandLede')}</p>
            <ul class="relabel">
              {list.map((r) => (
                <li key={r.parcelId}>
                  <label class="checkline">
                    <input type="checkbox" checked={!left[r.parcelId]} onChange={(e) => setLeft((s) => ({ ...s, [r.parcelId]: !e.currentTarget.checked }))} />
                    <span class="mono relabel__ids">{abroadLine(r, t)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div class="field">
              <label class="field__label" for={`abroad-ref-${carrier}`}>
                {t('mdp.abroad.reference')}
              </label>
              <input id={`abroad-ref-${carrier}`} class="input" value={ref} maxLength={60} autoComplete="off" autocapitalize="characters" onInput={(e) => setRefs((s) => ({ ...s, [carrier]: e.currentTarget.value }))} />
            </div>
            <Button chevron={false} busy={busy === `hand:${carrier}`} disabled={!chosen.length || ref.trim().length < 3} onClick={() => void act(`hand:${carrier}`, () => api.handAbroad(mdpId, chosen, ref.trim()) as Promise<{ error?: SbgError | null }>)}>
              {t('mdp.abroad.hand', { count: chosen.length, carrier })}
            </Button>
          </section>
        );
      })}

      {g.coming.length ? (
        <section style="margin-bottom:16px">
          <p class="t-body">
            <b>{t('mdp.abroad.coming')}</b>
          </p>
          <ul class="relabel">
            {g.coming.map((r) => (
              <li key={r.parcelId}>
                <span class="mono relabel__ids">{abroadLine(r, t)}</span>
                <span class="hint relabel__ids">{t('mdp.abroad.comingWith', { carrier: r.carrier, reference: r.reference ?? '' })}</span>
                <Button full={false} chevron={false} busy={busy === `receive:${r.parcelId}`} onClick={() => void act(`receive:${r.parcelId}`, () => api.receiveAbroad(mdpId, r.parcelId) as Promise<{ error?: SbgError | null }>)}>
                  {t('mdp.abroad.receive')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {g.customs.length ? (
        <section style="margin-bottom:16px">
          <p class="t-body">
            <b>{t('mdp.abroad.customs')}</b>
          </p>
          <p class="hint">{t('mdp.abroad.customsLede')}</p>
          <ul class="relabel">
            {g.customs.map((r) => (
              <li key={r.parcelId}>
                <span class="mono relabel__ids">{abroadLine(r, t)}</span>
                <span class="hint relabel__ids">{t('mdp.abroad.declared', { contents: r.contents, count: r.itemCount, value: r.value.toFixed(2), currency: r.valueCurrency })}</span>
                {holding === r.parcelId ? (
                  <>
                    <div class="field">
                      <label class="field__label" for={`abroad-amount-${r.parcelId}`}>
                        {t('mdp.abroad.amount')}
                      </label>
                      <input id={`abroad-amount-${r.parcelId}`} class="input" inputMode="decimal" value={amount} maxLength={12} onInput={(e) => setAmount(e.currentTarget.value)} />
                    </div>
                    <div class="field">
                      <label class="field__label" for={`abroad-customs-ref-${r.parcelId}`}>
                        {t('mdp.abroad.customsRef')}
                      </label>
                      <input id={`abroad-customs-ref-${r.parcelId}`} class="input" value={customsRef} maxLength={60} autoComplete="off" autocapitalize="characters" onInput={(e) => setCustomsRef(e.currentTarget.value)} />
                    </div>
                    <Button
                      full={false}
                      chevron={false}
                      busy={busy === `held:${r.parcelId}`}
                      disabled={!(value > 0) || customsRef.trim().length < 3}
                      onClick={() => void act(`held:${r.parcelId}`, () => api.customsAbroad(mdpId, r.parcelId, { outcome: 'held', amount: Math.round(value * 100) / 100, reference: customsRef.trim() }) as Promise<{ error?: SbgError | null }>)}
                    >
                      {t('mdp.abroad.saveHold')}
                    </Button>
                    <Button variant="link" onClick={() => setHolding(null)}>
                      {t('mdp.abroad.cancel')}
                    </Button>
                  </>
                ) : (
                  <span class="relabel__ids">
                    <Button full={false} chevron={false} busy={busy === `released:${r.parcelId}`} onClick={() => void act(`released:${r.parcelId}`, () => api.customsAbroad(mdpId, r.parcelId, { outcome: 'released' }) as Promise<{ error?: SbgError | null }>)}>
                      {t('mdp.abroad.released')}
                    </Button>{' '}
                    <Button full={false} variant="outline" chevron={false} onClick={() => setHolding(r.parcelId)}>
                      {t('mdp.abroad.held')}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {g.givenUp.length ? (
        <section style="margin-bottom:16px">
          <p class="t-body">
            <b>{t('mdp.abroad.givenUpTitle')}</b>
          </p>
          <p class="hint">{t('mdp.abroad.givenUpLede')}</p>
          <ul class="relabel">
            {g.givenUp.map((r) => (
              <li key={r.parcelId}>
                <span class="mono relabel__ids">{abroadLine(r, t)}</span>
                <Button full={false} chevron={false} busy={busy === `dispose:${r.parcelId}`} onClick={() => void act(`dispose:${r.parcelId}`, () => api.disposeAbroad(mdpId, r.parcelId) as Promise<{ error?: SbgError | null }>)}>
                  {t('mdp.abroad.dispose')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {g.held.length ? (
        <section>
          <p class="t-body">
            <b>{t('mdp.abroad.heldTitle', { count: g.held.length })}</b>
          </p>
          <p class="hint">{t('mdp.abroad.heldLede')}</p>
          <ul class="relabel">
            {g.held.map((r) => (
              <li key={r.parcelId}>
                <span class="mono relabel__ids">{abroadLine(r, t)}</span>
                <span class="hint relabel__ids">{heldAbroadLine(r, t)}</span>
                <Button full={false} chevron={false} busy={busy === `paid:${r.parcelId}`} onClick={() => void act(`paid:${r.parcelId}`, () => api.paidAbroad(mdpId, r.parcelId) as Promise<{ error?: SbgError | null }>)}>
                  {t('mdp.abroad.paid')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}
