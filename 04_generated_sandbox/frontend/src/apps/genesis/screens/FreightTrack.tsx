import { Card, Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { FREIGHT_LADDER, carrierLine, freightLadderIndex, freightStatusPresentation, stepTime } from '../logic';
import type { FreightTrackView } from '../types';

/**
 * FP6 — a LOAD on the tracking page. The same ladder a parcel climbs, in the same plain words: where it is
 * now, who is carrying it (as the receiver will meet them at the door), the doors nobody answered, and who
 * signed. A withdrawn load falls off the ladder and says so, never why — that is between the parties.
 */
export function FreightTrack({ view }: { view: FreightTrackView }) {
  const t = useT();
  const p = freightStatusPresentation(view.status, t);
  const at = freightLadderIndex(view.status);
  const carrier = carrierLine(view.carrier, t);
  return (
    <>
      <section class={'now now--' + p.tone} aria-live="polite">
        <Icon name={p.icon} size={34} class="now__ic" />
        <span class="now__body">
          <span class="now__word">{p.word}</span>
          <span class="now__sub">{t('send.freight.line', { ref: view.ref, kg: view.weightKg, pickup: view.pickupLabel, dest: view.destLabel })}</span>
        </span>
      </section>

      {carrier ? (
        <div class="row row--static" role="group" aria-label={t('send.freight.carrierLabel')}>
          <span class="row__ic">
            <Icon name="truck" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{carrier}</span>
            <span class="row__s">{t('send.freight.carrierNote')}</span>
          </span>
        </div>
      ) : null}

      {view.attempts?.length ? (
        <Card tone="soft">
          {view.attempts.map((a) => (
            <p key={a.at} class="card__note">
              {t(a.outcome === 'refused' ? 'send.freight.attemptRefused' : a.outcome === 'unreachable' ? 'send.freight.attemptUnreachable' : 'send.freight.attemptAbsent', { when: stepTime(a.at) })}
            </p>
          ))}
        </Card>
      ) : null}

      {view.receiverName ? <p class="scr__lede">{t('send.freight.receivedBy', { name: view.receiverName })}</p> : null}
      {view.cancelled ? <p class="scr__lede">{t(view.cancelled.by === 'network' ? 'send.freight.withdrawnByNetwork' : 'send.freight.withdrawnBySender', { when: stepTime(view.cancelled.at) })}</p> : null}

      {at >= 0 ? (
        <Card label={t('send.track.journeySoFar')}>
          <ol class="ladder">
            {FREIGHT_LADDER.map((s, i) => {
              const rung = freightStatusPresentation(s, t);
              const done = i < at;
              const now = i === at;
              const step = view.steps.find((x) => x.status === s || (s === 'available' && x.status === 'scheduled'));
              return (
                <li key={s} class={'ladder__rung' + (done ? ' ladder__rung--done' : '') + (now ? ' ladder__rung--now' : '')}>
                  <span class="ladder__ic" aria-hidden="true">
                    <Icon name={done ? 'check' : rung.icon} size={20} />
                  </span>
                  <span class="ladder__body">
                    <span class="ladder__word">{rung.word}</span>
                    {step ? <span class="ladder__time">{stepTime(step.at)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}
    </>
  );
}
