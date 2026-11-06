import { useT } from '../../../shared/i18n';
import { offPlanStepWords, stepsOffPlan, type ParcelWay } from '../parcelWay';
import { reasonWords } from '../planVsActual';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * ITS WAY (2026-11-06, movement unification) — on the Support screen, under a parcel's history: the stops its plan names, the
 * way it was priced and promised, where it is now; and every step it took off them — where, what the plan said, where it
 * went, why, and who chose it. The record operations reads when a parcel did not go the way it should have.
 */
export function WayPanel({ way }: { way: ParcelWay }) {
  const t = useT();
  const off = stepsOffPlan(way);
  return (
    <section class="cons__panel" style="margin-top:12px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.way.title')}</span>
        <span class={`ctag ${off ? 'ctag--warn' : 'ctag--ok'}`}>{off ? t('tower.way.offCount', { count: off }) : t('tower.way.kept')}</span>
      </div>
      <p class="chint">{t('tower.way.lede')}</p>
      <p class="twr-way">
        {way.stops.map((s, i) => (
          <span key={`${s.label}-${i}`} class={`twr-way__stop twr-way__stop--${s.state}`}>
            {i > 0 ? <span class="twr-way__arrow" aria-hidden="true">→</span> : null}
            <span class="twr-way__name">{s.label}</span>
            {s.state === 'here' ? <span class="ctag ctag--info">{t('tower.way.here')}</span> : s.state === 'next' ? <span class="ctag ctag--quiet">{t('tower.way.next')}</span> : null}
          </span>
        ))}
      </p>
      <p class="chint">{way.expectedAt ? t('tower.way.expected', { at: when(way.promisedAt), expected: when(way.expectedAt) }) : t('tower.way.promised', { at: when(way.promisedAt) })}</p>
      {way.heading ? (
        <p class="chint">
          {t('tower.way.heading', { to: way.heading.to, why: reasonWords(way.heading.reason, t) })}
          {way.heading.note ? ` — “${way.heading.note}”` : ''}
        </p>
      ) : null}
      {way.offPlan.length ? (
        <div class="crows twr-way__steps">
          {way.offPlan.map((s, i) => (
            <div class="crow crow--static" key={`${s.at}-${i}`}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{offPlanStepWords(s, t)}</span>
                  <span class={`ctag ${s.reason === 'priced_other_way' ? 'ctag--quiet' : 'ctag--warn'}`}>{reasonWords(s.reason, t)}</span>
                </span>
                <span class="crow__sub">
                  {when(s.at)}
                  {s.by ? ` · ${t('tower.way.by', { by: s.by })}` : ''}
                  {s.note ? ` · “${s.note}”` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
