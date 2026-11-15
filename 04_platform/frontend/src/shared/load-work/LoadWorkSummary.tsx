import { useT } from '../i18n';
import { MARK_LABEL, endWords, type HandlingMark, type LoadWorkView } from '../loadWork';

/**
 * 2026-11-13 — WHAT IT TAKES TO MOVE IT, READ (unusual loads, U1–U3): what the load takes, each end — who helps there, the floor,
 * the carry, the waiting — and what the driver brings; the handling marks. On the driver's board and price sheet, their held
 * load, and the poster's own list. Nothing where the load says nothing.
 */
export function LoadWorkSummary({ work, look = 'app', forDriver = true }: { work: LoadWorkView | undefined; look?: 'app' | 'console'; /** The poster reads what the driver brings; the driver, what they bring. */ forDriver?: boolean }) {
  const t = useT();
  if (!work) return null;
  const hint = look === 'app' ? 'card__note' : 'chint';
  return (
    <div class="loadwork-sum">
      {work.needs ? <p class={hint}>{t(work.needs === 'machine' ? 'work.sum.machine' : work.needs === 'one' ? 'work.sum.carryOne' : work.needs === 'two' ? 'work.sum.carryTwo' : 'work.sum.carryThree')}</p> : null}
      {work.pickup ? (
        <p class={hint}>
          <b>{t('work.pickup')}:</b> {endWords(work.pickup, work.gaps?.pickup, 'pickup', t, forDriver)}
        </p>
      ) : null}
      {work.delivery ? (
        <p class={hint}>
          <b>{t('work.delivery')}:</b> {endWords(work.delivery, work.gaps?.delivery, 'delivery', t, forDriver)}
        </p>
      ) : null}
      {work.marks.length ? <p class={hint}>{work.marks.map((m) => t(MARK_LABEL[m as HandlingMark])).join(' · ')}</p> : null}
      {work.extras.length ? <p class={hint}>{t('work.negotiatedShort')}</p> : null}
    </div>
  );
}
