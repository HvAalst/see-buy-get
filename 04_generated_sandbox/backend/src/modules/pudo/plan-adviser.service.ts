import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GlosError } from '../../foundation/http/glos-error';
import { ClaudeGateway, type ClaudeReply, type ClaudeRequest } from './claude.gateway';
import { FleetPlanService, type PlanAsk } from './fleet-plan.service';
import { DayPlanView } from './fleet-plan.types';
import { AdviserFailure, AdviserTurn, PlanAdviceView, PlanAdviserStatus, PlanAskView } from './plan-adviser.types';

/** The model the adviser runs on. */
export const ADVISER_MODEL = 'claude-opus-5-5';
/** How many times the adviser may go round (ask the solver, read the answer) before it must reply. */
export const ADVISER_MAX_STEPS = 5;
export const ADVISER_MAX_MESSAGE = 1000;
export const ADVISER_MAX_HISTORY = 12;

/**
 * What the adviser is told it is, once, in full. Written as a briefing rather than a list of commands: who is on the
 * other side of the screen, what the plan is and is not, the one thing it can change and the things it cannot, and
 * why — so that it can use judgement on the questions this text did not think of.
 */
export const ADVISER_BRIEF = `You are the planning adviser inside the dispatch app of a road-freight fleet. A dispatcher is looking at a plan for one day's deliveries and is writing to you from that screen.

The plan is worked out by a solver, not by you. It decides which vehicle takes which orders, trip after trip, from the day's orders, the fleet's vehicles and a few settings. You never write, edit or imagine a plan yourself, and you never state something about the plan that is not in the plan data you were given. Dispatchers send trucks out on what this screen says, so a confident guess from you is worse than "the plan data does not say".

You can do two things.

1. Explain the plan in front of you: why an order is on a vehicle or left out, what a vehicle's day looks like, where the kilometres and hours go. Use only the plan data.

2. Change what the solver is ASKED, with the replan tool, when the dispatcher wants something different. The tool runs the solver again and returns the new plan. Afterwards say in a sentence or two what actually changed in the result, read from the new plan data - and say so plainly when the change did not get them what they wanted (for example, the order they moved is now left out because that vehicle cannot carry it).

What replan can express: when vehicles leave the depot, the longest day (1 to 13 hours), the speed on the road, the minutes to load an order and to hand one over, which vehicles are left out of the plan, keeping a named order off a named vehicle, and putting a named order on a named vehicle. Each list you send replaces the list in force, so to add one entry send the entries already in force as well (they are in the plan data: "rules", and the vehicles marked "leftOut").

What it cannot express: changing a delivery window, the order of stops within a trip, splitting an order across vehicles, areas on a map, prices or costs. When the dispatcher asks for one of these, say that the plan cannot do that yet, and offer the nearest thing it can do if there is one. An instruction about an area ("keep truck 3 out of the city centre") can be done order by order: use the delivery addresses in the plan data to choose the orders, keep each of them off that vehicle, and name the orders you chose so the dispatcher can check your reading of the addresses - you are reading place names, not a map.

The solver already holds to the rules of the trade, so do not propose breaking them and do not present them as your own caution: a vehicle is never loaded past what it carries at once, no day is longer than 13 hours, no more vehicles go out than the fleet has drivers, and goods go only on a vehicle with the equipment for them.

The solver already plans to the delivery window each shipper asked for, wherever it could read one as a time ("plannedTo"). A vehicle that is early waits for the window to open ("waitsMin"). An order that cannot make its window is planned all the same and marked ("lateByMin", or "earlyByMin" where the day had no room to wait) - nothing is left out because of a window. Words the solver could not read as a time are marked "windowNotRead": that order was planned to its day only, and the fix is the shipper or the office writing the window as hours, such as 8-12 or before 14:00.

The plan data says what its distances are ("distances"): by road, from a routing server, or an estimate - straight lines with an allowance for the road - and, where a routing server could not be used, why. Every time in the plan is an estimate either way: those distances at one speed, plus fixed minutes at each stop. Say "about" with times and do not present them as promises.

Nothing you do accepts a plan or sends anything to a driver: what comes back from replan is a proposal on the dispatcher's screen, and accepting it is theirs.

Write for someone in the middle of a working day: short, plain and specific, with order codes, plates and numbers. No preamble, no headings, and no lists unless they ask for one. Answer in the language the dispatcher writes in.`;

const nullable = (type: string, description: string) => ({ anyOf: [{ type }, { type: 'null' }], description });
const PAIRS = (description: string) => ({
  anyOf: [{ type: 'array', items: { type: 'object', additionalProperties: false, required: ['order', 'vehicle'], properties: { order: { type: 'string', description: 'The order code, e.g. FRT-142' }, vehicle: { type: 'string', description: 'The vehicle plate, e.g. KLM 808T' } } } }, { type: 'null' }],
  description,
});

/** The one tool: change what the solver is asked. `strict`, so its arguments always match this shape. */
export const REPLAN_TOOL: Anthropic.Beta.Messages.BetaTool = {
  name: 'replan',
  description:
    'Run the solver again with different asks, and get the new plan back. Send null for anything that should stay as it is. Each list REPLACES the list in force: to add an entry, include the ones already in force. Nothing is accepted or sent to drivers by calling this - the result is a proposal on the dispatcher\'s screen.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['day_start', 'day_hours', 'speed_kmh', 'load_min', 'unload_min', 'leave_out', 'keep_off', 'put_on'],
    properties: {
      day_start: nullable('string', 'When vehicles leave the depot, as HH:MM (24-hour). null to leave as it is.'),
      day_hours: nullable('number', 'The longest a vehicle\'s day may be, depot to depot, in hours: 1 to 13. null to leave as it is.'),
      speed_kmh: nullable('number', 'The one speed used for every road, km/h: 5 to 110. null to leave as it is.'),
      load_min: nullable('number', 'Minutes to load one order at its collection point: 0 to 240. null to leave as it is.'),
      unload_min: nullable('number', 'Minutes to hand one order over at its door: 0 to 240. null to leave as it is.'),
      leave_out: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }], description: 'The plates of ALL vehicles left out of the plan. Replaces the current list; an empty list brings every vehicle back. null to leave as it is.' },
      keep_off: PAIRS('ALL "keep this order off this vehicle" rules. Replaces the current list. null to leave as it is.'),
      put_on: PAIRS('ALL "this order goes on this vehicle, or on none" rules. Replaces the current list. null to leave as it is.'),
    },
  },
};

interface ReplanInput {
  day_start: string | null;
  day_hours: number | null;
  speed_kmh: number | null;
  load_min: number | null;
  unload_min: number | null;
  leave_out: string[] | null;
  keep_off: Array<{ order: string; vehicle: string }> | null;
  put_on: Array<{ order: string; vehicle: string }> | null;
}

/**
 * P5 — AN ADVISER OVER THE MATH.
 *
 * The user, 2026-10-05: planning "requires smart planning and we expect that AI could help with that if ordinary math
 * is not sufficient" — and, asked how: the math plans, the adviser explains it and takes instructions in words, and
 * the math runs again. So the adviser is given the plan as data and ONE tool, which changes what the solver is asked.
 * It cannot write a plan, and nothing it says is taken as a fact about one:
 *
 *  - the plan in the answer is the solver's, worked out here;
 *  - "what changed" is derived here, from the asks before and after — not from the adviser's account of itself;
 *  - a plate or an order code the adviser names is looked up in the plan; one that is not there is handed back to it
 *    as an error to correct, never guessed at;
 *  - whatever it asks goes through the same checks a dispatcher's own settings do (a 20-hour day is refused the same).
 *
 * Nothing is accepted and nothing is sent to a driver from here. The conversation is the client's to keep: each call
 * carries the turns so far as plain text and the plan as it stands now, so the server holds no chat and an old turn
 * can never describe a plan that has since changed.
 */
@Injectable()
export class PlanAdviserService {
  private readonly logger = new Logger(PlanAdviserService.name);

  constructor(
    private readonly plans: FleetPlanService,
    private readonly claude: ClaudeGateway,
  ) {}

  status(): PlanAdviserStatus {
    return { configured: this.claude.configured() };
  }

  async advise(fleetDid: string, input: { ask: PlanAsk; message: string; history?: AdviserTurn[] }, now: number = Date.now()): Promise<PlanAdviceView> {
    const said = (input.message ?? '').trim();
    if (!said) throw new GlosError('FIELD_REQUIRED', 'Say what you want to know, or what to change', { field: 'message' });
    if (said.length > ADVISER_MAX_MESSAGE) throw new GlosError('INVALID_INPUT', `Keep it under ${ADVISER_MAX_MESSAGE} characters`, { field: 'message' });

    // The plan as it stands, under the asks the screen has now. A bad ask fails here, before anybody is called.
    let plan = await this.plans.proposeRouted(fleetDid, input.ask, now);
    const first = plan;
    const answer = (reply: string, failed?: AdviserFailure): PlanAdviceView => {
      const ask = askOf(plan);
      return { reply, ...(failed ? { failed } : {}), changed: changesBetween(first, plan), ask, plan };
    };
    if (!this.claude.configured()) return answer('', 'not_configured');

    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      ...turnsOf(input.history),
      { role: 'user', content: `The plan on the dispatcher's screen now, as data:\n${JSON.stringify(dataOf(plan))}\n\nThe dispatcher writes:\n${said}` },
    ];

    for (let step = 0; step < ADVISER_MAX_STEPS; step++) {
      let reply: ClaudeReply;
      try {
        reply = await this.claude.create(this.request(messages));
      } catch (e) {
        return answer('', this.failureOf(e));
      }
      // A decline arrives as an ordinary reply: read why it stopped before reading what it said.
      if (reply.stop_reason === 'refusal') return answer('', 'declined');

      const calls = reply.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
      if (reply.stop_reason !== 'tool_use' || calls.length === 0) {
        const text = reply.content
          .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return answer(text || 'The adviser had nothing to add.');
      }

      // The assistant's turn goes back exactly as it came — thinking blocks and all — and every call gets its result.
      messages.push({ role: 'assistant', content: reply.content });
      // One after the other, each on top of the last: a plan is worked out (and its roads asked about) before the next call is read.
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        try {
          if (call.name !== 'replan') throw new Error(`There is no tool called ${call.name}`);
          plan = await this.replan(fleetDid, plan, call.input, now);
          results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(dataOf(plan)) });
        } catch (e) {
          // Told back to the adviser in the refusal's own words, so it can correct itself or tell the dispatcher.
          results.push({ type: 'tool_result', tool_use_id: call.id, content: e instanceof Error ? e.message : 'That could not be done', is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    // Out of steps without a last word. The plan is still the solver's latest, and what changed is still derived.
    return answer('The plan below is the last one worked out. Ask again if it is not what you wanted.');
  }

  private request(messages: Anthropic.Beta.Messages.BetaMessageParam[]): ClaudeRequest {
    return {
      model: ADVISER_MODEL,
      max_tokens: 8000,
      system: ADVISER_BRIEF,
      tools: [REPLAN_TOOL],
      // Explained and re-planned in a few steps, on a dispatcher's time: this model's default depth, said out loud.
      output_config: { effort: 'medium' },
      // If a safety classifier declines the request, it is re-run on the model Anthropic recommends for that case.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    };
  }

  /** What a replan call asks, turned into the solver's asks: plates and codes looked up, never guessed. */
  private async replan(fleetDid: string, plan: DayPlanView, raw: unknown, now: number): Promise<DayPlanView> {
    const input = (raw ?? {}) as Partial<ReplanInput>;
    const current = askOf(plan);
    const vehicleId = (plate: string): string => {
      const want = norm(plate);
      const v = plan.vehicles.find((x) => norm(x.plate) === want);
      if (!v) throw new Error(`No vehicle with the plate "${plate}" in this fleet. The plates are: ${plan.vehicles.map((x) => x.plate).join(', ')}`);
      return v.vehicleId;
    };
    const orders = new Map<string, string>([...plan.routes.flatMap((r) => r.trips.flatMap((t) => t.stops.map((s) => [norm(s.code), s.freightId] as const))), ...plan.unplanned.map((u) => [norm(u.code), u.freightId] as const)]);
    const freightId = (code: string): string => {
      const id = orders.get(norm(code));
      if (!id) throw new Error(`No order with the code "${code}" in this day's plan`);
      return id;
    };
    const pairs = (list: ReplanInput['keep_off']) => (list ?? []).map((p) => ({ freightId: freightId(p.order), vehicleId: vehicleId(p.vehicle) }));
    const ask: PlanAsk = {
      day: plan.day,
      dayStart: input.day_start ?? current.dayStart,
      dayHours: input.day_hours ?? current.dayHours,
      speedKmh: input.speed_kmh ?? current.speedKmh,
      loadMin: input.load_min ?? current.loadMin,
      unloadMin: input.unload_min ?? current.unloadMin,
      excludeVehicleIds: input.leave_out ? input.leave_out.map(vehicleId) : current.excludeVehicleIds,
      keepOff: input.keep_off ? pairs(input.keep_off) : current.keepOff,
      putOn: input.put_on ? pairs(input.put_on) : current.putOn,
    };
    return this.plans.proposeRouted(fleetDid, ask, now);
  }

  /** Why the adviser could not be asked, as one of the few things a dispatcher can do something about. */
  private failureOf(e: unknown): AdviserFailure {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      this.logger.error('The adviser credential was refused — check the key configured for this server');
      return 'not_configured';
    }
    if (e instanceof Anthropic.RateLimitError) return 'busy';
    if (e instanceof Anthropic.APIConnectionError) return 'unreachable';
    if (e instanceof Anthropic.APIError) {
      this.logger.warn(`The adviser request failed with status ${e.status}`);
      return e.status === 529 ? 'busy' : 'unreachable';
    }
    this.logger.warn(`The adviser request failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    return 'unreachable';
  }
}

const norm = (s: string) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The asks behind a plan, in full, read back off the plan itself — the one source for "what was it asked". */
export function askOf(plan: DayPlanView): PlanAskView {
  const pairs = (kind: 'keep_off' | 'put_on') => (plan.rules ?? []).filter((r) => r.kind === kind).map((r) => ({ freightId: r.freightId, vehicleId: r.vehicleId }));
  return {
    day: plan.day,
    excludeVehicleIds: plan.vehicles.filter((v) => v.excluded).map((v) => v.vehicleId),
    dayStart: plan.settings.dayStart,
    dayHours: plan.settings.dayHours,
    speedKmh: plan.settings.speedKmh,
    loadMin: plan.settings.loadMin,
    unloadMin: plan.settings.unloadMin,
    keepOff: pairs('keep_off'),
    putOn: pairs('put_on'),
  };
}

/** The conversation so far, as the API wants it: plain text turns, starting with the dispatcher. */
function turnsOf(history: AdviserTurn[] | undefined): Anthropic.Beta.Messages.BetaMessageParam[] {
  const turns = (history ?? [])
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' && t.text.trim())
    .slice(-ADVISER_MAX_HISTORY)
    .map((t) => ({ role: t.role, content: t.text.trim().slice(0, 4000) }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

/**
 * The plan as the adviser reads it: everything it needs to explain a day, by the names a dispatcher uses (plates and
 * order codes), and nothing it does not — no phone numbers, no contacts, no internal ids.
 */
export function dataOf(plan: DayPlanView) {
  return {
    day: plan.day,
    distances: plan.distances?.source === 'roads' ? `by road, from the routing server${plan.distances.gaps ? ` (${plan.distances.gaps} legs it knew no road for are estimated)` : ''}` : `an estimate: straight lines with an allowance for the road${plan.distances?.why ? ` (${plan.distances.why})` : ''}`,
    settings: { leaveAt: plan.settings.dayStart, longestDayHours: plan.settings.dayHours, speedKmh: plan.settings.speedKmh, loadMinPerOrder: plan.settings.loadMin, handOverMinPerOrder: plan.settings.unloadMin },
    totals: { orders: plan.totals.orders, planned: plan.totals.planned, kg: plan.totals.weightKg, plannedKg: plan.totals.plannedKg, km: plan.totals.km, emptyKm: plan.totals.emptyKm, vehiclesUsed: plan.totals.trucksUsed, vehiclesGoingOut: plan.totals.trucksAvailable, drivers: plan.totals.drivers, outsideTheirWindow: plan.totals.outsideWindow ?? 0, windowsNotRead: plan.totals.unreadWindows ?? 0 },
    ...(plan.hire ? { short: { moreVehiclesNeeded: plan.hire.trucks, eachCarryingKg: plan.hire.capacityKg, forOrders: plan.hire.orders, kg: plan.hire.weightKg } } : {}),
    vehicles: plan.vehicles.map((v) => ({ plate: v.plate, kind: v.vehicleClass, carriesKg: v.capacityKg, ...(v.excluded ? { leftOut: true } : {}), ...(v.offRoad?.length ? { offTheRoad: v.offRoad } : {}) })),
    rules: (plan.rules ?? []).map((r) => ({ rule: r.kind === 'keep_off' ? 'keep off' : 'put on', order: r.code, vehicle: r.plate })),
    days: plan.routes.map((r) => ({
      vehicle: r.plate,
      carriesKg: r.capacityKg,
      hours: Math.round((r.minutes / 60) * 10) / 10,
      homeAbout: r.home,
      km: r.km,
      emptyKm: r.emptyKm,
      trips: r.trips.map((t) => ({
        trip: t.no,
        collectsAt: t.pickupLabel,
        loadsAbout: t.start,
        kg: t.weightKg,
        emptyKmToGetThere: t.emptyKm,
        stops: t.stops.map((s) => ({ order: s.code, for: s.shipperName, to: s.destLabel, kg: s.weightKg, about: s.arrive, ...(s.deliveryWindow ? { askedFor: s.deliveryWindow } : {}), ...(s.window ? { plannedTo: s.window } : {}), ...(s.windowUnread ? { windowNotRead: true } : {}), ...(s.lateMin ? { lateByMin: s.lateMin } : {}), ...(s.earlyMin ? { earlyByMin: s.earlyMin } : {}), ...(s.waitMin ? { waitsMin: s.waitMin } : {}) })),
      })),
    })),
    notPlanned: plan.unplanned.map((u) => ({ order: u.code, for: u.shipperName, to: u.destLabel, kg: u.weightKg, why: WHY[u.reason] })),
  };
}

const WHY: Record<string, string> = {
  no_pin: 'its address has no point on the map, so it cannot be routed',
  too_heavy: "heavier than the fleet's largest vehicle carries at once",
  no_truck_can_carry: 'no vehicle that could handle these goods (equipment, body, or a rule) is big enough',
  no_time: 'every vehicle that could take it has a full day',
  no_driver: 'a vehicle is free for it, but there is no driver left to send out',
  no_trucks: 'no vehicle of the fleet is going out',
};

/**
 * WHAT CHANGED, in words, from the asks before and after. Derived here so that the list under an adviser's reply is a
 * fact about the plan and not the adviser's own summary of what it believes it did.
 */
export function changesBetween(was: DayPlanView, is: DayPlanView): string[] {
  const out: string[] = [];
  const before = askOf(was);
  const after = askOf(is);
  const plate = (id: string) => is.vehicles.find((v) => v.vehicleId === id)?.plate ?? id;
  // A rule's order is named on the plan the rule is in — the one before for a rule taken away, the one after for a new one.
  const codes = new Map<string, string>([...(was.rules ?? []), ...(is.rules ?? [])].map((r) => [r.freightId, r.code]));
  const code = (id: string) => codes.get(id) ?? id;
  if (before.dayStart !== after.dayStart) out.push(`Vehicles leave at ${after.dayStart} (was ${before.dayStart})`);
  if (before.dayHours !== after.dayHours) out.push(`Longest day ${after.dayHours} h (was ${before.dayHours} h)`);
  if (before.speedKmh !== after.speedKmh) out.push(`Speed on the road ${after.speedKmh} km/h (was ${before.speedKmh})`);
  if (before.loadMin !== after.loadMin) out.push(`Loading ${after.loadMin} min an order (was ${before.loadMin})`);
  if (before.unloadMin !== after.unloadMin) out.push(`Handing over ${after.unloadMin} min an order (was ${before.unloadMin})`);
  for (const id of after.excludeVehicleIds.filter((x) => !before.excludeVehicleIds.includes(x))) out.push(`${plate(id)} left out of the plan`);
  for (const id of before.excludeVehicleIds.filter((x) => !after.excludeVehicleIds.includes(x))) out.push(`${plate(id)} back in the plan`);
  const key = (p: { freightId: string; vehicleId: string }) => `${p.freightId}|${p.vehicleId}`;
  const diff = (was: PlanAskView['keepOff'], now: PlanAskView['keepOff'], added: (o: string, v: string) => string, removed: (o: string, v: string) => string) => {
    const wasKeys = new Set(was.map(key));
    const nowKeys = new Set(now.map(key));
    for (const p of now.filter((x) => !wasKeys.has(key(x)))) out.push(added(code(p.freightId), plate(p.vehicleId)));
    for (const p of was.filter((x) => !nowKeys.has(key(x)))) out.push(removed(code(p.freightId), plate(p.vehicleId)));
  };
  diff(before.keepOff, after.keepOff, (o, v) => `${o} kept off ${v}`, (o, v) => `${o} no longer kept off ${v}`);
  diff(before.putOn, after.putOn, (o, v) => `${o} put on ${v}`, (o, v) => `${o} no longer put on ${v}`);
  return out;
}
