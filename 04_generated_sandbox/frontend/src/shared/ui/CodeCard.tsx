import { qrPayload } from '../qr';
import { QrBlock } from './QrBlock';
import { ReadAloud } from './ReadAloud';

export interface CodeCardProps {
  /** Uppercase 14px label above the code. */
  label: string;
  /** The code itself — rendered 46px mono in brand blue, the rev-5 "moment of truth". */
  code: string;
  /** Read-aloud control text; the code is always spoken digit by digit. */
  sayLabel?: string;
  /**
   * Show the code as a scannable QR beside the digits. Rev 5 draws exactly this — a code
   * a person can read AND a machine can scan, because at a counter either one may be the
   * faster path. Give the payload kind; omit to render digits only.
   */
  scanAs?: 'collect' | 'parcel' | 'track';
}

/**
 * The rev-5 code card: a 46px mono code in blue on a white card with a "Hear the code"
 * control — the one place the palette lets BLUE carry a number, because the code IS the
 * action. Spoken digit-by-digit ("4, 7, 2, 9"): a synthesiser reading "4729" as
 * four-thousand-something is useless to the person at the counter.
 */
export function CodeCard({ label, code, sayLabel = 'Hear the code', scanAs }: CodeCardProps) {
  const spoken = () => code.split('').join(', ');
  return (
    <section class="codecard" aria-label={`${label}: ${code.split('').join(' ')}`}>
      <div class={scanAs ? 'codecard__row' : undefined}>
        <div>
          <p class="codecard__label">{label}</p>
          <p class="codecard__code">{code}</p>
          <ReadAloud text={spoken} label={sayLabel} />
        </div>
        {scanAs ? (
          <QrBlock value={qrPayload(scanAs, code)} size={116} label={`${label} as a scannable code`} />
        ) : null}
      </div>
    </section>
  );
}
