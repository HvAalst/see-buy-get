import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { COUNTRY_CATALOGUE } from '../countries/catalogue';
import { kindsInUse, type RecordKind, type RowCountry } from './staff-country-sources';

/**
 * The countries one record touches: its own, or several (a load across a border, a parcel between two countries' shops).
 * `null` — there is no such record (the door then answers as it always did); `[]` — a record whose country is not known,
 * which only somebody who works in every country reaches.
 */
export type CountryResolver = (id: string) => string[] | null;

/**
 * 2026-11-01 — WHICH COUNTRIES A RECORD TOUCHES, by kind (staff-country-sources.ts names the kinds). Each kind is answered
 * by the service that keeps the record — registered at start-up (staff-country.resolvers.ts) — so this file knows no
 * record and no record learns about staff. A kind the declaration uses and nobody answers stops the server starting:
 * found at boot, not by a Kenya colleague reading the Netherlands' records.
 */
@Injectable()
export class StaffCountryRegistry implements OnApplicationBootstrap {
  private readonly resolvers = new Map<RecordKind, CountryResolver>();

  register(kind: RecordKind, resolver: CountryResolver): void {
    this.resolvers.set(kind, resolver);
  }

  /** The countries a record touches, upper-cased and each once; null when there is no such record. */
  countriesOf(kind: RecordKind, id: string | undefined): string[] | null {
    if (!id) return null;
    const resolver = this.resolvers.get(kind);
    if (!resolver) throw new Error(`No resolver for ${kind} records`);
    let found: string[] | null;
    try {
      found = resolver(id);
    } catch {
      // A getter that throws for a record it does not hold: no such record.
      return null;
    }
    return found === null ? null : [...new Set(found.filter(Boolean).map((c) => c.toUpperCase()))];
  }

  /** The countries a row of a list says it is in: a field, a currency, or a record it names. Null: none can be told. */
  rowCountries(row: unknown, how: RowCountry): string[] | null {
    if (!row || typeof row !== 'object') return null;
    if ('field' in how) {
      const fields = Array.isArray(how.field) ? how.field : [how.field];
      const values = fields.flatMap((f) => {
        const v = pick(row, f);
        return Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
      });
      return values.filter((v): v is string => typeof v === 'string').map((c) => c.toUpperCase());
    }
    if ('currency' in how) {
      const money = pick(row, how.currency);
      return typeof money === 'string' ? countriesPaying(money) : [];
    }
    const ids = Array.isArray(how.id) ? how.id : [how.id];
    const id = ids.map((f) => pick(row, f)).find((v): v is string => typeof v === 'string' && v.length > 0);
    return this.countriesOf(how.of, id);
  }

  onApplicationBootstrap(): void {
    const missing = kindsInUse().filter((kind) => !this.resolvers.has(kind));
    if (missing.length) throw new Error(`Staff are separated by country, and nothing answers which country these records are in: ${missing.join(', ')}`);
  }
}

/** The countries whose money a currency is — where a payment with no name on it is somebody's to chase. */
export function countriesPaying(currency: string): string[] {
  const wanted = currency.toUpperCase();
  return COUNTRY_CATALOGUE.filter((c) => c.currency === wanted).map((c) => c.code);
}

/** A field of a row by a dotted path (`payment.currency`). */
function pick(row: object, path: string): unknown {
  return path.split('.').reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), row);
}
