import { useEffect, useState } from 'preact/hooks';
import { narrow, type Result } from '../../../lib/sbg';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { cash } from '../../../shared/money';
import { PARTNER_WORK, type PartnerOwedRow, type PartnerWork } from '../../../shared/partnerOwed';
import { ConsoleFold } from '../ConsoleFold';

/**
 * 2026-11-20 — CHECKS ON THE PARTNER'S FIGURES, FOR OUR STAFF (the payments plan, 3b; the owner: "We also need AI anti fraud
 * scrutiny on the figures"). On a partner company's own page: each finding of the fixed rules and of the daily AI review, why —
 * in figures — and a "Looked at" with what was found. Nothing here stops a step or holds a payout: it tells staff where to look.
 */
export type PartnerCheckRule = 'twice' | 'never_held' | 'own_parcels' | 'off_list' | 'volume' | 'ai';

export interface PartnerFlagRow {
  flagId: string;
  rule: PartnerCheckRule;
  payeeId: string;
  payeeKind: PartnerOwedRow['payeeKind'];
  lineIds: string[];
  facts: { work?: PartnerWork; reference?: string; times?: number; amount?: number; listed?: number; currency?: string; day?: string; count?: number; usual?: number; parcels?: string[]; missing?: boolean };
  reason?: string;
  severity: 'look' | 'urgent';
  foundAt: string;
  looked?: { by: string; at: string; note?: string };
}

export interface PartnerReviewRow {
  day: string;
  at: string;
  state: 'done' | 'failed' | 'off';
  flags: number;
  why?: 'refused' | 'cut_short' | 'unreadable' | 'unreachable';
  rows?: number;
}

export interface PartnerChecksView {
  open: PartnerFlagRow[];
  looked: PartnerFlagRow[];
  review?: PartnerReviewRow;
  aiReady: boolean;
}

const RULE: Record<PartnerCheckRule, MessageKey> = {
  twice: 'tower.partner.checks.rule.twice',
  never_held: 'tower.partner.checks.rule.never_held',
  own_parcels: 'tower.partner.checks.rule.own_parcels',
  off_list: 'tower.partner.checks.rule.off_list',
  volume: 'tower.partner.checks.rule.volume',
  ai: 'tower.partner.checks.rule.ai',
};
const KIND: Record<PartnerOwedRow['payeeKind'], MessageKey> = { shop: 'tower.partner.kind.shop', hub: 'tower.partner.kind.hub', driver: 'tower.partner.kind.driver', fleet: 'tower.partner.kind.fleet' };
const WHY: Record<NonNullable<PartnerReviewRow['why']>, MessageKey> = {
  refused: 'tower.partner.checks.why.refused',
  cut_short: 'tower.partner.checks.why.cut_short',
  unreadable: 'tower.partner.checks.why.unreadable',
  unreachable: 'tower.partner.checks.why.unreachable',
};
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/** Why a finding was raised, in the reader's own language and its figures — the AI review's own words as it gave them. */
export function flagWhy(f: PartnerFlagRow, t: Translate): string {
  const x = f.facts;
  const work = x.work ? t(PARTNER_WORK[x.work]) : '';
  switch (f.rule) {
    case 'twice':
      return t('tower.partner.checks.say.twice', { work, reference: x.reference ?? '', times: x.times ?? 2 });
    case 'never_held':
      return t(x.missing ? 'tower.partner.checks.say.notOnRecord' : 'tower.partner.checks.say.neverHeld', { reference: x.reference ?? '' });
    case 'own_parcels':
      return t('tower.partner.checks.say.ownParcels', { count: x.count ?? 0, day: x.day ?? '', parcels: (x.parcels ?? []).join(', ') });
    case 'off_list':
      return t('tower.partner.checks.say.offList', { amount: cash(x.amount, x.currency), work, reference: x.reference ?? '', listed: cash(x.listed, x.currency) });
    case 'volume':
      return x.usual != null ? t('tower.partner.checks.say.volume', { count: x.count ?? 0, day: x.day ?? '', usual: x.usual }) : t('tower.partner.checks.say.volumeNew', { count: x.count ?? 0, day: x.day ?? '' });
    default:
      return f.reason ?? '';
  }
}

/** Where the daily AI review stands: not set up, not run yet, run (and what it found), or did not finish (and why). */
export function reviewWords(view: Pick<PartnerChecksView, 'review' | 'aiReady'>, t: Translate): string {
  const r = view.review;
  if (!view.aiReady || r?.state === 'off') return t('tower.partner.checks.reviewOff');
  if (!r) return t('tower.partner.checks.reviewNone');
  if (r.state === 'failed') return t('tower.partner.checks.reviewFailed', { at: when(r.at), why: t(WHY[r.why ?? 'unreachable']) });
  return t('tower.partner.checks.reviewDone', { at: when(r.at), n: r.flags });
}

/** The fold's inside, from what the server said — pure, for the test. */
export function PartnerChecksBody({ view, t, busy, onLooked, onReview }: { view: PartnerChecksView; t: Translate; busy?: string | null; onLooked?: (flagId: string, note: string) => void; onReview?: () => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <>
      <p class="chint">{t('tower.partner.checks.lede')}</p>
      <p class="chint">
        {reviewWords(view, t)}{' '}
        {view.aiReady && onReview ? (
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy === 'review'} onClick={onReview}>
            {t('tower.partner.checks.reviewBtn')}
          </button>
        ) : null}
      </p>
      {view.open.length === 0 ? (
        <p class="cons__empty">{t('tower.partner.checks.none')}</p>
      ) : (
        <div class="crows">
          {view.open.map((f) => (
            <div class="crow" key={f.flagId}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{t(RULE[f.rule])}</span>
                  <span class="ctag ctag--quiet">{t(KIND[f.payeeKind])}</span>
                  {f.severity === 'urgent' ? <span class="ctag ctag--warn">{t('tower.partner.checks.urgent')}</span> : null}
                </span>
                <span class="crow__sub">{flagWhy(f, t)}</span>
                <span class="crow__sub">
                  {f.payeeId} · {when(f.foundAt)}
                </span>
                {onLooked ? (
                  <input
                    class="cinput cinput--sm"
                    maxLength={500}
                    aria-label={t('tower.partner.checks.notePh')}
                    placeholder={t('tower.partner.checks.notePh')}
                    value={notes[f.flagId] ?? ''}
                    onInput={(e) => setNotes({ ...notes, [f.flagId]: (e.target as HTMLInputElement).value })}
                  />
                ) : null}
              </span>
              {onLooked ? (
                <span class="crow__tail">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy === f.flagId} onClick={() => onLooked(f.flagId, notes[f.flagId] ?? '')}>
                    {t('tower.partner.checks.lookedBtn')}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {view.looked.length ? (
        <>
          <p class="cfield__label">{t('tower.partner.checks.lookedTitle')}</p>
          <div class="crows">
            {view.looked.map((f) => (
              <div class="crow" key={f.flagId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{t(RULE[f.rule])}</span>
                    <span class="ctag ctag--quiet">{t(KIND[f.payeeKind])}</span>
                  </span>
                  <span class="crow__sub">{flagWhy(f, t)}</span>
                  {f.looked ? (
                    <span class="crow__sub">
                      {t('tower.partner.checks.lookedBy', { by: f.looked.by, at: when(f.looked.at) })}
                      {f.looked.note ? ` · ${f.looked.note}` : ''}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

type Load = (entityId: string) => Promise<Result<unknown>>;

export function PartnerChecksFold({ entityId, load, looked, review }: { entityId: string; load: Load; looked: (entityId: string, flagId: string, note?: string) => Promise<Result<unknown>>; review: Load }) {
  const t = useT();
  const [view, setView] = useState<PartnerChecksView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const refresh = () => load(entityId).then((r) => setView(r.error || !r.data ? null : narrow<PartnerChecksView>(r.data)));
  useEffect(() => {
    void refresh();
  }, [entityId]);
  const act = async (key: string, run: () => Promise<Result<unknown>>) => {
    setBusy(key);
    setFailed(null);
    const r = await run();
    setBusy(null);
    if (r.error) setFailed(r.error.detail || r.error.title || t('tower.partner.checks.failed'));
    await refresh();
  };
  if (!view) return null;
  const hint = view.open.length ? t('tower.partner.checks.hintOpen', { n: view.open.length }) : t('tower.partner.checks.hintNone');
  return (
    <ConsoleFold title={t('tower.partner.checks.title')} hint={hint} defaultOpen={view.open.length > 0}>
      {failed ? <p class="cerr">{failed}</p> : null}
      <PartnerChecksBody view={view} t={t} busy={busy} onLooked={(flagId, note) => void act(flagId, () => looked(entityId, flagId, note))} onReview={() => void act('review', () => review(entityId))} />
    </ConsoleFold>
  );
}
