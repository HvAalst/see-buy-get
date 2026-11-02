import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { paperForUpload } from '../../../shared/media';
import { uploadFailureSentence } from '../../../shared/ui/ErrorNote';
import { uploadHint } from '../../../shared/upload';

/** A paper chosen and made ready to send: the file as it was chosen, and what goes to the server. */
export interface PaperReady {
  file: File;
  dataUrl: string;
}

export interface PaperPickerProps {
  /** The paper, by its name: each button's name to a screen reader says which paper it adds. */
  paper: string;
  /** The paper, read and made ready to send. Whatever it returns is waited for, and the picker says "Adding…" meanwhile. */
  onReady: (ready: PaperReady) => unknown;
  disabled?: boolean;
  /** Sent by the screen that holds it: said here too, where the person chose the file. */
  working?: boolean;
  /** "Take a photo" as the call — where adding this paper is the thing to do now. */
  primary?: boolean;
  /** Small buttons, in a row of other small buttons. */
  small?: boolean;
  /** The kinds and the limit, said under the buttons. Off where one hint already stands under several pickers. */
  hint?: boolean;
}

/**
 * A PAPER, BY CAMERA OR FROM THE PHONE (the owner, 2026-11-02: "there is no image upload (either camera or gallery)").
 *
 * Two buttons, because one picker asking for a PDF and a photo at once is, on most Androids, the Files app — no camera, no
 * gallery. "Take a photo" opens the phone's own camera (`capture`): the paper photographed flat, with the camera's own
 * focus and light; at a desk the browser offers its file chooser instead. "Choose a photo or PDF" opens the gallery and the
 * files together. Either way the file is read by the one path that checks it (paperForUpload: a photo made smaller to fit,
 * a PDF over the most refused with its size and the most), and whatever stops it is said in words, here, under the buttons.
 *
 * The house's own live camera (CameraCapture) is not used here: it proves a photo was taken in the app at the time, which
 * a paper does not need, and it would cost a scan of a certificate the phone camera's own sharpness.
 */
export function PaperPicker({ paper, onReady, disabled, working, primary, small, hint = true }: PaperPickerProps) {
  const t = useT();
  const [reading, setReading] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const busy = reading || Boolean(working);
  const off = Boolean(disabled) || busy;

  const pick = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared at once, so the same file chosen again (after a refusal from the server) still counts as a choice.
    input.value = '';
    if (!file) return;
    setRefused(null);
    setReading(true);
    try {
      await onReady({ file, dataUrl: await paperForUpload(file) });
    } catch (err) {
      setRefused(uploadFailureSentence(err));
    } finally {
      setReading(false);
    }
  };

  const size = small ? ' cbtn--sm' : '';
  return (
    <span class={`biz-pick${small ? ' biz-pick--sm' : ''}`}>
      <span class="biz-pick__btns">
        <label class={`cbtn ${primary ? 'cbtn--primary' : 'cbtn--ghost'}${size} biz-pick__btn`} aria-disabled={off ? 'true' : undefined}>
          <Icon name="camera" size={16} />
          <span>{t('business.paper.takePhoto')}</span>
          <input type="file" data-upload="document" accept="image/*" capture="environment" class="biz-file" disabled={off} aria-label={t('business.paper.takePhotoOf', { paper })} onChange={(e) => void pick(e)} />
        </label>
        <label class={`cbtn cbtn--ghost${size} biz-pick__btn`} aria-disabled={off ? 'true' : undefined}>
          <Icon name="arrowUp" size={16} />
          <span>{t('business.paper.choose')}</span>
          <input type="file" data-upload="document" accept="application/pdf,image/*" class="biz-file" disabled={off} aria-label={t('business.paper.chooseFor', { paper })} onChange={(e) => void pick(e)} />
        </label>
      </span>
      {busy ? (
        <span class="chint" role="status">
          {t('business.paper.uploading')}
        </span>
      ) : null}
      {refused ? (
        <span class="cerr biz-pick__why" role="alert">
          {refused}
        </span>
      ) : null}
      {hint ? <span class="chint">{uploadHint('document')}</span> : null}
    </span>
  );
}

/**
 * WHAT WAS ADDED, to be seen before moving on: the photo itself, small — or, for a PDF, its name on a tile that says PDF.
 * `preview` is the paper as it was sent, where it is a picture.
 */
export function PaperAdded({ name, preview, status }: { name: string; preview?: string; status?: string }) {
  const t = useT();
  const picture = preview && preview.startsWith('data:image/') ? preview : undefined;
  return (
    <span class="biz-added">
      {picture ? (
        <img class="biz-added__thumb" src={picture} alt={t('business.paper.thumb', { name })} />
      ) : (
        <span class="cdoc__tile biz-added__tile" aria-hidden="true">
          PDF
        </span>
      )}
      <span class="biz-added__body">
        <span class="biz-added__name">{name}</span>
        {status ? <span class="chint">{status}</span> : null}
      </span>
    </span>
  );
}
