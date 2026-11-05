import { Button, Card, Icon, Pill } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { AheadView } from '../types';

/**
 * 2026-11-05 — PRE-DROP-OFF, THE DRIVER'S SIDE (the owner: "Seen ahead, taken on ahead"). The parcels coming in at the shops
 * along this road — booked to be handed in, or waiting there — by the stop they go to next. Taking them on holds the room on
 * the vehicle, and the shop's bag for that stop is given to this driver once it is closed. One driver a stop.
 */
export function ParcelsComing({ ahead, busy, onTake, onLetGo }: { ahead: AheadView[]; busy?: string | null; onTake: (a: AheadView) => void; onLetGo: (promiseId: string) => void }) {
  const t = useT();
  if (!ahead.length) return null;
  return (
    <Card title={t('driver.ahead.title')}>
      <p class="card__note">{t('driver.ahead.lede')}</p>
      <div class="rows" role="list">
        {ahead.map((a) => {
          const key = `${a.agentDid}:${a.hopKey}`;
          const theirs = a.takenBy && !a.mine;
          return (
            <div key={key} class="row row--static" role="listitem">
              <span class="row__ic">
                <Icon name="box" size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{t('driver.ahead.line', { count: a.parcels, kg: a.kg, stop: a.hopLabel })}</span>
                <span class="row__s">{t('driver.ahead.at', { shop: a.shopName, km: a.detourKm })}</span>
                {a.booked ? <span class="row__s">{t('driver.ahead.booked', { count: a.booked })}</span> : null}
              </span>
              <span class="row__end">
                {a.mine ? (
                  a.mine.state === 'given' ? (
                    <Pill tone="ok">{t('driver.ahead.bagYours')}</Pill>
                  ) : (
                    <Button variant="link" full={false} busy={busy === `ahead-${a.mine.promiseId}`} onClick={() => onLetGo(a.mine!.promiseId)}>
                      {t('driver.ahead.letGo')}
                    </Button>
                  )
                ) : theirs ? (
                  <Pill tone="idle">{t('driver.ahead.taken', { name: a.takenBy!.name })}</Pill>
                ) : (
                  <Button variant="outline" full={false} chevron={false} busy={busy === `ahead-${key}`} onClick={() => onTake(a)}>
                    {t('driver.ahead.take')}
                  </Button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
