import { GlosError } from '../../foundation/http/glos-error';
import { NETWORK_JURISDICTION } from './pudo.config';

/**
 * Which country a SITE stands in — the fact a border is made of.
 *
 * The network could always say where a place was to within a few metres and could never say which country
 * it was in, because nothing ever asked: every shop and hub was contracted to `NETWORK_JURISDICTION` by
 * construction, so a shop in Addis Ababa came out belonging to the Kenyan sister. That is not a rounding
 * error — it is revenue, tax and liability booked in the wrong company, which is the single thing the
 * sister structure exists to prevent.
 *
 * A country is deliberately DECLARED rather than derived from the map pin. Reverse-geocoding a border
 * region is a guess, and this answer decides which company invoices; a guess is not good enough to sign a
 * contract with. So a site states its country, and the network refuses the ones it cannot lawfully operate
 * in — the same refusal `requireForJurisdiction` already makes, moved to where the site is created.
 *
 * Zones are unaffected and stay what they are: a delivery area inside a country, which corridors and hubs
 * are keyed to. A country is coarser than a zone and answers a different question — who bills, and where
 * the goods leave one customs territory for another.
 */

const ISO_ALPHA2 = /^[A-Za-z]{2}$/;

/**
 * Normalise a declared country code, refusing anything that is not ISO-3166 alpha-2.
 *
 * The refusal is for shape only. Whether the network can actually operate there is the entity registry's
 * question, and it is asked immediately afterwards at every call site — a well-formed code with no sister
 * behind it is a country we do not trade in yet, which is a different and much better error message.
 */
export function requireCountryCode(input?: string, fallback: string = NETWORK_JURISDICTION): string {
  const raw = input?.trim();
  if (!raw) return fallback;
  if (!ISO_ALPHA2.test(raw)) throw new GlosError('INVALID_INPUT', `"${raw}" is not a country — use its two-letter code (KE, ET)`);
  return raw.toUpperCase();
}

/**
 * The country a site sits in.
 *
 * Every record written before sites carried one is silently in this deployment's home country, which was
 * the truth at the time — one jurisdiction, every site inside it. Defaulting HERE rather than backfilling
 * the store means an old record and a new one answer the same question the same way, forever.
 */
export function countryOfSite(site: { country?: string }): string {
  const raw = site.country?.trim();
  return raw ? raw.toUpperCase() : NETWORK_JURISDICTION;
}

/** One leg of a journey that leaves one country for another. */
export interface BorderCrossing {
  /** Index into the leg list — the leg on which the goods cross. A crossing happens ON THE ROAD, never
   *  at a stop: it is the driving between two places in different countries that has to clear a border. */
  legIndex: number;
  from: string;
  to: string;
  fromCountry: string;
  toCountry: string;
}

/**
 * The border crossings on a route, read off consecutive stops.
 *
 * Derived rather than stored, for the same reason a leg's distance is: it is a consequence of where the
 * stops are, and a stored copy would be one more thing that can disagree with the route it describes.
 */
export function crossingsOn(stops: Array<{ label: string; country: string }>): BorderCrossing[] {
  const crossings: BorderCrossing[] = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const from = stops[i];
    const to = stops[i + 1];
    if (from.country === to.country) continue;
    crossings.push({ legIndex: i, from: from.label, to: to.label, fromCountry: from.country, toCountry: to.country });
  }
  return crossings;
}
