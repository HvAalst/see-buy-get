import { useRef } from 'preact/hooks';
import { Icon } from '../../../shared/ui';

export interface PhotoFieldProps {
  /** The captured reference (file name), '' while empty. */
  value: string;
  onCapture: (ref: string) => void;
  /** Big-target label while empty. */
  label: string;
  id: string;
}

/**
 * Photo-as-proof capture. `capture="environment"` sends a phone straight to the camera —
 * show, don't type. The sandbox transports no bytes; the REFERENCE is the contract field
 * (dropoffPhotoRef / photoProofRef), exactly as the legacy pages recorded it.
 */
export function PhotoField({ value, onCapture, label, id }: PhotoFieldProps) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div class="photo">
      <input
        ref={input}
        id={id}
        class="photo__input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) onCapture(f.name || `photo-${Math.round(performance.now())}.jpg`);
        }}
      />
      <button type="button" class={`photo__btn${value ? ' photo__btn--done' : ''}`} onClick={() => input.current?.click()}>
        <Icon name={value ? 'check' : 'camera'} size={24} />
        <span>{value ? 'Photo captured — tap to retake' : label}</span>
      </button>
    </div>
  );
}
