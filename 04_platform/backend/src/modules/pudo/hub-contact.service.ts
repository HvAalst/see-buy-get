import { Injectable, Optional } from '@nestjs/common';
import { HandleService } from '../../foundation/handle/handle.service';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { CONTACT_EMAIL, CONTACT_PHONE } from './contact-card.service';
import { clockAt, clocksOfCountry, minutesOf, zoneName } from './fleet-clock';
import { weekOf } from './fleet-site.service';
import { WEEKDAYS, type SiteWeek } from './fleet-site.types';
import type { HubAtStop, HubContact, HubContactView, HubOnPage, HubOpenNow } from './hub-contact.types';
import { MdpService } from './mdp.service';
import type { Mdp } from './pudo.types';

/** Said on every screen that shows a hub's entry. */
export const HUB_CONTACT_BASIS =
  'Written by the hub itself and published on its page — never verified by us: we do not ring the number or write to the address. The shape is checked; the choice is the hub’s.';

type Day = (typeof WEEKDAYS)[number];
const DAY_WORDS: Record<Day, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

/**
 * OPEN NOW, OR WHEN NEXT — on the hub's own clock, from the hours it keeps. Open from its opening until its closing;
 * closed, the next opening within the week: later today, or the next day it opens. Nothing where it keeps no hours or
 * no single clock can be said: a guess here sends a driver to a locked gate.
 */
export function openNowOf(week: SiteWeek | undefined, zone: string | undefined, now: number): HubOpenNow | undefined {
  if (!week || !zone) return undefined;
  const at = clockAt(now, zone);
  const today = new Date(`${at.day}T12:00:00Z`).getUTCDay();
  const hours = week[WEEKDAYS[today]];
  if (hours) {
    const from = minutesOf(hours.open) ?? 0;
    const to = minutesOf(hours.close) ?? 0;
    if (at.minutes >= from && at.minutes < to) return { open: true, until: hours.close };
    if (at.minutes < from) return { open: false, opensDay: WEEKDAYS[today], opensAt: hours.open, opensToday: true };
  }
  for (let i = 1; i <= 7; i += 1) {
    const day = WEEKDAYS[(today + i) % 7];
    const next = week[day];
    if (next) return { open: false, opensDay: day, opensAt: next.open, opensToday: false };
  }
  return { open: false };
}

/**
 * THE FIRST DAY ONE WEEK OF HOURS GOES OUTSIDE ANOTHER — a hub's hours for taking parcels in bulk against the hours it is
 * open: every day it receives must be a day it is open, from no earlier and until no later. Null where all of it fits.
 */
export function outsideOf(inner: SiteWeek, outer: SiteWeek): string | null {
  for (const day of WEEKDAYS) {
    const i = inner[day];
    if (!i) continue;
    const o = outer[day];
    if (!o) return `${DAY_WORDS[day]} — the hub is closed then`;
    if ((minutesOf(i.open) ?? 0) < (minutesOf(o.open) ?? 0) || (minutesOf(i.close) ?? 0) > (minutesOf(o.close) ?? 0)) return `${DAY_WORDS[day]} ${i.open}–${i.close} — the hub is open ${o.open}–${o.close}`;
  }
  return null;
}

@Injectable()
export class HubContactService {
  private readonly contacts = new PersistentMap<string, HubContact>('hub-contacts');

  constructor(
    private readonly mdps: MdpService,
    @Optional() private readonly handles?: HandleService,
  ) {}

  /** The hub's entry as it wrote it, or nothing yet. */
  of(mdpId: string): HubContact | undefined {
    return this.contacts.get(mdpId);
  }

  /** The opening hours it keeps, or none said. */
  openingHoursOf(mdpId: string): SiteWeek | undefined {
    return this.contacts.get(mdpId)?.openingHours;
  }

  /**
   * THE HUB WRITES ITS ENTRY — a merge: a field left out stays, an empty one goes, hours sent as null go. Each value
   * checked for its shape before anything is written; opening hours as a week of HH:MM, each day opening before it closes.
   */
  set(
    mdpId: string,
    patch: { openingHours?: Record<string, { open: string; close: string } | null> | null; phone?: string; phoneAlt?: string; askFor?: string; gate?: string; email?: string; publish?: boolean },
    by: string,
    now: number = Date.now(),
  ): HubContactView {
    const hub = this.mdps.require(mdpId);
    const was = this.contacts.get(mdpId);
    const next: HubContact = { ...(was ?? { mdpId }), mdpId, saidAt: new Date(now).toISOString(), saidBy: by };
    if (patch.openingHours === null) delete next.openingHours;
    else if (patch.openingHours !== undefined) {
      const week = weekOf(patch.openingHours);
      if (!WEEKDAYS.some((d) => week[d])) throw new GlosError('INVALID_INPUT', 'Give at least one day the hub is open — or clear its hours', { field: 'openingHours' });
      next.openingHours = week;
    }
    const put = (key: 'phone' | 'phoneAlt' | 'askFor' | 'gate' | 'email', raw: string | undefined, max: number, check?: (v: string) => boolean, why?: string) => {
      if (raw === undefined) return;
      const v = raw.trim().replace(/\s+/g, ' ');
      if (!v) return void delete next[key];
      if (v.length > max) throw new GlosError('INVALID_INPUT', `At most ${max} characters`, { field: key });
      if (check && !check(v)) throw new GlosError('INVALID_INPUT', why ?? 'Not in the right shape', { field: key });
      next[key] = v;
    };
    put('phone', patch.phone, 24, (v) => CONTACT_PHONE.test(v), 'A telephone number is digits, with an optional + in front — we check the shape and never dial it');
    put('phoneAlt', patch.phoneAlt, 24, (v) => CONTACT_PHONE.test(v), 'A telephone number is digits, with an optional + in front — we check the shape and never dial it');
    put('askFor', patch.askFor, 80);
    put('gate', patch.gate, 160);
    put('email', patch.email, 120, (v) => CONTACT_EMAIL.test(v), 'An email address has an @ and a domain');
    if (patch.publish !== undefined) {
      if (patch.publish) next.publish = true;
      else delete next.publish;
    }
    this.contacts.set(mdpId, next);
    return this.view(hub, now);
  }

  /** The hub's entry as anybody reads it: its own words, its hours and whether it is open now, its place and its page. */
  viewOf(mdpId: string, now: number = Date.now()): HubContactView {
    return this.view(this.mdps.require(mdpId), now);
  }

  /** The hub at a driver's stop, or in a store's hand-in: whether it is open now and how to reach somebody there. */
  atStop(mdpId: string, now: number = Date.now()): HubAtStop | undefined {
    let hub: Mdp;
    try {
      hub = this.mdps.require(mdpId);
    } catch {
      return undefined;
    }
    const c = this.contacts.get(mdpId);
    const zone = this.clockOf(hub, now);
    const openNow = openNowOf(c?.openingHours, zone, now);
    const handle = this.handles?.forId(hub.did)?.handle;
    return {
      mdpId: hub.mdpId,
      name: hub.name,
      ...(handle ? { handle } : {}),
      ...(c?.phone ? { phone: c.phone } : {}),
      ...(c?.askFor ? { askFor: c.askFor } : {}),
      ...(c?.gate ? { gate: c.gate } : {}),
      ...(c?.openingHours ? { openingHours: c.openingHours } : {}),
      ...(openNow ? { openNow } : {}),
    };
  }

  private view(hub: Mdp, now: number): HubContactView {
    const c = this.contacts.get(hub.mdpId);
    const zone = this.clockOf(hub, now);
    return {
      ...this.atStop(hub.mdpId, now)!,
      location: { lat: hub.location.lat, lng: hub.location.lng },
      ...(hub.address ? { address: hub.address } : {}),
      ...(c?.phoneAlt ? { phoneAlt: c.phoneAlt } : {}),
      ...(c?.email ? { email: c.email } : {}),
      ...(c?.publish ? { publish: true } : {}),
      ...(zone ? { zone, zoneName: zoneName(zone, now) } : {}),
      ...(c ? { saidAt: c.saidAt, saidBy: c.saidBy } : {}),
      basis: HUB_CONTACT_BASIS,
    };
  }

  /**
   * THE HUB ON ITS PUBLIC PAGE: its hours and whether it is open now, always — and its number and gate only where it
   * ticked that they go there. Nothing where it wrote nothing.
   */
  onPage(mdpId: string, now: number = Date.now()): HubOnPage | undefined {
    let hub: Mdp;
    try {
      hub = this.mdps.require(mdpId);
    } catch {
      return undefined;
    }
    const c = this.contacts.get(mdpId);
    if (!c) return undefined;
    const zone = this.clockOf(hub, now);
    const openNow = openNowOf(c.openingHours, zone, now);
    const shown = c.publish === true;
    const page: HubOnPage = {
      ...(c.openingHours ? { openingHours: c.openingHours } : {}),
      ...(openNow ? { openNow } : {}),
      ...(zone ? { zoneName: zoneName(zone, now) } : {}),
      ...(shown && c.phone ? { phone: c.phone } : {}),
      ...(shown && c.phoneAlt ? { phoneAlt: c.phoneAlt } : {}),
      ...(shown && c.askFor ? { askFor: c.askFor } : {}),
      ...(shown && c.gate ? { gate: c.gate } : {}),
      basis: HUB_CONTACT_BASIS,
    };
    return Object.keys(page).length > 1 ? page : undefined;
  }

  /** The hub's clock: its country's, where that country keeps one. */
  private clockOf(hub: Mdp, now: number): string | undefined {
    const clocks = clocksOfCountry(this.mdps.countryOf(hub), now);
    return clocks.length === 1 ? clocks[0] : undefined;
  }
}
