import { useEffect, useRef, useState } from 'preact/hooks';
import { checkScan, kindLabel, type ScanKind } from '../scan';
import { signal } from '../feedback';
import { Icon } from './Icon';

/** BarcodeDetector is not in the DOM lib types; the shape we use is tiny. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}
/** The torch capability is not in lib.dom's MediaTrack types; read it through a cast. */
function trackHasTorch(track: MediaStreamTrack): boolean {
  try {
    return Boolean((track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch);
  } catch {
    return false;
  }
}
function setTrackTorch(track: MediaStreamTrack, on: boolean): Promise<void> {
  return track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints);
}

export interface ScannerProps {
  open: boolean;
  /** The kind of code this field wants — a code of any other kind is rejected loudly. */
  expect: ScanKind;
  title: string;
  /** Fired once, with the parsed value, on the first accepted read. */
  onResult: (value: string) => void;
  onClose: () => void;
}

type Phase = 'starting' | 'scanning' | 'denied' | 'unsupported';

/**
 * The camera scanner — the compendium's "camera opens instantly" for every scan step.
 *
 * Uses the platform BarcodeDetector, which ships on Chromium/Android — the exact "cheap
 * Android" this product targets. Where it is absent (iOS Safari, Firefox) the overlay says
 * so and points back to the keyboard: the field behind is always typeable, so a missing
 * camera is a slower path, never a dead end (a WS-UX non-negotiable). A read of the WRONG
 * kind of code fires the red signal and keeps scanning rather than filling the wrong box.
 *
 * The camera stream is the thing that must never leak: every exit path — a read, a close,
 * an unmount, a denied permission — runs through the same effect cleanup that stops every
 * track.
 */
export function Scanner({ open, expect, title, onResult, onClose }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const torchTrackRef = useRef<MediaStreamTrack | null>(null);
  const [torchable, setTorchable] = useState(false);

  // Latest onResult/onClose without re-subscribing the camera effect (they are inline arrows).
  const cb = useRef({ onResult, onClose });
  cb.current = { onResult, onClose };

  useEffect(() => {
    if (!open) return;

    let stream: MediaStream | null = null;
    let interval: number | undefined;
    let done = false; // a single read wins; later frames are ignored
    let lastMismatchAt = 0;
    const restoreTo = document.activeElement as HTMLElement | null;

    const stop = () => {
      done = true;
      window.clearInterval(interval);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    // Focus + Escape are set up FIRST, on every branch — the 'unsupported' fallback is a
    // real role=dialog too, so a browser without BarcodeDetector (iOS Safari/Firefox) must
    // still trap focus into it and honour Escape, or the fallback card is an unreachable,
    // un-dismissable overlay for a keyboard user.
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cb.current.onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);

    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      stop();
      torchTrackRef.current = null;
      setTorchable(false);
      setTorchOn(false);
      setMismatch(null);
      setPhase('starting');
      restoreTo?.focus?.();
    };

    const detectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!detectorCtor) {
      setPhase('unsupported');
      return cleanup;
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (done) {
          // The sheet was closed before the permission resolved — do not leak the stream.
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play().catch(() => undefined);
        setPhase('scanning');

        const track = stream.getVideoTracks()[0];
        if (track && trackHasTorch(track)) {
          torchTrackRef.current = track;
          setTorchable(true);
        }

        const detector = new detectorCtor({ formats: ['qr_code'] });
        interval = window.setInterval(async () => {
          if (done || !videoRef.current) return;
          let codes: DetectedBarcode[] = [];
          try {
            codes = await detector.detect(videoRef.current);
          } catch {
            return; // a frame that is not ready yet — try the next tick
          }
          // detect() is async: the scanner may have CLOSED (X / Escape / unmount ran stop())
          // or a slower overlapping tick may already have won while we awaited. Without this
          // re-check, a frame decoded after close injects a value and fires onResult/onClose
          // a second time — a phantom read and a double submit.
          if (done) return;
          for (const code of codes) {
            const { value, mismatch: wrong, scannedKind } = checkScan(code.rawValue, expect);
            if (value) {
              done = true;
              signal('ok');
              stop();
              cb.current.onResult(value);
              cb.current.onClose();
              return;
            }
            if (wrong && Date.now() - lastMismatchAt > 1400) {
              lastMismatchAt = Date.now();
              signal('error');
              setMismatch(`That is a ${kindLabel(scannedKind)} code — scan the ${kindLabel(expect)}.`);
            }
          }
        }, 220);
      } catch {
        if (!done) setPhase('denied');
      }
    })();

    return cleanup;
  }, [open, expect]);

  if (!open) return null;

  const toggleTorch = () => {
    const track = torchTrackRef.current;
    if (!track) return;
    const next = !torchOn;
    void setTrackTorch(track, next)
      .then(() => setTorchOn(next))
      .catch(() => undefined);
  };

  return (
    <div class="scanner" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} tabIndex={-1}>
      <video ref={videoRef} class="scanner__video" aria-hidden="true" />

      <div class="scanner__top">
        <span class="scanner__title">{title}</span>
        <button type="button" class="scanner__x" onClick={onClose} aria-label="Close the camera">
          <Icon name="close" size={26} />
        </button>
      </div>

      {phase === 'scanning' ? (
        <>
          <div class="scanner__reticle" aria-hidden="true" />
          <p class="scanner__hint" role="status">
            {mismatch ?? 'Point the camera at the code.'}
          </p>
          {torchable ? (
            <button type="button" class={`scanner__torch${torchOn ? ' scanner__torch--on' : ''}`} onClick={toggleTorch} aria-pressed={torchOn}>
              <Icon name="power" size={20} />
              <span>{torchOn ? 'Light off' : 'Light on'}</span>
            </button>
          ) : null}
        </>
      ) : null}

      {phase === 'starting' ? <p class="scanner__hint" role="status">Opening the camera…</p> : null}

      {phase === 'denied' || phase === 'unsupported' ? (
        <div class="scanner__fallback" role="alert">
          <Icon name="camera" size={40} class="scanner__fallback-ic" />
          <p class="scanner__fallback-t">{phase === 'denied' ? 'The camera is blocked' : 'This phone cannot scan'}</p>
          <p class="scanner__fallback-s">
            {phase === 'denied' ? 'Allow the camera, or type the code instead.' : 'Type the code instead — it works the same.'}
          </p>
          <button type="button" class="btn btn--primary btn--full" onClick={onClose}>
            <span>Type it instead</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
