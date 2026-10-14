import type { ComponentChildren } from 'preact';

export interface GlanceNumberProps {
  /** Uppercase 14px label above the figure. */
  label: string;
  /** The one number that carries the screen — 64px, 800, navy, tabular; smaller only where it would not fit the card. */
  value: string | number;
  /** Trailing unit, set smaller so the figure keeps the weight. */
  unit?: string;
  /** Thin capacity bar, 0–100. Omit for a bare figure. */
  percent?: number;
  /** One line of plain language under the bar. No jargon, no abbreviations. */
  sub?: string;
  /** Turns the bar red once it is genuinely full. */
  alert?: boolean;
  aside?: ComponentChildren;
}

/**
 * The "one big number" glance. A driver looks at this screen for well under a second,
 * often one-handed in a moving vehicle: one figure, one bar, one sentence. Anything else
 * that wants to be here belongs on a card below.
 */
export function GlanceNumber({ label, value, unit, percent, sub, alert, aside }: GlanceNumberProps) {
  const pct = percent === undefined ? undefined : Math.max(0, Math.min(100, percent));

  return (
    <section class="glance" aria-label={label}>
      <div class="card__head" style="margin-bottom:0">
        <p class="glance__label">{label}</p>
        {aside ?? null}
      </div>
      <p class="glance__figure">
        <span class="glance__value" style={`--glance-chars:${Math.max(String(value).length, 1)}`}>{value}</span>
        {unit ? <span class="glance__unit">{unit}</span> : null}
      </p>
      {pct === undefined ? null : (
        <div
          class={`glance__bar${alert ? ' glance__bar--full' : ''}`}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} used`}
        >
          <span style={`width:${pct}%`} />
        </div>
      )}
      {sub ? <p class="glance__sub">{sub}</p> : null}
    </section>
  );
}
