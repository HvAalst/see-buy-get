import { Card, Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { carrierLine, expectedLine, freightLadder, freightLadderIndex, freightStatusPresentation, freightWithdrawnLine, stepTime } from '../logic';
import type { FreightTrackView } from '../types';
import { crossingWords, passageWords } from '../../../shared/passages';

/**
 * FP6 — a LOAD on the tracking page. The same ladder a parcel climbs, in the same plain words: where it is
 * now, who is carrying it (as the receiver will meet them at the door), the doors nobody answered, and who
 * signed. A withdrawn load falls off the ladder and says so, never why — that is between the parties.
 */
export function FreightTrack({ view }: { view: FreightTrackView }) {
  const t = useT();
  const ladder = freightLadder(view);
  const run = view.on === 'run';
  const p = freightStatusPresentation(view.status, t, view.on);
  const at = freightLadderIndex(view.status, ladder);
  const carrier = carrierLine(view.carrier, t);
  const expected = expectedLine(view, t);
  // Round 14 — what its driver said on the road; across a border, where it has got to, the allowance and when it is expected.
  const crossing = view.status === 'in_transit' && view.crossing ? crossingWords(view.crossing, t, stepTime) : null;
  const said = view.passages ?? [];
  return (
    <>
      <section class={'now now--' + p.tone} aria-live="polite">
        <Icon name={p.icon} size={34} class="now__ic" />
        <span class="now__body">
          <span class="now__word">{p.word}</span>
          <span class="now__sub">{t(run ? 'send.freight.runLine' : 'send.freight.line', { ref: view.ref, kg: view.weightKg, pickup: view.pickupLabel, dest: view.destLabel })}</span>
        </span>
      </section>

      {/* WHEN — the first thing somebody waiting at a door wants. The day always; the hour once it is on the road. */}
      {expected ? <p class="scr__lede">{expected}</p> : null}

      {said.length || crossing ? (
        <Card label={t('send.freight.roadLabel')}>
          {said.map((s) => (
            <p key={`${s.kind}-${s.at}`} class="card__note">
              {passageWords(s, t, stepTime)}
            </p>
          ))}
          {crossing && !said.length ? <p class="card__note">{crossing.where}</p> : null}
          {crossing?.wait ? <p class="card__note">{crossing.wait}</p> : null}
          {crossing?.expected ? (
            <p class="card__note">
              <b>{crossing.expected}</b>
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Round 15 — the seals: the numbers to look for on the door, and whether each is still on. */}
      {view.seals?.length ? (
        <Card label={t('send.freight.sealsLabel')}>
          <p class="card__note">{t('send.freight.sealsLede')}</p>
          {view.seals.map((s) => (
            <p key={s.number} class="card__note">
              <b class="track-seal">{s.number}</b> · {t(s.state === 'on' ? 'send.freight.sealOn' : s.state === 'replaced' ? 'send.freight.sealReplaced' : 'send.freight.sealBroken')}
            </p>
          ))}
        </Card>
      ) : null}

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

      {run && view.status === 'claimed' && view.scheduledPickupAt ? <p class="scr__lede">{t('send.freight.runLeaves', { when: stepTime(view.scheduledPickupAt) })}</p> : null}
      {view.receiverName ? <p class="scr__lede">{t('send.freight.receivedBy', { name: view.receiverName })}</p> : null}
      {/* Put back with the rest of its order: said as that — it was not withdrawn, it is coming with the others. */}
      {view.rejoined ? <p class="scr__lede">{t('send.freight.rejoined')}</p> : view.cancelled ? <p class="scr__lede">{freightWithdrawnLine(view.cancelled, t)}</p> : null}

      {/* AN ORDER IN SEVERAL LOADS: which one this link is for, and where every one of them has got to. */}
      {view.partOf && view.loads?.length ? (
        <Card label={t('send.freight.loadsTitle', { n: view.loads.length })}>
          <p class="card__note">{t('send.freight.loadsLede', { no: view.partOf.no, of: view.partOf.of, kg: view.partOf.orderKg.toLocaleString() })}</p>
          <ul class="loads">
            {view.loads.map((l) => (
              <li key={l.code} class={l.no === view.partOf!.no ? 'loads__this' : undefined}>
                {t(l.no === view.partOf!.no ? 'send.freight.loadLineThis' : 'send.freight.loadLine', { no: l.no, kg: l.weightKg.toLocaleString(), status: freightStatusPresentation(l.status, t, view.on).word })}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {at >= 0 ? (
        <Card label={t('send.track.journeySoFar')}>
          <ol class="ladder">
            {ladder.map((s, i) => {
              const rung = freightStatusPresentation(s, t, view.on);
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
