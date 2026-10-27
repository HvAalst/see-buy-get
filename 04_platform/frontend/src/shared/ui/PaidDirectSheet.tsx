import { useT } from '../i18n';
import { Button } from './Button';
import { Sheet } from './Sheet';

/**
 * "WERE YOU PAID?" — asked once, before the carrier says on the record that the shipper paid the price agreed for a load
 * settled between them (the user, 2026-10-27: "Driver ticks 'paid'"). The shipper sees it, with the time; it cannot be taken
 * back, so the question names the load and the amount. With `notPaid`: delivered and NOT paid yet — the shipper is told.
 */
export function PaidDirectSheet({ open, code, amount, office = false, notPaid = false, busy, onYes, onClose }: { open: boolean; code: string; amount: string; office?: boolean; notPaid?: boolean; busy?: boolean; onYes: () => void; onClose: () => void }) {
  const t = useT();
  // …or, delivered, NOT paid yet (2026-10-27): the shipper is told, and it can still be said paid later.
  const words = notPaid
    ? { title: t('common.paidDirect.notPaidTitle'), body: t('common.paidDirect.notPaidBody', { amount, code }), yes: office ? t('common.paidDirect.notPaidYesOffice') : t('common.paidDirect.notPaidYes') }
    : { title: t('common.paidDirect.title'), body: office ? t('common.paidDirect.bodyOffice', { amount, code }) : t('common.paidDirect.body', { amount, code }), yes: office ? t('common.paidDirect.yesOffice', { amount }) : t('common.paidDirect.yes', { amount }) };
  return (
    <Sheet open={open} onClose={onClose} title={words.title}>
      <p class="t-body">{words.body}</p>
      <Button busy={busy} onClick={onYes}>
        {words.yes}
      </Button>
      <Button variant="link" onClick={onClose}>
        {notPaid ? t('common.paidDirect.back') : t('common.paidDirect.notYet')}
      </Button>
    </Sheet>
  );
}
