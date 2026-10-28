import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'node:crypto';
import { GeoPoint } from './pudo.types';
import { lookupPlace } from './geo-gazetteer';
import { weekOf } from './fleet-site.service';
import type { SiteWeek } from './fleet-site.types';

/**
 * What a site is FOR — and these three are the CHAIN a container travels, which is why there are three.
 *
 *   port       where the vessel puts it down     (Djibouti)
 *   clearance  where the customs entry is made   (Modjo, Nazareth, Addis Ababa)
 *   delivery   where it is finally handed over   (the importer's yard)
 *
 * The middle one is the addition, and the user's question is what produced it: "for the reefer the
 * destination is Djibouti, for clearance it may be nazareth or addis ababa. different location,
 * different legs and the expeditor needs to know this." Quite so — for a landlocked import the box
 * moves inland under bond and clears at a dry port, and a model with one "port" on it cannot say that.
 */
/** `loading`: where an export box is stuffed — the exporter's own warehouse or yard (2026-10-27). */
export const SITE_KINDS = ['port', 'clearance', 'delivery', 'loading'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export interface Site {
  siteId: string;
  /** The company whose list this is. A site is nobody else's business and never a shared directory. */
  entityId: string;
  kind: SiteKind;
  name: string;
  location: GeoPoint;
  /** What somebody typed, when they gave an address rather than dropping a pin. Kept as they wrote it. */
  address?: string;
  /** How the point was arrived at — shown, because a resolved address and a dropped pin are not the same claim. */
  from: 'pin' | 'address';
  createdBy: string;
  createdAt: string;
  /**
   * WHEN GOODS ARE LOADED HERE, and how many trucks at once — the company's own word, for the carriers whose day plans
   * collect here. A place of its own only (a delivery place): a port's hours are the port's. Absent: it said neither.
   */
  loading?: SiteLoading;
  /**
   * INBOUND (reading A): this company receives goods here from its suppliers, who address a load to it by this code.
   * Absent: it does not receive here through SeeBuyGet. See SiteService.openReceiving.
   */
  receiving?: { code: string; since: string; by: string };
}

/** Letters and digits nobody mistakes for one another on a phone or a delivery note: no I, L, O, 0 or 1. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A receiving point's code: eight of them, written in two fours — "7KQ3-PX9M". */
export function receivingCode(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** A code as it compares: capitals, no spaces or dashes. Empty for something that cannot be one. */
export function normalisedCode(code: string): string {
  const plain = (code ?? '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{8}$/.test(plain) ? plain : '';
}

export interface SiteLoading {
  /** Open for loading, day by day. A day left out, or null, is closed. Absent: any hour. */
  hours?: SiteWeek;
  /** How many trucks load at once. Absent: not counted. */
  bays?: number;
  setAt: string;
  setBy: string;
}

export const SITE_BASIS =
  'Places this company has saved for itself. Nobody else can see this list, nothing here is checked by us, ' +
  'and a point resolved from an address is the middle of a place we know rather than a gate somebody stood at. ' +
  'The one exception: the loading hours and bays you give a place are read by the carriers whose plans collect there.';

/**
 * THE PLACES A COMPANY KEEPS — the ports it collects from, and the addresses it delivers to.
 *
 * WHY THIS EXISTS. Minting a road leg from a container asked for a port LATITUDE, a port LONGITUDE and a
 * delivery LABEL: three fields, two of which nobody knows off the top of their head and the third of
 * which is a sentence a driver has to interpret. The same port is used for every container a company
 * imports, so it was being typed — or mistyped — over and over, and the user's word for it was that it
 * was not consistent. It is not: one end was coordinates and the other was prose.
 *
 * A site is named ONCE and chosen after that. The name is what a person recognises, the point is what a
 * driver is routed to, and both travel onto the consignment note, where being right matters legally
 * rather than just operationally.
 *
 * TWO WAYS TO SAY WHERE, AND THEY ARE DIFFERENT CLAIMS. A dropped pin is somebody pointing at a place on
 * a map. An address resolved through the gazetteer is the CENTRE of a town or neighbourhood we know —
 * good enough to route a truck to the right part of a city, not good enough to call a gate. `from`
 * records which, and every screen that shows a site shows it, because a note that says "delivered to"
 * should not imply a precision nobody claimed.
 *
 * NOT A SHARED DIRECTORY. Every company keeps its own list. Ports are public facts and it is tempting to
 * pool them, but a pooled list is a list somebody else can put a wrong pin in, and the wrong pin sends a
 * truck to the wrong gate on a document with legal weight.
 */
@Injectable()
export class SiteService {
  private readonly sites = new PersistentMap<string, Site>('pudo-sites');

  /**
   * Save a place. A pin comes with its own point; an address is resolved through the gazetteer.
   *
   * Refuses a duplicate NAME within a company's list of that kind, rather than silently making a second
   * "Mombasa Port": two entries with one name is exactly the confusion this exists to end, and the fix a
   * person wants is to correct the one they have, not to acquire another.
   */
  declare(
    entityId: string,
    input: { kind: SiteKind; name: string; location?: GeoPoint; address?: string },
    by: string,
    now = Date.now(),
  ): Site {
    const name = (input.name ?? '').trim();
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Give the place a name you will recognise next time');
    if (!SITE_KINDS.includes(input.kind)) throw new GlosError('VALIDATION_FAILED', 'A site is a port, a place of clearance or a delivery place');

    const address = input.address?.trim();
    let location = input.location;
    let from: Site['from'] = 'pin';
    if (!location) {
      if (!address) throw new GlosError('FIELD_REQUIRED', 'Drop a pin or write an address — a place with neither cannot route a truck');
      const found = lookupPlace(address);
      if (!found) {
        throw new GlosError(
          'VALIDATION_FAILED',
          `We do not know "${address}" well enough to put it on a map. Drop a pin on it instead, which is a better answer anyway.`,
        );
      }
      location = found.entry.location;
      from = 'address';
    }
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) {
      throw new GlosError('VALIDATION_FAILED', 'That is not a place on this planet');
    }

    const clash = this.list(entityId, input.kind).find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new GlosError('CONFLICT', `You already have a place called "${clash.name}" on that list — change that one rather than keeping two`);

    const site: Site = {
      siteId: `site_${randomBytes(8).toString('hex')}`,
      entityId,
      kind: input.kind,
      name,
      location,
      ...(address ? { address } : {}),
      from,
      createdBy: by,
      createdAt: new Date(now).toISOString(),
    };
    this.sites.set(site.siteId, site);
    return site;
  }

  /** This company's own, ALPHABETICAL — never most-used-first, which would be a ranking of their own work. */
  list(entityId: string, kind?: SiteKind): Site[] {
    return [...this.sites.values()]
      .filter((s) => s.entityId === entityId && (!kind || s.kind === kind))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * WHEN GOODS ARE LOADED AT ONE OF THIS COMPANY'S PLACES: its hours day by day, and how many trucks at once. What is not
   * sent stays; null clears it. The company's own word — nobody else changes it, and nothing here is checked by us.
   */
  setLoading(entityId: string, siteId: string, input: { hours?: Record<string, { open: string; close: string } | null> | null; bays?: number | null }, by: string, now = Date.now()): Site {
    const site = this.require(entityId, siteId);
    if (site.kind !== 'delivery') throw new GlosError('INVALID_STATE', 'Only a place of your own keeps loading hours — a port or a place of clearance keeps its own');
    if (input.bays != null && !(Number.isInteger(input.bays) && input.bays >= 1 && input.bays <= 50)) throw new GlosError('VALIDATION_FAILED', 'Loading bays are a whole number from 1 to 50');
    const hours = input.hours === null ? undefined : input.hours !== undefined ? weekOf(input.hours) : site.loading?.hours;
    const bays = input.bays === null ? undefined : (input.bays ?? site.loading?.bays);
    const next: Site = { ...site };
    if (hours || bays) next.loading = { ...(hours ? { hours } : {}), ...(bays ? { bays } : {}), setAt: new Date(now).toISOString(), setBy: by };
    else delete next.loading;
    this.sites.set(siteId, next);
    return next;
  }

  /** This company's places that keep loading hours or bays — what a carrier's day plan reads, and nothing else of the list. */
  loadingPlaces(entityId: string): Array<Pick<Site, 'siteId' | 'name' | 'location'> & { loading: SiteLoading }> {
    return this.list(entityId, 'delivery')
      .filter((s) => s.loading)
      .map((s) => ({ siteId: s.siteId, name: s.name, location: s.location, loading: s.loading! }));
  }

  /* ------------------------------------------------- inbound, reading A: receiving points -- */

  /**
   * A PLACE OF ITS OWN WHERE THIS COMPANY RECEIVES GOODS from its suppliers (assessment.html, inbound reading A; the
   * user, 2026-10-25: "Yes, A then B"). Opening it gives the place a code; the company gives the code to its suppliers,
   * who write it as "deliver to" when they post a load, and that load is among what the company sees coming in. The
   * code NAMES the place and opens nothing (rule: an identifier opens nothing): whoever holds it learns the place's name
   * and where it is, which a supplier needs to send anything there, and reads nothing else of the company's.
   * Already open, it is left as it is.
   */
  openReceiving(entityId: string, siteId: string, by: string, now = Date.now()): Site {
    const site = this.require(entityId, siteId);
    if (site.kind !== 'delivery') throw new GlosError('INVALID_STATE', 'Goods are received at a place of your own — not at a port or a place of clearance');
    if (site.receiving) return site;
    return this.withCode(site, by, now);
  }

  /** A new code for a receiving point, when the old one went further than it should: the old one names nothing from now. */
  newReceivingCode(entityId: string, siteId: string, by: string, now = Date.now()): Site {
    const site = this.require(entityId, siteId);
    if (!site.receiving) throw new GlosError('INVALID_STATE', `${site.name} does not receive goods through SeeBuyGet: open it first`);
    return this.withCode(site, by, now);
  }

  /** It no longer receives here through us: the code names nothing. Loads already sent to it stay among what is coming. */
  closeReceiving(entityId: string, siteId: string): Site {
    const site = this.require(entityId, siteId);
    const next: Site = { ...site };
    delete next.receiving;
    this.sites.set(siteId, next);
    return next;
  }

  /** This company's receiving points, alphabetical. */
  receivingPoints(entityId: string): Site[] {
    return this.list(entityId, 'delivery').filter((s) => s.receiving);
  }

  /** The receiving point a code names — written as it was given, in any case, with or without its dash. */
  byReceivingCode(code: string): Site | undefined {
    const wanted = normalisedCode(code);
    if (!wanted) return undefined;
    return [...this.sites.values()].find((s) => s.receiving && normalisedCode(s.receiving.code) === wanted);
  }

  private withCode(site: Site, by: string, now: number): Site {
    let code = receivingCode();
    while (this.byReceivingCode(code)) code = receivingCode();
    const next: Site = { ...site, receiving: { code, since: new Date(now).toISOString(), by } };
    this.sites.set(site.siteId, next);
    return next;
  }

  /** One site, and only to the company that saved it. Anyone else is told it does not exist. */
  require(entityId: string, siteId: string): Site {
    const site = this.sites.get(siteId);
    if (!site || site.entityId !== entityId) throw new GlosError('NOT_FOUND', 'No such place on your list');
    return site;
  }
}
