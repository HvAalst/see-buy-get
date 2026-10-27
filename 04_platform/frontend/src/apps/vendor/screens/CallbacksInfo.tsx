import { useT, type MessageKey } from '../../../shared/i18n';
import { Abbreviated } from '../../../shared/ui/Abbr';

/** What a store's own system hears, in the order a parcel meets it — each by the name its message carries. */
const MESSAGES: Array<[string, MessageKey]> = [
  ['parcel_paid', 'vendor.store.cbInfo.ev.paid'],
  ['ready_for_pickup', 'vendor.store.cbInfo.ev.ready'],
  ['collected', 'vendor.store.cbInfo.ev.collected'],
  ['disputed', 'vendor.store.cbInfo.ev.disputed'],
  ['held · released', 'vendor.store.cbInfo.ev.held'],
  ['parcel.late', 'vendor.store.cbInfo.ev.late'],
  ['parcel.lost · parcel.found', 'vendor.store.cbInfo.ev.lost'],
  ['parcel.unclaimed', 'vendor.store.cbInfo.ev.unclaimed'],
  ['hub_arrival.received · hub_arrival.missed', 'vendor.store.cbInfo.ev.hub'],
  ['load.taken · load.picked_up · load.delivered', 'vendor.store.cbInfo.ev.load'],
  ['load.delivery_failed · load.refusal_decided', 'vendor.store.cbInfo.ev.loadDoor'],
  ['load.handed_back · load.cancelled', 'vendor.store.cbInfo.ev.loadBack'],
  ['balance_topped_up · balance_returned', 'vendor.store.cbInfo.ev.balance'],
  ['test', 'vendor.store.cbInfo.ev.test'],
];

/**
 * WHAT A CALLBACK URL IS, slid up from the (i) on the Store screen (the user, 2026-10-26: "what do you mean with callback
 * URL? that might need more detailed information in a slide up sheet"). In plain words first — what it is, and who needs
 * one at all — then what is sent, and how it arrives, for whoever builds the store's website.
 */
export function CallbacksInfo() {
  const t = useT();
  return (
    <>
      <p>
        <Abbreviated text={t('vendor.store.cbInfo.what')} />
      </p>
      <p>{t('vendor.store.cbInfo.who')}</p>
      <h3 class="info__h">{t('vendor.store.cbInfo.listTitle')}</h3>
      <ul class="info__list">
        {MESSAGES.map(([name, key]) => (
          <li key={name}>
            <span class="mono-t">{name}</span> — {t(key)}
          </li>
        ))}
      </ul>
      <h3 class="info__h">{t('vendor.store.cbInfo.howTitle')}</h3>
      <p>
        <Abbreviated text={t('vendor.store.cbInfo.how1')} />
      </p>
      <p>{t('vendor.store.cbInfo.how2')}</p>
      <p>
        <Abbreviated text={t('vendor.store.cbInfo.how3')} />
      </p>
      <p>{t('vendor.store.cbInfo.test')}</p>
    </>
  );
}

/** What the (i) reads aloud: the plain part. */
export const callbacksAloud = (t: (key: MessageKey) => string) => `${t('vendor.store.cbInfo.what')} ${t('vendor.store.cbInfo.who')}`;
