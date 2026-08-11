import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';

export interface PhotoFieldProps {
  /** The captured mediaId, '' while empty. */
  value: string;
  onCapture: (mediaId: string) => void;
  /** Downscale + EXIF-strip + upload the file → resolves the mediaId (or null on failure). */
  upload: (file: File) => Promise<string | null>;
  /** Big-target label while empty. */
  label: string;
  id: string;
  disabled?: boolean;
}

/**
 * Photo-as-proof capture (S23 receiver photo, S26 real upload). `capture="environment"` sends a phone
 * straight to the camera. The file is downscaled + EXIF-stripped and uploaded to /media; the contract
 * field (podPhotoRef / dispute photoRef) now holds a real mediaId. A local preview shows instantly.
 */
export function PhotoField({ value, onCapture, upload, label, id, disabled }: PhotoFieldProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (file: File) => {
    setFailed(false);
    setBusy(true);
    setPreview(URL.createObjectURL(file));
    const mediaId = await upload(file);
    setBusy(false);
    if (!mediaId) {
      setFailed(true);
      setPreview(null);
      return;
    }
    onCapture(mediaId);
  };

  const done = Boolean(value) && !busy && !failed;
  return (
    <div class="photo">
      <input
        ref={input}
        id={id}
        class="photo__input"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled || busy}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void pick(f);
        }}
      />
      {preview ? <img class="photo__preview" src={preview} alt="" /> : null}
      <button type="button" class={`photo__btn${done ? ' photo__btn--done' : ''}`} disabled={disabled || busy} onClick={() => input.current?.click()}>
        <Icon name={busy ? 'clock' : done ? 'check' : 'camera'} size={24} />
        <span>{busy ? t('send.photo.uploading') : done ? t('send.photo.captured') : failed ? t('send.photo.failed') : label}</span>
      </button>
    </div>
  );
}
