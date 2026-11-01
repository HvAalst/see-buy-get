import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EntityService } from '../src/foundation/entity/entity.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { ImportService } from '../src/modules/pudo/import.service';
import { EventBus } from '../src/foundation/events/event-bus.service';
import { GlosEvent } from '../src/foundation/events/glos-events';
import { NotificationService } from '../src/modules/pudo/notification.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { AGREED } from './agreed';
import { declared } from './declared';

/**
 * AN IMPORT BY AIR (2026-10-29, the research's synthesis B–D). The cargo waits in the handler's shed until customs has
 * released it, every agency the goods need has released it, and the handler has given its delivery order — notice of
 * arrival alone is never enough. Each step is recorded by the importer or its agent; the road leg from the shed is offered
 * to nobody until then, unless the importer says to send the truck anyway. The handler's free storage is counted in
 * hours from its notice, and warned — never priced.
 */
describe('an import by air, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;
  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
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
  });

  async function aBusiness(activities: string[], called: string) {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `airimp-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${called} ${digits()}`, country: 'KE', registrationNo: `AI-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    return { token, entityId, site };
  }
  const bell = (entityId: string) => app.get(NotificationService).inboxFor(app.get(EntityService).get(entityId).did);

  /** A truck driver near the airport, vetted, declared, in a closed truck. */
  const aDriver = () => {
    const drivers = app.get(DriverService);
    const driver = drivers.register({ displayName: 'Air', fullName: 'Air Driver', nationalId: `ID-AI-${digits()}`, mobile: `+2547${digits()}7`, licenceClasses: ['truck'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(driver.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(driver.did, true);
    app.get(FleetService).couple(driver.did, app.get(VehicleService).register({ plate: `KDA ${digits().slice(0, 3)}A`, vehicleClass: 'truck', truckSubtype: 'box', capacityKg: 5_000, ownerName: 'X', equipment: ['TLT'], baseFee: 0.5, pricePerKm: 0.1 } as never).vehicleId);
    declared(app, 'driver', driver.did);
    return driver.did;
  };

  const phones = (handler = 'Swissport cargo shed, JKIA') => ({
    awb: '074-12345675',
    waybillKind: 'master',
    flights: [{ flight: 'kl 565', date: today(), from: 'ams', to: 'nbo', arrivesLocal: '06:15' }],
    handler,
    pieces: 12,
    weightKg: 240,
    agencies: ['kebs'],
    freeHours: 48,
    freeHoursSource: 'Swissport’s notice of arrival',
  });

  it('the road leg waits for every release — customs, each agency, the delivery order — and the free storage is counted and warned', async () => {
    const imp = await aBusiness(['importer'], 'Nairobi Phones');
    const agent = await aBusiness(['clearing_agent'], 'Pwani Clearing');
    const shed = await imp.site('port', 'Swissport cargo shed, JKIA', { lat: -1.33, lng: 36.93 });
    const store = await imp.site('delivery', 'Moi Avenue store', { lat: -1.283, lng: 36.823 });
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Mobile phones, 12 cartons', originCountry: 'NL', destCountry: 'KE', destPort: 'JKIA', mode: 'air' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    await http().post(`${path}/appoint`).set(bearer(imp.token)).send({ agentEntityId: agent.entityId }).expect(201);

    // The agencies Kenya lists, each with what it looks at: the importer or its agent chooses.
    const listed = (await http().get('/v1/sbg/imports/air/agencies?country=KE').set(bearer(imp.token)).expect(200)).body;
    expect(listed.items.map((a: { key: string }) => a.key)).toEqual(['kephis', 'dvs', 'port_health', 'kebs', 'ppb']);
    expect(listed.source).toMatch(/2026-10-29/);

    const air = (body: object, token = imp.token) => http().post(`${path}/air`).set(bearer(token)).send(body);
    // The waybill number's digit, a known agency, a consolidation's house number — and staff write nothing.
    expect(String((await air({ ...phones(), awb: '074-12345674' })).body.detail)).toMatch(/last digit does not check/);
    expect(String((await air({ ...phones(), agencies: ['kra_customs'] })).body.detail)).toBe('Not an agency we list for KE: kra_customs');
    expect((await air({ ...phones(), waybillKind: 'house' })).status).toBe(400);
    expect((await air(phones(), operator)).status).toBe(403);

    const set = (await air(phones(), agent.token).expect(201)).body;
    expect(set.modes).toEqual(['air', 'road']);
    expect(set.air).toMatchObject({ awb: '074-12345675', airline: 'KLM / Martinair', arrivalAirport: 'NBO', flights: [{ flight: 'KL 565' }], handler: 'Swissport cargo shed, JKIA', agencies: [{ key: 'kebs', name: 'Kenya Bureau of Standards (KEBS)' }], clock: { state: 'not_started', freeHours: 48 } });
    expect(set.air.gaps).toEqual(['the customs release', 'the release by Kenya Bureau of Standards (KEBS)', 'the handler’s delivery order', 'the handler’s charges paid']);
    expect(set.air.check).toMatchObject({ regime: 'mc99', airline: 'KLM / Martinair' });

    // The road leg from the shed is posted, and nobody may take it yet.
    const leg = (await http().post(`${path}/road-leg`).set(bearer(imp.token)).send({ pickupSiteId: shed, destSiteId: store, weightKg: 240 }).expect(201)).body;
    const dispatch = app.get(DispatchService);
    const freight = () => dispatch.requireFreightPublic(leg.roadFreightId);
    expect(freight()).toMatchObject({ pickupLabel: 'Swissport cargo shed, JKIA', packages: 12, weightKg: 240, waitsForRelease: { importCode: made.code, place: 'Swissport cargo shed, JKIA', missing: set.air.gaps } });
    expect(freight().instructions?.text).toMatch(/air waybill 074-12345675 \(KLM \/ Martinair\)\. Collect it at Swissport cargo shed, JKIA against this waybill and the delivery order\./);
    const driver = aDriver();
    const from = freight().pickupLocation;
    const offered = () => dispatch.suggest(driver, { from, to: from }).some((o) => o.ref === leg.roadFreightId);
    const marked = () => dispatch.board({ driverDid: driver, from }).find((r) => r.freightId === leg.roadFreightId)?.blockers.find((b) => b.code === 'NOT_RELEASED')?.message;
    expect(offered()).toBe(false);
    expect(marked()).toBe(`Not released yet at Swissport cargo shed, JKIA: still waiting for the customs release, the release by Kenya Bureau of Standards (KEBS), the handler’s delivery order, the handler’s charges paid. This load opens as soon as it is released on ${made.code}.`);
    expect(() => dispatch.assign(leg.roadFreightId, driver, { managerDid: 'did:office:x' })).toThrow(/^Not released yet at Swissport cargo shed, JKIA/);
    expect((await http().get(path).set(bearer(imp.token)).expect(200)).body.air.roadWaits).toMatch(/^Not released yet/);

    const step = (body: object, token = agent.token) => http().post(`${path}/air/release`).set(bearer(token)).send(body);
    // The handler's notice of arrival starts its free storage — and opens nothing.
    const notifiedAt = Date.now() - 2 * H;
    expect((await step({ step: 'notified', at: new Date(Date.now() + 2 * H).toISOString() })).status).toBe(400);
    const notified = (await step({ step: 'notified', at: new Date(notifiedAt).toISOString(), reference: 'NFD-88120' }).expect(201)).body;
    expect(notified.air.clock).toMatchObject({ state: 'running', freeHours: 48, freeUntil: new Date(notifiedAt + 48 * H).toISOString() });
    expect(marked()).toBeDefined();
    // A release is a paper with a number; staff record none; a step that is not one of this import's is refused.
    expect(String((await step({ step: 'customs' })).body.detail)).toMatch(/^Give the customs release’s reference/);
    expect((await step({ step: 'customs', reference: 'KRA-REL-1' }, operator)).status).toBe(403);
    expect((await step({ step: 'kephis' })).status).toBe(400);
    await step({ step: 'customs', reference: '2026NBOIM448120' }).expect(201);
    await step({ step: 'kebs', reference: 'KEBS-CoC-7781' }).expect(201);
    const one = (await http().get(path).set(bearer(imp.token)).expect(200)).body;
    expect(one.air.gaps).toEqual(['the handler’s delivery order', 'the handler’s charges paid']);
    expect(marked()).toMatch(/still waiting for the handler’s delivery order, the handler’s charges paid\./);
    expect(freight().waitsForRelease?.missing).toEqual(['the handler’s delivery order', 'the handler’s charges paid']);

    // The delivery order — and its number told to the driver, who is asked for it at the shed's counter.
    await step({ step: 'delivery_order', reference: 'DO-55120' }).expect(201);
    expect(freight().waitsForRelease?.missing).toEqual(['the handler’s charges paid']);
    expect(freight().instructions?.text).toMatch(/against this waybill and the delivery order DO-55120\. Count the pieces before you leave the shed: the waybill says 12\./);
    // 2026-11-01 — the shed's own charges paid: released — the gate opens, the offer comes, the receipt told to the driver.
    const released = (await step({ step: 'handler_charges', reference: 'SWP-RC-901' }).expect(201)).body;
    expect(freight().instructions?.text).toMatch(/delivery order DO-55120; the handler’s charges are paid, receipt SWP-RC-901\./);
    expect(released.air).toMatchObject({ gaps: [], customs: { reference: '2026NBOIM448120' }, deliveryOrder: { reference: 'DO-55120' }, handlerCharges: { reference: 'SWP-RC-901' }, agencies: [{ key: 'kebs', released: { reference: 'KEBS-CoC-7781' } }] });
    expect(released.air.roadWaits).toBeUndefined();
    // 2026-11-01 — the truck's slot at the shed, as the shed gave it: told to the driver; staff write none; cleared, gone.
    const slotFrom = new Date(Date.now() + 5 * H);
    const slotTo = new Date(Date.now() + 6 * H);
    const slotted = (await http().post(`${path}/air/slot`).set(bearer(agent.token)).send({ from: slotFrom.toISOString(), to: slotTo.toISOString(), reference: 'SWP-C-7' }).expect(201)).body;
    expect(slotted.air.slot).toEqual({ from: slotFrom.toISOString(), to: slotTo.toISOString(), reference: 'SWP-C-7' });
    expect(freight().instructions?.text).toMatch(/Your slot at the shed: \d{2}:\d{2}–.* \(slot SWP-C-7\)\. Come inside it/);
    expect((await http().post(`${path}/air/slot`).set(bearer(operator)).send({ from: slotFrom.toISOString(), to: slotTo.toISOString() })).status).toBe(403);
    expect(String((await http().post(`${path}/air/slot`).set(bearer(agent.token)).send({ from: slotTo.toISOString(), to: slotFrom.toISOString() })).body.detail)).toBe('The slot must end after it starts');
    expect((await http().post(`${path}/air/slot`).set(bearer(imp.token)).send({ from: '', to: '', clear: true }).expect(201)).body.air.slot).toBeUndefined();
    expect(freight().instructions?.text).not.toMatch(/Your slot at the shed/);
    // Recorded again with another agency: the releases already given are kept, and the new one is waited for.
    const again = (await air({ ...phones(), agencies: ['kebs', 'port_health'] }, agent.token).expect(201)).body;
    expect(again.air).toMatchObject({ customs: { reference: '2026NBOIM448120' }, deliveryOrder: { reference: 'DO-55120' }, handlerCharges: { reference: 'SWP-RC-901' }, agencies: [{ key: 'kebs', released: { reference: 'KEBS-CoC-7781' } }, { key: 'port_health' }] });
    expect(again.air.gaps).toEqual(['the release by Port Health']);
    expect(marked()).toMatch(/still waiting for the release by Port Health\./);
    await step({ step: 'port_health', reference: 'PH-2210' }).expect(201);
    expect(marked()).toBeUndefined();
    expect(offered()).toBe(true);
    // Released, nothing waits: no word to go anyway.
    expect(String((await http().post(`${path}/air/collect-anyway`).set(bearer(imp.token)).send({ reason: 'The shed says it is out', waitingIsMine: true })).body.detail)).toBe('It is released already: nothing waits');

    // The free storage: told once in its last six hours, once when it ended — the importer and its agent.
    const service = app.get(ImportService);
    expect(service.sweepAir(notifiedAt + 44 * H)).toContain(`${made.code}:air:due_soon`);
    expect(service.sweepAir(notifiedAt + 45 * H)).not.toContain(`${made.code}:air:due_soon`);
    expect(service.sweepAir(notifiedAt + 49 * H)).toContain(`${made.code}:air:over`);
    const titles = (id: string) => bell(id).map((n) => n.title).filter((t) => t.startsWith(made.code));
    expect(titles(imp.entityId)).toEqual(expect.arrayContaining([`${made.code}: the free storage at Swissport cargo shed, JKIA ends soon`, `${made.code}: the free storage at Swissport cargo shed, JKIA ended`]));
    expect(titles(agent.entityId)).toContain(`${made.code}: the free storage at Swissport cargo shed, JKIA ended`);
    expect(bell(imp.entityId).find((n) => n.title.endsWith('ended'))?.body).not.toMatch(/KES|USD|\$/);

    // Taken by a driver, the clock stops; the gate is never closed again under them, and the cargo cannot change.
    dispatch.claim(dispatch.suggest(driver, { from, to: from }).find((o) => o.ref === leg.roadFreightId)!.offerId);
    expect(dispatch.setReleaseGate(leg.roadFreightId, { importId: made.importId, importCode: made.code, place: 'x', missing: ['y'] })).toBe(false);
    expect(String((await air(phones(), agent.token)).body.detail)).toMatch(/A driver has taken the road leg/);
    // Collected from the shed: the free storage stops there.
    const picked = new Date(notifiedAt + 50 * H).toISOString();
    Object.assign(dispatch.requireFreightPublic(leg.roadFreightId), { status: 'in_transit', pickedUpAt: picked });
    expect((await http().get(path).set(bearer(imp.token)).expect(200)).body.air.clock).toMatchObject({ state: 'stopped', leftAt: picked });

    // 2026-11-01 — what our truck took out of the shed: counted short and noted, so the importer is told its airline's deadline.
    Object.assign(dispatch.requireFreightPublic(leg.roadFreightId), { countedAtPickup: 11, reservations: { note: 'Counted 11 pieces at Swissport cargo shed, JKIA; air waybill 074-12345675 says 12.', at: picked } });
    await app.get(EventBus).publish(GlosEvent.Pudo.FreightPickedUp, { freightId: leg.roadFreightId });
    const collected = (await http().get(path).set(bearer(imp.token)).expect(200)).body.air.collected;
    expect(collected).toMatchObject({ counted: 11, reservations: 'Counted 11 pieces at Swissport cargo shed, JKIA; air waybill 074-12345675 says 12.', complainBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    const told = bell(imp.entityId).find((n) => n.title === `${made.code}: something was noted when it was collected at Swissport cargo shed, JKIA`);
    expect(told?.body).toBe(`Counted 11 pieces at Swissport cargo shed, JKIA; air waybill 074-12345675 says 12. Complain to KLM / Martinair in writing by ${collected.complainBy} — the law gives 14 days from receipt for damage, quoting air waybill 074-12345675.`);
  });

  it('the importer alone may send the truck before the release — with why, and its waiting its own; medicines and other modes refused', async () => {
    const imp = await aBusiness(['importer'], 'Ruiru Fresh');
    const agent = await aBusiness(['clearing_agent'], 'Kilindini Clearing');
    const shed = await imp.site('port', 'KQ Cargo Centre, JKIA', { lat: -1.33, lng: 36.92 });
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Apples, 60 cartons', originCountry: 'ZA', destCountry: 'KE', destPort: 'JKIA', mode: 'air' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    await http().post(`${path}/appoint`).set(bearer(imp.token)).send({ agentEntityId: agent.entityId }).expect(201);
    // Perishables give their range, and ride in it.
    app.get(ImportService).declareCargo(made.importId, imp.entityId, { natureCode: 'FOP' }, 'Wanjiku');
    const fresh = { ...phones('KQ Cargo Centre, JKIA'), awb: '706-12345675', agencies: ['kephis', 'port_health'] };
    expect(String((await http().post(`${path}/air`).set(bearer(imp.token)).send(fresh)).body.detail)).toMatch(/temperature range/);
    const set = (await http().post(`${path}/air`).set(bearer(imp.token)).send({ ...fresh, minC: 1, maxC: 4 }).expect(201)).body;
    expect(set.air.gaps).toHaveLength(5);
    const leg = (await http().post(`${path}/road-leg`).set(bearer(imp.token)).send({ pickupSiteId: shed, destLabel: 'Ruiru cold store', weightKg: 240 }).expect(201)).body;
    expect(app.get(DispatchService).requireFreightPublic(leg.roadFreightId)).toMatchObject({ natureCode: 'FOP', tempRange: { minC: 1, maxC: 4 } });

    const anyway = (body: object, token = imp.token) => http().post(`${path}/air/collect-anyway`).set(bearer(token)).send(body);
    expect((await anyway({ reason: 'The agent says it is out within the hour', waitingIsMine: true }, agent.token)).status).toBe(403);
    expect((await anyway({ reason: 'ok', waitingIsMine: true })).status).toBe(400);
    expect(String((await anyway({ reason: 'The agent says it is out within the hour', waitingIsMine: false })).body.detail)).toMatch(/say that its waiting is yours/);
    const after = (await anyway({ reason: 'The agent says it is out within the hour', waitingIsMine: true }).expect(201)).body;
    expect(after.air).toMatchObject({ collectAnyway: { reason: 'The agent says it is out within the hour' } });
    expect(after.air.roadWaits).toBeUndefined();
    // Still said what is missing: the importer's word opens the road, it releases nothing.
    expect(after.air.gaps).toHaveLength(5);
    expect(app.get(DispatchService).requireFreightPublic(leg.roadFreightId).waitsForRelease?.collectAnyway?.reason).toBe('The agent says it is out within the hour');

    // Medicines wait for the lawyer; a box by sea has no air waybill.
    const meds = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Vaccines, 4 boxes', originCountry: 'IN', destCountry: 'KE', destPort: 'JKIA', mode: 'air' }).expect(201)).body;
    app.get(ImportService).declareCargo(meds.importId, imp.entityId, { natureCode: 'HUM' }, 'Wanjiku');
    const refused = await http().post(`/v1/sbg/imports/${meds.importId}/air`).set(bearer(imp.token)).send(phones());
    expect([refused.status, String(refused.body.detail)]).toEqual([403, expect.stringMatching(/is still with our lawyer\.$/)]);
    const sea = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Rice, 800 bags', originCountry: 'PK', destCountry: 'KE', destPort: 'Mombasa', mode: 'sea' }).expect(201)).body;
    expect(String((await http().post(`/v1/sbg/imports/${sea.importId}/air`).set(bearer(imp.token)).send(phones())).body.detail)).toBe(`${sea.code} came by sea: an air waybill is for goods that came by air`);
  });

  it('landed in another country than the importer’s (2026-11-01): released for transit at the airport, the destination’s agencies at destination, and the road leg runs under bond across the border', async () => {
    const imp = await aBusiness(['importer'], 'Kampala Phones');
    const shed = await imp.site('port', 'Swissport cargo shed, JKIA', { lat: -1.33, lng: 36.93 });
    const store = await imp.site('delivery', 'Kampala Road store', { lat: 0.313, lng: 32.581 });
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Mobile phones, 12 cartons', originCountry: 'NL', destCountry: 'UG', destPort: 'Entebbe', mode: 'air' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    // Landed at Nairobi: read off the airport. Uganda's standards body is the destination's, and waits for the goods there.
    const set = (await http().post(`${path}/air`).set(bearer(imp.token)).send({ ...phones(), agencies: ['unbs'] }).expect(201)).body;
    expect(set.air.landedIn).toBe('KE');
    expect(set.air.gaps).toEqual(['the transit release at customs in Kenya', 'the handler’s delivery order', 'the handler’s charges paid']);
    // A country said by its code is taken; one that is not a country is refused.
    expect(String((await http().post(`${path}/air`).set(bearer(imp.token)).send({ ...phones(), agencies: ['unbs'], landedIn: 'ZZ' })).body.detail)).toMatch(/two-letter code/);
    const leg = (await http().post(`${path}/road-leg`).set(bearer(imp.token)).send({ pickupSiteId: shed, destSiteId: store, weightKg: 240 }).expect(201)).body;
    const freight = app.get(DispatchService).requireFreightPublic(leg.roadFreightId);
    expect(freight).toMatchObject({ pickupCountry: 'KE', destCountry: 'UG', bonded: true, bondCountry: 'KE' });
    expect(freight.instructions?.text).toMatch(/In transit: it landed in Kenya and goes on under bond to Uganda, to be cleared there/);
    // Landing at home is no transit: nothing changes for an importer whose plane lands in its own country.
    const home = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Phones by air', originCountry: 'NL', destCountry: 'KE', destPort: 'JKIA', mode: 'air' }).expect(201)).body;
    const homeSet = (await http().post(`/v1/sbg/imports/${home.importId}/air`).set(bearer(imp.token)).send(phones()).expect(201)).body;
    expect(homeSet.air.landedIn).toBeUndefined();
    expect(homeSet.air.gaps[0]).toBe('the customs release');
  });

  it('flowers from Addis Ababa into Maastricht, collected built up on airline pallets (2026-11-01): landed at home, chilled, and only a truck with a roller floor takes them', async () => {
    const imp = await aBusiness(['importer'], 'Aalsmeer Flowers');
    const shed = await imp.site('port', 'Cargo shed, Maastricht Aachen Airport', { lat: 50.915, lng: 5.775 });
    const auction = await imp.site('delivery', 'Flower auction, Aalsmeer', { lat: 52.27, lng: 4.77 });
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Roses, 4 pallets', originCountry: 'ET', destCountry: 'NL', destPort: 'Maastricht', mode: 'air', natureCode: 'FOP' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    const set = (await http().post(`${path}/air`).set(bearer(imp.token)).send({ awb: '071-12345675', waybillKind: 'master', flights: [{ flight: 'ET 3714', date: today(), from: 'ADD', to: 'MST' }], handler: 'Cargo shed, Maastricht Aachen Airport', pieces: 480, weightKg: 9_600, minC: 2, maxC: 6, agencies: [], builtUp: 4 }).expect(201)).body;
    // Maastricht is in the Netherlands: no border on the road, and the pallets as the airline built them.
    expect(set.air.landedIn).toBeUndefined();
    expect(set.air.builtUp).toBe(4);
    const leg = (await http().post(`${path}/road-leg`).set(bearer(imp.token)).send({ pickupSiteId: shed, destSiteId: auction, weightKg: 9_600 }).expect(201)).body;
    const freight = app.get(DispatchService).requireFreightPublic(leg.roadFreightId);
    expect(freight).toMatchObject({ airPallets: 4, pickupCountry: 'NL', destCountry: 'NL', tempRange: { minC: 2, maxC: 6 } });
    expect(freight.instructions?.text).toMatch(/4 built-up airline pallets, as the airline delivered them: roll them on and off — never break them down/);
  });
});
