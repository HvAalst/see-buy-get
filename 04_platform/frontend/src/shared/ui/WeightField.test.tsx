import { readFileSync } from 'node:fs';
import { renderToString } from 'preact-render-to-string';
import { afterEach, describe, expect, it } from 'vitest';
import { LIGHTEST_KG, WeightInput, readWeightUnit, underFloor, weightIn, weightKg } from './WeightField';

/*
 * 2026-11-05 — A PARCEL'S WEIGHT IN KILOGRAMS OR GRAMS (the owner: "a toggle weight kg/gram is more intuitive for letters").
 * The box speaks the chosen unit; the form, the size tier and the price keep reading kilograms.
 */
describe('a weight in kilograms or grams', () => {
  it('writes kilograms in grams and back, without the noise of a float', () => {
    expect(weightIn('0.15', 'g')).toBe('150');
    expect(weightIn('0.5', 'g')).toBe('500');
    expect(weightIn('12', 'g')).toBe('12000');
    expect(weightKg('150', 'g')).toBe('0.15');
    expect(weightKg('20', 'g')).toBe('0.02');
    expect(weightKg('0.5', 'g')).toBe('0.0005');
    expect(weightKg('7', 'g')).toBe('0.007');
    // A round trip lands where it started.
    for (const kg of ['0.15', '0.333', '1.2', '25']) expect(weightKg(weightIn(kg, 'g'), 'g')).toBe(kg);
  });

  it('leaves kilograms as typed, and an empty box empty', () => {
    expect(weightIn('0.5', 'kg')).toBe('0.5');
    expect(weightKg('0.5', 'kg')).toBe('0.5');
    expect(weightIn('', 'g')).toBe('');
    expect(weightKg('', 'g')).toBe('');
    expect(weightKg('  ', 'g')).toBe('  ');
  });

  it('reads a decimal comma as a point', () => {
    expect(weightKg('150,5', 'g')).toBe('0.1505');
    expect(weightIn('0,25', 'g')).toBe('250');
  });
});

describe('the lightest a parcel may be', () => {
  it('is the server’s own floor, 10 g — and a 5 g letter is told so under the box rather than refused without a word', () => {
    // Every parcel's weightKg on the server is Min(0.01) (pudo.dto, business-parcel.types).
    const dto = readFileSync('../backend/src/modules/pudo/business-parcel.types.ts', 'utf8');
    expect(dto).toMatch(/@Min\(0\.01\) weightKg/);
    expect(LIGHTEST_KG).toBe(0.01);
    expect(underFloor(weightKg('5', 'g'))).toBe(true);
    expect(underFloor(weightKg('10', 'g'))).toBe(false);
    expect(underFloor('')).toBe(false);
    expect(underFloor('0')).toBe(false);
    const html = renderToString(<WeightInput id="w" value="0.005" onInput={() => undefined} />);
    expect(html).toContain('10 g');
    expect(html).toContain('aria-invalid="true"');
    expect(renderToString(<WeightInput id="w" value="0.02" onInput={() => undefined} />)).not.toContain('aria-invalid');
  });
});

describe('the unit a phone keeps', () => {
  const real = globalThis.localStorage;
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
  });
  const store = (v: string | null) =>
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => v, setItem: () => undefined }, configurable: true });

  it('starts in kilograms, and in grams where grams were chosen', () => {
    store(null);
    expect(readWeightUnit()).toBe('kg');
    store('g');
    expect(readWeightUnit()).toBe('g');
    store('nonsense');
    expect(readWeightUnit()).toBe('kg');
  });

  it('starts in kilograms where the phone keeps nothing (a private window throws)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
      },
      configurable: true,
    });
    expect(readWeightUnit()).toBe('kg');
  });

  it('shows the form’s kilograms in the unit the phone kept', () => {
    store('g');
    const html = renderToString(<WeightInput id="w" value="0.25" onInput={() => undefined} />);
    expect(html).toContain('value="250"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>g</);
  });
});

describe('the box', () => {
  it('is a box and a unit pair the screen labels — two pressed-or-not buttons in a group, never a tablist', () => {
    const html = renderToString(<WeightInput id="w" value="" onInput={() => undefined} />);
    expect(html).toContain('id="w"');
    expect(html).toContain('role="group"');
    expect(html.match(/aria-pressed=/g)?.length).toBe(2);
    expect(html).not.toContain('role="tab');
    expect(html).not.toContain('<label');
  });

  it('is the weight box of every parcel form — the Shop, Send, the Store and Business — and none wraps it in a label', () => {
    const forms = ['apps/agent/screens/AcceptScreen.tsx', 'apps/genesis/screens/SendScreen.tsx', 'apps/vendor/screens/MintScreen.tsx', 'apps/business/screens/ParcelsScreen.tsx'];
    for (const f of forms) {
      const src = readFileSync(`src/${f}`, 'utf8');
      expect({ f, uses: src.includes('<WeightInput') }).toEqual({ f, uses: true });
      // The weight is no longer one of the plain number boxes beside it.
      expect({ f, plain: /\['kg', /.test(src) }).toEqual({ f, plain: false });
      // A <label> may hold only the control it names; the unit buttons are controls of their own.
      expect({ f, wrapped: /<label[^>]*>\s*(?:<span[^>]*>[^<]*<\/span>\s*)?<WeightInput/.test(src) }).toEqual({ f, wrapped: false });
    }
  });
});
