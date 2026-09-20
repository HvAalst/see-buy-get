import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'node:crypto';
import { GeoPoint } from './pudo.types';
import { lookupPlace } from './geo-gazetteer';

/** What a site is FOR. The same object either way — a named place with a real point behind it. */
export const SITE_KINDS = ['port', 'delivery'] as const;
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
}

export const SITE_BASIS =
  'Places this company has saved for itself. Nobody else can see this list, nothing here is checked by us, ' +
  'and a point resolved from an address is the middle of a place we know rather than a gate somebody stood at.';

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
    if (!SITE_KINDS.includes(input.kind)) throw new GlosError('VALIDATION_FAILED', 'A site is a port or a delivery place');

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
    if (clash) throw new GlosError('CONFLICT', `You already have a ${input.kind === 'port' ? 'port' : 'place'} called "${clash.name}" — change that one rather than keeping two`);

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

  /** One site, and only to the company that saved it. Anyone else is told it does not exist. */
  require(entityId: string, siteId: string): Site {
    const site = this.sites.get(siteId);
    if (!site || site.entityId !== entityId) throw new GlosError('NOT_FOUND', 'No such place on your list');
    return site;
  }
}
