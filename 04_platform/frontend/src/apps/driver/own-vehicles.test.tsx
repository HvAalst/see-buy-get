import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import '../driver/english';
import { addsOwnVehicles, ownVehicleMissing } from './logic';
import { AddOwnVehicleSheet, OwnVehicleSheet } from './screens/OwnVehicleSheet';
import { OwnVehicleLinks } from './screens/OwnVehicleLinks';
import type { DriverActions } from './useDriverApp';

/*
 * 2026-11-21 — THE OWNER: "can't edit the car details when I made a mistake in the number plate, also I can't add a second car of
 * mine." A courier corrects the plate of a vehicle of their own, takes one off their vehicles, and adds another; a fleet's office
 * corrects the plate of its own.
 */
const actions = { correctPlate: async () => null, retireOwnVehicle: async () => null, addOwnVehicle: async () => null, truckBodies: async () => [] } as unknown as DriverActions;
const source = (path: string) => readFileSync(join('src/apps/driver', path), 'utf8');

describe('who adds a vehicle of their own, and what it asks', () => {
  it('a courier only: not a fleet’s driver, not somebody between fleets', () => {
    expect(addsOwnVehicles({})).toBe(true);
    expect(addsOwnVehicles({ managerDid: 'did:glos:fleet' })).toBe(false);
    expect(addsOwnVehicles({ removedFrom: { at: '2026-11-01' } })).toBe(false);
    expect(addsOwnVehicles(null)).toBe(false);
  });

  it('what riding for themselves asked of the first, in its order — without a country or papers', () => {
    expect(ownVehicleMissing({ vehicleClass: '', plate: '' }, ['bike', 'van'])).toBe('driver.alone.needVehicle');
    expect(ownVehicleMissing({ vehicleClass: 'truck', plate: 'KCA 1T' }, ['truck'])).toBe('driver.alone.needBody');
    expect(ownVehicleMissing({ vehicleClass: 'bike', plate: ' ' }, ['bike'])).toBe('driver.alone.needPlate');
    expect(ownVehicleMissing({ vehicleClass: 'bike', plate: 'KMEB 1' }, ['bike'])).toBe('vehicle.energy.missingBike');
    expect(ownVehicleMissing({ vehicleClass: 'van', plate: 'KDA 1A', energy: 'diesel' }, ['bike'])).toBe('driver.alone.needVehicle');
    expect(ownVehicleMissing({ vehicleClass: 'van', plate: 'KDA 1A', energy: 'diesel' }, ['van'])).toBeNull();
  });
});

describe('a vehicle of their own, corrected or taken off', () => {
  const sheet = (vehicleClass = 'van') => renderToString(<OwnVehicleSheet vehicle={{ vehicleId: 'veh_1', plate: 'KDA 12A', vehicleClass }} onClose={() => undefined} actions={actions} />);

  it('its plate as it stands, to correct — saved only once it changes; the old one is kept, said beside it', () => {
    const html = sheet();
    expect(html).toContain(t('driver.own.title', { plate: 'KDA 12A' }));
    expect(html).toMatch(/id="own-plate"[^>]*value="KDA 12A"/);
    expect(html).toContain(t('driver.own.plateHint'));
    expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>[\\s\\S]*?${t('driver.own.savePlate')}`));
    // A bicycle has no plate: what is marked on it, as when it was registered.
    expect(sheet('bike')).toContain(t('driver.alone.plateBike'));
  });

  it('taking it off is quiet until asked for, and says what it means first', () => {
    const html = sheet();
    expect(html).toContain(t('driver.own.removeTitle'));
    expect(html).toContain(t('driver.own.remove', { plate: 'KDA 12A' }));
    expect(html).not.toContain(t('driver.own.removeYes'));
  });
});

describe('another vehicle of their own', () => {
  const sheet = (classes: string[]) => renderToString(<AddOwnVehicleSheet classes={classes} onClose={() => undefined} actions={actions} />);

  it('one kind on their licence: chosen already, and the plate is asked next', () => {
    const html = sheet(['bike']);
    expect(html).toContain(t('driver.own.addTitle'));
    expect(html).toContain(t('driver.own.addLede'));
    expect(html).not.toContain(`>${t('driver.alone.choose')}</option>`);
    expect(html).toContain(t('driver.alone.needPlate'));
    expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>[\\s\\S]*?${t('driver.own.addCta')}`));
  });

  it('several: chosen by them, only the kinds their licence covers', () => {
    const html = sheet(['car', 'van']);
    expect(html).toContain(`>${t('driver.alone.choose')}</option>`);
    expect(html).toContain('value="car"');
    expect(html).toContain('value="van"');
    expect(html).not.toContain('value="truck"');
    expect(html).toContain(t('driver.alone.needVehicle'));
  });
});

describe('where they are reached', () => {
  it('the driver’s home: correct or remove each of their own, and add another — or, with none, the way to add the one they ride', () => {
    const links = (vehicles: Array<{ vehicleId: string; plate: string; own?: boolean }>, adds: boolean) => renderToString(<OwnVehicleLinks vehicles={vehicles} adds={adds} onOpen={() => undefined} onAdd={() => undefined} />);
    const two = [{ vehicleId: 'v1', plate: 'KMEA 1A', own: true }, { vehicleId: 'v2', plate: 'KBF 2B' }];
    const html = links(two, true);
    expect(html).toContain(t('driver.own.open', { plate: 'KMEA 1A' }));
    // A fleet's vehicle on their list is not theirs to correct or remove.
    expect(html).not.toContain(t('driver.own.open', { plate: 'KBF 2B' }));
    expect(html).toContain(t('driver.own.add'));
    // A fleet's driver, or somebody between fleets: no way to add one.
    expect(links(two, false)).not.toContain(t('driver.own.add'));
    // None on their list: a card of its own, to add the one they ride.
    expect(links([], true)).toContain(t('driver.own.noneTitle'));
    expect(links([], true)).toContain(t('driver.own.add'));
    expect(links([], false)).toBe('');
    // The home shows them in the vehicle card, and in place of it when the list is empty.
    expect(source('screens/HomeScreen.tsx').match(/<OwnVehicleLinks vehicles=\{state\.vehicles\} adds=\{addsOwn\}/g)).toHaveLength(2);
  });

  it('the fleet console: correct the plate, under each vehicle', () => {
    const fleet = source('../fleet/screens/VehiclesScreen.tsx');
    expect(fleet).toContain("t('fleet.vehicles.plateBtn')");
    expect(fleet).toContain('actions.correctPlate(v, plate.trim())');
  });

  it('every new word in each language', async () => {
    for (const locale of ['nl', 'sw', 'am'] as const) {
      const driver = (await import(`../../shared/i18n/words/${locale}/driver.ts`)).words as Record<string, string>;
      const fleet = (await import(`../../shared/i18n/words/${locale}/fleet.ts`)).words as Record<string, string>;
      for (const k of ['driver.own.open', 'driver.own.add', 'driver.own.removeMeans', 'driver.own.addedDetail']) expect(driver[k], `${locale} ${k}`).toBeTruthy();
      for (const k of ['fleet.vehicles.plateBtn', 'fleet.vehicles.plateSavedDetail']) expect(fleet[k], `${locale} ${k}`).toBeTruthy();
    }
  });
});
