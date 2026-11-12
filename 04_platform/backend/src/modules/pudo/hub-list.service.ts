import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { ASIDE_DAYS, stillAside } from './hub-density';
import { HubDensityService } from './hub-density.service';
import type { HubSuggestion } from './hub-density.types';
import type { HubListView, HubRow, HubRowDto, HubRowNewDto } from './hub-list.types';
import { MdpService } from './mdp.service';
import type { GeoPoint, Mdp } from './pudo.types';

interface StoredRow {
  rowId: string;
  kind: 'place';
  source: 'optimiser' | 'staff';
  suggestionId?: string;
  code?: string;
  name?: string;
  address?: string;
  location?: GeoPoint;
  phone?: string;
  email?: string;
  status: 'open' | 'negotiating' | 'rejected';
  reason?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  /** The suggestion's score when it was rejected: back open once it doubles. */
  rejectedScore?: number;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

interface StoredList {
  entityId: string;
  rows: Record<string, StoredRow>;
}

/** The kinds of suggestion that are a place to recruit a hub (two stops too close is not). */
const PLACE_KINDS = new Set(['hub_needed', 'extra_hub', 'road_gap', 'bottleneck']);

/**
 * 2026-11-12 — A COUNTRY'S HUB LIST (the owner, on the plan "Hubs on the Road", D2: "The proposal is a list of hub places with
 * open fields … A fourth status, joined, is set automatically when a hub signs up through the row's invitation. Existing hubs
 * start as joined"; D7: "A suggestion becomes an open row"). One list per country: its hubs (joined), the places "where hubs
 * are needed" suggests (open until staff move them), and places staff add. Staff fill in a row's name, address or location,
 * phone and email, move it to negotiating or rejected (with why — back open after 90 days, or once its numbers double), and
 * send the invitation from it: the hub sign-up with the place filled in and the row's code. A hub that signs up with that code
 * makes the row joined, linked to it with the date — the system's, never staff's; a hub gone, the row is open again.
 */
@Injectable()
export class HubListService {
  private readonly store = new PersistentMap<string, StoredList>('pudo-hub-list');

  constructor(
    private readonly entities: EntityService,
    private readonly mdps: MdpService,
    private readonly density: HubDensityService,
  ) {}

  view(entityId: string, now: number = Date.now()): HubListView {
    const company = this.company(entityId);
    const country = company.jurisdiction!;
    const s = this.stored(company);
    const hubs = this.mdps.list().filter((m) => this.mdps.countryOf(m) === country);
    const byCode = new Map(hubs.filter((h) => h.inviteCode && !h.vetting?.refusal).map((h) => [h.inviteCode!, h]));
    const suggestions = this.density.view(company.entityId, now).suggestions.filter((x) => PLACE_KINDS.has(x.kind));
    const bySuggestion = new Map(suggestions.map((x) => [x.id, x]));
    const rows: HubRow[] = [];
    const linked = new Set<string>();
    // Places: every row kept, and every suggestion not kept yet.
    const kept = Object.values(s.rows);
    for (const row of kept) {
      const sug = row.suggestionId ? bySuggestion.get(row.suggestionId) : undefined;
      const hub = row.code ? byCode.get(row.code) : undefined;
      if (hub) linked.add(hub.mdpId);
      rows.push(this.rowOf(row, sug, hub, now));
    }
    for (const sug of suggestions) {
      if (kept.some((r) => r.suggestionId === sug.id)) continue;
      rows.push(this.suggestionRow(sug));
    }
    // The hubs it has: joined from the start (a hub that signed up through a row is that row).
    for (const h of hubs) {
      if (linked.has(h.mdpId) || !this.mdps.isApproved(h)) continue;
      rows.push({
        rowId: `hub:${h.mdpId}`,
        kind: 'hub',
        source: 'network',
        name: h.name,
        ...(h.address ? { address: h.address } : {}),
        location: h.location,
        status: 'joined',
        mdpId: h.mdpId,
        hubName: h.name,
        joinedAt: h.createdAt,
        zoneNames: [],
        hubNames: [],
        towns: [],
      });
    }
    const order: Record<string, number> = { negotiating: 0, open: 1, rejected: 2, joined: 3 };
    rows.sort((a, b) => order[a.status] - order[b.status] || (b.numbers?.shops ?? 0) - (a.numbers?.shops ?? 0) || (a.name ?? '').localeCompare(b.name ?? ''));
    const counts = { open: 0, negotiating: 0, rejected: 0, joined: 0 };
    for (const r of rows) counts[r.status] += 1;
    return { entityId: company.entityId, country, rows, counts };
  }

  /** Staff fill in a row's fields, and move it — never to joined, and a rejection with why. Logged. */
  update(entityId: string, rowId: string, dto: HubRowDto, by: string, now: number = Date.now()): HubListView {
    const company = this.company(entityId);
    const row = this.keep(company, rowId, by, now);
    if (dto.status === 'rejected' && !dto.reason?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say why it is rejected: it comes back as open after 90 days, or sooner if its numbers double', { field: 'reason' });
    const fields: Array<keyof StoredRow> = [];
    for (const k of ['name', 'address', 'phone', 'email'] as const) {
      if (dto[k] === undefined) continue;
      const v = dto[k]!.trim();
      if (v) row[k] = v;
      else delete row[k];
      fields.push(k);
    }
    if (dto.lat !== undefined && dto.lng !== undefined) {
      row.location = { lat: dto.lat, lng: dto.lng };
      fields.push('location');
    }
    const before = row.status;
    if (dto.status) {
      row.status = dto.status;
      if (dto.status === 'rejected') {
        row.reason = dto.reason!.trim();
        row.rejectedBy = by;
        row.rejectedAt = new Date(now).toISOString();
        row.rejectedScore = row.suggestionId ? this.density.view(company.entityId, now).suggestions.find((x) => x.id === row.suggestionId)?.score : undefined;
      } else {
        delete row.reason;
        delete row.rejectedBy;
        delete row.rejectedAt;
        delete row.rejectedScore;
      }
    }
    row.updatedBy = by;
    row.updatedAt = new Date(now).toISOString();
    const s = this.stored(company);
    s.rows[row.rowId] = row;
    this.save(s);
    const name = row.name ?? row.rowId;
    if (dto.status && dto.status !== before) this.entities.noteChange(company.entityId, { by, what: 'hubList', from: `${name}: ${before}`, to: dto.status === 'rejected' ? `rejected: ${row.reason}` : dto.status });
    else if (fields.length) this.entities.noteChange(company.entityId, { by, what: 'hubList', from: name, to: `${fields.join(', ')} filled in` });
    return this.view(entityId, now);
  }

  /** A hub place staff add themselves. Logged. */
  add(entityId: string, dto: HubRowNewDto, by: string, now: number = Date.now()): HubListView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const rowId = `row:${randomBytes(5).toString('hex')}`;
    const at = new Date(now).toISOString();
    s.rows[rowId] = {
      rowId,
      kind: 'place',
      source: 'staff',
      name: dto.name.trim(),
      ...(dto.address?.trim() ? { address: dto.address.trim() } : {}),
      ...(dto.lat !== undefined && dto.lng !== undefined ? { location: { lat: dto.lat, lng: dto.lng } } : {}),
      ...(dto.phone?.trim() ? { phone: dto.phone.trim() } : {}),
      ...(dto.email?.trim() ? { email: dto.email.trim() } : {}),
      status: 'open',
      createdAt: at,
      updatedBy: by,
      updatedAt: at,
    };
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'hubList', from: 'the hub list', to: `${dto.name.trim()} added` });
    return this.view(entityId, now);
  }

  /**
   * The invitation to join from a row: its code made (once), the row kept. The link is the console's to build: the hub sign-up
   * with the place and this code. Nothing is sent by the system — staff send it to the business they found.
   */
  invite(entityId: string, rowId: string, by: string, now: number = Date.now()): HubListView {
    const company = this.company(entityId);
    const row = this.keep(company, rowId, by, now);
    if (!row.code) {
      row.code = this.newCode();
      row.updatedBy = by;
      row.updatedAt = new Date(now).toISOString();
      const s = this.stored(company);
      s.rows[row.rowId] = row;
      this.save(s);
      this.entities.noteChange(company.entityId, { by, what: 'hubList', from: row.name ?? row.rowId, to: 'invitation to join made' });
    }
    return this.view(entityId, now);
  }

  /* ------------------------------------------------------------------ inside -- */

  /** A row as kept, or a suggestion made a kept row now; a hub of the network is the hub's own record, never staff's. */
  private keep(company: Entity, rowId: string, by: string, now: number): StoredRow {
    if (rowId.startsWith('hub:')) throw new GlosError('FORBIDDEN', 'A hub in the network keeps its own record: its name, address and contact are its own, and it is joined');
    const s = this.stored(company);
    const kept = s.rows[rowId];
    if (kept) {
      const v = this.view(company.entityId, now).rows.find((r) => r.rowId === rowId);
      if (v?.status === 'joined') throw new GlosError('INVALID_STATE', 'This row is joined: its hub signed up through its invitation. Joined is set by the system');
      return { ...kept };
    }
    if (rowId.startsWith('sug:')) {
      const sug = this.density.view(company.entityId, now).suggestions.find((x) => `sug:${x.id}` === rowId && PLACE_KINDS.has(x.kind));
      if (!sug) throw new GlosError('NOT_FOUND', 'That suggestion is no longer made: read the list again');
      const at = new Date(now).toISOString();
      return { rowId, kind: 'place', source: 'optimiser', suggestionId: sug.id, ...(sug.place.name ? { name: sug.place.name } : {}), location: { lat: sug.place.lat, lng: sug.place.lng }, status: 'open', createdAt: at, updatedBy: by, updatedAt: at };
    }
    throw new GlosError('NOT_FOUND', 'No such row in this country’s hub list');
  }

  private rowOf(row: StoredRow, sug: HubSuggestion | undefined, hub: Mdp | undefined, now: number): HubRow {
    // Rejected comes back open after 90 days, or once the suggestion's numbers doubled.
    const back = row.status === 'rejected' && !stillAside(row.rejectedAt ? { at: row.rejectedAt, score: row.rejectedScore ?? Number.MAX_SAFE_INTEGER } : undefined, sug?.score ?? 0, now);
    const status = hub ? 'joined' : back ? 'open' : row.status;
    return {
      rowId: row.rowId,
      kind: 'place',
      source: row.source,
      ...(sug ? { suggestionKind: sug.kind } : {}),
      ...(row.suggestionId ? { suggestionId: row.suggestionId } : {}),
      ...(row.code ? { code: row.code } : {}),
      ...(row.name ? { name: row.name } : {}),
      ...(row.address ? { address: row.address } : {}),
      ...(row.location ? { location: row.location } : {}),
      ...(row.phone ? { phone: row.phone } : {}),
      ...(row.email ? { email: row.email } : {}),
      status,
      ...(status === 'rejected' ? { reason: row.reason, rejectedBy: row.rejectedBy, rejectedAt: row.rejectedAt } : {}),
      ...(hub ? { mdpId: hub.mdpId, hubName: hub.name, joinedAt: hub.createdAt } : {}),
      ...(sug ? { numbers: sug.numbers } : {}),
      zoneNames: sug?.zoneNames ?? [],
      hubNames: sug?.hubNames ?? [],
      towns: sug?.towns ?? [],
      ...(row.suggestionId && !sug && !hub ? { stale: true } : {}),
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  private suggestionRow(sug: HubSuggestion): HubRow {
    return {
      rowId: `sug:${sug.id}`,
      kind: 'place',
      source: 'optimiser',
      suggestionKind: sug.kind,
      suggestionId: sug.id,
      ...(sug.place.name ? { name: sug.place.name } : {}),
      location: { lat: sug.place.lat, lng: sug.place.lng },
      status: 'open',
      numbers: sug.numbers,
      zoneNames: sug.zoneNames,
      hubNames: sug.hubNames,
      towns: sug.towns,
    };
  }

  /** A code no hub and no row has: six letters and digits, the easily confused left out. */
  private newCode(): string {
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const used = new Set<string>([...this.mdps.list().map((m) => m.inviteCode ?? ''), ...[...this.store.values()].flatMap((l) => Object.values(l.rows).map((r) => r.code ?? ''))]);
    for (;;) {
      const bytes = randomBytes(6);
      const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
      if (!used.has(code)) return code;
    }
  }

  private company(entityId: string): Entity {
    const company = this.entities.get(entityId);
    if (company.kind !== 'sister' || !company.jurisdiction) throw new GlosError('FORBIDDEN', `${company.name} does not run a country: the hub list belongs to the company that does`);
    return company;
  }

  private stored(company: Entity): StoredList {
    const s = this.store.get(company.entityId);
    return s ? { entityId: s.entityId, rows: { ...s.rows } } : { entityId: company.entityId, rows: {} };
  }

  private save(s: StoredList): void {
    this.store.set(s.entityId, s);
  }
}

/** How long a rejected row stays rejected before it is open again (the same 90 days a suggestion was set aside). */
export const HUB_ROW_REJECTED_DAYS = ASIDE_DAYS;
