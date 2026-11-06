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
import { ToteService } from './tote.service';

/** A shop near a closed one, a driver could take its bag to instead, and how far it is from the closed one. */
export interface ShopNear {
  did: string;
  name: string;
  km: number;
}

/** A bag on its way to a shop that is closed: the driver's pick of shops near it, and its buyers' choices. */
export interface ShopChoice {
  code: string;
  /** The bag's trip (its filledAt): a bag is used again, and a choice is one trip's. */
  trip?: string;
  closed: { did: string; name: string };
  driverDid: string;
  /** The driver's pick, in his order: the first is where it goes when nobody has chosen. */
  picks: ShopNear[];
  parcelIds: string[];
  /** Each parcel's buyer's choice: parcelId → a shop's did. */
  chosen: Record<string, string>;
  /** The driver found its door shut — the shop had not said it was closed. */
  shut?: boolean;
  askedAt: string;
  /** Handed in at one of the picks: the bag, and its parcels, that shop's. */
  settled?: { did: string; name: string; at: string };
}

/** What the driver reads of it: where most buyers chose (his first pick where nobody has), and how many answered. */
export interface ShopChoiceForDriver {
  picks: ShopNear[];
  leading: { did: string; name: string; chose: number };
  answered: number;
  of: number;
  shut?: boolean;
  settled?: { did: string; name: string };
}

/** What a buyer reads of it, on their parcel. */
export interface ShopChoiceForBuyer {
  closed: string;
  picks: ShopNear[];
  chosen?: string;
  settled?: { did: string; name: string };
}

const MAX_PICKS = 3;
const NEAR_SHOWN = 8;
const SHUT_SHOWN_H = 24;

/**
 * 2026-11-06 — A PARCEL ON ITS WAY TO A SHOP THAT IS CLOSED (the owner, point 6: "let a driver be able to search for a pudos
 * near to the closed shop so the buyer can select from his pick … fair for both driver and buyer. especially if the parcel
 * is in a bag he can't go all over the place to deliver these individual parcels"). Nothing moved such a parcel before: the
 * hub sorted to the closed shop, its bag stayed addressed to it, and no buyer could choose another.
 *
 * The driver carrying a bag for a shop that is closed — said closed, or not taking parcels; or found SHUT at the door though
 * it never said so — sees the open shops near it with room for the whole bag, and picks up to three he can take it to. Each
 * buyer of a parcel in it is asked, in their app, which of them they will collect from — until the driver gets there (the
 * owner's choice): nobody chose, his first pick. The WHOLE bag goes to one shop (the owner's choice): the one most chose,
 * which the driver sees as they choose; the buyers who chose another are told where it went. Handed in at one of his picks,
 * the bag and its parcels are that shop's — each step kept on the parcel's plan as "its shop closed". A shop found shut is
 * told, and operations see it for a day. The price never moves; the shop that takes them is paid as any (a detour's cost).
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
    // Registered rather than asked for: the hub, parcel and dispatch services are below this.
    mdps.registerShopChoice({ may: (code, did) => this.mayHandIn(code, did), settle: (code, did, now) => this.settle(code, did, now) });
    parcels.registerShopChoiceView((parcelId) => this.forBuyer(parcelId));
    dispatch?.registerShopChoiceView((code, holder) => this.forBag(code, holder));
  }

  /** Whether a shop takes parcels now: it has not said it is closed, and it takes new ones (not locked, held, lapsed or resting). */
  isClosed(did: string): boolean {
    const shop = this.agents.find(did);
    return !shop || shop.openState === 'closed' || !this.agents.takesNew(shop);
  }

  /**
   * The open shops near the one this driver's bag is going to, with room on their shelves for the whole bag — nearest first.
   * Only for the driver carrying it, and only a bag going to a shop.
   */
  near(code: string, driverDid: string, now: number = Date.now()): { closed: { did: string; name: string; marked: boolean }; shops: ShopNear[] } {
    const tote = this.carriedBy(code, driverDid);
    const dest = this.agents.find(tote.destinationNodeId ?? '');
    if (!dest) throw new GlosError('INVALID_STATE', `Bag ${code} goes to a hub, not a shop: a hub takes it whatever the hour`);
    const shops = this.parcels
      .shopsWithRoom(dest, now, NEAR_SHOWN * 2)
      .filter((s) => this.parcels.shelfTakes(s.did, tote.parcels))
      .slice(0, NEAR_SHOWN)
      .map((s) => ({ did: s.did, name: s.shopName, km: s.km }));
    return { closed: { did: dest.did, name: dest.shopName, marked: this.isClosed(dest.did) }, shops };
  }

  /**
   * The driver's pick — one to three of the shops near — and its buyers asked which they will collect from. Refused before
   * anything is written where a pick is not one of the shops near, or the shop is open and the driver does not say it is shut.
   * A shop found shut is told, and operations see it.
   */
  ask(code: string, driverDid: string, pickDids: string[], opts: { shut?: boolean } = {}, now: number = Date.now()): ShopChoiceForDriver {
    const { closed, shops } = this.near(code, driverDid, now);
    const picks = [...new Set(pickDids)].map((did) => shops.find((s) => s.did === did));
    if (!picks.length || picks.length > MAX_PICKS) throw new GlosError('INVALID_INPUT', `Pick one to ${MAX_PICKS} shops`, { field: 'shopDids' });
    if (picks.some((p) => !p)) throw new GlosError('INVALID_STATE', 'A shop you picked cannot take this bag now — choose from the shops listed');
    if (!closed.marked && !opts.shut) throw new GlosError('INVALID_STATE', `${closed.name} is open: say it is shut if you found it so`);
    const tote = this.totes.requireByCode(code);
    const at = new Date(now).toISOString();
    const choice: ShopChoice = {
      code,
      ...(tote.filledAt ? { trip: tote.filledAt } : {}),
      closed: { did: closed.did, name: closed.name },
      driverDid,
      picks: picks as ShopNear[],
      parcelIds: [...tote.parcels],
      chosen: {},
      ...(opts.shut && !closed.marked ? { shut: true } : {}),
      askedAt: at,
    };
    this.choices.set(code, choice);
    this.askBuyers(choice);
    if (choice.shut) this.tellShopItWasShut(choice);
    return this.driverView(choice);
  }

  /** A buyer's choice, of the shops the driver picked — until the bag is handed in. */
  choose(parcelId: string, shopDid: string): ShopChoiceForBuyer {
    const choice = this.openFor(parcelId);
    if (!choice) throw new GlosError('INVALID_STATE', 'There is no choice of shop to make for this parcel now');
    if (!choice.picks.some((p) => p.did === shopDid)) throw new GlosError('INVALID_INPUT', 'Choose one of the shops offered', { field: 'shopDid' });
    choice.chosen[parcelId] = shopDid;
    this.choices.set(choice.code, choice);
    return this.buyerView(choice, parcelId);
  }

  /** Operations: shops a driver found shut in the last day. */
  shutReports(now: number = Date.now()): Array<{ did: string; name: string; at: string; code: string; parcels: number; to?: string }> {
    return [...this.choices.values()]
      .filter((c) => c.shut && now - Date.parse(c.askedAt) <= SHUT_SHOWN_H * 3_600_000)
      .map((c) => ({ did: c.closed.did, name: c.closed.name, at: c.askedAt, code: c.code, parcels: c.parcelIds.length, ...(c.settled ? { to: c.settled.name } : {}) }));
  }

  /* ------------------------------------------------------------------------------------------- the hand-in -- */

  /** A bag addressed to a closed shop, handed in at one of its driver's picks: may it be? (Asked before anything is written.) */
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
    if (!choice) return;
    const pick = choice.picks.find((p) => p.did === agentDid);
    if (!pick) return;
    this.totes.readdressCarried(code, pick.did, pick.name);
    for (const parcelId of this.totes.requireByCode(code).parcels) this.parcels.changePickupShop(parcelId, pick.did, choice.driverDid);
    choice.settled = { did: pick.did, name: pick.name, at: new Date(now).toISOString() };
    this.choices.set(code, choice);
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

  /* -------------------------------------------------------------------------------------------- the views -- */

  /** The driver's own bag in their claims: where it goes, whether that shop is closed, and its choice if asked. */
  private forBag(code: string, holder?: string): { destShop?: { did: string; name: string; closed: boolean }; shopChoice?: ShopChoiceForDriver } | undefined {
    const tote = this.totes.byCodeMaybe(code);
    const dest = tote?.destinationNodeId ? this.agents.find(tote.destinationNodeId) : undefined;
    if (!tote || !dest || !holder || tote.carriedBy !== holder) return undefined;
    const choice = this.liveChoice(code);
    return { destShop: { did: dest.did, name: dest.shopName, closed: this.isClosed(dest.did) }, ...(choice ? { shopChoice: this.driverView(choice) } : {}) };
  }

  /** A buyer's parcel: the choice open for it (or settled), or nothing. */
  private forBuyer(parcelId: string): ShopChoiceForBuyer | undefined {
    const choice = [...this.choices.values()].find((c) => c.parcelIds.includes(parcelId) && (!c.settled || this.parcels.get(parcelId).destAgentDid === c.settled.did));
    return choice ? this.buyerView(choice, parcelId) : undefined;
  }

  private driverView(choice: ShopChoice): ShopChoiceForDriver {
    const votes = new Map<string, number>();
    for (const did of Object.values(choice.chosen)) votes.set(did, (votes.get(did) ?? 0) + 1);
    // Most chose — the earlier of his picks on a tie; nobody chose, his first.
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
      ...(choice.chosen[parcelId] ? { chosen: choice.chosen[parcelId] } : {}),
      ...(choice.settled ? { settled: { did: choice.settled.did, name: choice.settled.name } } : {}),
    };
  }

  /* --------------------------------------------------------------------------------------------- inside -- */

  /** The bag, carried by this driver now — refused otherwise. */
  private carriedBy(code: string, driverDid: string) {
    const tote = this.totes.requireByCode(code);
    if (tote.status !== 'in_transit' || tote.carriedBy !== driverDid) throw new GlosError('FORBIDDEN', `Bag ${code} is not on your vehicle`);
    return tote;
  }

  /** Its choice, asked on the trip the bag is on now and not yet handed in. */
  private liveChoice(code: string): ShopChoice | undefined {
    const choice = this.choices.get(code);
    if (!choice || choice.settled) return undefined;
    const tote = this.totes.byCodeMaybe(code);
    if (!tote || tote.status !== 'in_transit' || (choice.trip !== undefined && tote.filledAt !== choice.trip)) return undefined;
    return choice;
  }

  /** The open choice a parcel is in, if any. */
  private openFor(parcelId: string): ShopChoice | undefined {
    const choice = [...this.choices.values()].find((c) => c.parcelIds.includes(parcelId) && !c.settled);
    return choice && this.liveChoice(choice.code) === choice ? choice : undefined;
  }

  private askBuyers(choice: ShopChoice): void {
    const names = choice.picks.map((p) => p.name);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
    for (const parcelId of choice.parcelIds) {
      this.tellBuyers(parcelId, {
        kind: 'parcel_choose_shop',
        title: 'Choose where to collect your parcel',
        body: `${choice.closed.name} is closed. The driver with your parcel can take it to ${list}: choose one. The bag goes to the shop most of its buyers choose.`,
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
    void this.notifications
      ?.notify(choice.closed.did, {
        kind: 'shop_found_shut',
        title: 'A driver found your shop shut',
        body: `A driver came with a bag of ${choice.parcelIds.length} parcel${choice.parcelIds.length === 1 ? '' : 's'} for you and found the door shut. They go to a shop near you instead, their buyers choosing which. Say “Close for now” in the app when you close, and drivers know before they come.`,
        link: '/',
        tag: `shut:${choice.closed.did}:${choice.askedAt.slice(0, 13)}`,
        data: { code: choice.code },
      })
      .catch(() => undefined);
  }
}
