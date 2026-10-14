import { useRef } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';

export interface PhotoFieldProps {
  value: string;
  onCapture: (ref: string) => void;
  label: string;
  id: string;
}

/**
 * Photo-as-proof capture (same contract as the agent app's): `capture="environment"` goes
 * straight to the camera; the sandbox transports no bytes — the REFERENCE is the contract
 * field (contentPhotoRef), the dispute baseline.
 */
export function PhotoField({ value, onCapture, label, id }: PhotoFieldProps) {
  const t = useT();
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
        <span>{value ? t('vendor.photo.captured') : label}</span>
      </button>
    </div>
  );
}
