import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EntityService } from '../../foundation/entity/entity.service';
import { listedPublicly } from '../../foundation/entity/entity.types';
import type { Entity } from '../../foundation/entity/entity.types';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { HandleService } from '../../foundation/handle/handle.service';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { ContactCardService } from './contact-card.service';
import { DispatchService } from './dispatch.service';
import { FleetManagerService } from './fleet-manager.service';
import { ImportService } from './import.service';
import { SiteService } from './site.service';
import { HandleDirectory } from './handle-directory.service';
import { NotificationService } from './notification.service';
import type { FleetManager } from './fleet.types';
import { DIRECTORY_KINDS, type ContractAskView, type DirectoryChoiceView, type DirectorySearchView, type DirectoryContact, type DirectoryCountry, type DirectoryCountryView, type DirectoryEntry, type DirectoryIndex, type DirectoryKind, type DirectoryListingView } from './directory.types';

/**
 * The papers that say who a COMPANY is — named among its checks. Never a container's import papers, which are company
 * documents too but belong to one consignment and are nobody else's business.
 */
const COMPANY_PAPERS: ReadonlySet<string> = new Set(['certificate_of_incorporation', 'memorandum_and_articles', 'tax_registration_certificate', 'bank_confirmation', 'licence', 'insurance_policy', 'representative_id', 'beneficial_ownership', 'obligation_registration']);

/** Lower case, without accents — "Mombasa", "MOMBASA" and "Mombása" are one word to a search. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** A business asked a haulier for a carriage contract. */
interface ContractAsk {
  at: string;
  by: string;
}

/** How long before a business may ask the same haulier again, and how many hauliers it may ask in a day. */
const ASK_AGAIN_MS = 7 * 24 * 3_600_000;
const ASKS_A_DAY = 10;

/** A firm's own choices about the directory: off it, its line, and — for a fleet — the contact it shows. */
interface Listing {
  hidden?: boolean;
  words?: string;
  contact?: { phone?: string; email?: string; website?: string };
  by: string;
  at: string;
}

export const DIRECTORY_BASIS =
  'Logistics firms on SeeBuyGet whose papers our staff checked, in alphabetical order. Not a ranking: what each firm says of itself is its own word, shown beside what we have seen of its work on SeeBuyGet — most of any firm’s work never comes through us, so a short record is not a bad one. No membership of any association is shown or vouched for.';

/**
 * THE DIRECTORY (the user, 2026-10-30; memory decided-2026-10-30-directory) — built from what already exists rather than
 * from a registry of its own: a COMPANY is listed by what it does (a forwarder, a clearing agent — by its activity or by
 * being appointed — a container depot) once two of our staff checked its papers, which is when its public page exists
 * (`listedPublicly`); a FLEET is a haulier once it is active. Either may take itself off. Nothing is ranked.
 */
@Injectable()
export class DirectoryService {
  private readonly listings = new PersistentMap<string, Listing>('directory-listings');
  /** `<entityId>:<fleetDid>` → when the business asked that haulier for a contract. */
  private readonly asks = new PersistentMap<string, ContractAsk>('directory-contract-asks');

  constructor(
    private readonly entities: EntityService,
    private readonly handles: HandleService,
    private readonly managers: FleetManagerService,
    private readonly imports: ImportService,
    private readonly dispatch: DispatchService,
    private readonly documents: CompanyDocumentService,
    private readonly contacts: ContactCardService,
    private readonly sites: SiteService,
    @Optional() private readonly handleDirectory?: HandleDirectory,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /** What a company does that the directory lists: its activities, and being appointed to clear. */
  kindsOfCompany(e: Entity): DirectoryKind[] {
    const acts = e.business?.activities ?? [];
    const kinds: DirectoryKind[] = [];
    if (acts.includes('expeditor')) kinds.push('forwarder');
    // By its activity, by having been appointed, or by having said what it clears — the agent finder's own rule.
    if (acts.includes('clearing_agent') || this.imports.isAgent(e.entityId) || this.imports.offerOf(e.entityId)) kinds.push('clearing_agent');
    if (acts.includes('depot')) kinds.push('depot');
    return kinds;
  }

  /** A fleet is a haulier once it is active; never while it is checked, refused or suspended. */
  private fleetActive(m: FleetManager): boolean {
    return m.status === 'ACTIVE';
  }

  /** Every entry, alphabetical — the companies and the fleets that may be shown and did not take themselves off. */
  entries(): DirectoryEntry[] {
    return this.rows().map((r) => r.entry);
  }

  /** Every entry with the id behind it, alphabetical. */
  private rows(): Array<{ id: string; entry: DirectoryEntry }> {
    this.handleDirectory?.ensure();
    const out: Array<{ id: string; entry: DirectoryEntry }> = [];
    for (const e of this.entities.list()) {
      if (e.kind !== 'business' || !listedPublicly(e) || !e.jurisdiction) continue;
      const kinds = this.kindsOfCompany(e);
      if (!kinds.length || this.listings.get(e.entityId)?.hidden) continue;
      const entry = this.companyEntry(e, kinds);
      if (entry) out.push({ id: e.entityId, entry });
    }
    for (const m of this.managers.list()) {
      if (!this.fleetActive(m) || !m.jurisdiction || this.listings.get(m.did)?.hidden) continue;
      const entry = this.fleetEntry(m);
      if (entry) out.push({ id: m.did, entry });
    }
    return out.sort((a, b) => a.entry.name.localeCompare(b.entry.name, 'en', { sensitivity: 'base' }));
  }

  /**
   * THE DIRECTORY INSIDE THE APPS — the firms that do one of `kinds`, every country, alphabetical, each with its id, for a
   * business to appoint or to ask. The same entries as the public pages: a firm that took itself off is not offered. A
   * business never sees itself, and sees which hauliers it asked for a contract.
   */
  choose(kind: string, forEntityId?: string): DirectoryChoiceView {
    const kinds = (kind ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    const unknown = kinds.find((k) => !(DIRECTORY_KINDS as readonly string[]).includes(k));
    if (!kinds.length || unknown) throw new GlosError('VALIDATION_FAILED', `What the firm does: forwarder, clearing_agent, depot or haulier${unknown ? ` — not "${unknown}"` : ''}`, { field: 'kind' });
    const items = this.rows()
      .filter((r) => r.id !== forEntityId && r.entry.kinds.some((k) => kinds.includes(k)))
      .map((r) => {
        const asked = forEntityId ? this.asks.get(`${forEntityId}:${r.id}`) : undefined;
        return { ...r.entry, id: r.id, ...(asked ? { askedAt: asked.at } : {}) };
      });
    return { items, basis: DIRECTORY_BASIS };
  }

  /**
   * SEARCH ACROSS EVERY COUNTRY (the user, 2026-10-30: "search across countries is somehow mandatory"): every word must be
   * found somewhere on the entry — its name, its own line, what it says it clears and where, its country (by its code or
   * its name), what it does, its address — accents and case aside. Alphabetical, never ranked; at most a hundred shown.
   */
  search(q: string | undefined, kind: string | undefined): DirectorySearchView {
    const words = fold(q ?? '').split(/[^a-z0-9]+/).filter(Boolean);
    const kinds = (kind ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    const unknown = kinds.find((k) => !(DIRECTORY_KINDS as readonly string[]).includes(k));
    if (unknown) throw new GlosError('VALIDATION_FAILED', `What the firm does: forwarder, clearing_agent, depot or haulier — not "${unknown}"`, { field: 'kind' });
    if (!words.length && !kinds.length) throw new GlosError('VALIDATION_FAILED', 'Say what to look for: a few words, or what the firm does', { field: 'q' });
    const found = this.entries().filter((e) => {
      if (kinds.length && !e.kinds.some((k) => kinds.includes(k))) return false;
      if (!words.length) return true;
      const text = fold(
        [e.name, e.words ?? '', ...(e.says?.clears ?? []), ...(e.says?.places ?? []), e.country, catalogueEntry(e.country)?.name ?? '', ...e.kinds, e.contact?.address ?? ''].join(' ').replace(/_/g, ' '),
      );
      return words.every((w) => text.includes(w));
    });
    return { entries: found.slice(0, 100), total: found.length, basis: DIRECTORY_BASIS };
  }

  /** The business that asked this haulier for a contract through the directory — or nobody, where it did not. */
  askerOf(entityId: string, fleetDid: string): { entityId: string; did: string; name: string } | undefined {
    if (!this.asks.get(`${entityId}:${fleetDid}`)) return undefined;
    try {
      const e = this.entities.get(entityId);
      return { entityId: e.entityId, did: e.did, name: e.name };
    } catch {
      return undefined;
    }
  }

  /**
   * A BUSINESS ASKS A HAULIER FOR A CARRIAGE CONTRACT — found in the directory, told in the fleet's bell with where to
   * read who is asking. Nothing is agreed by asking: the fleet records a contract and sends the code, as ever. Asked by a
   * business our staff checked (the fleet must be able to read who it is), of a haulier in the directory; the same
   * haulier once a week, and at most ten a day — a bell is not a mailing list. Every refusal before anything is written.
   */
  async askContract(entityId: string, fleetDid: string, by: string, now = Date.now()): Promise<ContractAskView> {
    const e = this.entities.get(entityId);
    if (!listedPublicly(e)) throw new GlosError('INVALID_STATE', 'A haulier is asked by a business our staff have checked, so it can read who is asking. Yours is not checked yet.');
    const m = this.managers.list().find((x) => x.did === fleetDid);
    if (!m || !this.fleetActive(m) || this.listings.get(m.did)?.hidden) throw new GlosError('NOT_FOUND', 'No such haulier in the directory', { field: 'fleetDid' });
    const key = `${e.entityId}:${m.did}`;
    const before = this.asks.get(key);
    if (before && now - Date.parse(before.at) < ASK_AGAIN_MS) {
      throw new GlosError('INVALID_STATE', `You asked ${m.companyName} on ${before.at.slice(0, 10)}. You can ask again from ${new Date(Date.parse(before.at) + ASK_AGAIN_MS).toISOString().slice(0, 10)}.`);
    }
    const today = [...this.asks.entries()].filter(([k, a]) => k.startsWith(`${e.entityId}:`) && now - Date.parse(a.at) < 24 * 3_600_000).length;
    if (today >= ASKS_A_DAY) throw new GlosError('RATE_LIMITED', `You asked ${ASKS_A_DAY} hauliers today. Ask more tomorrow.`);
    const at = new Date(now).toISOString();
    this.asks.set(key, { at, by });
    const handle = this.handles.forId(e.entityId)?.handle;
    const where = catalogueEntry(e.jurisdiction)?.name;
    await this.notifications?.notify(m.did, {
      kind: 'contract_asked',
      title: `${e.name} asks to carry under a contract with you`,
      body: `${e.name}${where ? `, in ${where},` : ''} found you in the logistics directory and asks you to record a carriage contract with it, so its loads come straight to you rather than onto the open board.${handle ? ` Who it is, and how to reach it, are on its page: @${handle}.` : ''} To agree, record the contract from this notice, or under Orders › Contracts: it is offered to ${e.name} in its app, and an owner there accepts it — no code. Nothing is agreed until then.`,
      link: '/',
      data: { entityId: e.entityId, name: e.name, ...(handle ? { handle } : {}) },
    });
    return { fleetName: m.companyName, askedAt: at };
  }

  private companyEntry(e: Entity, kinds: DirectoryKind[]): DirectoryEntry | undefined {
    const handle = this.handles.forId(e.entityId)?.handle;
    if (!handle) return undefined;
    const listing = this.listings.get(e.entityId);
    const offer = kinds.includes('clearing_agent') ? this.imports.offerOf(e.entityId) : undefined;
    const record = kinds.includes('clearing_agent') && this.imports.isAgent(e.entityId) ? this.imports.agentRecord(e.entityId) : undefined;
    const arranged = kinds.includes('forwarder') ? this.dispatch.postedBy(e.did).filter((r) => r.status === 'delivered').length : 0;
    const card = this.contacts.of(e.entityId);
    const contact: DirectoryContact = {
      ...(card?.phone ? { phone: card.phone } : {}),
      ...(card?.email ? { email: card.email } : {}),
      ...(card?.website ? { website: card.website } : {}),
      ...(card?.address ? { address: card.address } : {}),
      ...(card?.hours ? { hours: card.hours } : {}),
    };
    const says = offer && (offer.specialisms.length || offer.places.length) ? { clears: [...offer.specialisms], places: [...offer.places] } : undefined;
    return {
      handle,
      name: e.name,
      kinds,
      country: e.jurisdiction!,
      since: e.business?.verification.verifiedAt ?? e.createdAt ?? new Date(0).toISOString(),
      ...(listing?.words ? { words: listing.words } : offer?.words ? { words: offer.words } : {}),
      ...(says ? { says } : {}),
      seen: { ...(record ? { appointed: record.appointed, cleared: record.cleared } : {}), ...(arranged ? { arranged } : {}) },
      checks: this.documents
        .list(e.entityId)
        .filter((d) => d.status === 'verified' && COMPANY_PAPERS.has(d.kind))
        .map((d) => ({ paper: d.kind, what: d.kind.replace(/_/g, ' '), at: (d.verifiedAt ?? d.uploadedAt).slice(0, 10) })),
      ...(Object.keys(contact).length ? { contact } : {}),
    };
  }

  private fleetEntry(m: FleetManager): DirectoryEntry | undefined {
    const handle = this.handles.forId(m.did)?.handle;
    if (!handle) return undefined;
    const listing = this.listings.get(m.did);
    const moves = this.dispatch.mobilisationFor(m.did);
    return {
      handle,
      name: m.companyName,
      kinds: ['haulier'],
      country: m.jurisdiction!,
      since: m.createdAt,
      ...(listing?.words ? { words: listing.words } : {}),
      seen: moves.delivered ? { delivered: moves.delivered } : {},
      checks: m.kyc ? [{ paper: 'fleet_papers', what: 'business registration, operator licence and the owner’s identity, put on record', at: m.kyc.submittedAt.slice(0, 10) }] : [],
      ...(listing?.contact && Object.keys(listing.contact).length ? { contact: { ...listing.contact } } : {}),
    };
  }

  /** The countries with firms listed, each with how many of each kind, and where to put its marker. */
  index(): DirectoryIndex {
    const byCountry = new Map<string, DirectoryEntry[]>();
    for (const e of this.entries()) byCountry.set(e.country, [...(byCountry.get(e.country) ?? []), e]);
    const countries: DirectoryCountry[] = [...byCountry.entries()]
      .map(([country, list]) => {
        const at = this.markerFor(list);
        const counts = Object.fromEntries(DIRECTORY_KINDS.map((k) => [k, list.filter((e) => e.kinds.includes(k)).length])) as Record<DirectoryKind, number>;
        return { country, name: catalogueEntry(country)?.name ?? country, total: list.length, ...counts, ...(at ? { at } : {}) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return { countries, basis: DIRECTORY_BASIS };
  }

  /** One country's page: its firms, alphabetical. A country with none is a real answer, not an error. */
  country(code: string): DirectoryCountryView {
    const country = (code ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new GlosError('VALIDATION_FAILED', 'A country by its two letters, like KE');
    return { country, name: catalogueEntry(country)?.name ?? country, entries: this.entries().filter((e) => e.country === country), basis: DIRECTORY_BASIS };
  }

  /** The middle of a country's firms' own pins (a fleet's yard, a company's places), rounded — never a firm's own spot. */
  private markerFor(list: DirectoryEntry[]): { lat: number; lng: number } | undefined {
    const pins: Array<{ lat: number; lng: number }> = [];
    for (const e of list) {
      const held = this.handles.list().find((h) => h.handle === e.handle);
      if (!held) continue;
      if (held.kind === 'fleet') {
        const m = this.managers.list().find((x) => x.did === held.id);
        if (m?.location) pins.push(m.location);
      } else {
        for (const s of this.sites.list(held.id)) if (s.location) pins.push(s.location);
      }
    }
    if (!pins.length) return undefined;
    const lat = pins.reduce((t, p) => t + p.lat, 0) / pins.length;
    const lng = pins.reduce((t, p) => t + p.lng, 0) / pins.length;
    return { lat: Math.round(lat * 10) / 10, lng: Math.round(lng * 10) / 10 };
  }

  /* --------------------------------------------------------------- a firm's own say -- */

  /** A company's place in the directory, as its people see it. */
  companyListing(entityId: string): DirectoryListingView {
    const e = this.entities.get(entityId);
    const kinds = this.kindsOfCompany(e);
    const listing = this.listings.get(e.entityId);
    const verified = listedPublicly(e);
    const eligible = verified && kinds.length > 0;
    const card = this.contacts.of(e.entityId);
    return {
      listed: eligible && !listing?.hidden,
      eligible,
      kinds,
      ...(listing?.words ? { words: listing.words } : {}),
      ...(card && (card.phone || card.email || card.website) ? { contact: { ...(card.phone ? { phone: card.phone } : {}), ...(card.email ? { email: card.email } : {}), ...(card.website ? { website: card.website } : {}) } } : {}),
      ...(!verified ? { why: 'Your business is shown once two of our staff have checked its papers.' } : !kinds.length ? { why: 'The directory lists forwarders, clearing agents, container depots and hauliers: say under Business details that you do one of these.' } : listing?.hidden ? { why: 'You took your business off the directory.' } : {}),
      ...(this.handles.forId(e.entityId) ? { handle: this.handles.forId(e.entityId)!.handle } : {}),
      ...(e.jurisdiction ? { country: e.jurisdiction } : {}),
      onMap: this.sites.list(e.entityId).some((s) => Boolean(s.location)),
    };
  }

  /** On or off, and its own line — an owner's to say. */
  setCompanyListing(entityId: string, input: { listed?: boolean; words?: string }, by: string, now = Date.now()): DirectoryListingView {
    const e = this.entities.get(entityId);
    const before = this.listings.get(e.entityId);
    // Left out is kept; an empty line clears it.
    const words = (input.words === undefined ? before?.words : input.words.trim().replace(/\s+/g, ' '))?.slice(0, 240);
    const hidden = input.listed === undefined ? before?.hidden === true : !input.listed;
    this.listings.set(e.entityId, { ...(hidden ? { hidden: true } : {}), ...(words ? { words } : {}), by, at: new Date(now).toISOString() });
    return this.companyListing(e.entityId);
  }

  /** A fleet's place in the directory. */
  fleetListing(did: string): DirectoryListingView {
    const m = this.managers.get(did);
    const listing = this.listings.get(m.did);
    const eligible = this.fleetActive(m);
    return {
      listed: eligible && !listing?.hidden,
      eligible,
      kinds: ['haulier'],
      ...(listing?.words ? { words: listing.words } : {}),
      ...(listing?.contact && Object.keys(listing.contact).length ? { contact: { ...listing.contact } } : {}),
      ...(!eligible ? { why: 'Your fleet is shown once our staff have checked its papers and it is active.' } : listing?.hidden ? { why: 'You took your fleet off the directory.' } : {}),
      ...(this.handles.forId(m.did) ? { handle: this.handles.forId(m.did)!.handle } : {}),
      ...(m.jurisdiction ? { country: m.jurisdiction } : {}),
      onMap: Boolean(m.location),
    };
  }

  /** On or off, its line, and the contact it ticks to show — the fleet office's to say. */
  setFleetListing(did: string, input: { listed?: boolean; words?: string; phone?: string; email?: string; website?: string }, by: string, now = Date.now()): DirectoryListingView {
    const m = this.managers.get(did);
    const before = this.listings.get(m.did);
    // What a save leaves out is kept (taking the fleet off keeps its line and contact for when it comes back); an empty value clears it.
    const kept = (given: string | undefined, had: string | undefined) => (given === undefined ? had : given.trim());
    const words = kept(input.words === undefined ? undefined : input.words.replace(/\s+/g, ' '), before?.words)?.slice(0, 240);
    const email = kept(input.email, before?.contact?.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new GlosError('VALIDATION_FAILED', 'That is not an email address', { field: 'email' });
    const website = kept(input.website, before?.contact?.website);
    const phone = kept(input.phone, before?.contact?.phone);
    if (website && !/^https?:\/\/[^\s]+\.[^\s]{2,}/.test(website)) throw new GlosError('VALIDATION_FAILED', 'A website starts with https://', { field: 'website' });
    const contact = { ...(phone ? { phone } : {}), ...(email ? { email } : {}), ...(website ? { website } : {}) };
    const hidden = input.listed === undefined ? before?.hidden === true : !input.listed;
    this.listings.set(m.did, { ...(hidden ? { hidden: true } : {}), ...(words ? { words } : {}), ...(Object.keys(contact).length ? { contact } : {}), by, at: new Date(now).toISOString() });
    return this.fleetListing(m.did);
  }
}
