import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AIRPORT_COUNTRY } from '../../foundation/carriage-law/air';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { EntityService } from '../../foundation/entity/entity.service';
import { sameSigner, type Signer } from '../../foundation/entity/same-person';
import { GlosError } from '../../foundation/http/glos-error';
import { PresenceService } from '../../foundation/presence/presence.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DirectoryService } from './directory.service';
import { MdpService } from './mdp.service';
import {
  BORDER_CONDITIONS,
  type BorderAirport,
  type BorderArrivalAirport,
  type BorderCarrier,
  type BorderDeparture,
  type BorderPrices,
  type BorderArrivalView,
  type BorderChange,
  type BorderClearer,
  type BorderCondition,
  type BorderFee,
  type BorderRouteState,
  type BorderRouteView,
  type BorderRoutesView,
  type BorderWarehouse,
  type ClearerKind,
} from './border-routes.types';

interface Route {
  from: string;
  to: string;
  state: BorderRouteState;
  proposedBy?: Signer;
  proposedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  /** 2026-11-18 — step 2a: where it leaves, who carries it, what the international leg costs. */
  departure?: BorderDeparture;
  carrier?: BorderCarrier;
  prices?: BorderPrices;
  /** 2026-11-18 — D16: the arrival airport it names. */
  arrival?: BorderArrivalAirport;
}

interface Arrival {
  country: string;
  open: string[];
  warehouses: Record<string, BorderWarehouse>;
  clearer?: BorderClearer;
  fee?: BorderFee;
}

/** What the console says when a condition is missing — the refusal names each one. */
const MISSING: Record<BorderCondition, (from: string, to: string) => string> = {
  'open-from': (f) => `${f} is not open to everyone yet`,
  'open-to': (_f, t) => `${t} is not open to everyone yet`,
  'sells-from': (f) => `no company of ours sells in ${f}, so the first legs cannot be priced or paid`,
  'sells-to': (_f, t) => `no company of ours stands in ${t} for the last leg and the clearance fee`,
  departure: (f) => `no departure airport and hub in ${f} are named for this route`,
  carrier: () => 'no carrier from the directory is named for this route',
  price: () => 'the route’s prices for a small, a medium and a large parcel are not set',
  clearer: (_f, t) => `nobody clears in ${t} yet: name a clearing agent who has accepted, or our company with its customs registration`,
  fee: (_f, t) => `the clearance fee in ${t} is not set`,
  airport: (_f, t) => `the route’s arrival airport in ${t} is not named, or not open with its licensed customs warehouse`,
};

const SHOWN_CHANGES = 40;
const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * 2026-11-18 — PARCELS ACROSS A BORDER, STEP 1: THE ROUTES ON THE CONSOLE (the plan, D1–D9 "As recommended").
 *
 * A route is switched on route by route — one country pair, one direction — off by default, by two people: one proposes,
 * a different one approves, and both are refused while anything it needs is missing, each thing by name. One person
 * switches it off at once; parcels already on the way finish their journey (step 2 holds to that).
 *
 * The arrival end is the country's, shared by every route into it: its airports, each blocked until staff open it and
 * never opened without a customs warehouse agreed there under a temporary-storage licence (the owner: "Schiphol yes,
 * Maastricht airport block"); who clears there — a clearing agent from the directory once it has accepted (step 4), or
 * our own company with its customs registration (D4); and our clearance fee there, in its company's money (D8).
 */
@Injectable()
export class BorderRouteService {
  private readonly routes = new PersistentMap<string, Route>('border-routes');
  private readonly arrivals = new PersistentMap<string, Arrival>('border-arrivals');
  private readonly changes = new PersistentMap<string, BorderChange & { id: string }>('border-route-changes');

  constructor(
    private readonly presence: PresenceService,
    private readonly entities: EntityService,
    private readonly mdps: MdpService,
    @Optional() private readonly directory?: DirectoryService,
  ) {}

  /* ------------------------------------------------------------------ reading -- */

  view(reader?: Signer, now: number = Date.now()): BorderRoutesView {
    const countries = new Set<string>([...this.arrivals.keys(), ...[...this.routes.values()].map((r) => r.to)]);
    return {
      routes: [...this.routes.values()].sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)).map((r) => this.routeView(r, reader, now)),
      arrivals: [...countries].sort().map((c) => this.arrivalView(c, now)),
      changes: [...this.changes.values()]
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, SHOWN_CHANGES)
        .map(({ id: _id, ...c }) => c),
    };
  }

  /** What a route still needs, in the order the console lists it; empty when it may be switched on. */
  missing(from: string, to: string, now: number = Date.now()): BorderCondition[] {
    return BORDER_CONDITIONS.filter((c) => !this.met(c, from, to, now));
  }

  /** Whether parcels may be booked on this route now (step 2 asks it). */
  isOn(from: string, to: string): boolean {
    return this.routes.get(key(from, to))?.state === 'on';
  }

  /** The airports a parcel into this country may arrive at: open, with a licensed warehouse (step 2 asks it). */
  openAirports(country: string, now: number = Date.now()): string[] {
    const a = this.arrivals.get(country);
    return a ? a.open.filter((code) => this.licensed(a.warehouses[code], now)) : [];
  }

  /* ------------------------------------------------------------------ a route -- */

  propose(fromCode: string, toCode: string, by: Signer, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const r = this.routes.get(key(from, to));
    if (r?.state === 'on') throw new GlosError('INVALID_STATE', `${from} to ${to} is already on`);
    if (r?.state === 'waiting') throw new GlosError('INVALID_STATE', `${from} to ${to} is already waiting for a second person`);
    this.refuseMissing(from, to, now);
    const route: Route = { ...(r ? setUp(r) : { from, to, state: 'off' as const }), state: 'waiting', proposedBy: by, proposedAt: new Date(now).toISOString() };
    this.routes.set(key(from, to), route);
    this.log({ what: 'propose', by: by.name, country: from, to }, now);
    return this.routeView(route, by, now);
  }

  approve(fromCode: string, toCode: string, by: Signer, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const r = this.routes.get(key(from, to));
    if (!r || r.state !== 'waiting') throw new GlosError('INVALID_STATE', `${from} to ${to} is not waiting for approval`);
    if (r.proposedBy && sameSigner(r.proposedBy, by)) throw new GlosError('FORBIDDEN', 'A route is switched on by two people: somebody else approves the one you proposed');
    // Asked again: something may have lapsed or closed since it was proposed.
    this.refuseMissing(from, to, now);
    const route: Route = { ...r, state: 'on', approvedBy: by.name, approvedAt: new Date(now).toISOString() };
    this.routes.set(key(from, to), route);
    this.log({ what: 'approve', by: by.name, country: from, to }, now);
    return this.routeView(route, by, now);
  }

  /** A proposal withdrawn or declined — by anybody, the proposer included. */
  decline(fromCode: string, toCode: string, by: Signer, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const r = this.routes.get(key(from, to));
    if (!r || r.state !== 'waiting') throw new GlosError('INVALID_STATE', `${from} to ${to} is not waiting for approval`);
    const route: Route = setUp(r);
    this.routes.set(key(from, to), route);
    this.log({ what: 'decline', by: by.name, country: from, to }, now);
    return this.routeView(route, by, now);
  }

  /** Off, by one person, at once. Parcels already on the way finish their journey. */
  switchOff(fromCode: string, toCode: string, by: Signer, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const r = this.routes.get(key(from, to));
    if (!r || r.state !== 'on') throw new GlosError('INVALID_STATE', `${from} to ${to} is not on`);
    const route: Route = setUp(r);
    this.routes.set(key(from, to), route);
    this.log({ what: 'off', by: by.name, country: from, to }, now);
    return this.routeView(route, by, now);
  }

  /* ------------------------------------------------------------------ the sending end (step 2a) -- */

  /** A route set up before it is proposed: off, with nothing named yet. Idempotent. */
  prepare(fromCode: string, toCode: string, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const r = this.routes.get(key(from, to)) ?? { from, to, state: 'off' as const };
    this.routes.set(key(from, to), r);
    return this.routeView(r, undefined, now);
  }

  /** Where the route leaves (D13): an airport in the sending country, and our approved hub there that hands parcels to the carrier. */
  setDeparture(fromCode: string, toCode: string, input: { airport: string; mdpId: string }, by: string, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const airport = this.airportOf(from, input.airport);
    const hub = this.mdps.find(input.mdpId);
    if (!hub) throw new GlosError('NOT_FOUND', 'No such hub', { field: 'mdpId' });
    if (this.mdps.countryOf(hub) !== from) throw new GlosError('INVALID_INPUT', `${hub.name} is not in ${from}: the parcels leave from a hub in the sending country`, { field: 'mdpId' });
    if (!this.mdps.isApproved(hub)) throw new GlosError('INVALID_STATE', `${hub.name} is not approved yet`, { field: 'mdpId' });
    return this.change(from, to, (r) => ({ ...r, departure: { airport, mdpId: hub.mdpId, name: hub.name, by, at: new Date(now).toISOString() } }), { what: 'departure', by, country: from, to, airport }, now);
  }

  /** Where the route arrives (D16): an airport in the arrival country. It counts once it is open with its licensed warehouse. */
  setArrival(fromCode: string, toCode: string, airportCode: string, by: string, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const airport = this.airportOf(to, airportCode);
    return this.change(from, to, (r) => ({ ...r, arrival: { airport, by, at: new Date(now).toISOString() } }), { what: 'arrival', by, country: from, to, airport }, now);
  }

  /** Who carries the international leg (D14): a forwarder or haulier from the directory. */
  setCarrier(fromCode: string, toCode: string, entityId: string, by: string, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const carrier = this.carriersIn(from).find((c) => c.id === entityId);
    if (!carrier) throw new GlosError('NOT_FOUND', `No forwarder or haulier by that name in ${from}'s directory`, { field: 'entityId' });
    return this.change(from, to, (r) => ({ ...r, carrier: { entityId: carrier.id, name: carrier.name, by, at: new Date(now).toISOString() } }), { what: 'carrier', by, country: from, to }, now);
  }

  /** The international leg's price per size (D10: air or road carriage uses a route price), in the sending company's money. */
  setPrices(fromCode: string, toCode: string, input: { S: number; M: number; L: number }, by: string, now: number = Date.now()): BorderRouteView {
    const [from, to] = this.pair(fromCode, toCode);
    const ours = this.entities.forJurisdiction(from);
    if (!ours?.currency) throw new GlosError('INVALID_STATE', `No company of ours sells in ${from} to set prices in its money`, { field: 'S' });
    const cents = (n: number, field: string) => {
      if (!Number.isFinite(n) || n <= 0) throw new GlosError('INVALID_INPUT', 'A price above nothing', { field });
      return Math.round(n * 100) / 100;
    };
    const prices: BorderPrices = { S: cents(input.S, 'S'), M: cents(input.M, 'M'), L: cents(input.L, 'L'), currency: ours.currency, by, at: new Date(now).toISOString() };
    return this.change(from, to, (r) => ({ ...r, prices }), { what: 'prices', by, country: from, to }, now);
  }

  /** The route as it is set up — for booking a parcel on it (step 2b). Undefined: no such route. */
  routeOf(from: string, to: string): Readonly<Pick<Route, 'from' | 'to' | 'state' | 'departure' | 'carrier' | 'prices' | 'arrival'>> | undefined {
    const r = this.routes.get(key(from, to));
    return r ? { from: r.from, to: r.to, state: r.state, ...(r.departure ? { departure: r.departure } : {}), ...(r.carrier ? { carrier: r.carrier } : {}), ...(r.prices ? { prices: r.prices } : {}), ...(r.arrival ? { arrival: r.arrival } : {}) } : undefined;
  }

  /** The customs warehouse hub at an airport, while its licence holds — where a parcel on the route waits for customs (step 2c). */
  warehouseAt(country: string, airport: string, now: number = Date.now()): BorderWarehouse | undefined {
    const w = this.arrivals.get(country)?.warehouses[airport];
    return this.licensed(w, now) ? w : undefined;
  }

  /**
   * A route on is changed only by switching it off first: what parcels were booked on stays what they were promised,
   * and a changed route is asked again by two people.
   */
  private change(from: string, to: string, apply: (r: Route) => Route, entry: Omit<BorderChange, 'at'>, now: number): BorderRouteView {
    const r = this.routes.get(key(from, to)) ?? { from, to, state: 'off' as const };
    if (r.state !== 'off') throw new GlosError('INVALID_STATE', `${from} to ${to} is ${r.state === 'on' ? 'on' : 'waiting for approval'}: switch it off or withdraw it before changing it`);
    const next = apply(r);
    this.routes.set(key(from, to), next);
    this.log(entry, now);
    return this.routeView(next, undefined, now);
  }

  private carriersIn(country: string): Array<{ id: string; name: string }> {
    if (!this.directory) return [];
    return this.entities
      .companies()
      .filter((e) => e.kind === 'business' && e.jurisdiction === country && e.status !== 'draft' && this.directory!.kindsOfCompany(e).some((k) => k === 'forwarder' || k === 'haulier'))
      .map((e) => ({ id: e.entityId, name: e.name }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  /* ------------------------------------------------------------------ the arrival end -- */

  /** An airport opened or blocked (the owner: "Schiphol yes, Maastricht airport block"). Never opened without a licensed warehouse. */
  setAirport(countryCode: string, airportCode: string, open: boolean, by: string, now: number = Date.now()): BorderArrivalView {
    const country = this.country(countryCode);
    const code = this.airportOf(country, airportCode);
    const a = this.arrival(country);
    if (open && !this.licensed(a.warehouses[code], now)) {
      throw new GlosError('INVALID_STATE', `${code} is opened only with a customs warehouse agreed there under a temporary-storage licence that has not run out`, { field: 'warehouse' });
    }
    const was = a.open.includes(code);
    if (was === open) return this.arrivalView(country, now);
    this.arrivals.set(country, { ...a, open: open ? [...a.open, code].sort() : a.open.filter((c) => c !== code) });
    this.log({ what: open ? 'airport-open' : 'airport-block', by, country, airport: code }, now);
    return this.arrivalView(country, now);
  }

  /** The customs warehouse agreed at an airport: one of our approved hubs in that country, with its licence and the agreement. */
  setWarehouse(countryCode: string, airportCode: string, input: { mdpId: string; tstLicence: string; validUntil?: string; agreement: string }, by: string, now: number = Date.now()): BorderArrivalView {
    const country = this.country(countryCode);
    const code = this.airportOf(country, airportCode);
    const hub = this.mdps.find(input.mdpId);
    if (!hub) throw new GlosError('NOT_FOUND', 'No such hub', { field: 'mdpId' });
    if (this.mdps.countryOf(hub) !== country) throw new GlosError('INVALID_INPUT', `${hub.name} is not in ${country}: the warehouse stands in the airport's country`, { field: 'mdpId' });
    if (!this.mdps.isApproved(hub)) throw new GlosError('INVALID_STATE', `${hub.name} is not approved yet`, { field: 'mdpId' });
    if (input.validUntil && input.validUntil < day(now)) throw new GlosError('INVALID_INPUT', 'That licence has already run out', { field: 'validUntil' });
    const a = this.arrival(country);
    const warehouse: BorderWarehouse = {
      mdpId: hub.mdpId,
      name: hub.name,
      tstLicence: input.tstLicence.trim(),
      ...(input.validUntil ? { validUntil: input.validUntil } : {}),
      agreement: input.agreement.trim(),
      by,
      at: new Date(now).toISOString(),
    };
    this.arrivals.set(country, { ...a, warehouses: { ...a.warehouses, [code]: warehouse } });
    this.log({ what: 'warehouse', by, country, airport: code }, now);
    return this.arrivalView(country, now);
  }

  /**
   * Who clears in this country (D4): a clearing agent from the directory — counted only once it accepts, on its own side
   * (step 4) — or our own company there, with its registration as a customs representative.
   */
  setClearer(countryCode: string, input: { kind: ClearerKind; entityId?: string; registration?: string }, by: string, now: number = Date.now()): BorderArrivalView {
    const country = this.country(countryCode);
    const a = this.arrival(country);
    let clearer: BorderClearer;
    if (input.kind === 'company') {
      const ours = this.entities.forJurisdiction(country);
      if (!ours) throw new GlosError('INVALID_STATE', `No company of ours stands in ${country}`, { field: 'kind' });
      if (!input.registration?.trim()) throw new GlosError('FIELD_REQUIRED', 'Our company clears only with its registration as a customs representative', { field: 'registration' });
      clearer = { kind: 'company', entityId: ours.entityId, name: ours.name, registration: input.registration.trim(), acceptedAt: new Date(now).toISOString(), by, at: new Date(now).toISOString() };
    } else {
      const agent = input.entityId ? this.entities.find(input.entityId) : undefined;
      if (!agent || !this.agentsIn(country).some((o) => o.id === agent.entityId)) throw new GlosError('NOT_FOUND', `No clearing agent by that name in ${country}'s directory`, { field: 'entityId' });
      // Named again: the earlier acceptance was for whoever was named then.
      clearer = { kind: 'agent', entityId: agent.entityId, name: agent.name, by, at: new Date(now).toISOString() };
    }
    this.arrivals.set(country, { ...a, clearer });
    this.log({ what: 'clearer', by, country }, now);
    return this.arrivalView(country, now);
  }

  /** The agent named for a country accepts it — its own act, on its side (step 4 gives it the screen). */
  acceptAsClearer(countryCode: string, entityId: string, now: number = Date.now()): BorderArrivalView {
    const country = this.country(countryCode);
    const a = this.arrival(country);
    if (!a.clearer || a.clearer.kind !== 'agent' || a.clearer.entityId !== entityId) throw new GlosError('FORBIDDEN', `You are not the clearing agent named for ${country}`);
    this.arrivals.set(country, { ...a, clearer: { ...a.clearer, acceptedAt: new Date(now).toISOString() } });
    this.log({ what: 'clearer-accepted', by: a.clearer.name, country }, now);
    return this.arrivalView(country, now);
  }

  /** Our clearance fee in this country (D8), in its company's money, shown to the receiver before they pay. */
  setFee(countryCode: string, amount: number, by: string, now: number = Date.now()): BorderArrivalView {
    const country = this.country(countryCode);
    const ours = this.entities.forJurisdiction(country);
    if (!ours?.currency) throw new GlosError('INVALID_STATE', `No company of ours stands in ${country} to set a fee in its money`, { field: 'amount' });
    if (!Number.isFinite(amount) || amount <= 0) throw new GlosError('INVALID_INPUT', 'A fee above nothing', { field: 'amount' });
    const a = this.arrival(country);
    this.arrivals.set(country, { ...a, fee: { amount: Math.round(amount * 100) / 100, currency: ours.currency, by, at: new Date(now).toISOString() } });
    this.log({ what: 'fee', by, country }, now);
    return this.arrivalView(country, now);
  }

  /* ------------------------------------------------------------------ inside -- */

  private met(c: BorderCondition, from: string, to: string, now: number): boolean {
    const a = this.arrivals.get(to);
    switch (c) {
      case 'open-from':
        return this.openToEveryone(from);
      case 'open-to':
        return this.openToEveryone(to);
      case 'sells-from':
        return Boolean(this.entities.forJurisdiction(from));
      case 'sells-to':
        return Boolean(this.entities.forJurisdiction(to));
      case 'departure':
        return Boolean(this.routes.get(key(from, to))?.departure);
      case 'carrier':
        return Boolean(this.routes.get(key(from, to))?.carrier);
      case 'price':
        return Boolean(this.routes.get(key(from, to))?.prices);
      case 'clearer':
        return Boolean(a?.clearer?.acceptedAt);
      case 'fee':
        return Boolean(a?.fee);
      case 'airport': {
        // D16: the airport this route names, open with its licensed warehouse — not just any airport in the country.
        const named = this.routes.get(key(from, to))?.arrival?.airport;
        return Boolean(named && this.openAirports(to, now).includes(named));
      }
    }
  }

  private openToEveryone(country: string): boolean {
    const can = this.presence.resolve(country).capabilities;
    return Boolean(can.signUp && can.takeIn) && !this.presence.testing(country);
  }

  private refuseMissing(from: string, to: string, now: number): void {
    const missing = this.missing(from, to, now);
    if (missing.length) throw new GlosError('INVALID_STATE', `${from} to ${to} cannot be switched on yet: ${missing.map((c) => MISSING[c](from, to)).join('; ')}`, { missing });
  }

  private licensed(w: BorderWarehouse | undefined, now: number): boolean {
    return Boolean(w && (!w.validUntil || w.validUntil >= day(now)));
  }

  private agentsIn(country: string): Array<{ id: string; name: string }> {
    if (!this.directory) return [];
    return this.entities
      .companies()
      .filter((e) => e.kind === 'business' && e.jurisdiction === country && e.status !== 'draft' && this.directory!.kindsOfCompany(e).includes('clearing_agent'))
      .map((e) => ({ id: e.entityId, name: e.name }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  private arrival(country: string): Arrival {
    return this.arrivals.get(country) ?? { country, open: [], warehouses: {} };
  }

  private arrivalView(country: string, now: number): BorderArrivalView {
    const a = this.arrival(country);
    const ours = this.entities.forJurisdiction(country);
    const airports: BorderAirport[] = Object.entries(AIRPORT_COUNTRY)
      .filter(([, c]) => c === country)
      .map(([code]) => ({
        code,
        open: a.open.includes(code) && this.licensed(a.warehouses[code], now),
        ...(a.warehouses[code] ? { warehouse: a.warehouses[code] } : {}),
        lapsed: Boolean(a.warehouses[code]) && !this.licensed(a.warehouses[code], now),
      }));
    return {
      country,
      airports,
      ...(a.clearer ? { clearer: a.clearer } : {}),
      ...(a.fee ? { fee: a.fee } : {}),
      ...(ours?.currency ? { currency: ours.currency } : {}),
      hubs: this.mdps
        .list()
        .filter((m) => this.mdps.countryOf(m) === country && this.mdps.isApproved(m))
        .map((m) => ({ id: m.mdpId, name: m.name }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      agents: this.agentsIn(country),
    };
  }

  private routeView(r: Route, reader: Signer | undefined, now: number): BorderRouteView {
    return {
      from: r.from,
      to: r.to,
      state: r.state,
      ...(r.proposedBy ? { proposedBy: r.proposedBy.name } : {}),
      ...(r.proposedAt ? { proposedAt: r.proposedAt } : {}),
      ...(r.approvedBy ? { approvedBy: r.approvedBy } : {}),
      ...(r.approvedAt ? { approvedAt: r.approvedAt } : {}),
      mine: Boolean(r.state === 'waiting' && r.proposedBy && reader && sameSigner(r.proposedBy, reader)),
      conditions: BORDER_CONDITIONS.map((c) => ({ key: c, met: this.met(c, r.from, r.to, now) })),
      ...(r.departure ? { departure: r.departure } : {}),
      ...(r.carrier ? { carrier: r.carrier } : {}),
      ...(r.prices ? { prices: r.prices } : {}),
      ...(r.arrival ? { arrival: r.arrival } : {}),
      arrivalAirports: Object.entries(AIRPORT_COUNTRY)
        .filter(([, c]) => c === r.to)
        .map(([code]) => code),
      departureAirports: Object.entries(AIRPORT_COUNTRY)
        .filter(([, c]) => c === r.from)
        .map(([code]) => code),
      departureHubs: this.mdps
        .list()
        .filter((m) => this.mdps.countryOf(m) === r.from && this.mdps.isApproved(m))
        .map((m) => ({ id: m.mdpId, name: m.name }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      carriers: this.carriersIn(r.from),
      ...(this.entities.forJurisdiction(r.from)?.currency ? { currency: this.entities.forJurisdiction(r.from)!.currency } : {}),
    };
  }

  private pair(fromCode: string, toCode: string): [string, string] {
    const from = this.country(fromCode);
    const to = this.country(toCode);
    if (from === to) throw new GlosError('INVALID_INPUT', 'A route crosses a border: two different countries', { field: 'to' });
    return [from, to];
  }

  private country(code: string): string {
    const entry = catalogueEntry(code);
    if (!entry) throw new GlosError('NOT_FOUND', `No such country: ${code}`);
    return entry.code;
  }

  private airportOf(country: string, airportCode: string): string {
    const code = String(airportCode ?? '').trim().toUpperCase();
    if (AIRPORT_COUNTRY[code] !== country) throw new GlosError('NOT_FOUND', `${code || 'That'} is not an airport we hold for ${country}`, { field: 'airport' });
    return code;
  }

  private log(c: Omit<BorderChange, 'at'>, now: number): void {
    const id = `brc_${now.toString(36)}_${randomBytes(4).toString('hex')}`;
    this.changes.set(id, { ...c, id, at: new Date(now).toISOString() });
  }
}

const key = (from: string, to: string) => `${from}-${to}`;

/** What a route is, without who switched it: kept when it is declined or switched off. */
const setUp = (r: Route): Route => ({ from: r.from, to: r.to, state: 'off', ...(r.departure ? { departure: r.departure } : {}), ...(r.carrier ? { carrier: r.carrier } : {}), ...(r.prices ? { prices: r.prices } : {}), ...(r.arrival ? { arrival: r.arrival } : {}) });
