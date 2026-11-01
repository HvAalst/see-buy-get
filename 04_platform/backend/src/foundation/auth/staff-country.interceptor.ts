import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { GlosError } from '../http/glos-error';
import type { IntrospectionResult } from './auth.types';
import { isStaffAccount } from './setup-key';
import { STAFF_AREAS } from './staff-areas.table';
import { countrySourceOf, type ListRule } from './staff-country-sources';
import { StaffCountryRegistry } from './staff-country.registry';
import { EVERY_COUNTRY, holdsEvery, reaches } from './staff-countries';
import { routeKeyOf } from './staff-roles';

/** The console's country picker: one of the reader's countries, for the lists they read. */
export const COUNTRY_PICKED_HEADER = 'x-sbg-country';

/** Where the countries of the record a member of staff opened are left on the request, for "What staff opened". */
export const RECORD_COUNTRIES = 'sbgRecordCountries';

/** Said for a record of a country the reader does not work in — the same words as for a record that does not exist. */
export const NO_SUCH_RECORD = 'Not found';

/**
 * 2026-11-01 — A MEMBER OF STAFF REACHES THE COUNTRIES THEY WORK IN (the owner: "those assigned to a country can not login
 * to any other country without the right credentials").
 *
 * On every request of a named member of staff, after the guard has let their ROLE through, this reads which COUNTRY the
 * door's record is in (staff-country-sources.ts) and holds it against the countries their sign-in carries:
 *  - one record of another country answers as one that does not exist — never "it exists, and it is not yours";
 *  - a list keeps the rows of their countries (and, with the console's picker, of the one picked);
 *  - a door of the network as a whole is for somebody who works in every country.
 * Somebody who works in every country passes untouched, unless the picker narrows a list for them.
 */
@Injectable()
export class StaffCountryInterceptor implements NestInterceptor {
  constructor(private readonly registry: StaffCountryRegistry) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request & { auth?: IntrospectionResult }>();
    const auth = request.auth;
    if (!auth || !isStaffAccount(auth)) return next.handle();
    const key = routeKeyOf(context.getHandler(), context.getClass());
    const area = key ? STAFF_AREAS[key] : undefined;
    // Not a staff door: the guard has already refused it to a member of staff.
    if (!key || !area || area === 'none') return next.handle();

    const held = auth.staffCountries;
    const every = holdsEvery(held);
    const source = countrySourceOf(key);
    // Nothing declared (staff-country-sources.spec.ts keeps this from shipping): every country only.
    if (!source) {
      if (every) return next.handle();
      throw new GlosError('FORBIDDEN', 'This is for staff who work in every country.');
    }
    if ('network' in source) return next.handle();
    if ('every' in source) {
      if (every) return next.handle();
      throw new GlosError('FORBIDDEN', `This is for staff who work in every country: ${source.every}.`);
    }
    if ('record' in source) {
      // Read for everybody on a reading door: "What staff opened" records the country of what was opened.
      if (every && request.method !== 'GET') return next.handle();
      const touched = this.registry.countriesOf(source.record, request.params?.[source.param]);
      // No such record: the door says so in its own words.
      if (touched === null) return next.handle();
      if (!every && !reaches(held, touched)) throw new GlosError('NOT_FOUND', NO_SUCH_RECORD);
      (request as unknown as Record<string, unknown>)[RECORD_COUNTRIES] = touched;
      return next.handle();
    }
    if ('country' in source) {
      if (every && request.method !== 'GET') return next.handle();
      const from = source.country === 'param' ? request.params : source.country === 'query' ? request.query : (request.body as Record<string, unknown> | undefined);
      const named = from?.[source.name];
      if (typeof named === 'string' && reaches(held, [named])) {
        (request as unknown as Record<string, unknown>)[RECORD_COUNTRIES] = [named.toUpperCase()];
        return next.handle();
      }
      throw new GlosError('NOT_FOUND', NO_SUCH_RECORD);
    }
    // A list: kept to the reader's countries — or to the one their picker names, which must be one of theirs.
    const scope = pickedScope(request.header(COUNTRY_PICKED_HEADER), held);
    if (!scope) return next.handle();
    return next.handle().pipe(map((body) => this.keep(body, source.list, scope)));
  }

  /** The rows of a response a reader working in `scope` sees. */
  private keep(body: unknown, rules: readonly ListRule[], scope: readonly string[]): unknown {
    const shown = (row: unknown, rule: ListRule): boolean => {
      const countries = this.registry.rowCountries(row, rule.row);
      if (countries === null) return false;
      // A row naming every country (a colleague who works in every country) is everybody's to see.
      if (countries.includes(EVERY_COUNTRY)) return true;
      return reaches(scope, countries);
    };
    let out = body;
    for (const rule of rules) {
      if (!rule.at) {
        if (Array.isArray(out)) out = out.filter((row) => shown(row, rule));
        continue;
      }
      if (!out || typeof out !== 'object' || Array.isArray(out)) continue;
      const copy = { ...(out as Record<string, unknown>) };
      const fields = rule.at === '*' ? Object.keys(copy).filter((k) => Array.isArray(copy[k])) : [rule.at];
      for (const field of fields) if (Array.isArray(copy[field])) copy[field] = (copy[field] as unknown[]).filter((row) => shown(row, rule));
      out = copy;
    }
    return out;
  }
}

/**
 * The countries a list is kept to: the one picked, when the reader works there (or everywhere); otherwise all of the
 * reader's — or none at all (null) for somebody who works in every country and picked nothing.
 */
export function pickedScope(picked: string | undefined, held: readonly string[] | undefined): readonly string[] | null {
  const one = picked?.trim().toUpperCase();
  if (one && /^[A-Z]{2}$/.test(one) && reaches(held, [one])) return [one];
  return holdsEvery(held) ? null : held!;
}
