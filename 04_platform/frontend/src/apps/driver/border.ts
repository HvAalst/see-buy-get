import type { Translate } from '../../shared/i18n';

/**
 * CA6 — what a driver taking a load across a border needs to know, BEFORE they claim it: where they may cross and
 * when, what they must carry, and the limit the crossing sets. Where nobody has recorded the crossing, the driver
 * is told exactly that — never shown nothing, which would read as "nothing is needed".
 */
export interface BorderAdviceView {
  from: string;
  to: string;
  recorded: boolean;
  crossings: Array<{ name: string; hours?: string }>;
  permits: string[];
  regionalInsurance: string[];
  maxWeightKg?: number;
  note?: string;
}

const regionName = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();
const countryName = (code: string) => {
  try {
    return regionName?.of(code) ?? code;
  } catch {
    return code;
  }
};

export function borderLines(border: BorderAdviceView | undefined, t: Translate): string[] {
  if (!border) return [];
  const lines = [t('driver.offers.border', { from: countryName(border.from), to: countryName(border.to) })];
  if (!border.recorded) return [...lines, t('driver.offers.borderUnknown')];
  if (border.crossings.length) lines.push(t('driver.offers.borderAt', { crossings: border.crossings.map((c) => [c.name, c.hours].filter(Boolean).join(' ')).join(', ') }));
  const carry = [...border.permits, ...border.regionalInsurance];
  if (carry.length) lines.push(t('driver.offers.borderCarry', { items: carry.join(', ') }));
  if (border.maxWeightKg) lines.push(t('driver.offers.borderMax', { kg: border.maxWeightKg.toLocaleString() }));
  return lines;
}
