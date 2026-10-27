import { useT } from '../i18n';
import { Button } from './Button';
import { Sheet } from './Sheet';

/**
 * "WERE YOU PAID?" — asked once, before the carrier says on the record that the shipper paid the price agreed for a load
 * settled between them (the user, 2026-10-27: "Driver ticks 'paid'"). The shipper sees it, with the time; it cannot be taken
 * back, so the question names the load and the amount.
 */
export function PaidDirectSheet({ open, code, amount, office = false, busy, onYes, onClose }: { open: boolean; code: string; amount: string; office?: boolean; busy?: boolean; onYes: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t('common.paidDirect.title')}>
      <p class="t-body">{office ? t('common.paidDirect.bodyOffice', { amount, code }) : t('common.paidDirect.body', { amount, code })}</p>
      <Button busy={busy} onClick={onYes}>
        {office ? t('common.paidDirect.yesOffice', { amount }) : t('common.paidDirect.yes', { amount })}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('common.paidDirect.notYet')}
      </Button>
    </Sheet>
  );
}
