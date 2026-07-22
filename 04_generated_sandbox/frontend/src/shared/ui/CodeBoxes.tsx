import { useRef } from 'preact/hooks';

export interface CodeBoxesProps {
  /** Current digits, 0–`length` of them. */
  value: string;
  onInput: (value: string) => void;
  length?: number;
  /** Labels the group for AT; the visual is the boxes. */
  label: string;
  id: string;
  disabled?: boolean;
}

/**
 * The rev-5 segmented code entry: one box per digit, filled boxes solid, the next one
 * dashed — a non-reader can SEE how many digits are still missing. One real input carries
 * focus, keyboard, paste and autofill (`one-time-code`); it sits invisibly over the boxes
 * so a tap anywhere lands in it and the caret logic stays the browser's.
 */
export function CodeBoxes({ value, onInput, length = 4, label, id, disabled }: CodeBoxesProps) {
  const input = useRef<HTMLInputElement>(null);
  const digits = value.replace(/\D/g, '').slice(0, length);

  return (
    <div class="codeboxes" data-disabled={disabled ? 'true' : undefined}>
      <input
        ref={input}
        id={id}
        class="codeboxes__input"
        value={digits}
        onInput={(e) => onInput(e.currentTarget.value.replace(/\D/g, '').slice(0, length))}
        inputMode="numeric"
        autocomplete="one-time-code"
        maxLength={length}
        aria-label={label}
        disabled={disabled}
      />
      <div class="codeboxes__row" aria-hidden="true" onClick={() => input.current?.focus()}>
        {Array.from({ length }, (_, i) => {
          const d = digits[i];
          const next = i === digits.length;
          return (
            <span key={i} class={`codebox${d ? ' codebox--filled' : ''}${next && !disabled ? ' codebox--next' : ''}`}>
              {d ?? ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
