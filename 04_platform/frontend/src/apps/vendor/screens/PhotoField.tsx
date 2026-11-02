import { useEffect, useRef, useState } from 'preact/hooks';
import { Note, uploadFailureSentence } from '../../../shared/ui/ErrorNote';
import { failedWords, mediaIdOf, type Uploaded } from '../../../shared/upload';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';

export interface PhotoFieldProps {
  /** The uploaded mediaId, '' while empty. */
  value: string;
  onCapture: (mediaId: string) => void;
  /** Downscale + strip the location + upload the file → resolves the mediaId, or why it did not go ({ failed: words }). */
  upload: (file: File) => Promise<Uploaded>;
  /** Big-target label while empty. */
  label: string;
  id: string;
  disabled?: boolean;
}

/**
 * Photo-as-proof capture, the same contract as the shop's and the Send app's: `capture="environment"` goes
 * straight to the camera, the file is uploaded, and the contract field (contentPhotoRef, the dispute baseline)
 * holds the id of a photo we keep. Round 30 — it used to keep the file's NAME and send nothing, so a damage claim on
 * a store's parcel had no "before" to be judged against. A local preview shows at once while the bytes go.
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

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = async (file: File) => {
    setFailed(null);
    setBusy(true);
    setPreview(URL.createObjectURL(file));
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
          e.currentTarget.value = ''; // the same file may be picked again
          if (f) void pick(f);
        }}
      />
      {preview ? <img class="photo__preview" src={preview} alt="" /> : null}
      <button type="button" class={`photo__btn${done ? ' photo__btn--done' : ''}`} disabled={disabled || busy} onClick={() => input.current?.click()}>
        <Icon name={busy ? 'clock' : done ? 'check' : 'camera'} size={24} />
        <span>{busy ? t('vendor.photo.uploading') : done ? t('vendor.photo.captured') : failed !== null ? t('vendor.photo.failed') : label}</span>
      </button>
      {failed ? <Note tone="warn" icon="camera" title={failed} /> : null}
    </div>
  );
}
