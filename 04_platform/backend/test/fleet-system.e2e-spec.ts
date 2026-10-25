import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EventBus } from '../src/foundation/events/event-bus.service';
import { GlosEvent } from '../src/foundation/events/glos-events';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { FleetHookService } from '../src/modules/pudo/fleet-hooks.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { declared } from './declared';
import { AGREED } from './agreed';

/**
 * A FLEET'S OWN SYSTEM, TOLD OF ITS WORK, over the wire (the user, round 11: the events recommended; the money on each load
 * we pay it for and nothing else about money; where its vehicles are is the fleet's own choice, and the driver is told;
 * any manager sets it up, under their own name). Orders come in, are put on a truck, split and put back together through
 * the booted app's own doors; the goods' later steps are moved in the running app's store and said on its bus.
 */
describe('a fleet’s own system, told of its work, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  let receiver: Server;
  let origin = '';
  let landed: Array<{ path: string; event: string; delivery: string; signature: string; raw: string }> = [];
  let answer = 200;
  const settle = () => new Promise((r) => setImmediate(r));
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ path: String(req.url), event: String(req.headers['x-sbg-event']), delivery: String(req.headers['x-sbg-delivery']), signature: String(req.headers['x-sbg-signature']), raw: Buffer.concat(chunks).toString() });
        res.writeHead(answer);
        res.end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const a = receiver.address();
    origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  /** An active fleet, and its office signed in. */
  async function aFleet(name: string): Promise<{ did: string; office: string; name: string; email: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const email = `fleet-${tag}-${n}@example.com`;
    const m = managers.register({
      companyName: `${name} ${n}`, contactPhone: `+2548${n}4`, contactEmail: email, ownerFullName: 'O O', ownerNationalId: `MGR-SYS-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-SYS-${n}`, transportOperatorLicence: `TOL-SYS-${n}`, taxId: `TAX-SYS-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    declared(app, 'fleet', m.did);
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: m.did, office, name: m.companyName, email };
  }

  /** One of a fleet's drivers, signed in to the driver app, out on a shift in one of its trucks. */
  async function onShiftIn(fleetDid: string, fleetName: string): Promise<{ did: string; token: string; truckId: string; plate: string }> {
    const n = digits();
    const phone = `+2547${digits()}5`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Kamau', fullName: 'Kamau Driver', nationalId: `ID-SYS-${n}`, mobile: phone, licenceClasses: ['truck'], licenceNumber: `L-SYS-${n}`, licenceExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: fleetDid }).expect(201);
    const did = onboarded.body.did as string;
    await http().post(`/v1/sbg/fleet/drivers/${did}/submit-kyc`).set(bearer(operator)).send({ idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${did}/kyc-decision`).set(bearer(operator)).send({ approve: true, by: 'Test' }).expect(201);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `sysdrv${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    const token = session.body.token.access_token as string;
    const plate = `SYS ${n.slice(-3)}T`;
    const truck = app.get(VehicleService).register({ plate, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: fleetName, equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: fleetDid } as never);
    await http().post(`/v1/sbg/fleet/drivers/${did}/start-session`).set(bearer(token)).send({ vehicleId: truck.vehicleId, pin: PIN }).expect(201);
    return { did, token, truckId: truck.vehicleId, plate };
  }

  /** An order under the fleet's contract, as an uploaded sheet places one. */
  function anOrder(fleet: { did: string; name: string }, contractId: string, kg: number, what: string) {
    return app.get(DispatchService).registerFreight({
      description: what,
      pickupLocation: { lat: -1.31, lng: 36.85 },
      pickupLabel: 'Industrial Area depot',
      destLabel: 'Thika town',
      destLocation: { lat: -1.03, lng: 37.07 },
      weightKg: kg,
      postedByDid: fleet.did,
      postedByName: 'The office',
      contract: { contractId, fleetDid: fleet.did, fleetName: fleet.name, shipperName: 'Mama Mboga Wholesale' },
      deliverOn: tomorrow(),
    });
  }

  const bodyOf = (l: { raw: string }) => JSON.parse(l.raw) as { event: string; at: string; data: Record<string, any> };
  const signedWith = (secret: string, l: { raw: string; signature: string }) => timingSafeEqual(Buffer.from(createHmac('sha256', secret).update(l.raw).digest('hex')), Buffer.from(l.signature));

  it('tells its system of its orders and loads as its own screens read them — the money only where we pay it, and only its own', async () => {
    const fleet = await aFleet('Pwani Hauliers');
    const rival = await aFleet('Rival Hauliers');
    const hooks = app.get(FleetHookService);
    const own = `/v1/sbg/fleet/managers/${encodeURIComponent(fleet.did)}`;

    // Its office only: staff are refused by name, another fleet as not its own.
    const staff = await http().get(`${own}/system`).set(bearer(operator)).expect(403);
    expect(staff.body.detail ?? staff.body.message).toMatch(/Network staff/);
    await http().get(`${own}/system`).set(bearer(rival.office)).expect(403);
    expect((await http().get(`${own}/system`).set(bearer(fleet.office)).expect(200)).body).toMatchObject({ hasSecret: false, messages: [], events: expect.arrayContaining(['order.received', 'order.removed', 'load.assigned', 'load.delivered', 'vehicle.broke_down', 'run.booked', 'plan.accepted']) });
    expect((await http().get(`${own}/system`).set(bearer(fleet.office)).expect(200)).body.events).not.toContain('vehicle.position');

    // Any manager gives the address, under their name; the secret is shown once.
    await http().put(`${own}/system`).set(bearer(fleet.office)).send({ url: 'not an address' }).expect(400);
    await http().put(`${own}/system`).set(bearer(operator)).send({ url: `${origin}/a` }).expect(403);
    const set = (await http().put(`${own}/system`).set(bearer(fleet.office)).send({ url: `${origin}/a` }).expect(200)).body;
    expect(set).toMatchObject({ url: `${origin}/a`, setBy: fleet.name, hasSecret: true, secretTurnedBy: fleet.name });
    const secret = set.secret as string;
    expect(secret).toMatch(/^whsec_/);
    expect((await http().get(`${own}/system`).set(bearer(fleet.office)).expect(200)).body.secret).toBeUndefined();
    // The rival has a system of its own, and hears nothing of this fleet's work.
    await http().put(`/v1/sbg/fleet/managers/${encodeURIComponent(rival.did)}/system`).set(bearer(rival.office)).send({ url: `${origin}/rival` }).expect(200);

    // An order comes in.
    const contractId = (await http().post(`${own}/contracts`).set(bearer(fleet.office)).send({ shipperName: 'Mama Mboga Wholesale' }).expect(201)).body.contractId as string;
    landed = [];
    const order = anOrder(fleet, contractId, 2000, 'Maize flour, 40 bags');
    await settle();
    await hooks.drain();
    expect(landed.map((l) => [l.path, l.event])).toEqual([['/a', 'order.received']]);
    expect(signedWith(secret, landed[0])).toBe(true);
    // Exactly what its own Orders screen reads about that order, and nothing more.
    const row = (await http().get(`${own}/orders`).set(bearer(fleet.office)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === order.freightId);
    const received = bodyOf(landed[0]).data.order;
    expect(received).toMatchObject({ freightId: order.freightId, code: order.code, status: 'ordered', role: 'own' });
    for (const key of Object.keys(received)) expect(row).toHaveProperty(key);

    // The office puts it on a driver: said once, as put on a driver — and it is priced between the parties, so no money.
    const driver = await onShiftIn(fleet.did, fleet.name);
    landed = [];
    await http().post(`${own}/dispatch`).set(bearer(fleet.office)).send({ freightId: order.freightId, driverDid: driver.did }).expect(201);
    await settle();
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['load.assigned']);
    const assigned = bodyOf(landed[0]).data;
    expect(assigned.order).toMatchObject({ freightId: order.freightId, status: 'claimed', driverName: 'Kamau', plate: driver.plate });
    expect(assigned.load).toMatchObject({ freightId: order.freightId, direct: true, driverName: 'Kamau' });
    expect(assigned.load).not.toHaveProperty('earning');
    expect(assigned.load).not.toHaveProperty('paid');

    // A load off the open board, which WE pay the fleet for: its money comes with it, as its Earnings screen reads it.
    const dispatch = app.get(DispatchService);
    const board = dispatch.registerFreight({ description: 'Cement, 10 bags', pickupLocation: { lat: -1.3, lng: 36.84 }, pickupLabel: 'Athi River yard', destLabel: 'Ruiru', destLocation: { lat: -1.15, lng: 36.96 }, weightKg: 500 });
    await settle();
    await hooks.drain();
    landed = [];
    await http().post(`${own}/dispatch`).set(bearer(fleet.office)).send({ freightId: board.freightId, driverDid: driver.did }).expect(201);
    await settle();
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['load.assigned']);
    const paid = bodyOf(landed[0]).data;
    expect(paid.order).toBeUndefined();
    expect(paid.load).toMatchObject({ freightId: board.freightId, paid: false, earning: expect.any(Number) });
    expect(paid.load.earning).toBeGreaterThan(0);
    const earnings = (await http().get(`${own}/earnings`).set(bearer(fleet.office)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === board.freightId);
    expect(paid.load.earning).toBe(earnings.earning);
    for (const key of Object.keys(paid.load)) expect(earnings).toHaveProperty(key);

    // The goods move on: picked up, then the board load withdrawn — a load, not one of its orders.
    const store = (dispatch as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const bus = app.get(EventBus);
    const say = async (freightId: string, topic: string, payload: Record<string, unknown>, patch: Record<string, unknown>) => {
      store.set(freightId, { ...store.get(freightId), ...patch });
      await bus.publish(topic, { freightId, ...payload }, { source: 'test' });
      await hooks.drain();
    };
    landed = [];
    await say(order.freightId, GlosEvent.Pudo.FreightPickedUp, { code: order.code }, { status: 'in_transit', pickedUpAt: new Date().toISOString() });
    await say(board.freightId, GlosEvent.Pudo.FreightCancelled, { code: board.code, reason: 'test' }, { status: 'cancelled', cancellation: { by: 'did:glos:someone', role: 'shipper', reason: 'test', at: new Date().toISOString() } });
    expect(landed.map((l) => l.event)).toEqual(['load.picked_up', 'load.cancelled']);
    expect(bodyOf(landed[0]).data.order).toMatchObject({ status: 'in_transit' });
    expect(bodyOf(landed[1]).data.order).toBeUndefined();

    // A driver gives a board load back: the fleet no longer carries it, and its system hears it, with the driver's words.
    const another = dispatch.registerFreight({ description: 'Sugar, 6 bags', pickupLocation: { lat: -1.3, lng: 36.84 }, pickupLabel: 'Athi River yard', destLabel: 'Juja', destLocation: { lat: -1.1, lng: 37.01 }, weightKg: 300 });
    await http().post(`${own}/dispatch`).set(bearer(fleet.office)).send({ freightId: another.freightId, driverDid: driver.did }).expect(201);
    await settle();
    await hooks.drain();
    landed = [];
    await http().post(`/v1/sbg/dispatch/freight/${another.freightId}/hand-back`).set(bearer(driver.token)).send({ reason: 'The truck is full already' }).expect(201);
    await settle();
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['load.handed_back']);
    expect(bodyOf(landed[0]).data).toEqual({ handBack: { freightId: another.freightId, code: another.code, driverDid: driver.did, driverName: 'Kamau', reason: 'The truck is full already', at: expect.any(String) } });

    // Split in two, and put back together: the order changed, a load came in — and then left its Orders.
    const big = anOrder(fleet, contractId, 3000, 'Rice, 60 bags');
    await settle();
    await hooks.drain();
    landed = [];
    const split = (await http().post(`${own}/orders/${big.freightId}/split`).set(bearer(fleet.office)).send({ loadsKg: [1500, 1500] }).expect(201)).body.loads as Array<{ freightId: string }>;
    await settle();
    await hooks.drain();
    const second = split.find((l) => l.freightId !== big.freightId)!.freightId;
    expect(landed.map((l) => [l.event, bodyOf(l).data.order.freightId])).toEqual(expect.arrayContaining([['order.changed', big.freightId], ['order.received', second]]));
    expect(landed).toHaveLength(2);
    landed = [];
    await http().post(`${own}/orders/${big.freightId}/rejoin`).set(bearer(fleet.office)).expect(201);
    await settle();
    await hooks.drain();
    expect(landed.map((l) => [l.event, bodyOf(l).data.order.freightId])).toEqual(expect.arrayContaining([['order.changed', big.freightId], ['order.removed', second]]));
    expect(bodyOf(landed.find((l) => l.event === 'order.removed')!).data.order).toEqual({ freightId: second, code: expect.any(String) });

    // An order the office uploaded, withdrawn: one of its orders cancelled, as its Orders screen now reads it.
    const beans = anOrder(fleet, contractId, 400, 'Beans, 8 bags');
    await settle();
    await hooks.drain();
    landed = [];
    await http().post(`${own}/orders/${beans.freightId}/withdraw`).set(bearer(fleet.office)).send({ reason: 'The shipper called it off' }).expect(201);
    await settle();
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['order.cancelled']);
    expect(bodyOf(landed[0]).data.order).toMatchObject({ freightId: beans.freightId, status: 'cancelled' });

    // The day's plan, accepted: its system hears the plan — and not each order on it again.
    landed = [];
    const plan = (await http().post(`${own}/plan/accept`).set(bearer(fleet.office)).send({ day: tomorrow() }).expect(201)).body;
    await settle();
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['plan.accepted']);
    expect(bodyOf(landed[0]).data.plan).toMatchObject({ day: tomorrow(), accepted: { at: plan.accepted.at }, totals: plan.totals });

    // A step that changes nothing it sees is not said again; nothing of this fleet's ever went to the rival's system.
    landed = [];
    await bus.publish(GlosEvent.Pudo.OrderChanged, { freightId: big.freightId }, { source: 'test' });
    await hooks.drain();
    expect(landed).toEqual([]);
    expect((await http().get(`/v1/sbg/fleet/managers/${encodeURIComponent(rival.did)}/system`).set(bearer(rival.office)).expect(200)).body.messages).toEqual([]);
  });

  it('sends where its vehicles are only once the fleet turns it on, as often as it chose — and the driver is told', async () => {
    const fleet = await aFleet('Kilifi Movers');
    const hooks = app.get(FleetHookService);
    const own = `/v1/sbg/fleet/managers/${encodeURIComponent(fleet.did)}`;
    const driver = await onShiftIn(fleet.did, fleet.name);
    const sessionOf = async () => (await http().get(`/v1/sbg/fleet/drivers/${driver.did}/session`).set(bearer(driver.token)).expect(200)).body;
    const locate = (lat: number, lng: number) => http().post(`/v1/sbg/fleet/drivers/${driver.did}/locate`).set(bearer(driver.token)).send({ lat, lng }).expect(201);

    // Not before an address, and not in a step nobody offered.
    const early = await http().put(`${own}/system/positions`).set(bearer(fleet.office)).send({ everyMin: 5 }).expect(400);
    expect(early.body.detail ?? early.body.message).toMatch(/address first/);
    const secret = (await http().put(`${own}/system`).set(bearer(fleet.office)).send({ url: `${origin}/pos` }).expect(200)).body.secret as string;
    await http().put(`${own}/system/positions`).set(bearer(fleet.office)).send({ everyMin: 7 }).expect(400);
    await http().put(`${own}/system/positions`).set(bearer(operator)).send({ everyMin: 5 }).expect(403);

    // Off: nothing is sent, and the driver's app says nothing.
    landed = [];
    await locate(-1.28, 36.82);
    await settle();
    await hooks.drain();
    expect(landed).toEqual([]);
    expect(await sessionOf()).not.toHaveProperty('positionsToFleetSystem');

    // On, every minute: the driver is told, one position goes, the next within the minute waits.
    const on = (await http().put(`${own}/system/positions`).set(bearer(fleet.office)).send({ everyMin: 1 }).expect(200)).body;
    expect(on.positions).toMatchObject({ everyMin: 1, setBy: fleet.name, delivered: 0, notDelivered: 0 });
    expect(on.events).toContain('vehicle.position');
    expect((await sessionOf()).positionsToFleetSystem).toEqual({ fleetName: fleet.name, everyMin: 1 });
    await locate(-1.27, 36.83);
    await settle();
    await hooks.drain();
    await locate(-1.26, 36.84);
    await settle();
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['vehicle.position']);
    expect(signedWith(secret, landed[0])).toBe(true);
    expect(bodyOf(landed[0]).data.position).toMatchObject({ plate: driver.plate, vehicleClass: 'truck', driverName: 'Kamau', location: { lat: -1.27, lng: 36.83 } });
    // Counted, never listed.
    const read = (await http().get(`${own}/system`).set(bearer(fleet.office)).expect(200)).body;
    expect(read.positions).toMatchObject({ delivered: 1, notDelivered: 0, lastDeliveredAt: expect.any(String) });
    expect(read.messages.filter((m: { event: string }) => m.event === 'vehicle.position')).toEqual([]);

    // Its system down: a position is tried once, and the next replaces it — never retried for days.
    answer = 503;
    landed = [];
    hooks.queuePosition(driver.did, { lat: -1.25, lng: 36.85 }, Date.now() + 61_000);
    await hooks.drain();
    await hooks.drain();
    expect(landed).toHaveLength(1);
    expect((await http().get(`${own}/system`).set(bearer(fleet.office)).expect(200)).body.positions).toMatchObject({ delivered: 1, notDelivered: 1, lastError: expect.any(String) });
    answer = 200;

    // A breakdown on the road: its system hears it as the office's own screen reads it.
    landed = [];
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/breakdown`).set(bearer(driver.token)).send({ cause: 'engine', note: 'Steam from the bonnet' }).expect(201);
    await settle();
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['vehicle.broke_down']);
    expect(bodyOf(landed[0]).data.breakdown).toMatchObject({ plate: driver.plate, cause: 'engine', status: 'open', driverName: 'Kamau' });

    // Off again: the driver's app stops saying it, and nothing more is sent.
    await http().put(`${own}/system/positions`).set(bearer(fleet.office)).send({ everyMin: 0 }).expect(200);
    expect(await sessionOf()).not.toHaveProperty('positionsToFleetSystem');
    landed = [];
    hooks.queuePosition(driver.did, { lat: -1.24, lng: 36.86 }, Date.now() + 10 * 61_000);
    await hooks.drain();
    expect(landed).toEqual([]);

    // On, but the shift is over: where the driver is, off a shift, is nobody's business — not sent, and not said.
    await http().put(`${own}/system/positions`).set(bearer(fleet.office)).send({ everyMin: 15 }).expect(200);
    expect((await sessionOf()).positionsToFleetSystem).toEqual({ fleetName: fleet.name, everyMin: 15 });
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/end-session`).set(bearer(driver.token)).send({}).expect(201);
    expect(await sessionOf()).not.toHaveProperty('positionsToFleetSystem');
    hooks.queuePosition(driver.did, { lat: -1.23, lng: 36.87 }, Date.now() + 60 * 61_000);
    await hooks.drain();
    expect(landed).toEqual([]);
  });

  it('reads back what became of each, sends one again under a new secret, and tells the fleet once a day when its system stays down', async () => {
    const fleet = await aFleet('Lamu Freight');
    const rival = await aFleet('Other Freight');
    const hooks = app.get(FleetHookService);
    const own = `/v1/sbg/fleet/managers/${encodeURIComponent(fleet.did)}`;
    const secret = (await http().put(`${own}/system`).set(bearer(fleet.office)).send({ url: `${origin}/down` }).expect(200)).body.secret as string;
    const contractId = (await http().post(`${own}/contracts`).set(bearer(fleet.office)).send({ shipperName: 'Bahari Traders' }).expect(201)).body.contractId as string;

    // Down: the message waits, says why, and is read back.
    answer = 503;
    anOrder(fleet, contractId, 800, 'Mangoes, 30 crates');
    await settle();
    await hooks.drain();
    const waiting = (await http().get(`${own}/system`).set(bearer(fleet.office)).expect(200)).body.messages.find((m: { event: string }) => m.event === 'order.received');
    expect(waiting).toMatchObject({ state: 'pending', attempts: 1 });
    expect(waiting.lastError).toBeTruthy();

    // A new secret meanwhile, under the manager's name; what is sent again is signed with it.
    const turned = (await http().post(`${own}/system/secret`).set(bearer(fleet.office)).expect(201)).body;
    expect(turned.secret).toMatch(/^whsec_/);
    expect(turned.secret).not.toBe(secret);
    expect(turned.secretTurnedBy).toBe(fleet.name);
    answer = 200;
    landed = [];
    await http().post(`${own}/system/messages/${waiting.id}/resend`).set(bearer(rival.office)).expect(403);
    await http().post(`/v1/sbg/fleet/managers/${encodeURIComponent(rival.did)}/system/messages/${waiting.id}/resend`).set(bearer(rival.office)).expect(404);
    await http().post(`${own}/system/messages/${waiting.id}/resend`).set(bearer(operator)).expect(403);
    expect((await http().post(`${own}/system/messages/${waiting.id}/resend`).set(bearer(fleet.office)).expect(201)).body).toMatchObject({ id: waiting.id, state: 'delivered', resent: 1 });
    expect(landed).toEqual([expect.objectContaining({ delivery: waiting.id, event: 'order.received' })]);
    expect(landed[0].raw).toBe(waiting.body);
    expect(signedWith(turned.secret, landed[0])).toBe(true);
    expect((await http().post(`${own}/system/test`).set(bearer(fleet.office)).expect(201)).body).toMatchObject({ event: 'test', state: 'delivered' });

    // Given up after two days of tries: the fleet hears it in its bell and at its contact email — once a day.
    answer = 503;
    const notices = async () => ((await http().get('/v1/sbg/notifications/inbox').set(bearer(fleet.office)).expect(200)).body.items as Array<{ kind: string }>).filter((n) => n.kind === 'system_down').length;
    const mails = async () => ((await http().get('/v1/mail/outbox').query({ to: fleet.email }).expect(200)).body.items as Array<{ template: string; text: string }>).filter((m) => m.template === 'fleet-system-down');
    const stateOf = (id: string) => hooks.view(fleet.did).messages.find((m) => m.id === id)?.state;
    const pending = () => new Set(hooks.view(fleet.did).messages.filter((m) => m.state === 'pending').map((m) => m.id));
    const before = pending();
    anOrder(fleet, contractId, 900, 'Pineapples, 40 crates');
    await settle();
    await hooks.drain();
    const first = [...pending()].find((id) => !before.has(id))!;
    // Time goes by in five-minute steps, so every try is made when it is due.
    let t = Date.now();
    const tick = async () => {
      t += 5 * 60_000;
      await hooks.drain(t);
    };
    for (let i = 0; i < 72; i++) await tick();
    // A second one, six hours behind the first.
    const mid = pending();
    anOrder(fleet, contractId, 700, 'Bananas, 25 crates');
    await settle();
    await hooks.drain(t);
    const second = [...pending()].find((id) => !mid.has(id))!;
    let toldAt = 0;
    for (let i = 0; i < 1500 && stateOf(second) !== 'failed'; i++) {
      await tick();
      if (!toldAt && stateOf(first) === 'failed') toldAt = t;
    }
    expect(stateOf(first)).toBe('failed');
    expect(stateOf(second)).toBe('failed');
    // The first given up: told once, in the bell and by email. The second, hours later the same day: not told again yet…
    expect(t - toldAt).toBeLessThan(24 * 3_600_000);
    expect(await notices()).toBe(1);
    expect(await mails()).toHaveLength(1);
    expect((await mails())[0].text).toContain('could not be delivered to your system');
    // …and a day after the first notice, it is.
    await hooks.drain(toldAt + 25 * 3_600_000);
    expect(await notices()).toBe(2);
    expect(await mails()).toHaveLength(2);

    // Staff read the counts under Fleets; they send nothing in the fleet's name.
    const rows = (await http().get('/v1/sbg/fleet/managers').set(bearer(operator)).expect(200)).body as Array<{ did: string; system?: Record<string, unknown> }>;
    expect(rows.find((r) => r.did === fleet.did)?.system).toMatchObject({ hasAddress: true, givenUp: 2, delivered: expect.any(Number), positions: false });
    // The fleet's own list of fleets carries no counts of anybody's.
    const asFleet = (await http().get('/v1/sbg/fleet/managers').set(bearer(fleet.office)).expect(200)).body as Array<{ system?: unknown }>;
    expect(asFleet.every((r) => r.system === undefined)).toBe(true);
    await http().post(`${own}/system/test`).set(bearer(operator)).expect(403);
  });
});
