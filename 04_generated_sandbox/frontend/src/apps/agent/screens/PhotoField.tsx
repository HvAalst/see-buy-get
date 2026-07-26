import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';

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
 * Photo-as-proof capture (S26 — real upload). `capture="environment"` sends a phone straight to the
 * camera. The file is downscaled + EXIF-stripped and uploaded to /media by the parent's `upload`; the
 * REFERENCE stored in the contract field is now a real mediaId (not a filename). A local object-URL
 * preview shows instantly while the bytes upload, so the worker sees their shot without a round-trip.
 */
export function PhotoField({ value, onCapture, upload, label, id, disabled }: PhotoFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (file: File) => {
    setFailed(false);
    setBusy(true);
    setPreview(URL.createObjectURL(file)); // instant local preview
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
          e.currentTarget.value = ''; // allow re-picking the same file
          if (f) void pick(f);
        }}
      />
      {preview ? <img class="photo__preview" src={preview} alt="" /> : null}
      <button type="button" class={`photo__btn${done ? ' photo__btn--done' : ''}`} disabled={disabled || busy} onClick={() => input.current?.click()}>
        <Icon name={busy ? 'clock' : done ? 'check' : 'camera'} size={24} />
        <span>{busy ? 'Uploading…' : done ? 'Photo saved — tap to retake' : failed ? 'Upload failed — tap to try again' : label}</span>
      </button>
    </div>
  );
}
