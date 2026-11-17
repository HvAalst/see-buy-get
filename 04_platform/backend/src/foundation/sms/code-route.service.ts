import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { catalogueEntry, countryOfPhone } from '../countries/catalogue';
import { GlosError } from '../http/glos-error';
import { hashPhone } from '../identity/phone';
import { PresenceService } from '../presence/presence.service';
import { PersistentMap } from '../store/persistent-map';
import { ALL_ROUTES, AUTO_NEXT_SECONDS, AnyRouteId, OFFER_ROUTES, OfferRouteId, CODE_ROUTES, CodeRouteChange, CodeRouteCount, CodeRouteId, CodeRouteLast, CodeRoutesView, CodeWay, CountryCodeRoutes, RouteState } from './code-routes.types';
import { OutgoingSms, SmsSendError } from './sms.types';

/** A text, and — where it carries one — the code itself and how long it works: an app sends the code, not the text. */
export type OutgoingCode = OutgoingSms & { code?: string; minutes?: number };

/** A provider a code can go by. It throws an `SmsSendError` when it did not take the text, and says the provider's id for it when it did. */
export interface RouteSender {
  readonly id: AnyRouteId;
  /** A text route (in each country's order), an app (WhatsApp, Telegram) that goes only by the person's choice, or a way that
   *  confirms a number without a code (Truecaller) — never handed a text. */
  readonly kind: 'sms' | 'app' | 'confirm';
  state(): RouteState;
  /** It tells this server what became of each text: only then may a code move on by itself after a minute. */
  reportsDelivery(): boolean;
  deliver(msg: OutgoingCode): Promise<{ ref?: string }>;
}

export const ROUTE_SENDERS = Symbol('ROUTE_SENDERS');

/**
 * THE ORDER A COUNTRY STARTS WITH, before staff change it (the plan, D1): a local route first where there is one — Africa's
 * Talking in East Africa, under $0.01 a text — and Twilio behind it; Twilio alone elsewhere. A route that is not set up is
 * passed over, so until Africa's Talking's key is in the server's settings every code still goes by Twilio.
 */
const LOCAL_FIRST = new Set(['KE', 'UG', 'TZ', 'RW', 'ET']);
export function defaultOrder(country: string | undefined): CodeRouteId[] {
  return country && LOCAL_FIRST.has(country) ? ['africastalking', 'twilio'] : ['twilio', 'africastalking'];
}

/**
 * 2026-11-16 — THE APPS OFFERED AS A CHOICE, before staff change it (the owner: "the choice is for the user in every country";
 * "I prefer Whatsapp also wired in for Ethiopia"): WhatsApp and Telegram in every country — Telegram listed first in Ethiopia,
 * where it is the messaging app. Staff may still withdraw one in a country. An app not set up is offered to nobody.
 */
export function defaultOffer(country: string | undefined): OfferRouteId[] {
  if (!country) return [];
  const apps: OfferRouteId[] = country === 'ET' ? ['telegram', 'whatsapp'] : ['whatsapp', 'telegram'];
  // 2026-11-17 — Truecaller where it is most used (the owner: "as recommended"): India, Egypt, South Africa and Kenya.
  return TRUECALLER_FIRST.has(country) ? [...apps, 'truecaller'] : apps;
}
const TRUECALLER_FIRST = new Set(['IN', 'EG', 'ZA', 'KE']);

interface Plan {
  order: CodeRouteId[];
  off: CodeRouteId[];
  /** Apps (and ways that confirm without a code) offered as the person's choice; absent: the default. */
  offer?: OfferRouteId[];
}

interface Attempt {
  id: string;
  country?: string;
  route: AnyRouteId;
  ref?: string;
  /** The number, hashed: never the number. */
  phoneKey: string;
  at: string;
  status: 'sent' | 'delivered' | 'failed';
  doneAt?: string;
  enteredAt?: string;
  /** 0 for the first way tried for this code, 1 for the next… */
  step: number;
  /** The code already went the next way from here. */
  advanced?: boolean;
}

interface Waiting {
  phone: string;
  body: string;
  code?: string;
  minutes?: number;
  tried: AnyRouteId[];
  until: number;
}

/** How long counts are kept: a week shown, a day more kept. */
const KEEP_MS = 8 * 86_400_000;
const SHOWN_MS = 7 * 86_400_000;
/** A code typed in within this long of a text counts for that text. */
const ENTERED_WITHIN_MS = 15 * 60_000;
/** How long the text is held in memory to send the next way: no longer than the code works. */
const HOLD_MS = 10 * 60_000;
const SWEEP_MS = 15_000;

/**
 * 2026-11-16 — THE WAYS A CODE REACHES A PHONE, AND STAFF'S HAND ON THEM (the owner: "visual and controlable from the
 * staff console"; the plan "Sign-in codes beyond Twilio SMS", D1 and D4).
 *
 * - SEND: a text goes by the country's routes in order — the ones set up and not switched off — the person's own last
 *   working route first. A route that will not take it hands it to the next at once.
 * - MOVE ON: where a route reports deliveries, a text still not delivered after a minute (or reported failed) goes the
 *   next way, the same code. The text itself is held in memory only, and no longer than the code works.
 * - REMEMBER: a code typed in marks its text delivered and entered, and its route goes first for that number next time.
 * - STEER: staff set a country's order and switch a route off; at least one stays on. Each change is kept with who made it.
 * - SHOW: per country and route, the last seven days: codes asked, delivered, failed, entered.
 *
 * Kept: hashes of numbers, never a number or a code.
 */
@Injectable()
export class CodeRouteService implements OnModuleDestroy {
  private readonly logger = new Logger(CodeRouteService.name);
  private readonly plans = new PersistentMap<string, Plan>('code-route-plans');
  private readonly attempts = new PersistentMap<string, Attempt>('code-route-attempts');
  private readonly remembered = new PersistentMap<string, AnyRouteId>('code-route-remembered');
  private readonly changes = new PersistentMap<string, CodeRouteChange & { id: string }>('code-route-changes');
  private readonly waiting = new Map<string, Waiting>();
  private readonly last = new Map<AnyRouteId, CodeRouteLast>();
  private gate?: (now: number) => void;
  private timer?: ReturnType<typeof setInterval>;
  private sweptAt = 0;

  constructor(
    @Inject(ROUTE_SENDERS) private readonly senders: RouteSender[],
    // Optional so a hand-built service keeps compiling: without it every country with a plan is shown, none as switched on.
    @Optional() private readonly presence?: PresenceService,
  ) {
    this.timer = setInterval(() => void this.sweep().catch((err: Error) => this.logger.warn(`moving codes on failed: ${err.message}`)), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The caps SmsService keeps, asked before a text that moves on by itself: it costs money as the first did. */
  useGate(gate: (now: number) => void): void {
    this.gate = gate;
  }

  private sender(id: AnyRouteId): RouteSender | undefined {
    return this.senders.find((s) => s.id === id);
  }

  /** Any text route can send from this server. (An app alone cannot carry every text: a payout notice is no code.) */
  anyReady(): boolean {
    return this.senders.some((s) => s.kind === 'sms' && s.state() === 'ready');
  }

  private orderOf(country: string | undefined): CodeRouteId[] {
    const planned = country ? this.plans.get(country)?.order : undefined;
    return planned && planned.length ? planned : defaultOrder(country);
  }

  private offIn(country: string | undefined): CodeRouteId[] {
    return (country ? this.plans.get(country)?.off : undefined) ?? [];
  }

  /** The routes a text to this country goes by, in order: set up and on; this number's last working route first. */
  usable(country: string | undefined, phoneKey?: string): CodeRouteId[] {
    const off = this.offIn(country);
    const list = this.orderOf(country).filter((r) => !off.includes(r) && this.sender(r)?.state() === 'ready');
    const known = phoneKey ? this.remembered.get(phoneKey) : undefined;
    return known && (list as AnyRouteId[]).includes(known) ? [known as CodeRouteId, ...list.filter((r) => r !== known)] : list;
  }

  private offerOf(country: string | undefined): OfferRouteId[] {
    const planned = country ? this.plans.get(country)?.offer : undefined;
    return planned ?? defaultOffer(country);
  }

  /** The apps a person in this country may choose: offered here and set up, in the order the code screen lists them. */
  appsFor(country: string | undefined): OfferRouteId[] {
    return this.offerOf(country).filter((r) => this.sender(r)?.state() === 'ready');
  }

  /** 2026-11-16 — the apps a person may ask their code by, for their number — and, 2026-11-17, Truecaller where offered. */
  ways(phone: string): OfferRouteId[] {
    return this.appsFor(countryOfPhone(phone));
  }

  /** 2026-11-17 — may this number be confirmed by this way (Truecaller): offered in its country and set up. */
  offers(phone: string, route: OfferRouteId): boolean {
    return this.ways(phone).includes(route);
  }

  /** 2026-11-17 — a number confirmed without a code (Truecaller), or not: counted with the rest, and remembered as working. */
  noteConfirm(phone: string, route: AnyRouteId, ok: boolean, now: number = Date.now()): void {
    const id = `cra_${now.toString(36)}_${randomBytes(4).toString('hex')}`;
    const at = new Date(now).toISOString();
    const country = countryOfPhone(phone);
    const phoneKey = hashPhone(phone);
    this.attempts.set(id, { id, route, phoneKey, at, status: ok ? 'delivered' : 'failed', doneAt: at, step: 0, ...(ok ? { enteredAt: at } : {}), ...(country ? { country } : {}) });
    this.last.set(route, { at, ok });
  }

  /**
   * THE WAYS ONE CODE IS TRIED, IN ORDER. An app only where the person chose it — now, or by having had a code by it typed in
   * before — and it is offered and set up; then the country's text routes. A text that is not a code goes by text alone.
   */
  private plan(country: string | undefined, phoneKey: string, code: string | undefined, via: CodeWay | undefined): AnyRouteId[] {
    const texts = this.usable(country, via === 'sms' ? undefined : phoneKey);
    if (!code) return texts;
    const apps = this.appsFor(country);
    const chosen = via && via !== 'sms' ? via : via === 'sms' ? undefined : this.remembered.get(phoneKey);
    // Only an app carries a code: a way that confirms without one (Truecaller) is never handed it.
    return chosen && (apps as AnyRouteId[]).includes(chosen) && this.sender(chosen)?.kind === 'app' ? [chosen, ...texts] : texts;
  }

  /**
   * A TEXT, BY THE FIRST ROUTE THAT TAKES IT. Throws the reason when none did: `rejected` only when every route said the
   * number cannot be texted — the person's to put right — and otherwise ours.
   */
  /** The way it went by, once one took it. */
  async send(phone: string, body: string, now: number = Date.now(), opts: { code?: string; minutes?: number; via?: CodeWay } = {}): Promise<AnyRouteId> {
    const country = countryOfPhone(phone);
    const phoneKey = hashPhone(phone);
    const routes = this.plan(country, phoneKey, opts.code, opts.via);
    if (!routes.length) throw new SmsSendError('refused', 'no route that can text this country is set up and switched on');
    const tried: AnyRouteId[] = [];
    const errors: SmsSendError[] = [];
    for (const route of routes) {
      tried.push(route);
      const done = await this.tryRoute(route, { phone, body, code: opts.code, minutes: opts.minutes, country, phoneKey, step: tried.length - 1, tried: [...tried] }, now);
      if (done === true) return route;
      errors.push(done);
    }
    throw errors.every((e) => e.kind === 'rejected') ? errors[0] : (errors.find((e) => e.kind !== 'rejected') ?? errors[0]);
  }

  /** One route, one text: recorded either way. True when it was taken. */
  private async tryRoute(route: AnyRouteId, t: { phone: string; body: string; code?: string; minutes?: number; country?: string; phoneKey: string; step: number; tried: AnyRouteId[] }, now: number): Promise<true | SmsSendError> {
    const sender = this.sender(route);
    const id = `cra_${now.toString(36)}_${randomBytes(4).toString('hex')}`;
    const at = new Date(now).toISOString();
    try {
      if (!sender) throw new SmsSendError('refused', 'that route is not built into this server');
      const { ref } = await sender.deliver({ to: t.phone, body: t.body, ...(t.code ? { code: t.code } : {}), ...(t.minutes ? { minutes: t.minutes } : {}) });
      this.attempts.set(id, { id, route, phoneKey: t.phoneKey, at, status: 'sent', step: t.step, ...(t.country ? { country: t.country } : {}), ...(ref ? { ref } : {}) });
      this.last.set(route, { at, ok: true });
      if (sender.reportsDelivery() && ref) this.waiting.set(id, { phone: t.phone, body: t.body, ...(t.code ? { code: t.code } : {}), ...(t.minutes ? { minutes: t.minutes } : {}), tried: t.tried, until: now + HOLD_MS });
      return true;
    } catch (err) {
      const why = err instanceof SmsSendError ? err : new SmsSendError('failed', 'the route answered with a fault');
      this.attempts.set(id, { id, route, phoneKey: t.phoneKey, at, status: 'failed', doneAt: at, step: t.step, ...(t.country ? { country: t.country } : {}) });
      this.last.set(route, { at, ok: false, failed: why.kind });
      this.logger.warn(`a text did not go by ${route}: ${why.message}`);
      return why;
    }
  }

  /**
   * WHAT A ROUTE SAYS BECAME OF A TEXT. Taken only for a text this server handed that route, by the provider's own id for
   * it, which nobody else holds. Failed, and the code still wanted: it goes the next way now.
   */
  async report(route: AnyRouteId, ref: string, outcome: 'delivered' | 'failed', now: number = Date.now()): Promise<boolean> {
    const attempt = [...this.attempts.values()].find((a) => a.route === route && a.ref === ref);
    if (!attempt || attempt.status !== 'sent') return Boolean(attempt);
    this.attempts.set(attempt.id, { ...attempt, status: outcome, doneAt: new Date(now).toISOString() });
    if (outcome === 'delivered') this.waiting.delete(attempt.id);
    else if (this.waiting.has(attempt.id)) await this.moveOn(attempt.id, now);
    return true;
  }

  /** A CODE TYPED IN: its text was delivered, and that route goes first for this number from now on. */
  entered(phone: string, now: number = Date.now()): void {
    const phoneKey = hashPhone(phone);
    const latest = [...this.attempts.values()]
      .filter((a) => a.phoneKey === phoneKey && a.status !== 'failed' && !a.enteredAt && now - Date.parse(a.at) <= ENTERED_WITHIN_MS)
      .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    for (const [id, w] of this.waiting) if (hashPhone(w.phone) === phoneKey) this.waiting.delete(id);
    if (!latest) return;
    const at = new Date(now).toISOString();
    this.attempts.set(latest.id, { ...latest, status: 'delivered', doneAt: latest.doneAt ?? at, enteredAt: at });
    this.remembered.set(phoneKey, latest.route);
  }

  /** Every few seconds: a text not delivered after a minute goes the next way; old counts are let go of. */
  async sweep(now: number = Date.now()): Promise<void> {
    for (const [id, w] of [...this.waiting]) {
      const attempt = this.attempts.get(id);
      if (now > w.until || !attempt || attempt.status !== 'sent' || attempt.advanced) {
        if (now > w.until || !attempt || attempt.status !== 'sent') this.waiting.delete(id);
        continue;
      }
      if (now - Date.parse(attempt.at) >= AUTO_NEXT_SECONDS * 1000) await this.moveOn(id, now);
    }
    if (now - this.sweptAt > 3_600_000) {
      this.sweptAt = now;
      for (const a of [...this.attempts.values()]) if (now - Date.parse(a.at) > KEEP_MS) this.attempts.delete(a.id);
    }
  }

  /** The same code, the next way: a route not yet tried for it, set up and on. Nothing more to try: it stays as it is. */
  private async moveOn(id: string, now: number): Promise<void> {
    const w = this.waiting.get(id);
    const attempt = this.attempts.get(id);
    this.waiting.delete(id);
    if (!w || !attempt) return;
    this.attempts.set(id, { ...attempt, advanced: true });
    // On by text: an app is never reached by moving on, only by the person's choice.
    const next = this.usable(attempt.country).filter((r) => !w.tried.includes(r));
    if (!next.length) return;
    try {
      this.gate?.(now);
    } catch {
      return;
    }
    const tried = [...w.tried];
    for (const route of next) {
      tried.push(route);
      const done = await this.tryRoute(route, { phone: w.phone, body: w.body, code: w.code, minutes: w.minutes, country: attempt.country, phoneKey: attempt.phoneKey, step: tried.length - 1, tried: [...tried] }, now);
      if (done === true) return;
    }
  }

  /* ------------------------------------------------------------------------------------------- staff's hand -- */

  private country(code: string): string {
    const c = catalogueEntry(code)?.code;
    if (!c) throw new GlosError('NOT_FOUND', 'No such country');
    return c;
  }

  private note(country: string, by: string, change: Omit<CodeRouteChange, 'at' | 'by' | 'country'>, now: number): void {
    const id = `crc_${now.toString(36)}_${randomBytes(3).toString('hex')}`;
    this.changes.set(id, { id, at: new Date(now).toISOString(), by, country, ...change });
    const all = [...this.changes.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
    for (const old of all.slice(200)) this.changes.delete(old.id);
  }

  /** The order a country's routes are tried in: every route, once each. */
  setOrder(code: string, order: CodeRouteId[], by: string, now: number = Date.now()): CountryCodeRoutes {
    const country = this.country(code);
    const known = new Set<string>(CODE_ROUTES);
    if (order.length !== CODE_ROUTES.length || new Set(order).size !== order.length || order.some((r) => !known.has(r))) {
      throw new GlosError('INVALID_INPUT', 'Name every route once, in the order they are tried', { field: 'order' });
    }
    this.plans.set(country, { ...this.plans.get(country), order: [...order], off: this.offIn(country) });
    this.note(country, by, { what: 'order', order: [...order] }, now);
    return this.countryView(country, now);
  }

  /** A route switched on or off in a country. The last one on stays on: without it no code reaches that country. */
  setOn(code: string, route: CodeRouteId, on: boolean, by: string, now: number = Date.now()): CountryCodeRoutes {
    const country = this.country(code);
    if (!(CODE_ROUTES as readonly string[]).includes(route)) throw new GlosError('NOT_FOUND', 'No such route');
    const off = this.offIn(country).filter((r) => r !== route);
    if (!on) {
      off.push(route);
      if (CODE_ROUTES.every((r) => off.includes(r))) throw new GlosError('INVALID_STATE', 'At least one route stays on: without one, no code reaches this country');
    }
    this.plans.set(country, { ...this.plans.get(country), order: this.orderOf(country), off });
    this.note(country, by, { what: on ? 'on' : 'off', route }, now);
    return this.countryView(country, now);
  }

  /** 2026-11-16 — an app offered in a country as the person's choice, or no longer (D2, D3). */
  setOffer(code: string, route: OfferRouteId, on: boolean, by: string, now: number = Date.now()): CountryCodeRoutes {
    const country = this.country(code);
    if (!(OFFER_ROUTES as readonly string[]).includes(route)) throw new GlosError('NOT_FOUND', 'No such app');
    const offer = this.offerOf(country).filter((r) => r !== route);
    if (on) offer.push(route);
    // The order the code screen lists them in is OFFER_ROUTES', unless a country's default puts one first (Telegram in Ethiopia).
    const lead = [...defaultOffer(country), ...OFFER_ROUTES.filter((r) => !defaultOffer(country).includes(r))];
    offer.sort((a, b) => (lead.indexOf(a) === -1 ? 9 : lead.indexOf(a)) - (lead.indexOf(b) === -1 ? 9 : lead.indexOf(b)));
    this.plans.set(country, { ...this.plans.get(country), order: this.orderOf(country), off: this.offIn(country), offer });
    this.note(country, by, { what: on ? 'offer' : 'withdraw', route }, now);
    return this.countryView(country, now);
  }

  /* ------------------------------------------------------------------------------------------------- shown -- */

  private countryView(country: string, now: number, switchedOn?: Set<string>): CountryCodeRoutes {
    const since = now - SHOWN_MS;
    const mine = [...this.attempts.values()].filter((a) => a.country === country && Date.parse(a.at) >= since);
    const counts: CodeRouteCount[] = ALL_ROUTES.map((route) => {
      const of = mine.filter((a) => a.route === route);
      return { route, asked: of.length, delivered: of.filter((a) => a.status === 'delivered').length, failed: of.filter((a) => a.status === 'failed').length, entered: of.filter((a) => a.enteredAt).length };
    });
    const on = switchedOn ?? this.switchedOn();
    const goesBy = this.usable(country)[0];
    return { country, switchedOn: on.has(country), order: this.orderOf(country), off: this.offIn(country), offer: this.offerOf(country), changed: this.plans.has(country), ...(goesBy ? { goesBy } : {}), counts };
  }

  private switchedOn(): Set<string> {
    return new Set((this.presence?.list() ?? []).filter((p) => p.level !== 'observed').map((p) => catalogueEntry(p.jurisdiction)?.code).filter((c): c is string => Boolean(c)));
  }

  view(now: number = Date.now()): CodeRoutesView {
    const on = this.switchedOn();
    // Switched on, steered by staff, or sent codes to this week: every country a code has to do with.
    const recent = [...this.attempts.values()].filter((a) => a.country && Date.parse(a.at) >= now - SHOWN_MS).map((a) => a.country as string);
    const countries = [...new Set([...on, ...this.plans.keys(), ...recent])].sort();
    return {
      routes: this.senders.map((s) => ({ id: s.id, state: s.state(), reportsDelivery: s.reportsDelivery(), ...(this.last.get(s.id) ? { last: { ...this.last.get(s.id)! } } : {}) })),
      countries: countries.map((c) => this.countryView(c, now, on)),
      changes: [...this.changes.values()]
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 30)
        .map(({ id: _id, ...c }) => c),
      since: new Date(now - SHOWN_MS).toISOString(),
      autoNextSeconds: AUTO_NEXT_SECONDS,
    };
  }
}
