import { useT, type MessageKey } from '../../../shared/i18n';
import { Icon } from '../../../shared/ui';
import type { IconName } from '../../../shared/ui/Icon';
import type { Translate } from '../../../shared/i18n';
import type { ExportDetail } from '../../business/exports';

/**
 * THE JOURNEY, BY ITS LEGS (the user, 2026-10-29: "Since we are growing, we must make careful decisions regarding the
 * navigation" — chosen: by direction, the mode inside). One export or import is one record; road, rail, sea and air are
 * its legs, in order, each with the document it travels under and where it stands. Air arrives as legs, not a section.
 */
export type LegMode = 'road' | 'rail' | 'sea' | 'air';

export interface JourneyLeg {
  mode: LegMode;
  from: string;
  to: string;
  /** The document this leg travels under, as held: a road note, a railway's note, a bill. */
  doc?: string;
  /** Where the leg stands, in words. */
  state?: string;
  tone?: 'ok' | 'warn' | 'quiet';
}

export const MODE_ICON: Record<LegMode, IconName> = { road: 'truck', rail: 'train', sea: 'ship', air: 'plane' };
export const MODE_WORD: Record<LegMode, MessageKey> = { road: 'tower.journey.mode.road', rail: 'tower.journey.mode.rail', sea: 'tower.journey.mode.sea', air: 'tower.journey.mode.air' };

export function JourneyStrip({ legs }: { legs: JourneyLeg[] }) {
  const t = useT();
  if (!legs.length) return null;
  return (
    <ol class="journey" aria-label={t('tower.journey.title')}>
      {legs.map((leg, i) => (
        <li class="journey__leg" key={`${leg.mode}-${i}`}>
          <span class="journey__mode">
            <Icon name={MODE_ICON[leg.mode]} size={18} />
            <span>{t(MODE_WORD[leg.mode])}</span>
          </span>
          <span class="journey__way">{t('tower.journey.way', { from: leg.from, to: leg.to })}</span>
          {leg.doc ? <span class="journey__doc">{leg.doc}</span> : null}
          {leg.state ? <span class={`ctag ctag--${leg.tone ?? 'quiet'}`}>{leg.state}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * A LIST BY ITS MODES: all, or those with a leg of one mode. Drawn only where the list holds more than one mode — a
 * choice between one thing and itself is no choice.
 */
export function ModeFilter({ present, value, onChange }: { present: LegMode[]; value: LegMode | ''; onChange: (m: LegMode | '') => void }) {
  const t = useT();
  if (present.length < 2) return null;
  return (
    <div class="twr-tabs" role="group" aria-label={t('tower.journey.filter')}>
      {(['', ...present] as Array<LegMode | ''>).map((m) => (
        <button key={m || 'all'} type="button" aria-pressed={value === m} class={`cbtn cbtn--sm ${value === m ? 'cbtn--on' : 'cbtn--ghost'}`} onClick={() => onChange(m)}>
          {m ? <Icon name={MODE_ICON[m]} size={16} /> : null}
          {t(m ? MODE_WORD[m] : 'tower.journey.all')}
        </button>
      ))}
    </div>
  );
}

/** The modes a list holds, in the order road, rail, sea, air. */
export function modesPresent(rows: Array<{ modes?: LegMode[] }>): LegMode[] {
  const seen = new Set(rows.flatMap((r) => r.modes ?? []));
  return (['road', 'rail', 'sea', 'air'] as LegMode[]).filter((m) => seen.has(m));
}

/**
 * AN EXPORT'S JOURNEY, BY ITS LEGS (the navigation by direction, 2026-10-29): our truck to the terminal — the rail
 * terminal where it goes by train — the train to the port, and the sea; each with its document and where it stands.
 */
export function exportJourney(d: ExportDetail, t: Translate): JourneyLeg[] {
  const c = d.consignment;
  const h = d.timing.handover;
  const roadTo = h?.place ?? c.terminal.label;
  const road = d.ladenLeg
    ? { doc: t('tower.journey.roadNote', { code: `CMR-${d.ladenLeg.code}` }), state: t(d.timing.state === 'gated_in' ? 'tower.journey.state.handedIn' : d.timing.state === 'missed' ? 'tower.journey.state.late' : d.timing.collectedAt ? 'tower.journey.state.onTheRoad' : 'tower.journey.state.posted'), tone: (d.timing.state === 'gated_in' ? 'ok' : d.timing.state === 'missed' || d.timing.state === 'at_risk' ? 'warn' : 'quiet') as 'ok' | 'warn' | 'quiet' }
    : { doc: t('tower.journey.noDoc'), state: t('tower.journey.state.planned'), tone: 'quiet' as const };
  const legs: JourneyLeg[] = [{ mode: 'road', from: c.loadingPlace.label, to: roadTo, ...road }];
  if (c.byRail) {
    legs.push({
      mode: 'rail',
      from: c.byRail.terminal.label,
      to: c.terminal.label,
      doc: d.rail ? t('tower.journey.railNote', { railway: d.rail.railwayName, number: d.rail.noteNumber ?? '' }).trim() : t('tower.journey.noDoc'),
      state: t(c.byRail.atPort ? 'tower.journey.state.atThePort' : d.timing.gatedInAt ? 'tower.journey.state.onTheTrain' : 'tower.journey.state.planned'),
      tone: c.byRail.atPort ? 'ok' : 'quiet',
    });
  }
  legs.push({
    mode: 'sea',
    from: c.loadingPort,
    to: c.destCountry,
    doc: d.fbl ? t('tower.journey.fbl', { number: d.fbl.number }) : c.billOfLading ? t('tower.journey.bl', { number: c.billOfLading.number }) : t('tower.journey.noDoc'),
    state: t(c.loaded ? 'tower.journey.state.loaded' : 'tower.journey.state.booked'),
    tone: c.loaded ? 'ok' : 'quiet',
  });
  return legs;
}
