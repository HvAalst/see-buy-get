import { useEffect, useState } from 'preact/hooks';
import { narrow, type Result } from '../lib/sbg';
import { useT, type MessageKey, type Translate } from './i18n';
import { cash } from './money';
import { Card } from './ui';

/**
 * 2026-11-20 — WHAT THE PARTNER OWES YOU, NAMED (the payments plan, 3a; the owner: the hands see it, "Yes, named"). In a country
 * where a partner company contracts and pays for the network, a shop, a hub, a courier and a fleet's office each see the steps
 * the partner owes them for, at its own rates, in its money — and who it is. Nothing where nothing is owed.
 */
export interface PartnerOwedRow {
  lineId: string;
  partnerName: string;
  payeeId: string;
  payeeKind: 'shop' | 'hub' | 'driver' | 'fleet';
  amount: number;
  currency: string;
  reference: string;
  step: 'labour' | 'sort' | 'receiving' | 'pass_on' | 'haul';
  at: string;
  /** A step undone (a parcel voided or called off at the shop): what was owed for it, taken back — its amount below zero. */
  takenBack?: boolean;
  /** Which work, exactly: a take-in, a shelving, a release… (3b). Absent on a line from before it was said. */
  work?: PartnerWork;
  /** What the partner’s own list said for that work when it was owed. */
  listed?: number;
}

export type PartnerWork = 'take_in' | 'shelving' | 'release' | 'handover' | 'holding' | 'sort' | 'receiving' | 'pass_on' | 'bag_load' | 'road';

export interface MyPartnerOwed {
  lines: PartnerOwedRow[];
  totals?: Array<{ partnerName: string; currency: string; amount: number }>;
}

export const PARTNER_STEP: Record<PartnerOwedRow['step'], MessageKey> = {
  labour: 'partner.owed.step.labour',
  sort: 'partner.owed.step.sort',
  receiving: 'partner.owed.step.receiving',
  pass_on: 'partner.owed.step.pass_on',
  haul: 'partner.owed.step.haul',
};

/** 2026-11-20 — which work, said as the hand did it: “Taken in”, “Handed out”, “A bag loaded” (3b). */
export const PARTNER_WORK: Record<PartnerWork, MessageKey> = {
  take_in: 'partner.owed.work.take_in',
  shelving: 'partner.owed.work.shelving',
  release: 'partner.owed.work.release',
  handover: 'partner.owed.work.handover',
  holding: 'partner.owed.work.holding',
  sort: 'partner.owed.work.sort',
  receiving: 'partner.owed.work.receiving',
  pass_on: 'partner.owed.work.pass_on',
  bag_load: 'partner.owed.work.bag_load',
  road: 'partner.owed.work.road',
};

/** The words for a line's work: the very work where it is said, the kind of step where it is not. */
export const workWords = (l: Pick<PartnerOwedRow, 'work' | 'step'>): MessageKey => (l.work ? PARTNER_WORK[l.work] : PARTNER_STEP[l.step]);

const when = (at: string) => new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The card, from what the server said — pure, for the test. The latest twenty steps; the total per partner first. */
export function PartnerOwedList({ owed, t }: { owed: MyPartnerOwed | null; t: Translate }) {
  if (!owed || owed.lines.length === 0) return null;
  return (
    <Card title={t('partner.owed.title')}>
      {(owed.totals ?? []).map((total) => (
        <p class="t-body" key={`${total.partnerName}|${total.currency}`}>
          <b>{t('partner.owed.total', { partner: total.partnerName, amount: cash(total.amount, total.currency) })}</b>
        </p>
      ))}
      <p class="hint">{t('partner.owed.note')}</p>
      <div class="rows" role="list">
        {owed.lines.slice(0, 20).map((l) => (
          <div class="row" role="listitem" key={l.lineId}>
            <span class="row__body">
              <span class="row__title">
                {t(workWords(l))} · {l.reference}
                {l.takenBack ? ` · ${t('partner.owed.takenBack')}` : null}
              </span>
              <span class="row__meta">{when(l.at)}</span>
            </span>
            <span class="row__end">{cash(l.amount, l.currency)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Reads what the partners owe this sign-in, once, as the screen opens. */
export function PartnerOwedCard({ fetchOwed }: { fetchOwed: () => Promise<Result<unknown> | { data: null; error: null }> }) {
  const t = useT();
  const [owed, setOwed] = useState<MyPartnerOwed | null>(null);
  useEffect(() => {
    void fetchOwed().then((r) => setOwed(r.error || !r.data ? null : narrow<MyPartnerOwed>(r.data)));
  }, []);
  return <PartnerOwedList owed={owed} t={t} />;
}

/** The request every app makes for it, through its own client. */
export const PARTNER_OWED_PATH = '/v1/sbg/partner-owed/mine';
