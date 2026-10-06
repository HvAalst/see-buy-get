import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { VendorService } from './vendor.service';
import { ParcelService } from './parcel.service';
import { ToteService } from './tote.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { RouteConstraintService } from './route-constraint.service';
import { WalletGateService } from './wallet-gate.service';
import { CargoService } from './cargo.service';
import { MediaService } from './media.service';
import { MarketPulseStore } from './market-pulse.store';
import { MarketPulseService } from './market-pulse.service';
import { RatingService } from './rating.service';
import { MonitorService } from './monitor.service';
import { GraduationService } from './graduation.service';
import { VendorCallbackService } from './vendor-callback.service';
import { ConsignmentService } from './consignment.service';
import { BagPlanService } from './bag-plan.service';
import { ForthcomingService } from './forthcoming.service';
import { DockService } from './dock.service';
import { FleetManagerService } from './fleet-manager.service';
import { DepartureService } from './departure.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CarriageContractService, CONTRACT_LINK_TRIES_PER_HOUR, isDay } from './carriage-contract.service';
import { GazetteerGeocoder, GEOCODER, type Geocoder } from './geocoder';
import { OrderImportService } from './order-import.service';
import { HeuristicRouter, ROUTER } from './router';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BooksService } from '../../foundation/books/books.service';
import { FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';
import type { AgentService as Agents } from './agent.service';
import type { ImportService } from './import.service';
import type { ContractRef } from './carriage-contract.types';

import { FleetPlanService } from './fleet-plan.service';
import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeGateway, ClaudeReply, ClaudeRequest } from './claude.gateway';
import { ADVISER_BRIEF, ADVISER_MAX_HISTORY, ADVISER_MAX_MESSAGE, ADVISER_MAX_STEPS, PlanAdviserService, REPLAN_TOOL } from './plan-adviser.service';
import type { RoadDistances, RoadMatrix } from './road-matrix';
import { ROUTER as ROUTER_TOKEN, type Router } from './router';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
import { GlosError } from '../../foundation/http/glos-error';

const DAY = 86_400_000;

/**
 * A scripted stand-in for the one class that talks to Claude: it answers with what the test queued, in order, and
 * keeps each request as it was at the moment it was sent. No key, no network, nothing spent.
 */
class ScriptedClaude {
  isConfigured = true;
  script: Array<ClaudeReply | Error> = [];
  requests: ClaudeRequest[] = [];
  configured(): boolean {
    return this.isConfigured;
  }
  async create(request: ClaudeRequest): Promise<ClaudeReply> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as ClaudeRequest);
    const next = this.script.shift();
    if (!next) throw new Error('The script ran out: the adviser asked more often than the test expected');
    if (next instanceof Error) throw next;
    return next;
  }
}

/**
 * P5 — THE ADVISER OVER A DAY'S PLAN, on the real solver, orders and trucks, with a scripted stand-in for the model.
 * What is pinned here is everything the model must not be trusted with: that the plan in an answer is the solver's,
 * that "what changed" is derived and not narrated, that a name it gets wrong is handed back and never guessed at,
 * that it is held to a dispatcher's own limits, that nothing is accepted or sent, and that every way of not getting
 * an answer still leaves the dispatcher with a plan. WHAT A REAL MODEL SAYS IS NOT TESTED HERE.
 */
describe('the adviser over a day’s plan', () => {
  let dispatch: DispatchService;
  let drivers: DriverService;
  let vehicles: VehicleService;
  let managers: FleetManagerService;
  let plans: FleetPlanService;
  let claude: ScriptedClaude;
  let adviser: PlanAdviserService;
  /** The same service, with a routing server to ask. */
  let withRoads: (roads: RoadMatrix) => FleetPlanService;
  let heuristic: Router;
  let fleetSvc: FleetService;
  let seq = 0;
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
          AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
          GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
          BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
          DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
          DepartureService, MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
          ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
          WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
          EntityService, PresenceService, BooksService, FxService,
          PayoutService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
          { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
          GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
          HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
        ],
      }).compile();
    moduleRef.get(EntityService).seed();
    moduleRef.get(FxService).seed();
    dispatch = moduleRef.get(DispatchService);
    drivers = moduleRef.get(DriverService);
    vehicles = moduleRef.get(VehicleService);
    managers = moduleRef.get(FleetManagerService);
    fleetSvc = moduleRef.get(FleetService);
    plans = new FleetPlanService(dispatch, vehicles, drivers, managers, moduleRef.get<Router>(ROUTER_TOKEN), fleetSvc, moduleRef.get(EventBus));
    plans.onModuleInit();
    claude = new ScriptedClaude();
    adviser = new PlanAdviserService(plans, claude as unknown as ClaudeGateway);
    heuristic = moduleRef.get<Router>(ROUTER_TOKEN);
    withRoads = (roads) => new FleetPlanService(dispatch, vehicles, drivers, managers, heuristic, fleetSvc, moduleRef.get(EventBus), roads);
  });

  const depot = { lat: -1.2, lng: 36.8 };
  const yard = { lat: -1.3, lng: 36.85 };
  const site = (n: number) => ({ lat: -1.25 + n * 0.02, lng: 36.9 + n * 0.02 });
  const dayPlus = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const tomorrow = () => dayPlus(1);

  function aFleet(name: string) {
    seq += 1;
    const m = managers.register({
      companyName: name, contactPhone: `+25480030${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-PL-${seq}`,
      location: depot,
      requirements: { businessRegistrationNo: `BRN-PL-${seq}`, transportOperatorLicence: `TOL-PL-${seq}`, taxId: `TAX-PL-${seq}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return managers.get(m.did);
  }
  function aDriver(managerDid: string) {
    seq += 1;
    const d = drivers.register({
      displayName: `Driver ${seq}`, fullName: `D ${seq}`, nationalId: `ID-PL-${seq}`, mobile: `+2547830${seq}00`,
      licenceClasses: ['truck'], licenceNumber: `L-PL-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * DAY).toISOString(), criminalRecordClear: true, managerDid,
    });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    return drivers.get(d.did);
  }
  function aTruck(managerDid: string, plate: string, capacityKg: number, equipment: string[] = ['TLT', 'FLT']) {
    return vehicles.register({ plate, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg, ownerName: 'X', equipment, baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid } as never);
  }
  const contractOf = (fleet: { did: string; companyName: string }): ContractRef => ({ contractId: 'ctr_plan', fleetDid: fleet.did, fleetName: fleet.companyName, shipperName: 'Jenga Bricks' });
  function anOrder(fleet: { did: string; companyName: string }, over: { kg?: number; n?: number; day?: string; pinned?: boolean; ref?: string; window?: string; indivisible?: boolean } = {}) {
    seq += 1;
    return dispatch.registerFreight({
      description: `Bricks ${seq}`, pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: `Site ${over.n ?? seq}`,
      ...(over.pinned === false ? {} : { destLocation: site(over.n ?? 1) }),
      weightKg: over.kg ?? 2000, packaging: 'palletised', postedByDid: fleet.did, postedByName: 'Amina', contract: contractOf(fleet), deliverOn: over.day ?? tomorrow(), orderRef: over.ref ?? `WS-${seq}`,
      ...(over.window ? { deliveryWindow: over.window } : {}),
      ...(over.indivisible ? { indivisible: true } : {}),
    });
  }
  /** A fleet with an 8 t and a 3 t truck and two drivers. */
  function setUp() {
    const fleet = aFleet('Kilima Logistics');
    const big = aTruck(fleet.did, 'KPL 008T', 8000);
    const small = aTruck(fleet.did, 'KPL 003T', 3000);
    aDriver(fleet.did);
    aDriver(fleet.did);
    return { fleet, big, small };
  }


  type Plan = ReturnType<FleetPlanService['propose']>;
  const truckOf = (plan: Plan, freightId: string) => plan.routes.find((r) => r.trips.some((t) => t.stops.some((st) => st.freightId === freightId)))?.plate;
  const NOTHING = { day_start: null, day_hours: null, speed_kmh: null, load_min: null, unload_min: null, leave_out: null, keep_off: null, put_on: null };
  let callNo = 0;
  const says = (text: string, stop: string = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text }] }) as unknown as ClaudeReply;
  /** A turn in which the adviser calls replan, once per argument — with a thinking block in front, as a real one has. */
  const replans = (...inputs: Array<Record<string, unknown>>) =>
    ({
      stop_reason: 'tool_use',
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...inputs.map((input) => ({ type: 'tool_use', id: `tu_${++callNo}`, name: 'replan', input: { ...NOTHING, ...input } }))],
    }) as unknown as ClaudeReply;
  const textOf = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content));
  const resultsOf = (request: ClaudeRequest) => request.messages[request.messages.length - 1].content as Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }>;

  /* --------------------------------------------------------- what is asked -- */

  it('says it is not set up when the server has no key — with the plan all the same, and without calling anybody', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    claude.isConfigured = false;
    expect(adviser.status()).toEqual({ configured: false });
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Why two trucks?' });
    expect(out).toMatchObject({ reply: '', failed: 'not_configured', changed: [] });
    expect(out.plan.totals.planned).toBe(1);
    expect(claude.requests).toEqual([]);
  });

  it('sends the plan as data in the dispatcher’s own names, with the one tool, and hands back what was said', async () => {
    const { fleet, big } = setUp();
    const a = anOrder(fleet, { kg: 3000, n: 1 });
    claude.script.push(says('Both orders fit one round on KPL 008T.'));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Why is KPL 003T not going out?' });
    expect(out.reply).toBe('Both orders fit one round on KPL 008T.');
    expect(out.failed).toBeUndefined();
    expect(out.changed).toEqual([]);
    expect(out.plan.routes.map((r) => r.plate)).toEqual(['KPL 008T']);
    expect(out.ask).toEqual({ day: tomorrow(), excludeVehicleIds: [], dayStart: '07:00', dayHours: 10, speedKmh: out.plan.settings.speedKmh, loadMin: out.plan.settings.loadMin, unloadMin: out.plan.settings.unloadMin, keepOff: [], putOn: [] });

    expect(claude.requests).toHaveLength(1);
    const [request] = claude.requests;
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.system).toBe(ADVISER_BRIEF);
    expect(request.tools).toEqual([REPLAN_TOOL]);
    expect(request.output_config).toEqual({ effort: 'medium' });
    expect(request.fallbacks).toBe('default');
    expect(request.betas).toEqual(['server-side-fallback-2026-07-01']);
    // Not this model's to be told: thinking cannot be switched off, and a forced tool choice is refused.
    expect(request).not.toHaveProperty('thinking');
    expect(request).not.toHaveProperty('tool_choice');
    expect(request.messages).toHaveLength(1);
    const sent = textOf(request.messages[0].content);
    expect(sent).toContain('Why is KPL 003T not going out?');
    expect(sent).toContain(a.code);
    expect(sent).toContain('KPL 008T');
    expect(sent).toContain('Jenga yard');
    // By the names a dispatcher uses — never an internal id, which the adviser could only repeat or get wrong.
    expect(sent).not.toContain(a.freightId);
    expect(sent).not.toContain(big.vehicleId);
    expect(sent).not.toContain(fleet.did);
  });

  it('gives the tool a shape the API will hold the adviser to: every object closed, every property required', () => {
    expect(REPLAN_TOOL.strict).toBe(true);
    const closed = (schema: Record<string, unknown>): void => {
      if (schema.type === 'object') {
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(Object.keys(schema.properties as object).sort());
        for (const p of Object.values(schema.properties as Record<string, Record<string, unknown>>)) closed(p);
      }
      for (const alt of (schema.anyOf as Array<Record<string, unknown>>) ?? []) closed(alt);
      if (schema.items) closed(schema.items as Record<string, unknown>);
      // The limits a strict schema may not carry are said in the words, and held by the solver's own checks.
      for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength']) expect(schema).not.toHaveProperty(banned);
    };
    closed(REPLAN_TOOL.input_schema as unknown as Record<string, unknown>);
  });

  /* ------------------------------------------------------- what it changes -- */

  it('changes what the solver is asked — and the plan, the asks and "what changed" all come from the solver, not from the adviser', async () => {
    const { fleet, big } = setUp();
    const a = anOrder(fleet, { kg: 2000, n: 1 });
    const b = anOrder(fleet, { kg: 2000, n: 2 });
    // The adviser names things loosely, as a person would: a plate without its space, a code in lower case.
    const turn = replans({ keep_off: [{ order: a.code.toLowerCase(), vehicle: 'kpl008t' }] });
    claude.script.push(turn, says('Done — it now rides on KPL 003T.'));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: `Keep ${a.code} off the big truck` });

    expect(truckOf(out.plan, a.freightId)).toBe('KPL 003T');
    expect(truckOf(out.plan, b.freightId)).toBeDefined();
    expect(out.plan.rules).toEqual([{ kind: 'keep_off', freightId: a.freightId, code: a.code, vehicleId: big.vehicleId, plate: 'KPL 008T' }]);
    expect(out.ask.keepOff).toEqual([{ freightId: a.freightId, vehicleId: big.vehicleId }]);
    expect(out.changed).toEqual([`${a.code} kept off KPL 008T`]);
    expect(out.reply).toBe('Done — it now rides on KPL 003T.');
    // The same plan the dispatcher would get by asking the solver that themselves.
    const own = plans.propose(fleet.did, out.ask);
    expect(out.plan.routes).toEqual(own.routes);

    // The second call carries the adviser's turn back exactly as it came, and the new plan as the tool's result.
    expect(claude.requests).toHaveLength(2);
    const second = claude.requests[1];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]).toEqual({ role: 'assistant', content: turn.content });
    const [result] = resultsOf(second);
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: (turn.content[1] as { id: string }).id });
    expect(result.is_error).toBeUndefined();
    expect(JSON.parse(result.content).rules).toEqual([{ rule: 'keep off', order: a.code, vehicle: 'KPL 008T' }]);
  });

  it('takes nothing on the adviser’s word: saying it changed the plan changes nothing', async () => {
    const { fleet } = setUp();
    const a = anOrder(fleet, { kg: 2000, n: 1 });
    const before = plans.propose(fleet.did, { day: tomorrow() });
    claude.script.push(says(`I have moved ${a.code} to KPL 003T and started the day at 05:00.`));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Move it' });
    expect(out.changed).toEqual([]);
    expect(out.plan.routes).toEqual(before.routes);
    expect(out.plan.settings).toEqual(before.settings);
    expect(truckOf(out.plan, a.freightId)).toBe('KPL 008T');
  });

  it('accepts nothing and sends nothing: what comes back is a proposal', async () => {
    const { fleet } = setUp();
    const a = anOrder(fleet, { kg: 2000, n: 1 });
    claude.script.push(replans({ put_on: [{ order: a.code, vehicle: 'KPL 003T' }] }), says('Moved.'));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Put it on the small one' });
    expect(truckOf(out.plan, a.freightId)).toBe('KPL 003T');
    expect(out.plan.accepted).toBeUndefined();
    expect(plans.state(fleet.did, tomorrow()).plan).toBeUndefined();
    expect(dispatch.ordersForFleet(fleet.did).every((o) => o.planned === undefined)).toBe(true);
  });

  it('leaves alone what it sends null for, and replaces a list it sends', async () => {
    const { fleet, big, small } = setUp();
    const a = anOrder(fleet, { kg: 2000, n: 1 });
    const ask = { day: tomorrow(), keepOff: [{ freightId: a.freightId, vehicleId: big.vehicleId }], excludeVehicleIds: [] as string[] };

    // A later start, everything else null: the rule stays.
    claude.script.push(replans({ day_start: '09:15' }), says('Later start.'));
    const later = await adviser.advise(fleet.did, { ask, message: 'Start at quarter past nine' });
    expect(later.plan.settings.dayStart).toBe('09:15');
    expect(later.plan.rules).toHaveLength(1);
    expect(later.changed).toEqual(['Vehicles leave at 09:15 (was 07:00)']);

    // An empty list is a list: the rule goes, and is named as gone.
    claude.script.push(replans({ keep_off: [] }), says('Rule removed.'));
    const freed = await adviser.advise(fleet.did, { ask, message: 'Forget that rule' });
    expect(freed.plan.rules).toEqual([]);
    expect(freed.changed).toEqual([`${a.code} no longer kept off KPL 008T`]);
    expect(truckOf(freed.plan, a.freightId)).toBe('KPL 008T');

    // Vehicles left out, by plate; and brought back by an empty list.
    claude.script.push(replans({ leave_out: ['KPL 003T'] }), says('Left out.'));
    const without = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'The small one is in the workshop' });
    expect(without.ask.excludeVehicleIds).toEqual([small.vehicleId]);
    expect(without.changed).toEqual(['KPL 003T left out of the plan']);
    claude.script.push(replans({ leave_out: [] }), says('Back.'));
    const back = await adviser.advise(fleet.did, { ask: without.ask, message: 'It is back' });
    expect(back.ask.excludeVehicleIds).toEqual([]);
    expect(back.changed).toEqual(['KPL 003T back in the plan']);
  });

  it('says every setting it changed, each with what it was', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    claude.script.push(replans({ day_hours: 12, speed_kmh: 25, load_min: 45, unload_min: 35 }), says('Slower day.'));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Rain tomorrow' });
    const was = plans.propose(fleet.did, { day: tomorrow() }).settings;
    expect(out.changed).toEqual([`Longest day 12 h (was ${was.dayHours} h)`, `Speed on the road 25 km/h (was ${was.speedKmh})`, `Loading 45 min an order (was ${was.loadMin})`, `Handing over 35 min an order (was ${was.unloadMin})`]);
  });

  /* ----------------------------------------------- what it is not let do -- */

  it('hands a name it does not know back to the adviser as an error, with the names there are — and guesses at nothing', async () => {
    const { fleet } = setUp();
    const other = aFleet('Pwani Haulage');
    aTruck(other.did, 'PWN 001T', 8000);
    const theirs = anOrder(other);
    const a = anOrder(fleet, { kg: 2000, n: 1 });
    const before = plans.propose(fleet.did, { day: tomorrow() });
    claude.script.push(
      replans({ leave_out: ['KPL 999X'] }),
      replans({ keep_off: [{ order: a.code, vehicle: 'PWN 001T' }] }),
      replans({ put_on: [{ order: theirs.code, vehicle: 'KPL 003T' }] }),
      says('I could not find those.'),
    );
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Leave out KPL 999X' });
    expect(out.changed).toEqual([]);
    expect(out.plan.routes).toEqual(before.routes);
    expect(out.plan.rules).toEqual([]);
    const [noPlate] = resultsOf(claude.requests[1]);
    expect(noPlate.is_error).toBe(true);
    expect(noPlate.content).toMatch(/No vehicle with the plate "KPL 999X"/);
    expect(noPlate.content).toContain('KPL 008T, KPL 003T');
    // Another fleet's truck, and another fleet's order: not in this plan, so not there to be named.
    expect(resultsOf(claude.requests[2])[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/No vehicle with the plate "PWN 001T"/) });
    expect(resultsOf(claude.requests[3])[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/No order with the code/) });
  });

  it('holds the adviser to the limits a dispatcher is held to: a 20-hour day is refused in the same words', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    let own = '';
    try {
      plans.propose(fleet.did, { day: tomorrow(), dayHours: 20 });
    } catch (e) {
      own = (e as Error).message;
    }
    expect(own).toMatch(/between 1 and 13/);
    claude.script.push(replans({ day_hours: 20 }), says('The longest day is 13 hours.'));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Let them drive 20 hours' });
    expect(resultsOf(claude.requests[1])[0]).toMatchObject({ is_error: true, content: own });
    expect(out.plan.settings.dayHours).toBe(10);
    expect(out.changed).toEqual([]);
  });

  it('answers every call of a turn, and refuses a tool that does not exist', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    const turn = replans({ day_start: '08:00' }, { day_hours: 9 });
    (turn.content as unknown as Array<Record<string, unknown>>).push({ type: 'tool_use', id: 'tu_other', name: 'accept_plan', input: {} });
    claude.script.push(turn, says('Both done.'));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Start at eight, nine hours' });
    const results = resultsOf(claude.requests[1]);
    expect(results.map((r) => r.tool_use_id)).toEqual([...(turn.content as unknown as Array<{ type: string; id: string }>).filter((b) => b.type === 'tool_use').map((b) => b.id)]);
    expect(results.map((r) => Boolean(r.is_error))).toEqual([false, false, true]);
    expect(results[2].content).toMatch(/no tool called accept_plan/);
    // One after the other, each on top of the last.
    expect(out.plan.settings).toMatchObject({ dayStart: '08:00', dayHours: 9 });
    expect(out.changed).toHaveLength(2);
  });

  it('stops after a few rounds, with the last plan the solver made and what really changed', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    for (let i = 0; i < ADVISER_MAX_STEPS + 3; i++) claude.script.push(replans({ load_min: 10 + i }));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Keep trying' });
    expect(claude.requests).toHaveLength(ADVISER_MAX_STEPS);
    expect(out.plan.settings.loadMin).toBe(10 + ADVISER_MAX_STEPS - 1);
    expect(out.changed).toHaveLength(1);
    expect(out.reply).toMatch(/last one worked out/);
    expect(out.failed).toBeUndefined();
  });

  /* --------------------------------------------------- when it cannot answer -- */

  it('reads why it stopped before what it said: a decline is said as one, whatever text came with it', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    claude.script.push(says('Partial words that must not be shown as an answer', 'refusal'));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Something' });
    expect(out).toMatchObject({ reply: '', failed: 'declined', changed: [] });
    expect(out.plan.totals.planned).toBe(1);
  });

  it('says which kind of failure it was — and the plan is there regardless', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    const headers = new Headers();
    const cases: Array<[Error, string]> = [
      [new Anthropic.RateLimitError(429, undefined, 'slow down', headers), 'busy'],
      [new Anthropic.APIError(529, undefined, 'overloaded', headers), 'busy'],
      [new Anthropic.AuthenticationError(401, undefined, 'bad key', headers), 'not_configured'],
      [new Anthropic.PermissionDeniedError(403, undefined, 'no', headers), 'not_configured'],
      [new Anthropic.APIConnectionError({ message: 'no route' }), 'unreachable'],
      [new Anthropic.InternalServerError(500, undefined, 'boom', headers), 'unreachable'],
      [new Error('something else entirely'), 'unreachable'],
    ];
    for (const [error, failed] of cases) {
      claude.script.push(error);
      const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Why?' });
      expect([error.constructor.name, out.failed, out.reply]).toEqual([error.constructor.name, failed, '']);
      expect(out.plan.totals.planned).toBe(1);
    }
  });

  it('keeps a change made before it failed: the plan and "what changed" are the solver’s, with or without a last word', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    claude.script.push(replans({ day_start: '06:00' }), new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()));
    const out = await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Start at six' });
    expect(out).toMatchObject({ reply: '', failed: 'busy', changed: ['Vehicles leave at 06:00 (was 07:00)'] });
    expect(out.plan.settings.dayStart).toBe('06:00');
    expect(out.ask.dayStart).toBe('06:00');
  });

  it('keeps what the last question met, for staff: an answer, which failure, a decline as an answer — and never the key', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    const t0 = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const asks = (ms: number) => adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Why?' }, ms);
    // Before anybody has asked, there is nothing to say of a last time.
    expect(adviser.connection()).toEqual({ configured: true, model: 'claude-opus-5-5' });
    claude.script.push(says('Because of the weight.'));
    await asks(t0);
    expect(adviser.connection()).toEqual({ configured: true, model: 'claude-opus-5-5', last: { at: iso(t0), ok: true } });
    // It failed: staff read which kind, in the words the office was given.
    claude.script.push(new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()));
    await asks(t0 + 60_000);
    expect(adviser.connection().last).toEqual({ at: iso(t0 + 60_000), ok: false, failed: 'busy' });
    claude.script.push(new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key sk-ant-secret', new Headers()));
    await asks(t0 + 120_000);
    expect(adviser.connection().last).toEqual({ at: iso(t0 + 120_000), ok: false, failed: 'not_configured' });
    expect(JSON.stringify(adviser.connection())).not.toContain('sk-ant');
    // A round that worked and then one that did not: the last call is the one that is kept.
    claude.script.push(replans({ day_start: '06:00' }), new Anthropic.APIConnectionError({ message: 'no route' }));
    await asks(t0 + 180_000);
    expect(adviser.connection().last).toEqual({ at: iso(t0 + 180_000), ok: false, failed: 'unreachable' });
    // A decline is an answer: the service is there, and would not say this.
    claude.script.push(says('No', 'refusal'));
    await asks(t0 + 240_000);
    expect(adviser.connection().last).toEqual({ at: iso(t0 + 240_000), ok: true });
    // With no key nobody is called, and what the last call met stands as it was.
    claude.isConfigured = false;
    await asks(t0 + 300_000);
    expect(adviser.connection()).toEqual({ configured: false, model: 'claude-opus-5-5', last: { at: iso(t0 + 240_000), ok: true } });
  });

  /* ------------------------------------------------------ the conversation -- */

  it('carries the talk so far as plain words, starting with the dispatcher, the newest turns only', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    const history = [
      { role: 'assistant' as const, text: 'An answer with no question before it' },
      ...Array.from({ length: 9 }, (_, i) => [
        { role: 'user' as const, text: `Question ${i}` },
        { role: 'assistant' as const, text: `Answer ${i}` },
      ]).flat(),
      { role: 'user' as const, text: '   ' },
    ];
    claude.script.push(says('Yes.'));
    await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'And now?', history });
    const { messages } = claude.requests[0];
    expect(messages[0].role).toBe('user');
    expect(messages.length).toBeLessThanOrEqual(ADVISER_MAX_HISTORY + 1);
    expect(messages.slice(0, -1).every((m) => typeof m.content === 'string')).toBe(true);
    expect(messages[messages.length - 2]).toEqual({ role: 'assistant', content: 'Answer 8' });
    expect(textOf(messages[messages.length - 1].content)).toContain('And now?');
    expect(JSON.stringify(messages)).not.toContain('no question before it');
    // Only the turn of NOW carries a plan: an old turn can never describe a day that has since changed.
    expect(messages.filter((m) => textOf(m.content).includes('as data')).length).toBe(1);
  });

  it('never opens the talk with the adviser’s own words: a short history that starts with a reply loses that reply', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    claude.script.push(says('Yes.'));
    await adviser.advise(fleet.did, {
      ask: { day: tomorrow() },
      message: 'And now?',
      history: [
        { role: 'assistant', text: 'A reply whose question was cut off' },
        { role: 'user', text: 'Why two trucks?' },
        { role: 'assistant', text: 'Because of the weight.' },
      ],
    });
    const { messages } = claude.requests[0];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0].content).toBe('Why two trucks?');
  });

  it('refuses an empty or an endless message, and a bad ask, before anybody is called', async () => {
    const { fleet } = setUp();
    anOrder(fleet);
    await expect(adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: '   ' })).rejects.toThrow(/Say what you want to know/);
    await expect(adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'x'.repeat(ADVISER_MAX_MESSAGE + 1) })).rejects.toThrow(/Keep it under/);
    await expect(adviser.advise(fleet.did, { ask: { day: dayPlus(-1) }, message: 'Why?' })).rejects.toThrow(/That day has gone/);
    await expect(adviser.advise(fleet.did, { ask: { day: tomorrow(), dayHours: 20 }, message: 'Why?' })).rejects.toThrow(/between 1 and 13/);
    expect(claude.requests).toEqual([]);
  });

  /* ----------------------------------------------------- what it is told -- */

  it('tells the adviser why each order was left out, in words, and how many vehicles short the day is', async () => {
    const fleet = aFleet('Kilima Logistics');
    aTruck(fleet.did, 'KPL 003T', 3000);
    aDriver(fleet.did);
    const heavy = anOrder(fleet, { kg: 6000, n: 1 });
    const lost = anOrder(fleet, { kg: 500, n: 2, pinned: false });
    claude.script.push(says('One is too heavy; one has no point on the map.'));
    await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'What is left?' });
    const sent = textOf(claude.requests[0].messages[0].content);
    const data = JSON.parse(sent.slice(sent.indexOf('{'), sent.lastIndexOf('}') + 1));
    const why = Object.fromEntries(data.notPlanned.map((o: { order: string; why: string }) => [o.order, o.why]));
    expect(why[heavy.code]).toMatch(/heavier than the fleet's largest vehicle/);
    expect(why[lost.code]).toMatch(/no point on the map/);
    expect(data.vehicles).toEqual([{ plate: 'KPL 003T', kind: 'truck', carriesKg: 3000 }]);
    expect(data.totals).toMatchObject({ orders: 2, planned: 0, drivers: 1 });
  });

  it('tells the adviser what came of each window: what was read, who is late, who waits, and what was not read', async () => {
    const { fleet } = setUp();
    const late = anOrder(fleet, { kg: 1000, n: 2, window: 'before 07:05' });
    const waits = anOrder(fleet, { kg: 1000, n: 1, window: 'after 15:00' });
    const unread = anOrder(fleet, { kg: 1000, n: 3, window: 'morning' });
    claude.script.push(says('One is late.'));
    await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Who is late?' });
    const sent = textOf(claude.requests[0].messages[0].content);
    const data = JSON.parse(sent.slice(sent.indexOf('{'), sent.lastIndexOf('}') + 1));
    const stops = Object.fromEntries(data.days.flatMap((d: { trips: Array<{ stops: Array<{ order: string }> }> }) => d.trips.flatMap((t) => t.stops)).map((s: { order: string }) => [s.order, s]));
    expect(stops[late.code]).toMatchObject({ askedFor: 'before 07:05', plannedTo: 'before 07:05' });
    expect(stops[late.code].lateByMin).toBeGreaterThan(0);
    expect(stops[waits.code]).toMatchObject({ plannedTo: 'from 15:00', about: '15:00' });
    expect(stops[waits.code].waitsMin).toBeGreaterThan(0);
    expect(stops[unread.code]).toMatchObject({ askedFor: 'morning', windowNotRead: true });
    expect(stops[unread.code].plannedTo).toBeUndefined();
    expect(data.totals).toMatchObject({ outsideTheirWindow: 1, windowsNotRead: 1 });
  });

  it('tells the adviser what the plan’s distances are — and plans again on the same roads when it changes an ask', async () => {
    const { fleet } = setUp();
    anOrder(fleet, { kg: 2000, n: 1 });
    claude.script.push(says('Estimated.'));
    await adviser.advise(fleet.did, { ask: { day: tomorrow() }, message: 'How far is it?' });
    const dataIn = (request: ClaudeRequest) => {
      const sent = textOf(request.messages[0].content);
      return JSON.parse(sent.slice(sent.indexOf('{'), sent.lastIndexOf('}') + 1));
    };
    expect(dataIn(claude.requests[0]).distances).toBe('an estimate: straight lines with an allowance for the road');

    // With a routing server: said as by road, in the plan it is first shown AND in the one it asks for.
    const asked: unknown[] = [];
    const routed = new PlanAdviserService(
      withRoads({
        between: async (points) => {
          asked.push(points);
          return { source: 'roads', gaps: 1, km: (a, b) => heuristic.roadKm(a, b) * 2 };
        },
      }),
      claude as unknown as ClaudeGateway,
    );
    claude.script.push(replans({ day_start: '08:00' }), says('Later.'));
    const out = await routed.advise(fleet.did, { ask: { day: tomorrow() }, message: 'Start at eight' });
    expect(dataIn(claude.requests[1]).distances).toBe('by road, from the routing server (1 legs it knew no road for are estimated)');
    expect(JSON.parse(resultsOf(claude.requests[2])[0].content).distances).toMatch(/^by road/);
    expect(out.plan.distances).toEqual({ source: 'roads', gaps: 1 });
    expect(out.plan.settings.dayStart).toBe('08:00');
    expect(asked).toHaveLength(2);
    // A routing server that is down is said to the adviser in the plan's own words.
    const down = new PlanAdviserService(withRoads({ between: async () => ({ source: 'estimate', why: 'the routing server could not be reached', km: (a, b) => heuristic.roadKm(a, b) }) }), claude as unknown as ClaudeGateway);
    claude.script.push(says('Estimated, for now.'));
    await down.advise(fleet.did, { ask: { day: tomorrow() }, message: 'How far?' });
    expect(dataIn(claude.requests[3]).distances).toBe('an estimate: straight lines with an allowance for the road (the routing server could not be reached)');
  });

  it('gives the adviser its limits in the brief: what it may not invent, what the tool cannot say, and that nothing is sent', () => {
    for (const must of ['never state something about the plan that is not in the plan data', 'replaces the list in force', 'changing a delivery window', 'nothing is left out because of a window', '13 hours', 'says what its distances are', 'Say "about" with times', 'accepts a plan or sends anything to a driver', 'language the dispatcher writes in']) {
      expect(ADVISER_BRIEF).toContain(must);
    }
  });
});
