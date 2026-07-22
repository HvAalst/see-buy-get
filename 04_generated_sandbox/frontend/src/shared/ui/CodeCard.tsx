import { ReadAloud } from './ReadAloud';

export interface CodeCardProps {
  /** Uppercase 14px label above the code. */
  label: string;
  /** The code itself — rendered 46px mono in brand blue, the rev-5 "moment of truth". */
  code: string;
  /** Read-aloud control text; the code is always spoken digit by digit. */
  sayLabel?: string;
}

/**
 * The rev-5 code card: a 46px mono code in blue on a white card with a "Hear the code"
 * control — the one place the palette lets BLUE carry a number, because the code IS the
 * action. Spoken digit-by-digit ("4, 7, 2, 9"): a synthesiser reading "4729" as
 * four-thousand-something is useless to the person at the counter.
 */
export function CodeCard({ label, code, sayLabel = 'Hear the code' }: CodeCardProps) {
  const spoken = () => code.split('').join(', ');
  return (
    <section class="codecard" aria-label={`${label}: ${code.split('').join(' ')}`}>
      <p class="codecard__label">{label}</p>
      <p class="codecard__code">{code}</p>
      <ReadAloud text={spoken} label={sayLabel} />
    </section>
  );
}
