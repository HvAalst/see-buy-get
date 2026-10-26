import { useT } from '../../../shared/i18n';
import { DAY_NAME, DAY_SHORT, WEEK, type WeekForm } from '../../fleet/sites';

/**
 * A WEEK OF HOURS, AS A HUB WRITES IT — Sunday to Saturday, a line a day: ticked open with its opening and closing time,
 * or closed. Its opening hours and the hours it takes stores' parcels in bulk are written the same way. Short day names
 * so a 320px phone keeps the line; the full name is the tick box's label for a screen reader.
 */
export function WeekRows({ week, onChange }: { week: WeekForm; onChange: (next: WeekForm) => void }) {
  const t = useT();
  return (
    <div class="days">
      <div class="dayrow dayrow--head" aria-hidden="true">
        <span />
        <span>{t('fleet.sites.opens')}</span>
        <span>{t('fleet.sites.closes')}</span>
      </div>
      {WEEK.map((d) => {
        const day = week[d];
        const name = t(DAY_NAME[d]);
        const setDay = (value: { open: string; close: string } | null) => onChange({ ...week, [d]: value });
        return (
          <div class={`dayrow${day ? '' : ' dayrow--closed'}`} key={d}>
            <label class="dayrow__day">
              <input type="checkbox" checked={Boolean(day)} aria-label={name} onChange={(e) => setDay(e.currentTarget.checked ? { open: '08:00', close: '17:00' } : null)} />
              <span>{day ? t(DAY_SHORT[d]) : t('mdp.bulk.closedOn', { day: t(DAY_SHORT[d]) })}</span>
            </label>
            {day ? (
              <>
                <input class="input" type="time" aria-label={`${name} ${t('fleet.sites.opens')}`} value={day.open} onChange={(e) => setDay({ open: e.currentTarget.value, close: day.close })} />
                <input class="input" type="time" aria-label={`${name} ${t('fleet.sites.closes')}`} value={day.close} onChange={(e) => setDay({ open: day.open, close: e.currentTarget.value })} />
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
