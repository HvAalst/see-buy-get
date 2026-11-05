import { useEffect, useState } from 'preact/hooks';
import { useT } from '../i18n';

/**
 * 2026-11-05 — A PARCEL'S WEIGHT IN KILOGRAMS OR IN GRAMS (the owner: "parcel has only kg and it does the math correct for
 * 0,5 kg, but a toggle weight kg/gram is more intuitive for letters for example").
 *
 * The box asks in whichever unit is chosen beside it and hands the form kilograms, always: the size tier, the price and
 * every record downstream go on reading `weightKg` as they did. Switching the unit rewrites what is in the box (0.15 kg
 * becomes 150 g), never the weight. The choice is kept on the phone — a shop that takes letters all day stays on grams —
 * and a phone that cannot keep it simply starts on kilograms.
 */
export type WeightUnit = 'kg' | 'g';

const UNIT_KEY = 'sbg-weight-unit';

export function readWeightUnit(): WeightUnit {
  try {
    return globalThis.localStorage?.getItem(UNIT_KEY) === 'g' ? 'g' : 'kg';
  } catch {
    return 'kg';
  }
}

function keepWeightUnit(unit: WeightUnit): void {
  try {
    globalThis.localStorage?.setItem(UNIT_KEY, unit);
  } catch {
    // A private window or blocked storage: the unit lasts as long as the screen.
  }
}

const numberOf = (text: string): number => Number(text.trim().replace(',', '.'));

/** Kilograms as the form holds them, written in `unit` — without the noise of a float (0.15 kg is 150 g, not 150.00000000000003). */
export function weightIn(kg: string, unit: WeightUnit): string {
  if (unit === 'kg' || kg.trim() === '') return kg;
  const n = numberOf(kg);
  return Number.isFinite(n) ? String(Number((n * 1000).toFixed(3))) : '';
}

/** What was typed in `unit`, as kilograms for the form. */
export function weightKg(text: string, unit: WeightUnit): string {
  if (unit === 'kg' || text.trim() === '') return text;
  const n = numberOf(text);
  return Number.isFinite(n) ? String(Number((n / 1000).toFixed(6))) : '';
}

/** The lightest a parcel may be, as the server's own floor has it (Min(0.01) on every parcel's weightKg). */
export const LIGHTEST_KG = 0.01;

/** Something is in the box, and it is under the floor — said under the box, where grams invite a 5 g letter. */
export function underFloor(kg: string): boolean {
  const n = numberOf(kg);
  return kg.trim() !== '' && Number.isFinite(n) && n > 0 && n < LIGHTEST_KG;
}

export interface WeightInputProps {
  id: string;
  /** The weight in kilograms, as the form keeps it ('' for none yet). */
  value: string;
  /** Called with kilograms, whatever unit the box is in. */
  onInput: (kg: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** The console's own box (the Business app) rather than a field app's. */
  console?: boolean;
}

/**
 * The box and its unit, without a label: each screen keeps its own label (`for={id}`), so the field apps and the console
 * set it in their own way. Nothing here may sit inside a <label>: the unit buttons are controls of their own.
 */
export function WeightInput({ id, value, onInput, onBlur, disabled, console: inConsole }: WeightInputProps) {
  const t = useT();
  const [unit, setUnit] = useState<WeightUnit>(readWeightUnit);
  const [text, setText] = useState(() => weightIn(value, unit));

  // The form changed the weight on its own (a booked label read in, a new parcel started): show that, in this unit.
  // Typing never trips this — what was typed is, as kilograms, what the form holds.
  useEffect(() => {
    const shown = weightKg(text, unit);
    if (shown === value) return;
    if (shown.trim() !== '' && value.trim() !== '' && numberOf(shown) === numberOf(value)) return;
    setText(weightIn(value, unit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const choose = (next: WeightUnit) => {
    if (next === unit) return;
    keepWeightUnit(next);
    setText(weightIn(weightKg(text, unit), next));
    setUnit(next);
  };

  const light = underFloor(value);
  return (
    <>
    <div class={`wfield${inConsole ? ' wfield--console' : ''}`}>
      <input
        id={id}
        class={`${inConsole ? 'cinput' : 'input'} wfield__input`}
        type="number"
        inputMode="decimal"
        min="0"
        step={unit === 'g' ? '1' : '0.1'}
        value={text}
        disabled={disabled}
        aria-label={t(unit === 'g' ? 'common.weight.inG' : 'common.weight.inKg')}
        aria-invalid={light || undefined}
        onInput={(e) => {
          const typed = e.currentTarget.value;
          setText(typed);
          onInput(weightKg(typed, unit));
        }}
        onBlur={onBlur}
      />
      <div class="wfield__unit" role="group" aria-label={t('common.weight.unit')}>
        {(['kg', 'g'] as const).map((u) => (
          <button
            key={u}
            type="button"
            class={`wfield__btn${unit === u ? ' wfield__btn--on' : ''}`}
            aria-pressed={unit === u}
            aria-label={t(u === 'g' ? 'common.weight.grams' : 'common.weight.kilograms')}
            disabled={disabled}
            onClick={() => choose(u)}
          >
            {t(u === 'g' ? 'common.weight.g' : 'common.weight.kg')}
          </button>
        ))}
      </div>
    </div>
    {/* The size tier comes from the measurements, so a letter weighed as 10 g costs what it would at 5 g. */}
    {light ? <p class={inConsole ? 'chint' : 'hint'} role="status">{t('common.weight.atLeast')}</p> : null}
    </>
  );
}
