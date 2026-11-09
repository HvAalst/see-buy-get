import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GlosError } from '../../foundation/http/glos-error';
import { AccountService } from './account.service';
import { AgentService } from './agent.service';
import { HubContactService } from './hub-contact.service';
import { MdpService } from './mdp.service';
import type { WeeklyHours } from './pudo.types';
import { NETWORK_CURRENCY } from './pudo.config';

export type HubMode = 'sort' | 'sort_and_hand_out';

export class HubCounterLine {
  did: string;
  shopName: string;
  /** Open to take parcels in and hand them out now. */
  open: boolean;
  /** Its own counter fee, per parcel, in its money. */
  pricePerParcel: number;
  currency: string;
  rows: number;
  cols: number;
  /** As a shop's: APPROVED_UNFUNDED until its float has money, where we hold one. */
  status: string;
  /** The email that signs in to the Shop app for it — the hub owner's; absent where the hub has no email account. */
  @ApiPropertyOptional() signIn?: string;
}

/** What a hub does: sort only, or sort and hand out at its counter. */
export class HubCounterView {
  mdpId: string;
  @ApiProperty({ enum: ['sort', 'sort_and_hand_out'] }) mode: HubMode;
  @ApiPropertyOptional({ type: HubCounterLine }) counter?: HubCounterLine;
  /** Whether the hub has said its opening hours: its counter opens on them. */
  hoursSet: boolean;
}

/**
 * 2026-11-09 — "SORT ONLY" OR "SORT AND HAND OUT" (the owner: "The hub decides that"; "Shop app at the hub"; "Its own
 * counter fee"). A hub that hands out opens a counter — a shop at its own address, approved on the hub's papers, worked in
 * the Shop app with every rule a shop keeps, signed in to with the hub owner's email and password — and is offered to
 * senders and buyers beside the shops while its shelf has room. Its shelf, its fee and its hours (the hub's own) are the
 * owner's word. Back to "Sort only": the counter closes, its shelf's buyers told as when any shop closes; choosing to hand
 * out again opens the same counter.
 */
@Injectable()
export class HubCounterService {
  constructor(
    private readonly mdps: MdpService,
    private readonly agents: AgentService,
    private readonly accounts: AccountService,
    private readonly contacts: HubContactService,
  ) {}

  view(mdpId: string): HubCounterView {
    const hub = this.mdps.require(mdpId);
    const hoursSet = Boolean(this.hoursOf(mdpId));
    const c = hub.counter;
    if (!c) return { mdpId, mode: 'sort', hoursSet };
    const agent = this.agents.get(c.agentDid);
    const money = this.agents.amountsOf(agent.did);
    const signIn = this.accounts.emailOfDid(agent.did);
    return {
      mdpId,
      mode: c.stoppedAt ? 'sort' : 'sort_and_hand_out',
      hoursSet,
      counter: {
        did: agent.did,
        shopName: agent.shopName,
        open: !c.stoppedAt && agent.openState === 'open',
        pricePerParcel: agent.pricePerParcel,
        currency: money.currency ?? NETWORK_CURRENCY,
        rows: agent.shelf.rows,
        cols: agent.shelf.cols,
        status: agent.status,
        ...(signIn ? { signIn } : {}),
      },
    };
  }

  /** Sort and hand out: its counter opened — the first time with its shelf and fee, after that the same counter again. */
  handOut(mdpId: string, input: { rows?: number; cols?: number; pricePerParcel?: number }, by: string, now: number = Date.now()): HubCounterView {
    const hub = this.mdps.require(mdpId);
    if (!this.mdps.isApproved(hub)) throw new GlosError('INVALID_STATE', 'Your hub hands out once SeeBuyGet has approved it');
    if (hub.counter && !hub.counter.stoppedAt) return this.view(mdpId);
    if (hub.counter) {
      this.agents.reopenHubCounter(hub.counter.agentDid);
      if (input.pricePerParcel != null) this.agents.setPrice(hub.counter.agentDid, input.pricePerParcel);
      this.mdps.setCounter(mdpId, { agentDid: hub.counter.agentDid, openedAt: hub.counter.openedAt });
      return this.view(mdpId);
    }
    // Everything that can say no, before anything is made.
    const hours = this.hoursOf(mdpId);
    if (!hours) throw new GlosError('INVALID_STATE', 'Say your hub’s opening hours first, under “When and how to reach your hub”: your counter opens on them');
    const rows = Math.floor(Number(input.rows));
    const cols = Math.floor(Number(input.cols));
    if (!(rows >= 1 && rows <= 50 && cols >= 1 && cols <= 50)) throw new GlosError('VALIDATION_FAILED', 'Say your counter’s shelf: rows and columns, 1 to 50 each', { field: 'rows' });
    if (input.pricePerParcel == null || !(input.pricePerParcel >= 0)) throw new GlosError('VALIDATION_FAILED', 'Say what your counter charges for a parcel', { field: 'pricePerParcel' });
    if (!hub.zones.length) throw new GlosError('INVALID_STATE', `${hub.name} serves no area yet`);
    this.accounts.assertKindBeside(hub.did, 'pudo');
    const counter = this.agents.openHubCounter(
      { mdpId, name: hub.name, country: this.mdps.countryOf(hub), zone: hub.zones[0], location: hub.location, ...(hub.address ? { address: hub.address } : {}), ...(hub.vetting?.papers ? { papers: hub.vetting.papers } : {}) },
      { shelf: { rows, cols }, openingHours: hours, pricePerParcel: input.pricePerParcel },
      by,
      now,
    );
    this.mdps.setCounter(mdpId, { agentDid: counter.did, openedAt: new Date(now).toISOString() });
    this.accounts.openKindBeside(hub.did, 'pudo', counter.did, now);
    return this.view(mdpId);
  }

  /** Sort only: its counter closes; what is on its shelf is still collected there. */
  sortOnly(mdpId: string, now: number = Date.now()): HubCounterView {
    const hub = this.mdps.require(mdpId);
    if (hub.counter && !hub.counter.stoppedAt) {
      this.agents.stopHubCounter(hub.counter.agentDid);
      this.mdps.setCounter(mdpId, { ...hub.counter, stoppedAt: new Date(now).toISOString() });
    }
    return this.view(mdpId);
  }

  /** The hub's own opening hours, as a shop keeps them: the counter's. */
  private hoursOf(mdpId: string): WeeklyHours | undefined {
    const week = this.contacts.of(mdpId)?.openingHours;
    if (!week) return undefined;
    const out: WeeklyHours = {};
    for (const day of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const) if (week[day] !== undefined) out[day] = week[day] ? { open: week[day]!.open, close: week[day]!.close } : null;
    return Object.values(out).some(Boolean) ? out : undefined;
  }
}
