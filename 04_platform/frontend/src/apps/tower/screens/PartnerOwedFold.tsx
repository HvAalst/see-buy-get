import { useEffect, useState } from 'preact/hooks';
import { narrow, type Result } from '../../../lib/sbg';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { cash } from '../../../shared/money';
import { workWords, type PartnerOwedRow } from '../../../shared/partnerOwed';
import { ConsoleFold } from '../ConsoleFold';

/**
 * 2026-11-20 — WHAT THE PARTNER OWES, FOR OUR STAFF (the payments plan, 3a; the owner: "console for staff"). On a partner
 * company's own page: what it owes in all, what it owes each hand — a shop, a hub, a courier, a fleet — and every step, newest
 * first. Read only: the partner pays, nothing here moves money.
 */
export interface PartnerLedgerView {
  partnerEntityId: string;
  partnerName: string;
  currency: string;
  owed: number;
  byPayee: Array<{ payeeId: string; payeeKind: PartnerOwedRow['payeeKind']; amount: number; steps: number }>;
  lines: PartnerOwedRow[];
}

const KIND: Record<PartnerOwedRow['payeeKind'], MessageKey> = { shop: 'tower.partner.kind.shop', hub: 'tower.partner.kind.hub', driver: 'tower.partner.kind.driver', fleet: 'tower.partner.kind.fleet' };

/** The fold's inside, from what the server said — pure, for the test. */
export function PartnerOwedBody({ view, t }: { view: PartnerLedgerView; t: Translate }) {
  if (view.lines.length === 0) return <p class="cons__empty">{t('tower.partner.owedNone')}</p>;
  return (
    <>
      <p class="chint">
        <b>{t('tower.partner.owedTotal', { amount: cash(view.owed, view.currency) })}</b>
      </p>
      <p class="cfield__label">{t('tower.partner.byPayee')}</p>
      <div class="crows">
        {view.byPayee.map((p) => (
          <div class="crow" key={p.payeeId}>
            <span class="crow__body">
              <span class="crow__top">
                <span class="crow__name">{p.payeeId}</span>
                <span class="ctag ctag--quiet">{t(KIND[p.payeeKind])}</span>
              </span>
              <span class="crow__sub">{t('tower.partner.steps', { n: p.steps })}</span>
            </span>
            <span class="crow__end">{cash(p.amount, view.currency)}</span>
          </div>
        ))}
      </div>
      <p class="cfield__label">{t('tower.partner.lines')}</p>
      <div class="crows">
        {view.lines.slice(0, 50).map((l) => (
          <div class="crow" key={l.lineId}>
            <span class="crow__body">
              <span class="crow__top">
                <span class="crow__name">{t(workWords(l))}</span>
                <span class="ctag ctag--quiet">{t(KIND[l.payeeKind])}</span>
                {l.takenBack ? <span class="ctag ctag--quiet">{t('partner.owed.takenBack')}</span> : null}
              </span>
              <span class="crow__sub">
                {l.reference} · {l.payeeId} · {l.at.slice(0, 16).replace('T', ' ')}
              </span>
            </span>
            <span class="crow__end">{cash(l.amount, l.currency)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function PartnerOwedFold({ entityId, load }: { entityId: string; load: (entityId: string) => Promise<Result<unknown>> }) {
  const t = useT();
  const [view, setView] = useState<PartnerLedgerView | null>(null);
  useEffect(() => {
    void load(entityId).then((r) => setView(r.error || !r.data ? null : narrow<PartnerLedgerView>(r.data)));
  }, [entityId]);
  if (!view) return null;
  return (
    <ConsoleFold title={t('tower.partner.owedTitle')} hint={view.lines.length ? t('tower.partner.owedTotal', { amount: cash(view.owed, view.currency) }) : t('tower.partner.owedNoneShort')} defaultOpen={view.lines.length > 0}>
      <PartnerOwedBody view={view} t={t} />
    </ConsoleFold>
  );
}
