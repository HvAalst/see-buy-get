import { Injectable, Logger, Optional } from '@nestjs/common';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { MailService } from '../../foundation/mail/mail.service';
import type { MailApp } from '../../foundation/mail/mail.templates';
import type { PresenceCapability, PresenceLevel } from '../../foundation/presence/presence.types';
import { AccountService } from './account.service';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { VendorService } from './vendor.service';

/**
 * WHAT STOPS, said to the people it stops for. One clause each, about what they do — never about our levels or our
 * companies, which are facts about our paperwork and not about their counter.
 */
export const LOSS_WORDS: Record<PresenceCapability, string> = {
  takeIn: 'no new parcel can be taken in or sent from here',
  merchantOfRecord: 'we no longer charge customers here — a local carrier prices and bills',
  holdFloat: 'a shop here can no longer keep a float with us',
  cashOnDelivery: 'cash is no longer handled for us here',
  claims: 'nothing new here is covered for a claim',
  tax: 'we no longer collect tax here',
  payouts: 'we cannot pay out here for now, so what is owed waits',
  signUp: 'nobody new can sign up here for now',
  fieldEvidence: 'photographs of official documents are no longer kept',
};

/** What does NOT stop — the two questions anybody asks first, answered before they have to ask them. */
export const KEPT_WORDS = ['Parcels already on a shelf stay there to be collected', 'What is owed to you stays owed'];

/** One participant registered in the country, as they are reached: the inbox of the app they use, and an address where they gave one. */
interface Recipient {
  did: string;
  app: MailApp;
  name: string;
  email?: string;
  /** Checked and able to work — what they are told when the country opens: today, or once their papers are approved. */
  ready: boolean;
}

/**
 * NOBODY USED TO BE TOLD THAT THEIR COUNTRY WAS BEING WOUND DOWN.
 *
 * Lowering a country is counted before anybody presses it — how many shops, hubs, stores, fleets and couriers stand
 * there (`countryImpactOf`) — and then none of them heard a word: a shopkeeper found out by being refused at the
 * counter. Now, the moment a change takes something away, everybody registered there is told what stops for them,
 * and what does not, in the inbox of the app they use (and on their phone where they let it) — and by email where
 * they gave an address, because the Hub app has no inbox to read it in.
 *
 * Said for a change that TAKES SOMETHING AWAY — and, since 2026-10-25, for the one raise that changes everybody's
 * day: a country that took sign-ups before it opened, opening (tellOpened). Other raises are good news nobody has to
 * act on, with their own announcement to the people who asked to be told (the waiting list).
 */
@Injectable()
export class CountryNoticeService {
  private readonly logger = new Logger(CountryNoticeService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly vendors: VendorService,
    private readonly managers: FleetManagerService,
    private readonly drivers: DriverService,
    private readonly accounts: AccountService,
    @Optional() private readonly mail?: MailService,
  ) {}

  /** Everybody registered in the country: its shops, hubs, stores, fleets and couriers. */
  recipientsIn(jurisdiction: string): Recipient[] {
    const code = jurisdiction.trim().toUpperCase();
    const email = (did: string) => {
      try {
        return this.accounts.emailForDid(did);
      } catch {
        return undefined;
      }
    };
    return [
      ...this.agents.list().filter((a) => this.agents.countryOf(a) === code).map((a) => ({ did: a.did, app: 'agent' as const, name: a.shopName, email: email(a.did), ready: ['APPROVED_UNFUNDED', 'ACTIVE', 'LOCKED'].includes(a.status) })),
      ...this.mdps.list().filter((m) => this.mdps.countryOf(m) === code).map((m) => ({ did: m.did, app: 'mdp' as const, name: m.name, email: email(m.did), ready: this.mdps.isApproved(m) })),
      // A store is checked by nobody: it can ship the day its country opens.
      ...this.vendors.list().filter((v) => v.country === code).map((v) => ({ did: v.did, app: 'vendor' as const, name: v.name, email: email(v.did), ready: true })),
      ...this.managers.list().filter((m) => m.jurisdiction === code).map((m) => ({ did: m.did, app: 'fleet' as const, name: m.companyName, email: m.contactEmail ?? email(m.did), ready: m.status === 'ACTIVE' })),
      // Couriers, and drivers of a fleet there: their app is how a change reaches them, and their fleet is told too.
      ...this.drivers.list().filter((d) => d.jurisdiction === code).map((d) => ({ did: d.did, app: 'driver' as const, name: d.displayName, ready: d.status === 'ACTIVE' })),
    ];
  }

  /** Tell everybody registered in a country what a change to it takes away. Returns how many were told, and emailed. */
  async tellLowered(input: { jurisdiction: string; level: PresenceLevel; lost: PresenceCapability[] }): Promise<{ told: number; emailed: number }> {
    if (!input.lost.length) return { told: 0, emailed: 0 };
    const code = input.jurisdiction.trim().toUpperCase();
    const country = catalogueEntry(code)?.name ?? code;
    const lost = input.lost.map((c) => LOSS_WORDS[c]);
    const title = `What changes for you in ${country} from today`;
    const body = `From today ${lost.join('; ')}. ${KEPT_WORDS.join(', and ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}.`;
    let told = 0;
    let emailed = 0;
    for (const r of this.recipientsIn(code)) {
      try {
        // One notice per country and level: told again after a further change, the newer replaces the older on a phone.
        await this.notifications.notify(r.did, { kind: 'country_changed', title, body, link: '/', tag: `country:${code}:${input.level}`, data: { country: code, level: input.level } });
        told += 1;
      } catch (err) {
        this.logger.warn(`country notice failed for ${r.did}: ${(err as Error).message}`);
      }
      if (r.email && this.mail) {
        try {
          if (await this.mail.send('country-changed', { address: r.email, name: r.name }, { country, lost, kept: [...KEPT_WORDS], app: r.app })) emailed += 1;
        } catch (err) {
          this.logger.warn(`country email failed for ${r.did}: ${(err as Error).message}`);
        }
      }
    }
    return { told, emailed };
  }

  /**
   * THE DAY A COUNTRY OPENS, said to everybody who signed up there while it was COMING (the user, 2026-10-25: "Then we
   * have those on the network immediately"). Each is told whether they can start today — their papers were checked —
   * or the day their papers are approved, in the inbox of the app they use and by email where they gave an address.
   * Who they work with there is named where a company of ours stands; where none does, that the money stays between
   * them and whoever they work for. Returns how many were told, and emailed.
   */
  async tellOpened(input: { jurisdiction: string; level: PresenceLevel; company?: string }): Promise<{ told: number; emailed: number }> {
    const code = input.jurisdiction.trim().toUpperCase();
    const country = catalogueEntry(code)?.name ?? code;
    const title = `SeeBuyGet is open in ${country} from today`;
    const whom = input.company ? `${input.company} is the company you work with there.` : 'No company of ours handles money there yet: what you earn is settled with whoever you work for.';
    let told = 0;
    let emailed = 0;
    for (const r of this.recipientsIn(code)) {
      const body = `${r.ready ? 'You signed up before it opened, and your papers are checked: you can start today.' : 'You signed up before it opened, and your sign-up is not finished yet: you start the day it is.'} ${whom}`;
      try {
        await this.notifications.notify(r.did, { kind: 'country_changed', title, body, link: '/', tag: `country:${code}:${input.level}`, data: { country: code, level: input.level } });
        told += 1;
      } catch (err) {
        this.logger.warn(`country opening notice failed for ${r.did}: ${(err as Error).message}`);
      }
      if (r.email && this.mail) {
        try {
          if (await this.mail.send('country-opened', { address: r.email, name: r.name }, { country, ready: r.ready, ...(input.company ? { company: input.company } : {}), app: r.app })) emailed += 1;
        } catch (err) {
          this.logger.warn(`country opening email failed for ${r.did}: ${(err as Error).message}`);
        }
      }
    }
    return { told, emailed };
  }
}
