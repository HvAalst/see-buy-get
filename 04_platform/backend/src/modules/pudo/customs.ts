import { GlosError } from '../../foundation/http/glos-error';
import { BorderCrossing } from './country';
import { CustomsDeclaration, LineItem } from './pudo.types';

/**
 * The paperwork a parcel needs to leave one customs territory for another.
 *
 * The network could describe a border crossing and then let goods cross it carrying nothing. A parcel with
 * no declaration does not get waved through in the real world — it gets held, and the person waiting for
 * it is told nothing. So a crossing is now a STEP with a precondition, not a line on a route.
 *
 * Three deliberate limits, stated rather than hidden:
 *
 *  - **We are not a customs broker.** The declaration says what is in the box and what it is worth; it is
 *    not a filing, and nobody here computes a tariff code. It is the honest input to whoever does.
 *  - **Duty is the IMPORTER'S.** The receiver settles it at the border or on collection; no duty or import
 *    tax moves through our books, exactly as no fiat does. That is what `incoterm: 'DDU'` records — one
 *    value today, present so the field exists the day a store wants to prepay duty for its buyer.
 *  - **The importer is referenced, not named.** We hold a hashed phone, not a name and address, and a real
 *    filing needs both. Recorded as a gap rather than faked with a half-identity.
 */

/** What a customs declaration cannot be built without, given as a human sentence per missing thing. */
export function declarationGaps(input: { items?: LineItem[]; declaredValue?: number }): string[] {
  const gaps: string[] = [];
  if (!input.items?.length) gaps.push('a list of what is in the parcel');
  if (!(typeof input.declaredValue === 'number' && Number.isFinite(input.declaredValue) && input.declaredValue > 0)) {
    gaps.push('what the goods are worth');
  }
  return gaps;
}

/** "Ankara shirt ×2, Kitenge scarf" — what a border officer reads, from what the store already typed. */
export function contentsLine(items: LineItem[]): string {
  return items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ');
}

/**
 * Build the declaration for a crossing, or refuse and say exactly what is missing.
 *
 * Refusing is the point. Before this, a shipment to another country could be minted with no contents and
 * no value, and the first anyone would learn of it is a parcel stopped at a post with nobody able to answer
 * for it. Better to be unable to sell the shipment than to sell one that cannot legally travel.
 */
export function declareFor(input: {
  crossings: BorderCrossing[];
  items?: LineItem[];
  declaredValue?: number;
  currency: string;
  exporterId: string;
  importerRef?: string;
  at: string;
  context: string; // what to tell the caller they are missing it FOR
}): CustomsDeclaration {
  const gaps = declarationGaps(input);
  if (gaps.length) {
    throw new GlosError(
      'CUSTOMS_INCOMPLETE',
      `${input.context} crosses a border, so it needs ${gaps.join(' and ')} before it can be sent`,
      { missing: gaps, crossings: input.crossings.map((c) => `${c.fromCountry}→${c.toCountry}`) },
    );
  }
  const items = input.items!;
  return {
    crossings: input.crossings,
    contents: contentsLine(items),
    itemCount: items.reduce((n, i) => n + (Number.isFinite(i.qty) ? i.qty : 0), 0),
    declaredValue: Math.round(input.declaredValue! * 100) / 100,
    currency: input.currency,
    exporterId: input.exporterId,
    importerRef: input.importerRef,
    incoterm: 'DDU', // duties are the importer's; nothing about them moves through our books
    declaredAt: input.at,
  };
}
