export interface BandScaleProps {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  /** The viewer's own value, marked with the orange dot. */
  mine: number;
  /** Read-aloud/AT text for the whole scale. */
  label: string;
}

/**
 * "You against the market" in one glance: a grey track from min to max, the typical band
 * (p25–p75) in soft blue, a navy tick at the median, and YOU as the one orange dot — the
 * only place the accent colour appears on a pricing screen, which is what makes it findable
 * without reading. Pure CSS, no canvas; numbers land in the caller's copy, not here.
 */
export function BandScale({ min, p25, median, p75, max, mine, label }: BandScaleProps) {
  const span = Math.max(0.01, max - min);
  const at = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));

  return (
    <div class="band" role="img" aria-label={label}>
      <span class="band__track" />
      <span class="band__typical" style={`left:${at(p25)}%;width:${Math.max(0, at(p75) - at(p25))}%`} />
      <span class="band__median" style={`left:${at(median)}%`} />
      <span class="band__you" style={`left:${at(mine)}%`}>
        <span class="band__you-dot" />
        <span class="band__you-label" aria-hidden="true">
          you
        </span>
      </span>
    </div>
  );
}
