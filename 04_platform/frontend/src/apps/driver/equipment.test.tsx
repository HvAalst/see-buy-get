import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import '../driver/english';
import { EQUIPMENT_FITS, equipmentFits, equipmentOptions, equipmentToSend, equipmentWords } from '../../shared/equipment';
import { LoadSpaceSheet } from './screens/LoadSpaceSheet';
import type { DriverActions } from './useDriverApp';

/*
 * LOADING EQUIPMENT (the owner, 2026-11-13: "build loading equipment"): vans carry it too, a driver says it of their own
 * vehicle beside its weight and load space, and a fleet's vehicle shows what the fleet says.
 */
describe('loading equipment, what each kind carries', () => {
  it('a van takes a tail-lift, a pallet jack, a sack barrow, ramps and straps; a truck everything; a bike nothing', () => {
    expect([...equipmentFits('van')].sort()).toEqual(['HTR', 'PLT', 'RMP', 'STR', 'TLT']);
    expect(equipmentFits('truck')).toHaveLength(8);
    expect(equipmentFits('bike')).toEqual([]);
    expect(equipmentFits('motorcycle')).toEqual([]);
    expect(equipmentFits('spaceship')).toEqual([]);
    // Every kind the server knows has its line (backend fleet.config.ts VEHICLE_CLASSES).
    expect(Object.keys(EQUIPMENT_FITS).sort()).toEqual(['bike', 'bus', 'car', 'motorcycle', 'truck', 'tuktuk', 'van']);
    expect(equipmentOptions(t, 'van').map((o) => o.key)).not.toContain('FLT');
  });

  it('sends only what the kind can carry, by hand left out; says it in words, in the list’s order', () => {
    expect(equipmentToSend(['MAN', 'FLT', 'STR', 'TLT'], 'van')).toEqual(['TLT', 'STR']);
    expect(equipmentToSend(['HTR'], 'bike')).toEqual([]);
    expect(equipmentWords(['MAN', 'STR', 'TLT'], t)).toBe(`${t('equipment.tlt')}, ${t('equipment.str')}`);
    expect(equipmentWords(['MAN'], t)).toBe('');
    expect(equipmentWords(undefined, t)).toBe('');
  });
});

describe('what your vehicle takes and carries', () => {
  const actions = { setLoadSpace: async () => null } as unknown as DriverActions;
  const sheet = (vehicle: Record<string, unknown>, own: boolean, word = 'van') =>
    renderToString(<LoadSpaceSheet open onClose={() => undefined} actions={actions} vehicle={{ vehicleId: 'veh_1', vehicleClass: 'van', capacityKg: 1200, ...vehicle } as never} word={word} own={own} />);

  it('their own van: every piece a van can carry, to tick, the ones it has ticked', () => {
    const html = sheet({ equipment: ['MAN', 'TLT'] }, true);
    expect(html).toContain(t('equipment.title'));
    expect(html).toContain(t('equipment.tlt'));
    expect(html).toContain(t('equipment.plt'));
    expect(html).not.toContain(t('equipment.flt'));
    expect(html).toMatch(/aria-pressed="true"[^>]*>[^<]*Tail-lift/);
  });

  it('a fleet’s van: what the fleet says, nothing to tick', () => {
    const html = sheet({ equipment: ['MAN', 'PLT'] }, false);
    expect(html).toContain(t('equipment.plt'));
    expect(html).toContain(t('equipment.fleetSets'));
    expect(html).not.toContain('aria-pressed');
    expect(sheet({ equipment: ['MAN'] }, false)).toContain(t('equipment.none'));
  });

  it('a bike: loaded by hand, said so', () => {
    expect(sheet({ vehicleClass: 'bike', capacityKg: 20 }, true, 'bike')).toContain(t('equipment.noneFits', { vehicle: 'bike' }));
  });
});
