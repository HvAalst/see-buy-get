import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { ExportService } from '../src/modules/pudo/export.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { AGREED } from './agreed';
import { CONTENTS_PNG } from './content-photo';
import { declared } from './declared';

/**
 * AN EXPORT BY AIR (the user, 2026-10-29: "we move on to air"). Our part is the road: from the exporter's pack house to
 * the airline's cargo terminal, before the latest acceptance time on the airline's booking. The booking and its waybill
 * are copied off the confirmation and checked — the waybill number's digit, the convention of the route, the pieces and
 * weight against the packing list — never issued. Chilled goods ride in the shipper's own range; secured cargo in a
 * closed vehicle, sealed, by a driver whose ID was seen; an unconfirmed booking goes, with the warning said everywhere.
 */
describe('an export by air, over the wire', () => {
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

  /** A flower grower at Naivasha, with its pack house and the cargo terminal at Jomo Kenyatta on its list of places. */
  async function aGrower(): Promise<{ token: string; entityId: string; name: string; packHouse: string; terminal: string }> {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `air-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Naivasha Roses ${digits()}`, country: 'KE', registrationNo: `AIR-${digits()}`, activities: ['shipper'], yourName: 'Achieng' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    return {
      token,
      entityId,
      name: made.business.name as string,
      packHouse: await site('loading', 'Naivasha pack house', { lat: -0.72, lng: 36.43 }),
      terminal: await site('port', 'JKIA cargo terminal', { lat: -1.33, lng: 36.93 }),
    };
  }

  const roses = (g: { packHouse: string; terminal: string }, latAt: number) => ({
    goodsDescription: 'Cut roses, 40 boxes',
    originCountry: 'KE',
    destCountry: 'NL',
    natureCode: 'FOP',
    bookedWith: 'forwarder',
    partyName: 'Pwani Forwarders',
    loadingSiteId: g.packHouse,
    terminalSiteId: g.terminal,
    air: {
      awb: '706-12345675',
      waybillKind: 'master',
      bookingStatus: 'confirmed',
      flights: [{ flight: 'kq 112', date: today(), from: 'nbo', to: 'ams', departsLocal: '23:55' }],
      latAt: new Date(latAt).toISOString(),
      pieces: 40,
      weightKg: 600,
      handler: 'Kenya Airfreight Handling',
      security: { status: 'unsecured' },
      temp: { minC: 2, maxC: 4, preCooled: true },
      inspectionAtAirport: true,
    },
  });

  it('booked, checked, timed to the latest acceptance time, chilled in its own range, papered — and the file for the forwarder', async () => {
    const g = await aGrower();
    const lat = Date.now() + 24 * H;
    const base = roses(g, lat);
    const post = (body: unknown, token = g.token) => http().post('/v1/sbg/exports/air').set(bearer(token)).send(body as object);
    const said = async (body: unknown) => {
      const r = await post(body);
      return [r.status, String(r.body.detail)];
    };

    // The waybill number's last digit must check: a wrong one is never kept.
    expect(await said({ ...base, air: { ...base.air, awb: '706-12345674' } })).toEqual([400, expect.stringMatching(/last digit does not check/)]);
    expect(await said({ ...base, air: { ...base.air, awb: '706-1234567' } })).toEqual([400, expect.stringMatching(/^An air waybill number is eleven digits/)]);
    // A prefix we do not hold: the airline is asked for, never guessed.
    expect(await said({ ...base, air: { ...base.air, awb: '999-12345675' } })).toEqual([400, expect.stringMatching(/^We do not hold the airline for prefix 999/)]);
    // Perishable goods give their own range; a range must be one.
    expect(await said({ ...base, air: { ...base.air, temp: undefined } })).toEqual([400, expect.stringMatching(/temperature range/)]);
    expect(await said({ ...base, air: { ...base.air, temp: { minC: 4, maxC: 2 } } })).toEqual([400, 'The lowest temperature must be below the highest']);
    // A consolidation gives its house number; secured cargo says who secured it.
    expect(await said({ ...base, air: { ...base.air, waybillKind: 'house' } })).toEqual([400, expect.stringMatching(/house waybill number/)]);
    expect(await said({ ...base, air: { ...base.air, security: { status: 'secured' } } })).toEqual([400, expect.stringMatching(/which regulated agent or known consignor secured it/)]);
    // The latest acceptance time comes from the airline's confirmation: no table of ours stands in for it.
    expect(await said({ ...base, air: { ...base.air, latAt: undefined } })).toEqual([400, expect.anything()]);
    // Medicines wait for the lawyer (L29); live animals for the next step.
    expect(await said({ ...base, natureCode: 'HUM' })).toEqual([403, expect.stringMatching(/legal\.html L29/)]);
    expect(await said({ ...base, natureCode: 'HAZ-BIO' })).toEqual([403, expect.stringMatching(/^Live animals/)]);
    // The terminal is one of its port and airport places, and staff write nothing in its name.
    expect((await post({ ...base, terminalSiteId: g.packHouse })).status).toBe(400);
    expect((await post({ ...base, exporterEntityId: g.entityId }, operator)).status).toBe(403);

    const made = (await post(base).expect(201)).body;
    expect(made).toMatchObject({ code: expect.stringMatching(/^EXP-\d{3}$/), mode: 'air', air: { awb: '706-12345675', airline: 'Kenya Airways', fromAirport: 'NBO', toAirport: 'AMS', flights: [{ flight: 'KQ 112', from: 'NBO', to: 'AMS' }] }, booking: { reference: '706-12345675', gateCutoffAt: new Date(lat).toISOString() } });
    // A prefix we do not hold, with the airline said: kept as given.
    expect((await post({ ...base, air: { ...base.air, awb: '999-12345675', airline: 'Air China Cargo' } }).expect(201)).body.air.airline).toBe('Air China Cargo');
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = async () => (await http().get(path).set(bearer(g.token)).expect(200)).body;

    const first = await read();
    // The waybill read against the law of its route: Kenya and the Netherlands share MC99, at its limit today.
    expect(first.air.check).toMatchObject({ number: '706-12345675', airline: 'Kenya Airways', regime: 'mc99', missing: [], mismatches: [], electronicPossible: true, limits: [expect.stringMatching(/^At most 26 SDR a kilogram/)] });
    expect(first.air.warnings).toEqual([
      'Not secured: the terminal screens it when it arrives, which takes time there.',
      'Kept between 2 and 4 °C: a reefer or insulated body, its set-point inside the range, and the temperature recorded on the way.',
      'The plant-health inspection is at the airport: about 3 hours there, before the latest acceptance time.',
    ]);
    // The leave-by, its working shown: the drive, an hour before the acceptance time, and the inspection's three.
    expect(first.timing).toMatchObject({ state: 'on_time', handover: { place: 'JKIA cargo terminal', byAir: true }, air: { driveHours: expect.any(Number), bufferHours: 1, inspectionHours: 3 } });
    expect(first.timing.plannedHours).toBeCloseTo(first.timing.air.driveHours + 4, 0);
    expect(Date.parse(first.timing.leaveByAt)).toBeCloseTo(lat - first.timing.plannedHours * H, -5);
    // What it lacks by air: the load, and the papers — never a box, a weighing, or a bill of lading.
    expect(first.missing).toEqual(expect.arrayContaining(['A load to the cargo terminal', 'Commercial invoice', 'Packing list', 'Phytosanitary certificate (plant health)']));
    for (const sea of ['The box’s number', 'The verified gross mass', 'A load to the terminal']) expect(first.missing).not.toContain(sea);
    const keys = first.papers.map((p: { key: string }) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['air_waybill', 'phytosanitary_certificate', 'shipping_instructions']));
    for (const k of ['bill_of_lading', 'weighbridge_ticket', 'consignment_security_declaration']) expect(keys).not.toContain(k);
    // Its row in the list says it goes by air.
    expect((await http().get('/v1/sbg/exports').set(bearer(g.token)).expect(200)).body.items.find((r: { exportId: string }) => r.exportId === made.exportId)).toMatchObject({ mode: 'air' });

    // The sea's steps are refused by name: no box, no weighing, no bill of lading, no train, no FIATA bill.
    for (const [step, body] of [
      ['container', { containerNo: 'MSCU1234566' }],
      ['empty-leg', {}],
      ['vgm', { method: 1, kg: 600, signatory: 'Achieng' }],
      ['bill-of-lading', { number: 'MEDU8812345' }],
      ['fbl', { form: 'fbl', number: 'FBL-1', issuedOn: today(), electronic: false, seaLeg: true, printed: [] }],
    ] as const) {
      const r = await http().post(`${path}/${step}`).set(bearer(g.token)).send(body);
      expect([step, r.status, String(r.body.detail)]).toEqual([step, 400, expect.stringMatching(new RegExp(`^${made.code} goes by air: it has no `))]);
    }

    // The packing list disagreeing with the waybill is said, until they agree.
    const sheet = (kg: number) => ({ rows: [['Description', 'Boxes', 'G.W. (kg)'], ['Cut roses', '40', String(kg)]] });
    await http().post(`${path}/packing-list`).set(bearer(g.token)).send(sheet(640)).expect(201);
    expect((await read()).missing).toContain('The air waybill and the packing list disagree — Weight: the waybill says 600 kg, our papers 640 kg');
    await http().post(`${path}/packing-list`).set(bearer(g.token)).send(sheet(603)).expect(201);
    expect((await read()).missing.some((m: string) => m.startsWith('The air waybill and the packing list disagree'))).toBe(false);

    // The road to the cargo terminal: chilled goods in the shipper's own range, timed to the acceptance time.
    const leg = (await http().post(`${path}/laden-leg`).set(bearer(g.token)).send({}).expect(201)).body.ladenLeg;
    const dispatch = app.get(DispatchService);
    const load = dispatch.requireFreightPublic(leg.freightId);
    expect(load).toMatchObject({ weightKg: 600, packages: 40, natureCode: 'FOP', tempRange: { minC: 2, maxC: 4 }, pickupLabel: 'Naivasha pack house', destLabel: 'JKIA cargo terminal', requiredCapabilities: expect.arrayContaining(['coldChain']) });
    expect(load.securedBy).toBeUndefined();
    expect(load.instructions?.deliveryWindow).toMatch(/^At JKIA cargo terminal before .* — the airline’s latest acceptance time$/);
    expect(load.instructions?.text).toMatch(/air waybill 706-12345675 \(Kenya Airways\), KQ 112 on /);
    expect(load.instructions?.text).toMatch(/Hand it in at Kenya Airfreight Handling against this waybill/);
    expect(load.instructions?.text).toMatch(/Keep it between 2 and 4 °C/);
    expect(load.instructions?.text).not.toMatch(/has not confirmed/);
    // A second would send two trucks for one consignment.
    expect((await http().post(`${path}/laden-leg`).set(bearer(g.token)).send({})).status).toBe(409);
    expect((await read()).missing).not.toContain('A load to the cargo terminal');
    // Not secured: no seal is asked of it.
    expect(dispatch.sealRequiredBy(load)).toBeUndefined();

    // The letter of instruction by air: a named consignee (an air waybill is never to order), the airport of destination,
    // and no bill of lading to release.
    const sli = async (form: object) => (await http().post(`${path}/sli`).set(bearer(g.token)).send(form).expect(201)).body.sli.gaps as string[];
    const gaps = await sli({ consigneeKind: 'to_order', notify: { name: 'Royal FloraHolland', address: 'Aalsmeer' }, freight: 'prepaid', lines: [{ packages: 40, packageKind: 'boxes', description: 'Cut roses', grossKg: 603 }] });
    expect(gaps).toEqual(['A named consignee: an air waybill is not negotiable, so it is never made out to order', 'The airport of destination']);
    const early = await http().post(`${path}/sli/sign`).set(bearer(g.token)).send({ signatory: 'Achieng Otieno' });
    expect([early.status, String(early.body.detail)]).toEqual([400, expect.stringContaining('A named consignee: an air waybill is not negotiable')]);
    expect(await sli({ consigneeKind: 'named', consignee: { name: 'Royal FloraHolland', address: 'Legmeerdijk 313, Aalsmeer' }, notifySameAsConsignee: true, dischargePort: 'Amsterdam Schiphol', freight: 'prepaid', lines: [{ packages: 40, packageKind: 'boxes', description: 'Cut roses', grossKg: 603 }] })).toEqual([]);
    await http().post(`${path}/sli/sign`).set(bearer(g.token)).send({ signatory: 'Achieng Otieno' }).expect(201);
    const letter = (await http().get(`${path}/sli.html?draft=1`).set(bearer(g.token)).expect(200)).text;
    for (const fact of ['The flight and the terms', 'Amsterdam Schiphol', '706-12345675 — Kenya Airways', '40 pieces, 600 kg', '2 to 4 °C', 'make out the air waybill. SeeBuyGet books no flight']) expect(letter).toContain(fact);
    expect(letter).not.toContain('The voyage and the terms');

    // The file for the forwarder at the terminal.
    const file = (await http().get(`${path}/handover.html`).set(bearer(g.token)).expect(200)).text;
    for (const fact of [made.code, '706-12345675 — Kenya Airways', 'Pwani Forwarders', 'KQ 112', 'NBO→AMS', 'Confirmed by the airline', 'Latest acceptance time', '40 pieces, 600 kg', 'Kenya Airfreight Handling', 'Not secured: screened at the terminal', '2 to 4 °C, pre-cooled', `CMR-${leg.code}`, 'At most 26 SDR a kilogram', 'SeeBuyGet gives no security status']) expect(file).toContain(fact);
    expect(file).not.toContain('Bill of lading');

    // On the road, its readings are judged against the shipper's own 2–4 °C — not the network's 2–8 °C: 5 °C is a breach.
    const picked = new Date(Date.now() - 60_000).toISOString();
    Object.assign(dispatch.requireFreightPublic(leg.freightId), { status: 'in_transit', pickedUpAt: picked });
    expect(dispatch.recordTemp(leg.freightId, 3).tempReadings?.at(-1)).toMatchObject({ celsius: 3, breach: false });
    expect(dispatch.recordTemp(leg.freightId, 5).tempReadings?.at(-1)).toMatchObject({ celsius: 5, breach: true });

    // Delivered at the terminal is its hand-over — never the airline's acceptance, which is the airline's word.
    const at = new Date().toISOString();
    Object.assign(dispatch.requireFreightPublic(leg.freightId), { status: 'delivered', pickedUpAt: at, deliveredAt: at });
    expect((await read()).timing).toMatchObject({ state: 'gated_in', gatedInAt: at, collectedAt: at });
    expect((await http().get(`${path}/handover.html`).set(bearer(g.token)).expect(200)).text).toContain('Delivered at the terminal is not accepted by the airline');
  });

  it('a missed latest acceptance time: the next flight is recorded, the old booking kept, the clock and its warnings start again', async () => {
    const g = await aGrower();
    const lat = Date.now() + 2 * H;
    const made = (await http().post('/v1/sbg/exports/air').set(bearer(g.token)).send(roses(g, lat)).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const svc = app.get(ExportService);
    // Two hours off, with a drive and the inspection's three: already at risk.
    expect((await http().get(path).set(bearer(g.token)).expect(200)).body.timing.state).toBe('at_risk');
    expect(() => svc.mintLadenLeg(made.exportId, g.entityId, {}, 'test', lat + 1)).toThrow(/^The latest acceptance time at JKIA cargo terminal passed at .*: ask Pwani Forwarders for the next flight/);
    expect(svc.sweep(lat + 1)).toContain(`${made.code}:gate`);

    const change = (body: object, token = g.token) => http().post(`${path}/air/booking`).set(bearer(token)).send(body);
    // Something must change; a time already gone is not a new booking; staff write nothing in its name.
    expect((await change({ bookingStatus: 'confirmed' })).status).toBe(400);
    expect(String((await change({ latAt: new Date(Date.now() - H).toISOString() })).body.detail)).toMatch(/^That latest acceptance time has passed already/);
    expect((await change({ latAt: new Date(Date.now() + 30 * H).toISOString() }, operator)).status).toBe(403);
    // A box by sea has no airline booking to change.
    const sea = (await http().post('/v1/sbg/exports').set(bearer(g.token)).send({ goodsDescription: 'Roses by sea, 1 box', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '22R1', booking: { reference: `MBA${digits()}`, bookedWith: 'forwarder', partyName: 'Pwani Forwarders', gateCutoffAt: new Date(Date.now() + 48 * H).toISOString() }, loadingSiteId: g.packHouse, terminalSiteId: g.terminal }).expect(201)).body;
    expect(String((await http().post(`/v1/sbg/exports/${sea.exportId}/air/booking`).set(bearer(g.token)).send({ bookingStatus: 'queued' })).body.detail)).toBe(`${sea.code} goes by sea: its booking is your forwarder’s or the line’s`);

    const next = Date.now() + 30 * H;
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const moved = (await change({ flights: [{ flight: 'kq 116', date: tomorrow, from: 'NBO', to: 'AMS' }], latAt: new Date(next).toISOString() }).expect(201)).body;
    expect(moved.consignment.air).toMatchObject({ flights: [{ flight: 'KQ 116', date: tomorrow }], latAt: new Date(next).toISOString(), formerBookings: [{ bookingStatus: 'confirmed', flights: [{ flight: 'KQ 112' }], latAt: new Date(lat).toISOString(), by: expect.any(String) }] });
    expect(moved.consignment.booking.gateCutoffAt).toBe(new Date(next).toISOString());
    expect(moved.timing.state).toBe('on_time');
    // The road may be posted again under the new time — and its warnings are said again under it.
    expect(svc.mintLadenLeg(made.exportId, g.entityId, {}, 'test', lat + 1).ladenLeg).toBeDefined();
    expect(svc.sweep(next + 1)).toContain(`${made.code}:gate`);
  });

  it('secured cargo, an unconfirmed booking: warned, sealed, in a closed vehicle, by a driver whose ID was seen', async () => {
    const g = await aGrower();
    const lat = Date.now() + 30 * H;
    const parts = {
      ...roses(g, lat),
      goodsDescription: 'Machine spares, 2 cases',
      natureCode: undefined,
      air: {
        ...roses(g, lat).air,
        awb: '706-12345675',
        waybillKind: 'house',
        houseNumber: 'PWF-88123',
        bookingStatus: 'queued',
        pieces: 2,
        weightKg: 40,
        temp: undefined,
        inspectionAtAirport: undefined,
        security: { status: 'secured', agentName: 'Swissport Kenya RA', agentNumber: 'RA-KE-0042' },
      },
    };
    const made = (await http().post('/v1/sbg/exports/air').set(bearer(g.token)).send(parts).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = async () => (await http().get(path).set(bearer(g.token)).expect(200)).body;
    const first = await read();
    expect(first.air.warnings).toEqual([
      'The airline has not confirmed this booking yet: the truck may go, but the cargo may not fly on this flight. The risk of being left behind is yours.',
      'Secured cargo: it goes in a closed vehicle that locks, sealed where it is loaded and its seal checked at the terminal, with a driver whose ID has been seen. Its security status is Swissport Kenya RA’s to give, never SeeBuyGet’s.',
    ]);
    // A house waybill, its number given: whose contract is whose is said, and nothing more is asked of it.
    expect(first.air.check.ask).not.toContain('The forwarder’s house waybill number, and the master waybill it travels under.');
    expect(first.air.check.caveats.join(' ')).toMatch(/A house waybill is the forwarder’s contract with you; the airline’s is the master waybill/);
    // The regulated agent's declaration kept with it; an hour before the acceptance time, no inspection.
    expect(first.papers.map((p: { key: string }) => p.key)).toContain('consignment_security_declaration');
    expect(first.timing.air).toMatchObject({ bufferHours: 1, inspectionHours: 0 });

    const leg = (await http().post(`${path}/laden-leg`).set(bearer(g.token)).send({}).expect(201)).body.ladenLeg;
    const dispatch = app.get(DispatchService);
    const load = dispatch.requireFreightPublic(leg.freightId);
    expect(load).toMatchObject({ securedBy: 'Swissport Kenya RA', excludedBodies: expect.arrayContaining(['flatbed', 'curtain_side', 'tipper']) });
    expect([load.natureCode, load.tempRange]).toEqual(['GEN', undefined]);
    expect(load.instructions?.text).toMatch(/house waybill PWF-88123/);
    expect(load.instructions?.text).toMatch(/The airline has not confirmed the booking: it may not fly on this flight\./);
    expect(load.instructions?.text).toMatch(/Secured cargo \(Swissport Kenya RA\): keep it locked and sealed, with no stops on the way/);
    // Sealed whatever any company's rule says: its security is kept by the seal.
    expect(dispatch.sealRequiredBy(load)).toEqual({ why: 'secured', company: 'Swissport Kenya RA' });
    expect(dispatch.sealRefusal(load)).toBe('Swissport Kenya RA requires a seal on secured air cargo: the shipper writes one before the goods are taken over');
    expect((await read()).missing).toContain('A seal written on the load to the cargo terminal — secured cargo travels sealed');

    // A rider in no fleet, their ID not yet seen: the board says why, in the take's words, before any vehicle.
    const drivers = app.get(DriverService);
    const rider = drivers.register({ displayName: `Kamau ${digits().slice(-3)}`, fullName: 'Kamau Rider', nationalId: `ID-AIR-R-${digits()}`, mobile: `+2547${digits()}1`.slice(0, 13), licenceClasses: ['motorcycle'] } as never);
    declared(app, 'driver', rider.did);
    const from = load.pickupLocation;
    const blocker = () => dispatch.board({ driverDid: rider.did, from }).find((r) => r.freightId === load.freightId)?.blockers.find((b) => b.code === 'SECURED_CARGO')?.message;
    expect(blocker()).toBe('Secured air cargo goes only with a driver whose ID has been seen: send a photo of your ID from the Driver app, and take it once it has been looked at.');
    // On a motorcycle: nothing to lock or seal — said on the board, withheld from the offers.
    const bike = app.get(VehicleService).register({ plate: `KMB ${digits().slice(0, 3)}A`, vehicleClass: 'motorcycle', ownerName: 'Kamau' } as never);
    app.get(FleetService).couple(rider.did, bike.vehicleId);
    expect(blocker()).toBe('Secured air cargo goes in a closed vehicle that locks and takes a seal — a car, a van or a closed truck: never on a bike, a motorcycle or a tuk-tuk.');

    // The take refuses it too — the one commit, whatever offer it came from: an offer made before the load was secured.
    const plain = dispatch.registerFreight({ description: 'Spares, 2 cases', pickupLocation: from, pickupLabel: 'Naivasha pack house', destLabel: 'JKIA cargo terminal', destLocation: load.destLocation, weightKg: 10 });
    const offerOf = () => dispatch.suggest(rider.did, { from, to: from }).find((o) => o.ref === plain.freightId);
    const first1 = offerOf();
    expect(first1).toBeDefined();
    Object.assign(dispatch.requireFreightPublic(plain.freightId), { securedBy: 'Swissport Kenya RA' });
    // Secured, it is no longer offered to a motorcycle.
    expect(offerOf()).toBeUndefined();
    const take = (offerId: string) => {
      try {
        dispatch.claim(offerId);
        return 'taken';
      } catch (e) {
        return `${(e as { code?: string }).code}: ${(e as Error).message}`;
      }
    };
    expect(take(first1!.offerId)).toBe('FORBIDDEN: Secured air cargo goes in a closed vehicle that locks and takes a seal — a car, a van or a closed truck: never on a bike, a motorcycle or a tuk-tuk.');
    // In a closed vehicle, the ID still unseen: refused at the take, for that reason.
    Object.assign(dispatch.requireFreightPublic(plain.freightId), { securedBy: undefined });
    Object.assign(bike, { vehicleClass: 'car' });
    const second = offerOf();
    expect(second).toBeDefined();
    Object.assign(dispatch.requireFreightPublic(plain.freightId), { securedBy: 'Swissport Kenya RA' });
    // …nor to a closed vehicle whose driver's ID nobody has seen.
    expect(offerOf()).toBeUndefined();
    expect(take(second!.offerId)).toBe('FORBIDDEN: Secured air cargo goes only with a driver whose ID has been seen: send a photo of your ID from the Driver app, and take it once it has been looked at.');
    // Seen: the board clears it, the offer comes, and it is taken.
    Object.assign(drivers.get(rider.did), { idCheck: { photoRef: 'med_test', sentAt: new Date().toISOString(), seenAt: new Date().toISOString() } });
    expect(blocker()).toBeUndefined();
    const third = dispatch.suggest(rider.did, { from, to: from }).find((o) => o.ref === plain.freightId);
    expect(third).toBeDefined();
    expect(take(third!.offerId)).toBe('taken');

    // The seal written on the load, with its photographs: no longer missing.
    const photo = async () => (await http().post('/v1/sbg/media').set(bearer(g.token)).send({ kind: 'seal', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/dispatch/freight/${leg.freightId}/seals`).set(bearer(g.token)).send({ number: 'RA 004211', sealClass: 'I', appliedBy: 'sender', photos: { loadedOpen: await photo(), closedWithSeal: await photo(), sealCloseUp: await photo() } }).expect(201);
    const after = await read();
    expect(after.missing.some((m: string) => m.startsWith('A seal written on the load'))).toBe(false);
    expect(dispatch.sealRefusal(load)).toBeUndefined();
    const file = (await http().get(`${path}/handover.html`).set(bearer(g.token)).expect(200)).text;
    for (const fact of ['House waybill', 'PWF-88123', 'Not confirmed by the airline: it may not fly on this flight', 'Secured by Swissport Kenya RA (RA-KE-0042) — its status, not SeeBuyGet’s', 'RA 004211']) expect(file).toContain(fact);

    // The airline confirms it: the warning goes, and the load still to be collected is told so — rewritten, not added to.
    const confirmed = (await http().post(`${path}/air/booking`).set(bearer(g.token)).send({ bookingStatus: 'confirmed' }).expect(201)).body;
    expect(confirmed.air.warnings.join(' ')).not.toMatch(/has not confirmed/);
    expect(confirmed.consignment.air.formerBookings).toEqual([expect.objectContaining({ bookingStatus: 'queued' })]);
    const posted = dispatch.requireFreightPublic(leg.freightId);
    expect(posted.instructions?.text).not.toMatch(/has not confirmed/);
    expect(posted.instructions?.text).toMatch(/air waybill 706-12345675/);
    // On the road, the driver is told what changed, beside what they were told.
    Object.assign(posted, { status: 'in_transit', pickedUpAt: new Date().toISOString() });
    const later = new Date(Date.now() + 40 * H).toISOString();
    await http().post(`${path}/air/booking`).set(bearer(g.token)).send({ latAt: later }).expect(201);
    expect(dispatch.requireFreightPublic(leg.freightId).instructionAmendments?.at(-1)?.text).toMatch(/^The booking changed: Latest acceptance time now /);
    expect((await read()).consignment.air.formerBookings).toHaveLength(2);
  });
});
