import { countryNameIn } from '../../shared/documents/documents';
import { formatDate, formatMoney, getLocale, type MessageKey, type Translate } from '../../shared/i18n';
import type { IconName } from '../../shared/ui';

/*
 * 2026-11-19 — A PARCEL ABROAD, AS ITS SENDER AND RECEIVER READ IT (parcels across a border, step 3): at customs; held, with what
 * customs asks, to whom and by when, and then our part at the shop; not paid in time; released, with our part to pay at the shop.
 */
export interface AbroadView {
  to: string;
  stage: 'on_way' | 'customs' | 'held' | 'released';
  held?: { amount: number; currency: string; reference: string; payee?: string; payBy?: string; lapsed?: boolean };
  due?: { amount: number; currency: string; paid: boolean };
}

/** The note for a parcel abroad, or nothing while it is on its way there or once there is nothing to say. */
export function abroadNote(a: AbroadView | undefined, relation: 'sent' | 'received', t: Translate): { tone: 'info' | 'warn'; icon: IconName; title: string; detail: string } | null {
  if (!a) return null;
  const country = countryNameIn(a.to, getLocale());
  const ours = a.due && !a.due.paid ? formatMoney(a.due.amount, a.due.currency) : '';
  const w = (key: string, params: Record<string, string | number> = {}) => t(key as MessageKey, params);
  if (a.stage === 'customs') return { tone: 'info', icon: 'info', title: w('send.parcels.abroad.customs', { country }), detail: w('send.parcels.abroad.customsDetail') };
  if (a.stage === 'held' && a.held) {
    const h = a.held;
    const amount = formatMoney(h.amount, h.currency);
    const date = h.payBy ? formatDate(h.payBy) : '';
    const payee = h.payee ?? w('send.parcels.abroad.theAgent');
    if (h.lapsed) return { tone: 'warn', icon: 'warning', title: w('send.parcels.abroad.lapsed'), detail: w(relation === 'sent' ? 'send.parcels.abroad.lapsedSender' : 'send.parcels.abroad.lapsedReceiver') };
    if (relation === 'sent') return { tone: 'warn', icon: 'warning', title: w('send.parcels.abroad.held', { amount }), detail: w('send.parcels.abroad.heldSender', { amount, date }) };
    return {
      tone: 'warn',
      icon: 'wallet',
      title: w('send.parcels.abroad.held', { amount }),
      detail: `${w('send.parcels.abroad.heldReceiver', { payee, date, reference: h.reference })}${ours ? ` ${w('send.parcels.abroad.thenOurs', { amount: ours })}` : ''}`,
    };
  }
  if (a.stage === 'released') {
    if (relation === 'received' && ours) return { tone: 'info', icon: 'wallet', title: w('send.parcels.abroad.released', { country }), detail: w('send.parcels.abroad.payAtShop', { amount: ours }) };
    if (relation === 'sent') return { tone: 'info', icon: 'check', title: w('send.parcels.abroad.released', { country }), detail: w('send.parcels.abroad.onToShop') };
  }
  return null;
}
