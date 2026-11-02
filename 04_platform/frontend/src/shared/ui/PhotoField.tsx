import { useEffect, useRef, useState } from 'preact/hooks';
import { Note, uploadFailureSentence } from './ErrorNote';
import { failedWords, mediaIdOf, type Uploaded } from '../upload';
import { Icon } from './Icon';
import { useT } from '../i18n';

export interface PhotoFieldProps {
  /** The captured mediaId, '' while empty. */
  value: string;
  onCapture: (mediaId: string) => void;
  /** Downscale + EXIF-strip + upload the file → resolves the mediaId, or why it did not go ({ failed: words }). */
  upload: (file: File) => Promise<Uploaded>;
  /** Big-target label while empty. */
  label: string;
  id: string;
  disabled?: boolean;
}

/**
 * Photo-as-proof capture (S26 — real upload). `capture="environment"` sends a phone straight to the camera.
 * The file is downscaled + EXIF-stripped and uploaded by the parent's `upload`; the REFERENCE stored is a real
 * mediaId. A local object-URL preview shows instantly while the bytes upload, so the worker sees their shot
 * without a round-trip. Callback-parameterised (not app-bound) so any app can render it — S33 lifted it into
 * shared/ui for the driver securement photo; the agent/genesis/vendor apps still carry their own copies (a
 * later cleanup can point them here too).
 */
export function PhotoField({ value, onCapture, upload, label, id, disabled }: PhotoFieldProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /*
   * WHY IT DID NOT GO, SAID UNDER THE BUTTON (the owner, 2026-11-02: "It silently refused"). `upload` answers the
   * media id, or { failed: words } — the photo this phone could not open, the server's refusal, no signal — and those
   * words are shown here, where the photo was taken. A handler that throws is a failure like any other: the button never
   * stays "sending". Null (no words) still says the photo did not go.
   */

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (file: File) => {
    setFailed(null);
    setBusy(true);
    setPreview(URL.createObjectURL(file)); // instant local preview
    const result: Uploaded = await upload(file).catch((e: unknown) => ({ failed: uploadFailureSentence(e, 'photo') }));
    setBusy(false);
    const mediaId = mediaIdOf(result);
    if (!mediaId) {
      setFailed(failedWords(result) ?? '');
      setPreview(null);
      return;
    }
    onCapture(mediaId);
  };

  const done = Boolean(value) && !busy && failed === null;
  return (
    <div class="photo">
      <input
        ref={input}
        id={id}
        class="photo__input"
        type="file"
        data-upload="photo"
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
        <span>{busy ? t('photo.uploading') : done ? t('photo.saved') : failed !== null ? t('photo.failed') : label}</span>
      </button>
      {failed ? <Note tone="warn" icon="camera" title={failed} /> : null}
    </div>
  );
}
