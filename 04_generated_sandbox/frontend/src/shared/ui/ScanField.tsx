import { useState } from 'preact/hooks';
import type { ScanKind } from '../scan';
import { primeAudio } from '../feedback';
import { Icon } from './Icon';
import { Scanner } from './Scanner';

export interface ScanFieldProps {
  id: string;
  label: string;
  value: string;
  /** Fired for BOTH typing and scanning — the caller normalizes and stores. */
  onValue: (value: string) => void;
  /** The kind of code the camera should accept; a wrong-kind read is rejected. */
  expect: ScanKind;
  placeholder?: string;
  /** Fired ONLY when a value arrives by camera (not typing) — wire to auto-find/submit. */
  onScan?: (value: string) => void;
  /** Uppercase on entry, matching the bag/sort fields' existing normalization. */
  upper?: boolean;
  enterKeyHint?: 'go' | 'search' | 'done' | 'next';
  autocomplete?: string;
}

/**
 * A code field that can be SCANNED or typed — the WS-UX "show, don't type" default with the
 * keyboard always one tap away behind it. The camera is the fast path; the input is the
 * floor. The same `onValue` handles both, so a screen wires its state once.
 */
export function ScanField({ id, label, value, onValue, expect, placeholder, onScan, upper, enterKeyHint, autocomplete = 'off' }: ScanFieldProps) {
  const [scanning, setScanning] = useState(false);
  const norm = (s: string) => (upper ? s.toUpperCase() : s);

  return (
    <div class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      <div class="scanfield">
        <input
          id={id}
          class="input input--mono scanfield__input"
          value={value}
          onInput={(e) => onValue(norm(e.currentTarget.value))}
          placeholder={placeholder}
          autocapitalize={upper ? 'characters' : 'off'}
          autocomplete={autocomplete}
          spellcheck={false}
          enterkeyhint={enterKeyHint}
        />
        <button
          type="button"
          class="scanfield__btn"
          onClick={() => {
            primeAudio(); // resume WebAudio inside this gesture so the decode beep is heard
            setScanning(true);
          }}
          aria-label={`Scan the ${label.toLowerCase()} with the camera`}
        >
          <Icon name="scan" size={22} />
          <span>Scan</span>
        </button>
      </div>

      <Scanner
        open={scanning}
        expect={expect}
        title={`Scan the ${label.toLowerCase()}`}
        onClose={() => setScanning(false)}
        onResult={(v) => {
          const value = norm(v);
          onValue(value);
          onScan?.(value);
        }}
      />
    </div>
  );
}
