import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_PERSON_LOAD, choosesPayWay, personLoadBody, type PersonLoadForm } from './personLoads';

/*
 * 2026-11-24 — WHEN A PERSON PAYS FOR A LOAD, AND THE LOAD BESIDE THE SHOPS (route plan part 9; the owner: "Always, beside shops",
 * "sender can choose: QR or iDeal", and "the system will choose the right method depending on the country without the user noticing
 * it"). Asked only where the pickup's country offers both; never which provider.
 */
const filled = (over: Partial<PersonLoadForm> = {}): PersonLoadForm => ({
  ...EMPTY_PERSON_LOAD('+31612345678', '12'),
  description: 'A parcel of books',
  from: { label: 'Amsterdam', pin: { lat: 52.37, lng: 4.9 } },
  to: { label: 'Sofia', pin: { lat: 42.7, lng: 23.32 } },
  ...over,
});

describe('when a person pays for a load', () => {
  it('is asked only where the country offers both ways', () => {
    expect(choosesPayWay(['at_pickup', 'held'])).toBe(true);
    expect(choosesPayWay(['held'])).toBe(false);
    expect(choosesPayWay(['direct'])).toBe(false);
    expect(choosesPayWay(null)).toBe(false);
  });

  it('sends the way chosen, and nothing where the country’s own way stands; the parcel’s weight comes along', () => {
    expect(EMPTY_PERSON_LOAD('+31612345678', '12').weightKg).toBe('12');
    expect(personLoadBody(filled({ payWay: 'at_pickup' }))).toMatchObject({ payWay: 'at_pickup' });
    expect(personLoadBody(filled())).not.toHaveProperty('payWay');
  });

  it('the screens: the choice where both are offered; no number asked where paying opens a page; the load beside the shops', () => {
    const load = readFileSync(join('src/apps/genesis/screens', 'PersonLoad.tsx'), 'utf8');
    expect(load).toMatch(/const payChoice = choosesPayWay\(ways\) \?/);
    expect(load).toMatch(/\{payChoice \?\? <p class="card__note">\{t\('send\.load\.howPay'\)\}<\/p>\}/);
    expect(load).toMatch(/needsPhone=\{load\.payNeedsPhone !== false\}/);
    expect(load).toMatch(/if \(link\) window\.location\.assign\(link\);/);
    // Never a provider's name on the choice: when, not how.
    expect(load).not.toMatch(/send\.load\.(payIdeal|payMpesa)/);
    const send = readFileSync(join('src/apps/genesis/screens', 'SendScreen.tsx'), 'utf8');
    expect(send).toMatch(/onClick=\{\(\) => actions\.go\('load'\)\}>\s*\{t\('send\.point\.asLoad'\)\}/);
  });
});
