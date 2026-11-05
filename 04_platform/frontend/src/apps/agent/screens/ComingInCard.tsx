import { Card, Icon, Pill } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { ExpectedDropOff } from '../types';

/**
 * 2026-11-05 — PRE-DROP-OFF (compendium gap #6): the parcels booked to be handed in at this counter, each holding a place on
 * the shelf for 24 hours from booking. Before this the shop heard of a booking only in the bell. A place that ran out is
 * still shown — the booking stands, and it is taken in if there is room when it comes.
 */
export const COMING_IN_SHOWN = 5;

export function ComingInCard({ expected, held, now = Date.now() }: { expected: ExpectedDropOff[] | undefined; held: number | undefined; now?: number }) {
  const t = useT();
  if (!expected?.length) return null;
  const shown = expected.slice(0, COMING_IN_SHOWN);
  return (
    <Card title={t('agent.home.comingTitle')}>
      <p class="hint">{t('agent.home.comingLede', { count: held ?? 0 })}</p>
      <div class="rows" role="list">
        {shown.map((e) => {
          const hoursLeft = Math.max(0, Math.ceil((Date.parse(e.heldUntil) - now) / 3_600_000));
          const lapsed = e.state === 'lapsed' || hoursLeft === 0;
          return (
            <div key={e.parcelId} class="row" role="listitem">
              <span class="row__ic">
                <Icon name={e.sameShop ? 'home' : 'box'} size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{e.from === 'store' && e.name ? t('agent.home.comingFromStore', { store: e.name }) : t('agent.home.comingFromSender')}</span>
                <span class="row__s">
                  {[e.size, e.sameShop ? t('agent.home.comingHere') : e.nextStop ? t('agent.home.comingTo', { place: e.nextStop }) : null, e.takenBy ? t('agent.home.comingTakenBy', { name: e.takenBy }) : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span class="row__end">
                {lapsed ? <Pill tone="idle">{t('agent.home.comingLapsed')}</Pill> : <Pill tone={hoursLeft <= 3 ? 'warn' : 'ok'}>{t('agent.home.comingLeft', { hours: hoursLeft })}</Pill>}
              </span>
            </div>
          );
        })}
      </div>
      {expected.length > shown.length ? <p class="hint">{t('agent.home.comingMore', { count: expected.length - shown.length })}</p> : null}
    </Card>
  );
}
