import { qrMatrix, qrPath, type EccLevel } from '../qr';

export interface QrBlockProps {
  /** What the scanner will read. Use `qrPayload()` so every app namespaces the same way. */
  value: string;
  /** Rendered box in px. 132 suits a card; 200+ suits something meant to be printed. */
  size?: number;
  /**
   * Recovery level. 'Q' (~25%) is the default because everything this product shows is
   * meant to survive being printed, laminated, taped to a dashboard and scanned in dust.
   */
  ecc?: EccLevel;
  /** Human-readable line under the code — a person must be able to read what a scan reads. */
  caption?: string;
  /** Describes the code to assistive tech; the caption alone is not enough. */
  label: string;
}

/**
 * A real, scannable QR — the phygital half of this product.
 *
 * One `<path>` covers every dark module, so a screen listing a dozen bag codes stays cheap.
 * The quiet zone is drawn INSIDE the box (4 modules, as the spec requires): without it a
 * code rendered against a coloured card is unreadable, and that is exactly how a QR
 * silently fails in the field — it looks fine and never scans.
 */
export function QrBlock({ value, size = 132, ecc = 'Q', caption, label }: QrBlockProps) {
  let matrix: boolean[][];
  try {
    matrix = qrMatrix(value, { ecc });
  } catch {
    // A payload too long to encode must not take the screen down; say so instead.
    return (
      <div class="qr">
        <p class="qr__fail">Cannot make a code for this.</p>
        {caption ? <p class="qr__cap">{caption}</p> : null}
      </div>
    );
  }

  const quiet = 4;
  const span = matrix.length + quiet * 2;

  return (
    <div class="qr">
      <svg
        class="qr__svg"
        width={size}
        height={size}
        viewBox={`0 0 ${span} ${span}`}
        role="img"
        aria-label={label}
        shape-rendering="crispEdges"
      >
        <rect width={span} height={span} fill="#fff" />
        <g transform={`translate(${quiet} ${quiet})`}>
          <path d={qrPath(matrix)} fill="#000" />
        </g>
      </svg>
      {caption ? <p class="qr__cap">{caption}</p> : null}
    </div>
  );
}
