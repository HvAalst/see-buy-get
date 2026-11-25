import { useEffect, useState } from 'preact/hooks';
import { narrow, type Result } from '../../../lib/sbg';
import { useT, type Translate } from '../../../shared/i18n';
import { cash } from '../../../shared/money';
import { ConsoleFold } from '../ConsoleFold';

/** One week's statement, as the server says it (backend partner-statement.service.ts, PartnerStatementView). */
export interface PartnerStatement {
  statementId: string;
  sellerName: string;
  weekStart: string;
  weekEnd: string;
  amount: number;
  currency: string;
  steps: number;
  closed: boolean;
  paidAt?: string;
  paidBy?: string;
  paidReference?: string;
}

export interface PartnerStatements {
  statements: PartnerStatement[];
  unpaid: Record<string, number>;
}

/** What still waits to be paid, in words: each money's total, or nothing. */
export function unpaidLine(view: PartnerStatements, t: Translate): string {
  const parts = Object.entries(view.unpaid).map(([currency, amount]) => cash(amount, currency));
  return parts.length ? t('tower.partner.statementsUnpaid', { amount: parts.join(' + ') }) : t('tower.partner.statementsAllPaid');
}

/** The state of one week, in words: open, to pay, or paid by whom with which transfer. */
export function statementState(s: PartnerStatement, t: Translate): string {
  if (s.paidAt) return t('tower.partner.statementPaid', { date: s.paidAt.slice(0, 10), by: s.paidBy ?? '', reference: s.paidReference ?? '' });
  return t(s.closed ? 'tower.partner.statementToPay' : 'tower.partner.statementOpen');
}

/**
 * 2026-11-24 — WHAT COMPANIES OF OURS OWE A PARTNER, WEEK BY WEEK (route plan part 4; the owner: "we owe it weekly"). On a partner
 * company's own page: each week, Sunday to Saturday, the company of ours that owes it, for how many steps of its hands, and how
 * much; a week over is paid by bank transfer and said here, with the transfer's reference.
 */
export function PartnerStatementsBody({ view, t, onPaid, busy }: { view: PartnerStatements; t: Translate; onPaid?: (statementId: string, reference: string) => void; busy?: boolean }) {
  const [refs, setRefs] = useState<Record<string, string>>({});
  if (view.statements.length === 0) return <p class="cons__empty">{t('tower.partner.statementsNone')}</p>;
  return (
    <>
      <p class="chint">
        <b>{unpaidLine(view, t)}</b>
      </p>
      <div class="crows">
        {view.statements.map((s) => (
          <div class="crow" key={s.statementId}>
            <span class="crow__body">
              <span class="crow__top">
                <span class="crow__name">{t('tower.partner.statementWeek', { from: s.weekStart, to: s.weekEnd })}</span>
                <span class="ctag ctag--quiet">{statementState(s, t)}</span>
              </span>
              <span class="crow__sub">{t('tower.partner.statementWho', { company: s.sellerName, n: s.steps })}</span>
              {onPaid && s.closed && !s.paidAt ? (
                <span class="crow__sub">
                  <input class="cinput" aria-label={t('tower.partner.statementReference')} placeholder={t('tower.partner.statementReference')} value={refs[s.statementId] ?? ''} onInput={(e) => setRefs({ ...refs, [s.statementId]: e.currentTarget.value })} />
                  <button type="button" class="cbtn cbtn--ghost" disabled={busy || (refs[s.statementId] ?? '').trim().length < 3} onClick={() => onPaid(s.statementId, (refs[s.statementId] ?? '').trim())}>
                    {t('tower.partner.statementMarkPaid')}
                  </button>
                </span>
              ) : null}
            </span>
            <span class="crow__end">{cash(s.amount, s.currency)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function PartnerStatementsFold({ entityId, load, paid }: { entityId: string; load: (entityId: string) => Promise<Result<unknown>>; paid: (entityId: string, statementId: string, reference: string) => Promise<Result<unknown>> }) {
  const t = useT();
  const [view, setView] = useState<PartnerStatements | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const read = () => void load(entityId).then((r) => setView(r.error || !r.data ? null : narrow<PartnerStatements>(r.data)));
  useEffect(read, [entityId]);
  if (!view) return null;
  return (
    <ConsoleFold title={t('tower.partner.statementsTitle')} hint={unpaidLine(view, t)} defaultOpen={Object.keys(view.unpaid).length > 0}>
      <p class="chint">{t('tower.partner.statementsLede')}</p>
      {problem ? <p class="cerr">{problem}</p> : null}
      <PartnerStatementsBody
        view={view}
        t={t}
        busy={busy}
        onPaid={(statementId, reference) => {
          setBusy(true);
          setProblem(null);
          void paid(entityId, statementId, reference).then((r) => {
            setBusy(false);
            if (r.error) return setProblem((r.error as { detail?: string }).detail ?? t('tower.partner.statementFailed'));
            read();
          });
        }}
      />
    </ConsoleFold>
  );
}
