import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EntityService } from '../src/foundation/entity/entity.service';
import { ContactCardService } from '../src/modules/pudo/contact-card.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { ImportService } from '../src/modules/pudo/import.service';
import { NotificationService } from '../src/modules/pudo/notification.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { AGREED } from './agreed';
import { declared } from './declared';

/**
 * LIVE ANIMALS BY AIR, AND A LANDING THAT MAY WAIT FOR MONDAY (the user, 2026-10-30: "build 1 and 2"). Heifers landing at
 * the airport go only to the place the veterinary officer named, never without the vet's release, only on a livestock
 * body, and only once the driver has looked them over and has the original papers. A dog leaving by air goes in a closed
 * vehicle with the shipper's certification. A landing on a weekend, a Friday afternoon or a day the country's own calendar
 * marks closed is warned on the import and, in the three days before, in the bell.
 */
describe('live animals by air, and a landing that may wait — over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

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
    const email = `animals-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${called} ${digits()}`, country: 'KE', registrationNo: `AN-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    return { token, entityId, site };
  }
  const bell = (entityId: string) => app.get(NotificationService).inboxFor(app.get(EntityService).get(entityId).did);

  /** A vetted truck driver near the airport, declared, on the body given. */
  const aTruck = (truckSubtype: string) => {
    const drivers = app.get(DriverService);
    const driver = drivers.register({ displayName: 'Herd', fullName: 'Herd Driver', nationalId: `ID-AN-${digits()}`, mobile: `+2547${digits()}7`, licenceClasses: ['truck'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(driver.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(driver.did, true);
    app.get(FleetService).couple(driver.did, app.get(VehicleService).register({ plate: `KDL ${digits().slice(0, 3)}L`, vehicleClass: 'truck', truckSubtype, capacityKg: 12_000, ownerName: 'X', equipment: ['RMP', 'TLT', 'FLT'], baseFee: 0.5, pricePerKm: 0.1 } as never).vehicleId);
    declared(app, 'driver', driver.did);
    return driver.did;
  };

  const heifers = { kind: 'livestock', species: 'Dairy heifers', count: 20, permit: 'VS03-2026-118', healthCertificate: 'NL-VC-55120', fitToTravel: true, attendantName: 'Kiprono', attendantPhone: '+254700000001' };
  const flight = (lands: string) => ({ awb: '074-12345675', waybillKind: 'master', flights: [{ flight: 'KL 565', date: lands, from: 'AMS', to: 'NBO', arrivesLocal: '06:15' }], handler: 'Swissport livestock shed, JKIA', pieces: 20, weightKg: 9_000, agencies: [] as string[], freeHours: 0 });

  it('heifers by air: the vet’s release always asked, the vet-named place their only end, a livestock body, and the driver’s own look at pickup', async () => {
    const imp = await aBusiness(['importer'], 'Rift Dairy');
    const agent = await aBusiness(['clearing_agent'], 'Pwani Clearing');
    const shed = await imp.site('port', 'Swissport livestock shed, JKIA', { lat: -1.33, lng: 36.93 });
    const farm = await imp.site('delivery', 'Nakuru farm', { lat: -0.3, lng: 36.07 });
    const quarantine = await imp.site('delivery', 'Kabete quarantine station', { lat: -1.25, lng: 36.73 });
    const theirs = await agent.site('delivery', 'Agent’s yard', { lat: -1.3, lng: 36.8 });
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Dairy heifers, 20 head', originCountry: 'NL', destCountry: 'KE', destPort: 'JKIA', mode: 'air' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    await http().post(`${path}/appoint`).set(bearer(imp.token)).send({ agentEntityId: agent.entityId }).expect(201);
    const lands = day(Date.now() + 5 * 24 * H);
    const air = (body: object, token = imp.token) => http().post(`${path}/air`).set(bearer(token)).send(body);

    // The declaration is checked before anything is written; the place is the importer's to name.
    expect(String((await air({ ...flight(lands), animals: { ...heifers, fitToTravel: false } })).body.detail)).toMatch(/an unfit animal is not loaded$/);
    expect(String((await air({ ...flight(lands), animals: { ...heifers, permit: '' } })).body.detail)).toMatch(/^Give the import permit’s number/);
    expect((await air({ ...flight(lands), animals: { ...heifers, quarantineSiteId: theirs } }, agent.token)).status).toBe(403);
    const set = (await air({ ...flight(lands), animals: { ...heifers, quarantineSiteId: quarantine, namedOn: 'Permit VS03-2026-118, Dr Otieno (DVS)' } }).expect(201)).body;
    // The vet's release is asked whatever was ticked.
    expect(set.air.agencies).toEqual([expect.objectContaining({ key: 'dvs' })]);
    expect(set.air.gaps).toContain('the release by Directorate of Veterinary Services (DVS)');
    expect(set.air.animals).toMatchObject({ kind: 'livestock', count: 20, destination: { label: 'Kabete quarantine station', namedOn: 'Permit VS03-2026-118, Dr Otieno (DVS)' }, attendant: { name: 'Kiprono' }, fitToTravel: { by: expect.any(String) } });
    // Recorded again by its agent, the place the importer named stays, and so does the vet's release on the list.
    const again = (await air({ ...flight(lands), agencies: ['kebs'], animals: heifers }, agent.token).expect(201)).body;
    expect(again.air.animals.destination.label).toBe('Kabete quarantine station');
    expect(again.air.agencies.map((a: { key: string }) => a.key)).toEqual(['kebs', 'dvs']);

    // The road leg goes to the vet-named place and nowhere else — chosen elsewhere, refused; chosen nowhere, it goes there.
    expect(String((await http().post(`${path}/road-leg`).set(bearer(imp.token)).send({ pickupSiteId: shed, destSiteId: farm, weightKg: 9_000 })).body.detail)).toBe('Live animals go only to the place the veterinary officer named: Kabete quarantine station');
    const leg = (await http().post(`${path}/road-leg`).set(bearer(imp.token)).send({ pickupSiteId: shed, weightKg: 9_000 }).expect(201)).body;
    const dispatch = app.get(DispatchService);
    const load = () => dispatch.requireFreightPublic(leg.roadFreightId);
    expect(load()).toMatchObject({ destLabel: 'Kabete quarantine station', liveAnimals: { kind: 'livestock', species: 'Dairy heifers', count: 20 } });
    expect(load().instructions?.text).toMatch(/Live animals: 20 Dairy heifers\. Kiprono \(\+254700000001\) looks after them on the way\./);
    expect(load().instructions?.text).toMatch(/The originals ride with them: the veterinary health certificate NL-VC-55120, the import permit VS03-2026-118\./);
    // Once a truck is posted for it, the place does not change.
    expect(String((await air({ ...flight(lands), animals: { ...heifers, quarantineSiteId: farm } })).body.detail)).toMatch(/^The road leg is posted to Kabete quarantine station/);

    // Released — customs, the vet, standards, the delivery order — and offered only to a livestock body.
    const step = (body: object) => http().post(`${path}/air/release`).set(bearer(agent.token)).send(body).expect(201);
    await step({ step: 'customs', reference: '2026NBOIM551' });
    await step({ step: 'dvs', reference: 'DVS-REL-88' });
    await step({ step: 'kebs', reference: 'KEBS-1' });
    await step({ step: 'delivery_order', reference: 'DO-9' });
    const from = load().pickupLocation;
    const flatbed = aTruck('flatbed');
    const blocked = dispatch.board({ driverDid: flatbed, from }).find((r) => r.freightId === leg.roadFreightId)?.blockers.find((b) => b.code === 'ANIMALS_VEHICLE')?.message;
    expect(blocked).toBe('20 Dairy heifers go on a livestock body — an anti-slip floor, partitions, a ramp with sides, and air when it stands.');
    expect(dispatch.suggest(flatbed, { from, to: from }).some((o) => o.ref === leg.roadFreightId)).toBe(false);
    // The take refuses it too, whatever offer it came from: one made before the load said it carried animals.
    const plain = dispatch.registerFreight({ description: 'Feed, 40 bags', pickupLocation: from, pickupLabel: 'Swissport livestock shed, JKIA', destLabel: 'Kabete', destLocation: { lat: -1.25, lng: 36.73 }, weightKg: 900, packaging: 'palletised' } as never);
    const early = dispatch.suggest(flatbed, { from, to: from }).find((o) => o.ref === plain.freightId);
    expect(early).toBeDefined();
    Object.assign(dispatch.requireFreightPublic(plain.freightId), { liveAnimals: { kind: 'livestock', species: 'Goats', count: 30 } });
    expect(() => dispatch.claim(early!.offerId)).toThrow(/^30 Goats go on a livestock body/);
    const livestock = aTruck('livestock');
    expect(dispatch.board({ driverDid: livestock, from }).find((r) => r.freightId === leg.roadFreightId)?.blockers.map((b) => b.code) ?? []).not.toContain('ANIMALS_VEHICLE');
    const offer = dispatch.suggest(livestock, { from, to: from }).find((o) => o.ref === leg.roadFreightId);
    expect(offer).toBeDefined();
    dispatch.claim(offer!.offerId);

    // At pickup the driver looks them over and has the originals — the same list the app shows.
    const shown = dispatch.claimsFor(livestock).find((c) => c.ref === leg.roadFreightId)!;
    const keys = shown.loadChecklist!.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['animals_fit', 'animals_papers', 'animals_cleaned', 'animals_air', 'animals_ramp']));
    const base = keys.filter((k) => !k.startsWith('animals_'));
    expect(() => dispatch.pickupFreight(leg.roadFreightId, livestock, { confirmed: base })).toThrow(/load-safety checklist before pickup — 5 item\(s\) left/);
    expect(() => dispatch.pickupFreight(leg.roadFreightId, livestock, { confirmed: keys })).toThrow(/^Attach a photo of the secured load/);
  });

  it('a dog leaves by air: the shipper’s certification, a closed vehicle, its health certificate on the papers — and chicks past their 72 hours are said', async () => {
    const x = await aBusiness(['shipper'], 'Karen Kennels');
    const home = await x.site('loading', 'Karen kennels', { lat: -1.32, lng: 36.71 });
    const terminal = await x.site('port', 'KQ cargo centre, JKIA', { lat: -1.33, lng: 36.92 });
    const lat = Date.now() + 30 * H;
    const base = { goodsDescription: 'A dog, in its kennel', originCountry: 'KE', destCountry: 'NL', bookedWith: 'airline', partyName: 'Kenya Airways Cargo', loadingSiteId: home, terminalSiteId: terminal, air: { awb: '706-12345675', waybillKind: 'direct', bookingStatus: 'confirmed', flights: [{ flight: 'KQ 116', date: day(lat), from: 'NBO', to: 'AMS' }], latAt: new Date(lat).toISOString(), pieces: 1, weightKg: 40, security: { status: 'unsecured' } } };
    const dog = { kind: 'crated', species: 'Dog (Labrador)', count: 1, permit: 'NL-IMP-2026-77', healthCertificate: 'KE-DVS-HC-4410', fitToTravel: true };
    const post = (animals: object) => http().post('/v1/sbg/exports/air').set(bearer(x.token)).send({ ...base, air: { ...base.air, animals } });
    expect(String((await post(dog)).body.detail)).toMatch(/shipper’s certification for live animals/);
    // Biological goods stay refused; live animals are declared as such.
    expect(String((await http().post('/v1/sbg/exports/air').set(bearer(x.token)).send({ ...base, natureCode: 'HAZ-BIO' })).body.detail)).toMatch(/^Biological goods — samples, medical waste — are not carried to an airport on SeeBuyGet yet\. Live animals are declared as live animals/);
    const made = (await post({ ...dog, shipperCertifiedBy: 'Achieng Otieno' }).expect(201)).body;
    expect(made.air.animals).toMatchObject({ kind: 'crated', shipperCertifiedBy: 'Achieng Otieno' });
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = (await http().get(path).set(bearer(x.token)).expect(200)).body;
    expect(read.papers.map((p: { key: string }) => p.key)).toContain('health_certificate');
    expect(read.air.warnings.join(' ')).toMatch(/Live animals: 1 Dog \(Labrador\), on a closed vehicle with air\./);
    const leg = (await http().post(`${path}/laden-leg`).set(bearer(x.token)).send({}).expect(201)).body.ladenLeg;
    const load = app.get(DispatchService).requireFreightPublic(leg.freightId);
    expect(load.liveAnimals).toEqual({ kind: 'crated', species: 'Dog (Labrador)', count: 1 });
    expect(load.instructions?.text).toMatch(/Keep the crates upright, their air holes clear\./);

    // Day-old chicks hatched 80 hours before the latest acceptance time: past their 72 before they have even flown.
    const chicks = (await post({ kind: 'crated', species: 'Day-old chicks', count: 4000, permit: 'UG-IMP-31', healthCertificate: 'KE-DVS-HC-4411', fitToTravel: true, shipperCertifiedBy: 'Achieng Otieno', hatchedAt: new Date(lat - 80 * H).toISOString() }).expect(201)).body;
    const chickRead = (await http().get(`/v1/sbg/exports/${chicks.exportId}`).set(bearer(x.token)).expect(200)).body;
    expect(chickRead.air.warnings.join(' ')).toMatch(/They hatched 80 hours before the latest acceptance time: past the 72 hours/);
  });

  it('a landing on a Saturday, a Friday afternoon or a day the country’s calendar marks closed is warned — and told in the bell before, once', async () => {
    const imp = await aBusiness(['importer'], 'Thika Phones');
    const agent = await aBusiness(['clearing_agent'], 'Mombasa Clearing');
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Mobile phones, 12 cartons', originCountry: 'NL', destCountry: 'KE', destPort: 'JKIA', mode: 'air' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    await http().post(`${path}/appoint`).set(bearer(imp.token)).send({ agentEntityId: agent.entityId }).expect(201);
    // The next Saturday, at least a day off.
    let sat = Date.now() + 24 * H;
    while (new Date(sat).getUTCDay() !== 6) sat += 24 * H;
    const saturday = day(sat);
    const set = (await http().post(`${path}/air`).set(bearer(imp.token)).send({ ...flight(saturday), handler: 'Swissport cargo shed, JKIA', agencies: ['kebs'] }).expect(201)).body;
    expect(set.air.arrival).toMatchObject({ kind: 'saturday', landsOn: saturday, offices: ['customs verification (KRA)', 'Kenya Bureau of Standards (KEBS)'] });
    expect(set.air.warnings[0]).toMatch(/Form C\.1, at least 24 hours before/);

    // In the three days before, the importer and its agent are told — once.
    const service = app.get(ImportService);
    const before = Date.parse(`${saturday}T00:00:00Z`) - 48 * H;
    expect(service.sweepAir(Date.parse(`${saturday}T00:00:00Z`) - 5 * 24 * H)).not.toContain(`${made.code}:air:arrival`);
    expect(service.sweepAir(before)).toContain(`${made.code}:air:arrival`);
    expect(service.sweepAir(before + H)).not.toContain(`${made.code}:air:arrival`);
    const told = (id: string) => bell(id).filter((n) => n.title === `${made.code}: the release may wait for the next working day`);
    expect(told(imp.entityId)).toHaveLength(1);
    expect(told(agent.entityId)).toHaveLength(1);
    // Once it has landed — the notice recorded — nothing more is said about its landing.
    await http().post(`${path}/air/release`).set(bearer(agent.token)).send({ step: 'notified', at: new Date(Date.now() - H).toISOString() }).expect(201);
    expect((await http().get(path).set(bearer(imp.token)).expect(200)).body.air.arrival).toBeDefined();

    // A Friday afternoon; and a Wednesday the country's own calendar marks closed — its company and its note.
    let fri = Date.now() + 24 * H;
    while (new Date(fri).getUTCDay() !== 5) fri += 24 * H;
    const friday = (await http().post(`${path}/air`).set(bearer(imp.token)).send({ ...flight(day(fri)), flights: [{ flight: 'KL 565', date: day(fri), from: 'AMS', to: 'NBO', arrivesLocal: '15:40' }], handler: 'Swissport cargo shed, JKIA', agencies: [] }).expect(201)).body;
    expect(friday.air.arrival).toMatchObject({ kind: 'friday_late' });
    let wed = Date.now() + 24 * H;
    while (new Date(wed).getUTCDay() !== 3) wed += 24 * H;
    const contacts = app.get(ContactCardService);
    const ke = app.get(EntityService).forJurisdiction('KE')!;
    const kept = contacts.of(ke.entityId)?.closedDates ?? [];
    contacts.set(ke.entityId, { closedDates: [...kept, { date: day(wed), note: 'Public holiday' }] }, 'Test');
    try {
      const holiday = (await http().post(`${path}/air`).set(bearer(imp.token)).send({ ...flight(day(wed)), handler: 'Swissport cargo shed, JKIA', agencies: [] }).expect(201)).body;
      expect(holiday.air.arrival).toMatchObject({ kind: 'holiday' });
      expect(holiday.air.arrival.text).toMatch(new RegExp(`calendar marks closed \\(Public holiday\\)`));
    } finally {
      contacts.set(ke.entityId, { closedDates: kept }, 'Test');
    }
    // A plain Wednesday says nothing.
    const plain = (await http().post(`${path}/air`).set(bearer(imp.token)).send({ ...flight(day(wed)), handler: 'Swissport cargo shed, JKIA', agencies: [] }).expect(201)).body;
    expect(plain.air.arrival).toBeUndefined();
    expect(plain.air.warnings).toEqual([]);
    expect(operator).toBeTruthy();
  });
});
