import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { h } from 'preact';
import { t } from './i18n';
import { energiesFor, energyFits, energyMissing, energyWord } from './vehicleEnergy';
import { EnergyChoice } from './ui/EnergyChoice';

/*
 * WHAT A VEHICLE RUNS ON (2026-11-03 — the owner, on ISO 14083: "go ahead"). The server decides what fits
 * (fleet.config.ts energyMisfit); a form must never offer what it refuses.
 */
describe('what a vehicle runs on', () => {
  it('offers a bicycle pedalled or electric, an engine every fuel but pedalling, the most usual first', () => {
    expect(energiesFor('bike')).toEqual(['pedal', 'electric']);
    expect(energiesFor('motorcycle')[0]).toBe('petrol');
    expect(energiesFor('truck')[0]).toBe('diesel');
    for (const c of ['motorcycle', 'tuktuk', 'car', 'van', 'bus', 'truck']) {
      expect(energiesFor(c)).not.toContain('pedal');
      expect([...energiesFor(c)].sort()).toEqual(['diesel', 'electric', 'gas', 'hybrid', 'petrol']);
    }
    // A class this build has never heard of: any engine, never pedalled.
    expect(energiesFor('hovercraft')).not.toContain('pedal');
  });

  it('keeps only an answer that fits, and says what is missing in the class’s own words', () => {
    expect(energyFits('bike', 'electric')).toBe(true);
    expect(energyFits('bike', 'diesel')).toBe(false);
    expect(energyFits('van', 'pedal')).toBe(false);
    expect(energyFits('van', '')).toBe(false);
    expect(energyMissing('bike', '', t)).toBe('Say whether the bike is pedalled or electric');
    expect(energyMissing('van', 'pedal', t)).toBe('Say what the vehicle runs on');
    expect(energyMissing('van', 'hybrid', t)).toBeNull();
    expect(energyWord('gas', t)).toBe('Gas (autogas or natural gas)');
    // An energy this build has never heard of is shown as the server says it, never as a key.
    expect(energyWord('hydrogen', t)).toBe('hydrogen');
  });

  it('is chosen by a tap, with nothing chosen for anybody', () => {
    const html = renderToString(h(EnergyChoice, { id: 'e', vehicleClass: 'van', value: '', onChange: () => undefined }));
    expect(html).toContain('What it runs on');
    expect(html).toContain('Diesel');
    expect(html).not.toContain('Pedalled');
    expect(html).not.toContain('aria-pressed="true"');
    const chosen = renderToString(h(EnergyChoice, { id: 'e', vehicleClass: 'bike', value: 'electric', onChange: () => undefined, hint: false }));
    expect(chosen.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(chosen).not.toContain('emissions');
  });
});
