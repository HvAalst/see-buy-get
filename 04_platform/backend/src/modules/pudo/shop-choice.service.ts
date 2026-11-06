import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { accountFor } from './addressed-to';
import { AgentService } from './agent.service';
import { DispatchService } from './dispatch.service';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import type { Parcel, ParcelStatus, Tote } from './pudo.types';
import { ToteService } from './tote.service';

/** A shop near a closed one a parcel could go to instead, and how far it is from the closed one. */
export interface ShopNear {
  did: string;
  name: string;
  km: number;
}

/**
 * A closed shop's parcels, offered other shops near it: a BAG's (it goes whole to the shop most of its buyers choose, when its
 * driver gets there), or ONE parcel not in a bag (it goes to the shop its buyer chooses, as soon as they choose).
 */
export interface ShopChoice {
  /** The bag's code — a bag's choice. */
  code?: string;
  /** One parcel not in a bag — its own choice. */
  parcelId?: string;
  /** The bag's trip (its filledAt): a bag is used again, and a choice is one trip's. */
  trip?: string;
  closed: { did: string; name: string };
  /** The driver who picked them; absent where SeeBuyGet offered them as the shop closed. */
  driverDid?: string;
  /** In order: the first is where it goes when nobody has chosen. */
  picks: ShopNear[];
  parcelIds: string[];
  /** Each parcel's buyer's choice: parcelId → a shop's did. */
  chosen: Record<string, string>;
  /** The driver found its door shut — the shop had not said it was closed. */
  shut?: boolean;
  askedAt: string;
  /** Where it went: the shop that took the bag, or the one its buyer chose for one parcel. */
  settled?: { did: string; name: string; at: string };
}

/** What the driver reads of it: where most buyers chose (the first pick where nobody has), and how many answered. */
export interface ShopChoiceForDriver {
  picks: ShopNear[];
  leading: { did: string; name: string; chose: number };
  answered: number;
  of: number;
  shut?: boolean;
  settled?: { did: string; name: string };
}

/** What a buyer reads of it, on their parcel. `inBag`: it goes where most of its bag's buyers choose. */
export interface ShopChoiceForBuyer {
  closed: string;
  picks: ShopNear[];
  inBag: boolean;
  chosen?: string;
  settled?: { did: string; name: string };
}

/** A parcel handed to a driver loose, as the driver reads it: the shop it goes to, closed or not, and its choice if asked. */
export interface LooseParcelForDriver {
  parcelId: string;
  destShop?: { did: string; name: string; closed: boolean };
  shopChoice?: ShopChoiceForDriver;
}

const MAX_PICKS = 3;
const NEAR_SHOWN = 8;
const SHUT_SHOWN_H = 24;
/** Offered as a shop closes, with no driver to say where they can go: shops this near it only. */
const OFFERED_WITHIN_KM = 15;
/** On its way to its shop: not yet ready to collect there. */
const ON_THE_WAY: ReadonlyArray<ParcelStatus> = ['Created', 'At_PUDO', 'At_MDP', 'On_Bus'];

const keyOf = (c: Pick<ShopChoice, 'code' | 'parcelId'>): string => c.code ?? `parcel:${c.parcelId}`;

/**
 * 2026-11-06 — A PARCEL ON ITS WAY TO A SHOP THAT IS CLOSED (the owner, point 6: "let a driver be able to search for a pudos
 * near to the closed shop so the buyer can select from his pick … fair for both driver and buyer. especially if the parcel
 * is in a bag he can't go all over the place to deliver these individual parcels"). Nothing moved such a parcel before.
 *
 * AS THE SHOP CLOSES (the owner: "ask straight away, less risk"): its buyers are asked at once which of the open shops near
 * it with room (three at most) they will collect from. A parcel not yet in a bag goes to the one its buyer chooses as soon
 * as they choose — its plan made again to it. A bag goes WHOLE to the one most of its buyers chose (the owner's choice),
 * when its driver gets there; nobody chose, the nearest.
 *
 * ON THE ROAD: the driver carrying a bag — or a parcel handed to them loose — for a shop that is closed, or found SHUT at
 * the door though it never said so, sees the open shops near it with room and picks up to three they can take it to. The
 * buyers choose until the driver gets there (the owner's choice); nobody chose, his first pick. Handed in at one of the
 * picks, it is that shop's — the step kept on each parcel's plan as "its shop closed". A shop found shut is told, and
 * operations see it for a day. The price never moves; the shop that takes it is paid as any (a detour's cost).
 */
@Injectable()
export class ShopChoiceService {
  private readonly choices = new PersistentMap<string, ShopChoice>('pudo-shop-choices');

  constructor(
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly totes: ToteService,
    private readonly mdps: MdpService,
    private readonly persons: PersonService,
    @Optional() private readonly dispatch?: DispatchService,
    @Optional() private readonly notifications?: NotificationService,
  ) {
    // Registered rather than asked for: the shop, hub, parcel and dispatch services are below this.
    agents.registerOnClose((did) => this.onShopClosed(did));
    mdps.registerShopChoice({ may: (code, did) => this.mayHandIn(code, did), settle: (code, did, now) => this.settle(code, did, now) });
    parcels.registerShopChoiceView((parcelId) => this.forBuyer(parcelId));
    parcels.registerShopChoiceArrive((parcelId, did) => this.arrivedAt(parcelId, did));
    dispatch?.registerShopChoiceView((code, holder) => this.forBag(code, holder));
  }

  /** Whether a shop takes parcels now: it has not said it is closed, and it takes new ones (not locked, held, lapsed or resting). */
  isClosed(did: string): boolean {
    const shop = this.agents.find(did);
    return !shop || shop.openState === 'closed' || !this.agents.takesNew(shop);
  }

  /* ---------------------------------------------------------------------------------------- as the shop closes -- */

  /**
   * A shop has said it is closed: each of its parcels on the way, offered the open shops near it with room — a bag's together,
   * one not in a bag on its own — and their buyers asked at once. Nothing where no shop near can take them (a driver finds
   * one on the road), nor where they were asked already. Answers how many parcels' buyers were asked.
   */
  onShopClosed(did: string, now: number = Date.now()): number {
    const shop = this.agents.find(did);
    if (!shop) return 0;
    const onTheWay = this.parcels.list().filter((p) => p.destAgentDid === did && ON_THE_WAY.includes(p.status));
    if (!onTheWay.length) return 0;
    const near = this.parcels.shopsWithRoom(shop, now, NEAR_SHOWN * 2).filter((s) => s.km <= OFFERED_WITHIN_KM);
    let asked = 0;
    const bags = new Map<string, Tote>();
    for (const p of onTheWay) {
      const bag = this.bagOf(p);
      if (bag) {
        bags.set(bag.code, bag);
        continue;
      }
      if (this.openFor(p.parcelId)) continue;
      const picks = near.filter((s) => this.parcels.shelfTakes(s.did, [p.parcelId])).slice(0, MAX_PICKS).map((s) => ({ did: s.did, name: s.shopName, km: s.km }));
      if (!picks.length) continue;
      this.open({ parcelId: p.parcelId, closed: { did, name: shop.shopName }, picks, parcelIds: [p.parcelId], chosen: {}, askedAt: new Date(now).toISOString() });
      asked += 1;
    }
    for (const bag of bags.values()) {
      if (this.liveChoice(bag.code)) continue;
      const picks = near.filter((s) => this.parcels.shelfTakes(s.did, bag.parcels)).slice(0, MAX_PICKS).map((s) => ({ did: s.did, name: s.shopName, km: s.km }));
      if (!picks.length) continue;
      this.open({ code: bag.code, ...(bag.filledAt ? { trip: bag.filledAt } : {}), closed: { did, name: shop.shopName }, picks, parcelIds: [...bag.parcels], chosen: {}, askedAt: new Date(now).toISOString() });
      asked += bag.parcels.length;
    }
    return asked;
  }

  /* --------------------------------------------------------------------------------------------- on the road -- */

  /**
   * The open shops near the one this driver's bag is going to, with room on their shelves for the whole bag — nearest first.
   * Only for the driver carrying it, and only a bag going to a shop.
   */
  near(code: string, driverDid: string, now: number = Date.now()): { closed: { did: string; name: string; marked: boolean }; shops: ShopNear[] } {
    const tote = this.carriedBy(code, driverDid);
    const dest = this.agents.find(tote.destinationNodeId ?? '');
    if (!dest) throw new GlosError('INVALID_STATE', `Bag ${code} goes to a hub, not a shop: a hub takes it whatever the hour`);
    return { closed: { did: dest.did, name: dest.shopName, marked: this.isClosed(dest.did) }, shops: this.nearFor(dest, tote.parcels, now) };
  }

  /** The same for a parcel handed to this driver loose: the open shops near its shop with a place for it. */
  nearParcel(parcelId: string, driverDid: string, now: number = Date.now()): { closed: { did: string; name: string; marked: boolean }; shops: ShopNear[] } {
    const parcel = this.handedLooseTo(parcelId, driverDid);
    const dest = this.agents.find(parcel.destAgentDid ?? '');
    if (!dest) throw new GlosError('INVALID_STATE', `Parcel ${parcelId} has no shop to go to`);
    return { closed: { did: dest.did, name: dest.shopName, marked: this.isClosed(dest.did) }, shops: this.nearFor(dest, [parcelId], now) };
  }

  /**
   * The driver's pick — one to three of the shops near — and its buyers asked which they will collect from. Refused before
   * anything is written where a pick is not one of the shops near, the shop is open and the driver does not say it is shut,
   * or its buyers were asked already. A shop found shut is told, and operations see it.
   */
  ask(code: string, driverDid: string, pickDids: string[], opts: { shut?: boolean } = {}, now: number = Date.now()): ShopChoiceForDriver {
    const { closed, shops } = this.near(code, driverDid, now);
    const picks = this.picksOf(pickDids, shops, closed, opts);
    if (this.liveChoice(code)) throw new GlosError('INVALID_STATE', 'Its buyers were asked already: take it to the shop most of them choose');
    const tote = this.totes.requireByCode(code);
    const choice = this.open({ code, ...(tote.filledAt ? { trip: tote.filledAt } : {}), closed: { did: closed.did, name: closed.name }, driverDid, picks, parcelIds: [...tote.parcels], chosen: {}, ...(opts.shut && !closed.marked ? { shut: true } : {}), askedAt: new Date(now).toISOString() });
    if (choice.shut) this.tellShopItWasShut(choice);
    return this.driverView(choice);
  }

  /** The same for a parcel handed to this driver loose. */
  askParcel(parcelId: string, driverDid: string, pickDids: string[], opts: { shut?: boolean } = {}, now: number = Date.now()): ShopChoiceForDriver {
    const { closed, shops } = this.nearParcel(parcelId, driverDid, now);
    const picks = this.picksOf(pickDids, shops, closed, opts);
    if (this.openFor(parcelId)) throw new GlosError('INVALID_STATE', 'Its buyer was asked already: take it to the shop they choose');
    const choice = this.open({ parcelId, closed: { did: closed.did, name: closed.name }, driverDid, picks, parcelIds: [parcelId], chosen: {}, ...(opts.shut && !closed.marked ? { shut: true } : {}), askedAt: new Date(now).toISOString() });
    if (choice.shut) this.tellShopItWasShut(choice);
    return this.driverView(choice);
  }

  /**
   * A buyer's choice, of the shops offered — until the bag is handed in. One parcel not in a bag goes to the shop chosen at
   * once (its plan made again to it); a bag's vote counts toward where the whole bag goes.
   */
  choose(parcelId: string, shopDid: string, by: string = 'buyer', now: number = Date.now()): ShopChoiceForBuyer {
    const choice = this.openFor(parcelId);
    if (!choice) throw new GlosError('INVALID_STATE', 'There is no choice of shop to make for this parcel now');
    const pick = choice.picks.find((p) => p.did === shopDid);
    if (!pick) throw new GlosError('INVALID_INPUT', 'Choose one of the shops offered', { field: 'shopDid' });
    choice.chosen[parcelId] = shopDid;
    if (choice.parcelId) {
      this.parcels.changePickupShop(parcelId, pick.did, by);
      choice.settled = { did: pick.did, name: pick.name, at: new Date(now).toISOString() };
    }
    this.choices.set(keyOf(choice), choice);
    return this.buyerView(choice, parcelId);
  }

  /** The parcels handed to this driver loose (not in a bag): each one's shop, closed or not, and its choice if asked. */
  looseFor(driverBadgeId: string | undefined): LooseParcelForDriver[] {
    return this.parcels.onBusWith(driverBadgeId).map((p) => {
      const dest = p.destAgentDid ? this.agents.find(p.destAgentDid) : undefined;
      const choice = this.openFor(p.parcelId);
      return { parcelId: p.parcelId, ...(dest ? { destShop: { did: dest.did, name: dest.shopName, closed: this.isClosed(dest.did) } } : {}), ...(choice ? { shopChoice: this.driverView(choice) } : {}) };
    });
  }

  /** Operations: shops a driver found shut in the last day. */
  shutReports(now: number = Date.now()): Array<{ did: string; name: string; at: string; code: string; parcels: number; to?: string }> {
    return [...this.choices.values()]
      .filter((c) => c.shut && now - Date.parse(c.askedAt) <= SHUT_SHOWN_H * 3_600_000)
      .map((c) => ({ did: c.closed.did, name: c.closed.name, at: c.askedAt, code: c.code ?? c.parcelId ?? '', parcels: c.parcelIds.length, ...(c.settled ? { to: c.settled.name } : {}) }));
  }

  /* ------------------------------------------------------------------------------------------- the hand-in -- */

  /** A bag addressed to a closed shop, handed in at one of its picks: may it be? (Asked before anything is written.) */
  private mayHandIn(code: string, agentDid: string): boolean {
    const choice = this.liveChoice(code);
    return Boolean(choice && choice.picks.some((p) => p.did === agentDid));
  }

  /**
   * Handed in there — after every other refusal: the bag addressed to that shop, and each parcel's pickup shop it, the step
   * kept on its plan as "its shop closed". The buyers who chose another shop told where it went.
   */
  private settle(code: string, agentDid: string, now: number = Date.now()): void {
    const choice = this.liveChoice(code);
    const pick = choice?.picks.find((p) => p.did === agentDid);
    if (!choice || !pick) return;
    this.totes.readdressCarried(code, pick.did, pick.name);
    for (const parcelId of this.totes.requireByCode(code).parcels) this.parcels.changePickupShop(parcelId, pick.did, choice.driverDid ?? 'system');
    choice.settled = { did: pick.did, name: pick.name, at: new Date(now).toISOString() };
    this.choices.set(keyOf(choice), choice);
    for (const [parcelId, did] of Object.entries(choice.chosen)) {
      if (did === pick.did) continue;
      this.tellBuyers(parcelId, {
        kind: 'parcel_shop_changed',
        title: `Your parcel went to ${pick.name}`,
        body: `Most of the buyers of the parcels in its bag chose ${pick.name}, so the whole bag went there. You are told when it is ready to collect.`,
        tag: `shop-changed:${parcelId}`,
      });
    }
  }

  /**
   * A parcel handed in loose at a shop other than its own (ParcelService.arrive, after its refusals): where that shop is one
   * offered it and nobody chose — the driver's first pick, or another of them — it is that shop's, the step kept as above.
   */
  private arrivedAt(parcelId: string, agentDid: string): void {
    const choice = this.openFor(parcelId);
    const pick = choice?.picks.find((p) => p.did === agentDid);
    if (!choice?.parcelId || !pick) return;
    this.parcels.changePickupShop(parcelId, pick.did, choice.driverDid ?? 'system');
    choice.settled = { did: pick.did, name: pick.name, at: new Date().toISOString() };
    this.choices.set(keyOf(choice), choice);
  }

  /* -------------------------------------------------------------------------------------------- the views -- */

  /** The driver's own bag in their claims: where it goes, whether that shop is closed, and its choice if asked. */
  private forBag(code: string, holder?: string): { destShop?: { did: string; name: string; closed: boolean }; shopChoice?: ShopChoiceForDriver } | undefined {
    const tote = this.totes.byCodeMaybe(code);
    const dest = tote?.destinationNodeId ? this.agents.find(tote.destinationNodeId) : undefined;
    if (!tote || !dest || !holder || tote.carriedBy !== holder) return undefined;
    const choice = this.liveChoice(code);
    return { destShop: { did: dest.did, name: dest.shopName, closed: this.isClosed(dest.did) }, ...(choice ? { shopChoice: this.driverView(choice) } : {}) };
  }

  /** A buyer's parcel: the choice open for it, or where it went. */
  private forBuyer(parcelId: string): ShopChoiceForBuyer | undefined {
    const open = this.openFor(parcelId);
    if (open) return this.buyerView(open, parcelId);
    const done = [...this.choices.values()].find((c) => c.parcelIds.includes(parcelId) && c.settled && this.parcels.get(parcelId).destAgentDid === c.settled.did);
    return done ? this.buyerView(done, parcelId) : undefined;
  }

  private driverView(choice: ShopChoice): ShopChoiceForDriver {
    const votes = new Map<string, number>();
    for (const did of Object.values(choice.chosen)) votes.set(did, (votes.get(did) ?? 0) + 1);
    // Most chose — the earlier of the picks on a tie; nobody chose, the first.
    const leading = choice.picks.reduce((best, p) => ((votes.get(p.did) ?? 0) > (votes.get(best.did) ?? 0) ? p : best), choice.picks[0]);
    return {
      picks: choice.picks,
      leading: { did: leading.did, name: leading.name, chose: votes.get(leading.did) ?? 0 },
      answered: Object.keys(choice.chosen).length,
      of: choice.parcelIds.length,
      ...(choice.shut ? { shut: true } : {}),
      ...(choice.settled ? { settled: { did: choice.settled.did, name: choice.settled.name } } : {}),
    };
  }

  private buyerView(choice: ShopChoice, parcelId: string): ShopChoiceForBuyer {
    return {
      closed: choice.closed.name,
      picks: choice.picks,
      inBag: Boolean(choice.code),
      ...(choice.chosen[parcelId] ? { chosen: choice.chosen[parcelId] } : {}),
      ...(choice.settled ? { settled: { did: choice.settled.did, name: choice.settled.name } } : {}),
    };
  }

  /* --------------------------------------------------------------------------------------------- inside -- */

  /** Kept, and its buyers asked in the app. */
  private open(choice: ShopChoice): ShopChoice {
    this.choices.set(keyOf(choice), choice);
    this.askBuyers(choice);
    return choice;
  }

  /** The open shops near a closed one with room for these parcels, nearest first. */
  private nearFor(dest: { did: string; location?: { lat: number; lng: number } }, parcelIds: string[], now: number): ShopNear[] {
    return this.parcels
      .shopsWithRoom(dest, now, NEAR_SHOWN * 2)
      .filter((s) => this.parcels.shelfTakes(s.did, parcelIds))
      .slice(0, NEAR_SHOWN)
      .map((s) => ({ did: s.did, name: s.shopName, km: s.km }));
  }

  /** The driver's pick, checked: one to three of the shops near; an open shop passed over only where found shut. */
  private picksOf(pickDids: string[], shops: ShopNear[], closed: { name: string; marked: boolean }, opts: { shut?: boolean }): ShopNear[] {
    const picks = [...new Set(pickDids)].map((did) => shops.find((s) => s.did === did));
    if (!picks.length || picks.length > MAX_PICKS) throw new GlosError('INVALID_INPUT', `Pick one to ${MAX_PICKS} shops`, { field: 'shopDids' });
    if (picks.some((p) => !p)) throw new GlosError('INVALID_STATE', 'A shop you picked cannot take this now — choose from the shops listed');
    if (!closed.marked && !opts.shut) throw new GlosError('INVALID_STATE', `${closed.name} is open: say it is shut if you found it so`);
    return picks as ShopNear[];
  }

  /** The bag, carried by this driver now — refused otherwise. */
  private carriedBy(code: string, driverDid: string): Tote {
    const tote = this.totes.requireByCode(code);
    if (tote.status !== 'in_transit' || tote.carriedBy !== driverDid) throw new GlosError('FORBIDDEN', `Bag ${code} is not on your vehicle`);
    return tote;
  }

  /** The parcel, handed to this driver loose — refused otherwise. */
  private handedLooseTo(parcelId: string, driverDid: string): Parcel {
    const parcel = this.parcels.get(parcelId);
    const leg = [...(parcel.custody ?? [])].reverse().find((l) => !l.to);
    if (parcel.status !== 'On_Bus' || parcel.toteId || leg?.holderKind !== 'driver' || leg.holderId !== driverDid) throw new GlosError('FORBIDDEN', `Parcel ${parcelId} is not in your hands`);
    return parcel;
  }

  /** The bag a parcel is in now, if any. */
  private bagOf(p: Parcel): Tote | undefined {
    if (!p.toteId) return undefined;
    try {
      const tote = this.totes.requireById(p.toteId);
      return tote.parcels.includes(p.parcelId) ? tote : undefined;
    } catch {
      return undefined;
    }
  }

  /** A bag's choice, on the trip the bag is on now and not yet handed in. */
  private liveChoice(code: string): ShopChoice | undefined {
    const choice = this.choices.get(code);
    if (!choice || choice.settled) return undefined;
    const tote = this.totes.byCodeMaybe(code);
    if (!tote || tote.status === 'free' || (choice.trip !== undefined && tote.filledAt !== choice.trip)) return undefined;
    return choice;
  }

  /** The open choice a parcel is in, if any: its bag's, or its own. */
  private openFor(parcelId: string): ShopChoice | undefined {
    const own = this.choices.get(`parcel:${parcelId}`);
    if (own && !own.settled) {
      const p = this.parcels.get(parcelId);
      if (ON_THE_WAY.includes(p.status) && p.destAgentDid === own.closed.did && !p.toteId) return own;
    }
    const bag = [...this.choices.values()].find((c) => c.code && c.parcelIds.includes(parcelId) && !c.settled);
    return bag?.code && this.liveChoice(bag.code) === bag && this.totes.requireByCode(bag.code).parcels.includes(parcelId) ? bag : undefined;
  }

  private askBuyers(choice: ShopChoice): void {
    const names = choice.picks.map((p) => p.name);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
    const who = choice.driverDid ? `The driver with your parcel can take it to ${list}` : `It can go to ${list} instead`;
    const then = choice.code ? 'The bag it is in goes to the shop most of its buyers choose.' : 'It goes to the one you choose.';
    for (const parcelId of choice.parcelIds) {
      this.tellBuyers(parcelId, {
        kind: 'parcel_choose_shop',
        title: 'Choose where to collect your parcel',
        body: `${choice.closed.name} is closed. ${who}: choose one. ${then}`,
        tag: `choose-shop:${parcelId}`,
      });
    }
  }

  /** Its receiver told, in the app (never a text). */
  private tellBuyers(parcelId: string, n: { kind: 'parcel_choose_shop' | 'parcel_shop_changed'; title: string; body: string; tag: string }): void {
    if (!this.notifications) return;
    let person: { personDid: string } | undefined;
    try {
      person = accountFor<{ personDid: string }>(this.parcels.receiverOf(this.parcels.get(parcelId)), this.persons);
    } catch {
      return;
    }
    if (!person) return;
    void this.notifications.notify(person.personDid, { ...n, link: `/?parcel=${parcelId}`, data: { parcelId } }).catch(() => undefined);
  }

  private tellShopItWasShut(choice: ShopChoice): void {
    const n = choice.parcelIds.length;
    void this.notifications
      ?.notify(choice.closed.did, {
        kind: 'shop_found_shut',
        title: 'A driver found your shop shut',
        body: `A driver came with ${choice.code ? `a bag of ${n} parcel${n === 1 ? '' : 's'}` : 'a parcel'} for you and found the door shut. ${n === 1 ? 'It goes' : 'They go'} to a shop near you instead, ${n === 1 ? 'its buyer' : 'their buyers'} choosing which. Say “Close for now” in the app when you close, and drivers know before they come.`,
        link: '/',
        tag: `shut:${choice.closed.did}:${choice.askedAt.slice(0, 13)}`,
        data: { ref: choice.code ?? choice.parcelId },
      })
      .catch(() => undefined);
  }
}
