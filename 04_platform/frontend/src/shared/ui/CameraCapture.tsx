import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '../i18n';
import { useBackLayer } from '../nav';
import { useWakeLock } from '../wakeLock';
import { Icon } from './Icon';

export interface CameraCaptureProps {
  open: boolean;
  title: string;
  /** The frame taken, and the moment it was taken by this phone's clock. */
  onTaken: (photo: Blob, takenAt: string) => void;
  /** The camera is blocked or missing: the way to the gallery instead, so the camera is never a dead end. */
  onUseGallery: () => void;
  onClose: () => void;
}

type Phase = 'starting' | 'live' | 'denied';

/** The longest side a taken frame is kept at before it is made smaller to send — enough for the date-free original. */
const MAX_EDGE = 2048;

/** Whether this phone can open a live camera inside the app at all. */
export function canCaptureLive(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof document !== 'undefined';
}

/**
 * 2026-11-02 — THE APP'S OWN CAMERA (the owner: a photo "taken with the app's own camera is labelled 'taken in the app, at
 * the time'"). A live picture from the phone's camera, taken by the person's tap, inside the app: the one way the app can
 * say the photo was taken when it says, rather than picked from somewhere. A file input's `capture` opens the phone's own
 * camera app and hands back a file — it proves nothing about where that file came from, so it is not used for this.
 *
 * Built on the scanner's full-screen camera (Scanner.tsx) and its rule that the stream never leaks: every way out — a
 * photo taken, a close, Back, a denied permission, the component going away — stops every track.
 */
export function CameraCapture({ open, title, onTaken, onUseGallery, onClose }: CameraCaptureProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  useWakeLock(open);
  useBackLayer(open, onClose);
  const cb = useRef({ onTaken, onClose });
  cb.current = { onTaken, onClose };

  useEffect(() => {
    if (!open) return undefined;
    let done = false;
    const restoreTo = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cb.current.onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (done || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play().catch(() => undefined);
        setPhase('live');
      } catch {
        if (!done) setPhase('denied');
      }
    })();
    return () => {
      done = true;
      document.removeEventListener('keydown', onKey, true);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setPhase('starting');
      restoreTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  /** The frame now, as a picture: drawn from the live video at the moment of the tap. */
  const take = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const takenAt = new Date().toISOString();
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        cb.current.onTaken(blob, takenAt);
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <div class="scanner" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} tabIndex={-1}>
      <video ref={videoRef} class="scanner__video" aria-hidden="true" />
      <div class="scanner__top">
        <span class="scanner__title">{title}</span>
        <button type="button" class="scanner__x" onClick={onClose} aria-label={t('common.chat.photo.camera.close')}>
          <Icon name="close" size={26} />
        </button>
      </div>
      {phase === 'starting' ? (
        <p class="scanner__hint" role="status">
          {t('common.chat.photo.camera.opening')}
        </p>
      ) : null}
      {phase === 'live' ? (
        <>
          <p class="scanner__hint" role="status">
            {t('common.chat.photo.camera.hint')}
          </p>
          <button type="button" class="camera__shutter" onClick={take} aria-label={t('common.chat.photo.camera.shutter')}>
            <span class="camera__shutter-dot" aria-hidden="true" />
          </button>
        </>
      ) : null}
      {phase === 'denied' ? (
        <div class="scanner__fallback" role="alert">
          <Icon name="camera" size={40} class="scanner__fallback-ic" />
          <p class="scanner__fallback-t">{t('common.chat.photo.camera.blocked')}</p>
          <p class="scanner__fallback-s">{t('common.chat.photo.camera.blockedDetail')}</p>
          <button type="button" class="btn btn--primary btn--full" onClick={onUseGallery}>
            <span>{t('common.chat.photo.gallery')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
