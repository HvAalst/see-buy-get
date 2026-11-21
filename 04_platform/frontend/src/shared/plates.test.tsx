import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import '../apps/fleet/english';
import type { SbgClient, SbgError } from '../lib/sbg';
import { plateTakenOf, isFree, type PlateClaimsView } from './plates';
import { PlateClaimsBody, PlateTakenAsk } from './plates/PlateClaims';

/*
 * 2026-11-21 — THE OWNER: "add the check and consider that a vehicle may be sold and no longer belongs to a driver as well."
 * Under a plate refused as on another vehicle already, whoever bought it asks its owner; the owner answers with one tap; where
 * each ask stands is said to the one who asked; staff decide what nobody answered.
 */
const taken: SbgError = { code: 'DUPLICATE', status: 409, title: 'Already registered', detail: 'KDA 1A is on another vehicle in the network already. If you bought it, ask its owner whether they sold it', retryable: false, params: { field: 'plate', plate: 'KDA 1A' } };
const sbg = {} as SbgClient;
const src = (path: string) => readFileSync(join('src', path), 'utf8');

describe('a plate on another vehicle already', () => {
  it('is told apart from any other refusal, by its field', () => {
    expect(plateTakenOf(taken)).toBe('KDA 1A');
    expect(plateTakenOf({ ...taken, params: { field: 'nationalId' } })).toBeNull();
    expect(plateTakenOf({ ...taken, code: 'INVALID_STATE' })).toBeNull();
    expect(plateTakenOf(null)).toBeNull();
    expect(['sold', 'released', 'freed'].every((s) => isFree(s as never))).toBe(true);
    expect(['asked', 'kept', 'left', 'lapsed'].some((s) => isFree(s as never))).toBe(false);
  });

  it('offers whoever bought it to ask its owner — and nothing under another refusal', () => {
    const html = renderToString(<PlateTakenAsk error={taken} sbg={sbg} />);
    expect(html).toContain(t('plate.claim.ask', { plate: 'KDA 1A' }));
    expect(html).toContain(t('plate.claim.askHint'));
    expect(renderToString(<PlateTakenAsk error={{ ...taken, params: { field: 'nationalId' } }} sbg={sbg} />)).toBe('');
    expect(renderToString(<PlateTakenAsk error={taken} sbg={null} />)).toBe('');
  });
});

describe('what is asked of an owner, and where an ask stands', () => {
  const body = (view: PlateClaimsView | null) => renderToString(<PlateClaimsBody view={view} busy={null} error={null} onAnswer={() => undefined} />);
  const one = { claimId: 'pcl_1', plate: 'KDA 1A', vehicleClass: 'van', askedAt: '2026-11-21T10:00:00.000Z' };

  it('to the owner: "Did you sell …?", who says they bought it, one tap each way', () => {
    const html = body({ forMe: [{ ...one, state: 'asked', askedBy: 'Otieno' }], asked: [] });
    expect(html).toContain(t('plate.claim.soldTitle', { plate: 'KDA 1A' }));
    expect(html).toContain('Otieno says they bought it');
    expect(html).toContain(t('plate.claim.yesSold'));
    expect(html).toContain(t('plate.claim.stillMine'));
  });

  it('to the one who asked: waiting, free, kept, or staff’s words — and nothing when there is nothing', () => {
    expect(body({ forMe: [], asked: [{ ...one, state: 'asked' }] })).toContain(t('plate.claim.askedListTitle'));
    expect(body({ forMe: [], asked: [{ ...one, state: 'sold' }] })).toContain(t('plate.claim.state.free'));
    expect(body({ forMe: [], asked: [{ ...one, state: 'kept' }] })).toContain(t('plate.claim.state.kept'));
    expect(body({ forMe: [], asked: [{ ...one, state: 'left', reason: 'It still goes out daily.' }] })).toContain('It still goes out daily.');
    expect(body({ forMe: [], asked: [] })).toBe('');
    expect(body(null)).toBe('');
  });
});

describe('where it is reached', () => {
  it('the Driver app: the card on the home; the way on under a refused plate where one is added, corrected, or ridden', () => {
    expect(src('apps/driver/screens/HomeScreen.tsx')).toContain('<PlateClaimsCard sbg={sbg}');
    expect(src('apps/driver/screens/OwnVehicleSheet.tsx').match(/<PlateTakenAsk error=\{error\} sbg=\{sbg\} \/>/g)).toHaveLength(2);
    expect(src('apps/driver/screens/FleetSheet.tsx')).toContain('<PlateTakenAsk error={error} sbg={sbg} />');
    expect(src('apps/driver/app.tsx')).toMatch(/<FleetSheet open=\{fleetOpen\}.*sbg=\{sbg\} \/>/);
  });

  it('the fleet console: the card, the way on under its refusal, and Sold or scrapped under each vehicle', () => {
    const fleet = src('apps/fleet/screens/VehiclesScreen.tsx');
    expect(fleet).toContain('<PlateTakenAsk error={state.error} sbg={sbg} />');
    expect(fleet).toContain('<PlateClaimsCard sbg={sbg}');
    expect(fleet).toContain("t('fleet.vehicles.soldBtn')");
    expect(fleet).toContain('void actions.retireVehicle(v);');
  });

  it('the staff console: plates nobody answered about, on Papers', () => {
    expect(src('apps/tower/screens/PapersScreen.tsx')).toContain('<PlateClaimsPanel state={state} actions={actions} />');
  });

  it('every new word in each language', async () => {
    for (const locale of ['nl', 'sw', 'am'] as const) {
      const vehicles = (await import(`./i18n/words/${locale}/vehicles.ts`)).words as Record<string, string>;
      const fleet = (await import(`./i18n/words/${locale}/fleet.ts`)).words as Record<string, string>;
      const tower = (await import(`./i18n/words/${locale}/tower.ts`)).words as Record<string, string>;
      for (const k of ['plate.claim.ask', 'plate.claim.soldTitle', 'plate.claim.state.kept']) expect(vehicles[k], `${locale} ${k}`).toBeTruthy();
      for (const k of ['fleet.vehicles.soldBtn', 'fleet.vehicles.soldBody']) expect(fleet[k], `${locale} ${k}`).toBeTruthy();
      for (const k of ['tower.plates.title', 'tower.plates.release']) expect(tower[k], `${locale} ${k}`).toBeTruthy();
    }
  });
});
