import { Abbreviated } from '../../../shared/ui/Abbr';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { BusinessClient, BusinessView, CarriageContract } from '../api';
import { contractPeriod } from '../logic';
import type { BusinessActions } from '../useBusinessApp';
import { FindHaulier } from './FindHaulier';

/**
 * P1 — THE CARRIERS THIS BUSINESS HAS A CONTRACT WITH.
 *
 * The user, 2026-10-05: fleets work for shippers under contracts that run for a season, and they must deliver. The
 * fleet records the contract and sends the business a code; an owner links it here, and from then on a load posted
 * "with" that carrier goes straight into the fleet's queue instead of onto the open board. The price and the terms
 * are on their own paper, between the two of them — this screen keeps only who, which reference, and since when.
 */
export function ContractsScreen({ business, client }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null }) {
  const t = useT();
  const owner = business.you.role === 'owner';
  const [rows, setRows] = useState<CarriageContract[] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.contracts();
    if (r.error) return setError(r.error.detail || r.error.title);
    setRows(r.data?.items ?? []);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const link = async (e: Event) => {
    e.preventDefault();
    if (!client || !code.trim()) return;
    setBusy(true);
    setError(null);
    const r = await client.linkContract(code.trim());
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setDone(t('business.contracts.linked', { fleet: r.data.fleetName }));
    setCode('');
    await load();
  };

  const end = async (contractId: string) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = await client.endContract(contractId, reason.trim() || undefined);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setDone(t('business.contracts.endedNote', { fleet: r.data.fleetName }));
    setEnding(null);
    setReason('');
    await load();
  };

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.contracts.title')}</h1>
        <p class="cons__lede">{t('business.contracts.lede')}</p>
      </header>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}

      {owner ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.contracts.linkTitle')}</span>
          </div>
          <form onSubmit={(e) => void link(e)}>
            <label class="cfield">
              <span class="cfield__label">{t('business.contracts.f.code')}</span>
              <input class="cinput biz-code" maxLength={40} autocomplete="off" spellcheck={false} value={code} placeholder="ABCDE-FGHJK" onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
              <span class="chint">{t('business.contracts.f.codeHint')}</span>
            </label>
            <div class="twr-panelend">
              <button type="submit" class="cbtn cbtn--primary" disabled={busy || !code.trim()}>
                {t('business.contracts.linkCta')}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <p class="chint">{t('business.contracts.ownerOnly')}</p>
      )}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.contracts.listTitle')}</span>
        </div>
        {rows === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('business.contracts.none')}</p>
        ) : (
          <div class="crows">
            {rows.map((c) => (
              <div class="crow" key={c.contractId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">
                      {c.fleetName}
                      {c.reference ? ` · ${c.reference}` : ''}
                    </span>
                    <span class={`ctag ctag--${c.status === 'active' ? 'ok' : 'quiet'}`}>{t(c.status === 'active' ? 'business.contracts.active' : 'business.contracts.ended')}</span>
                  </span>
                  <span class="crow__sub">
                    {contractPeriod(c, t)}
                    {c.shipper.linkedBy ? ` · ${t('business.contracts.linkedBy', { who: c.shipper.linkedBy, when: (c.shipper.linkedAt ?? '').slice(0, 10) })}` : ''}
                    {c.ended ? ` · ${t(c.ended.side === 'fleet' ? 'business.contracts.endedByFleet' : 'business.contracts.endedByYou', { who: c.ended.by, when: c.ended.at.slice(0, 10) })}` : ''}
                    {c.ended?.reason ? ` — ${c.ended.reason}` : ''}
                  </span>
                  {owner && c.status === 'active' ? (
                    ending === c.contractId ? (
                      <span class="biz-contract__end">
                        <input class="cinput" maxLength={280} value={reason} placeholder={t('business.contracts.reasonPh')} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
                        <span class="chint">{t('business.contracts.endHint')}</span>
                        <span class="twr-panelend">
                          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setEnding(null)}>
                            {t('common.cancel')}
                          </button>
                          <button type="button" class="cbtn cbtn--danger cbtn--sm" disabled={busy} onClick={() => void end(c.contractId)}>
                            {t('business.contracts.endCta')}
                          </button>
                        </span>
                      </span>
                    ) : (
                      <span class="twr-panelend">
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setEnding(c.contractId)}>
                          {t('business.contracts.end')}
                        </button>
                      </span>
                    )
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
        <p class="chint">{t('business.contracts.howTo')}</p>
      </section>

      {/* A carrier to ask, from the logistics directory (2026-10-30): reached by a button, asked in its own app. */}
      <FindHaulier client={client} owner={owner} onAsked={(fleet) => setDone(t('business.contracts.askedNote', { fleet }))} />
    </>
  );
}
