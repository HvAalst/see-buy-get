import { useEffect, useState } from 'preact/hooks';
import { formatDate, useT } from '../../../shared/i18n';
import { paperDay } from '../../../shared/papers';
import { ConsolePick } from '../ConsolePick';
import { CurrencySelect } from './CurrencySelect';
import { CardPhoto } from './PapersScreen';
import { COVER_KINDS, type CourierPaperRow, type CoverKind } from '../papers';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * A COURIER'S OWN INSURANCE COVER (the user, 2026-10-28: "owner drivers should be able to show cover as well. Someone willing
 * to invest in it should be rewarded for it"). The policy they sent, large, and what staff read off it — until when, what
 * for, up to how much a load — or a refusal with the reason they are shown. Only cover read off a sent policy counts: there
 * is no way here to type cover on somebody's word.
 */
export function CourierCover({ row, state, actions }: { row: CourierPaperRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const cover = row.cover;
  const sent = cover?.sent;
  const [mode, setMode] = useState<'view' | 'refuse'>('view');
  const [expiresAt, setExpiresAt] = useState('');
  const [policy, setPolicy] = useState(sent?.reference ?? '');
  const [covers, setCovers] = useState<CoverKind | ''>('');
  const [limit, setLimit] = useState('');
  const [currency, setCurrency] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    setMode('view');
    setExpiresAt('');
    setPolicy(sent?.reference ?? '');
  }, [row.did, sent?.copyRef]);
  const busy = state.busyId === row.did;
  const limitBad = Boolean(limit.trim()) && (!(Number(limit) > 0) || !currency);
  const differs = Boolean(sent && expiresAt && expiresAt !== sent.expiresAt);

  if (!sent && !cover?.copyRef && !cover?.refused) return null;
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t(sent ? 'tower.courierCover.sentTitle' : 'tower.courierCover.title')}</span>
      </div>
      {sent ? (
        <>
          <p class="cons__lede">{t('tower.courierCover.sentRead', { date: formatDate(sent.sentAt), expires: paperDay(sent.expiresAt), policy: sent.reference ?? '—' })}</p>
          <CardPhoto mediaId={sent.copyRef} name={row.displayName} actions={actions} />
          {mode === 'refuse' ? (
            <div class="twr-clear">
              <label class="cfield">
                <span class="cfield__label">{t('tower.courierCover.why')}</span>
                <textarea class="cinput" rows={2} maxLength={500} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
              </label>
              <div class="twr-clear__act">
                <button type="button" class="cbtn cbtn--ghost" onClick={() => setMode('view')}>
                  {t('common.cancel')}
                </button>
                <button type="button" class="cbtn cbtn--danger" disabled={!reason.trim() || busy} onClick={() => void actions.refuseCourierCover(row.did, reason.trim(), row.displayName)}>
                  {t('tower.courierCover.refuse')}
                </button>
              </div>
            </div>
          ) : (
            <div class="twr-clear">
              <div class="twr-facts">
                <label class="cfield">
                  <span class="cfield__label">{t('tower.courierCover.readDate')}</span>
                  <input class="cinput" type="date" value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} />
                </label>
                <label class="cfield">
                  <span class="cfield__label">{t('tower.carrierPapers.policyLabel')}</span>
                  <input class="cinput" value={policy} autoComplete="off" onInput={(e) => setPolicy((e.target as HTMLInputElement).value)} />
                </label>
              </div>
              {differs ? <p class="cons__caveat">{t('tower.courierCover.differs', { expires: paperDay(sent.expiresAt) })}</p> : null}
              <div class="twr-facts">
                <ConsolePick label={t('tower.carrierPapers.covers')} value={covers} placeholder={t('tower.carrierPapers.coversNone')} options={COVER_KINDS.map((k) => ({ value: k, label: t(`tower.carrierPapers.covers.${k}`) }))} onChange={(v) => setCovers(v as CoverKind)} />
                <label class="cfield">
                  <span class="cfield__label">{t('tower.carrierPapers.limit')}</span>
                  <input class="cinput" type="number" min={1} value={limit} onInput={(e) => setLimit((e.target as HTMLInputElement).value)} />
                </label>
                <CurrencySelect api={(actions.client()?.api as never) ?? null} value={currency} onChange={setCurrency} label={t('tower.carrierPapers.limitCurrency')} near={row.jurisdiction ? [row.jurisdiction] : []} />
              </div>
              <p class="chint">{t('tower.courierCover.hint')}</p>
              <div class="twr-clear__act">
                <button type="button" class="cbtn cbtn--ghost" onClick={() => setMode('refuse')}>
                  {t('tower.courierCover.refuseOpen')}
                </button>
                <button
                  type="button"
                  class="cbtn cbtn--primary"
                  disabled={!expiresAt || limitBad || busy}
                  onClick={() =>
                    void actions.recordCourierCover(
                      row.did,
                      { expiresAt, ...(policy.trim() ? { policy: policy.trim() } : {}), ...(covers ? { covers } : {}), ...(limit.trim() ? { limit: Number(limit), currency } : {}) },
                      row.displayName,
                    )
                  }
                >
                  {t('tower.courierCover.record')}
                </button>
              </div>
            </div>
          )}
        </>
      ) : cover?.copyRef && cover.expiresAt ? (
        <p class="cons__lede">{t('tower.courierCover.onRecord', { expires: paperDay(cover.expiresAt), policy: cover.policy ?? '—', who: cover.recordedBy ?? '—', date: cover.recordedAt ? formatDate(cover.recordedAt) : '—' })}</p>
      ) : cover?.refused ? (
        <p class="cons__lede">{t('tower.courierCover.refusedLast', { reason: cover.refused.reason })}</p>
      ) : null}
    </section>
  );
}
