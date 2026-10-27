import type { Translate } from './i18n';
import { cash } from './money';

/**
 * A LOAD SETTLED BETWEEN THE PARTIES, PAID (the user, 2026-10-27: "Driver ticks 'paid'"). The shipper pays its carrier
 * directly, at the price agreed on SeeBuyGet; the driver it is on — or the office of the fleet that carries it — says it was
 * paid, and when. Their word, on the load for both sides. No money moves through SeeBuyGet.
 */
export interface PaidDirectView {
  at: string;
  amount: number;
  currency?: string;
  by: 'driver' | 'office';
}

/** When it was said, short: "27 Oct, 14:05". */
export function paidWhen(at: string): string {
  return new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The carrier's side: paid, how much, and who said so when. */
export function paidDirectLine(p: PaidDirectView, t: Translate, currency?: string): string {
  const vars = { amount: cash(p.amount, p.currency ?? currency), when: paidWhen(p.at) };
  return p.by === 'office' ? t('common.paidDirect.saidByOffice', vars) : t('common.paidDirect.saidByDriver', vars);
}

/**
 * The shipper's side, on its own load: that it pays the driver directly, and — once the carrier says so — that it was paid.
 * Nothing on a load SeeBuyGet pays the driver for.
 */
export function shipperPaidLine(row: { paysDriverDirect?: boolean; paidDirect?: PaidDirectView; currency?: string }, t: Translate): string | null {
  if (row.paidDirect) {
    const vars = { amount: cash(row.paidDirect.amount, row.paidDirect.currency ?? row.currency), when: paidWhen(row.paidDirect.at) };
    return row.paidDirect.by === 'office' ? t('common.paidDirect.shipperOffice', vars) : t('common.paidDirect.shipperDriver', vars);
  }
  return row.paysDriverDirect ? t('common.paidDirect.shipperPays') : null;
}

/**
 * May the carrier say it was paid: a load the shipper pays directly, with a price agreed, taken and not withdrawn, and not
 * said yet. The server holds the same rule; this only decides whether the button is there.
 */
export function maySayPaid(row: { direct?: boolean; status: string; earning?: number | null; paidDirectAt?: string }): boolean {
  return Boolean(row.direct) && row.earning != null && !row.paidDirectAt && (row.status === 'claimed' || row.status === 'in_transit' || row.status === 'delivered');
}
