import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { exportJourney, JourneyStrip, ModeFilter, modesPresent } from './screens/JourneyStrip';
import type { ExportDetail } from '../business/exports';

/*
 * THE JOURNEY BY ITS LEGS, AND A LIST BY ITS MODES (the user, 2026-10-29: "Since we are growing, we must make careful
 * decisions regarding the navigation" — by direction, the mode inside). One export or import, its legs in order, each
 * with its document; a list filtered by mode only where it holds more than one.
 */
describe('the journey of an export', () => {
  const d = {
    consignment: { loadingPlace: { label: 'Kericho warehouse' }, terminal: { label: 'Kipevu container terminal' }, loadingPort: 'Mombasa', destCountry: 'NL', byRail: { terminal: { label: 'Naivasha Inland Container Depot' }, cutoffAt: '2026-10-30T08:00:00Z' } },
    timing: { state: 'on_time', leaveByAt: '2026-10-30T02:00:00Z', roadKm: 120, plannedHours: 3.5, handover: { place: 'Naivasha Inland Container Depot', cutoffAt: '2026-10-30T08:00:00Z', byRail: true } },
    ladenLeg: { freightId: 'frt_1', code: 'FRT-88', status: 'available' },
    rail: { railwayName: 'Kenya Railways', noteNumber: 'KRC-1' },
    fbl: { number: 'KE-114' },
  } as unknown as ExportDetail;

  it('reads as the truck, the train and the ship, each with the document it travels under', () => {
    const legs = exportJourney(d, t);
    expect(legs.map((l) => [l.mode, l.from, l.to])).toEqual([
      ['road', 'Kericho warehouse', 'Naivasha Inland Container Depot'],
      ['rail', 'Naivasha Inland Container Depot', 'Kipevu container terminal'],
      ['sea', 'Mombasa', 'NL'],
    ]);
    expect(legs.map((l) => l.doc)).toEqual([t('tower.journey.roadNote', { code: 'CMR-FRT-88' }), t('tower.journey.railNote', { railway: 'Kenya Railways', number: 'KRC-1' }), t('tower.journey.fbl', { number: 'KE-114' })]);
    const html = renderToString(<JourneyStrip legs={legs} />);
    expect(html).toContain(t('tower.journey.mode.rail'));
    expect(html).toContain('Naivasha Inland Container Depot → Kipevu container terminal');
  });

  it('by road to the port, there is no rail leg', () => {
    const byRoad = { ...d, consignment: { ...d.consignment, byRail: undefined }, timing: { ...d.timing, handover: undefined } } as unknown as ExportDetail;
    expect(exportJourney(byRoad, t).map((l) => l.mode)).toEqual(['road', 'sea']);
  });
});

describe('a list by its modes', () => {
  it('offers the modes the list holds, and nothing where it holds only one', () => {
    expect(modesPresent([{ modes: ['road', 'sea'] }, { modes: ['road', 'rail', 'sea'] }])).toEqual(['road', 'rail', 'sea']);
    expect(renderToString(<ModeFilter present={['road', 'rail', 'sea']} value="" onChange={() => undefined} />)).toContain(t('tower.journey.mode.rail'));
    expect(renderToString(<ModeFilter present={['sea']} value="" onChange={() => undefined} />)).toBe('');
  });
});
