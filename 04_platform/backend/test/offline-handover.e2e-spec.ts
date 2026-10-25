import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { AGREED } from './agreed';

/**
 * A HANDOVER DONE WITH NO SIGNAL KEEPS ITS TIME, over the wire (round 22, the user: "Offline handovers keep their time";
 * "Within limits, both kept"). A pickup and a delivery sent hours after they were done are dated when they were done —
 * the phone's word within limits: never in the future, never before the step before it — and the moment they reached
 * us is kept beside them and said on the consignment note.
 */
describe('a handover done with no signal keeps its time, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const H = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  const photo = async (token: string, kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(bearer(token)).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };

  it('dates a pickup and a delivery by the phone, within limits — and keeps, and says, when each reached us', async () => {
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}8`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `offline-${tag}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Rift Millers ${tag}`, country: 'KE', registrationNo: `OFF-${tag}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: 'Wanjiru', fullName: 'Wanjiru Truck', nationalId: `DRV-O-${tag}`, mobile: `+2547${String(Date.now()).slice(-6)}9`, licenceClasses: ['truck'], licenceNumber: `DL-O-${tag}`, licenceExpiresAt: '2030-01-01' }).expect(201);
    const driver = { did: onboarded.body.did as string, token: (await http().post('/v1/auth/token').send({ role: 'driver', did: onboarded.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string };
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const claimedAt = Date.now() - 3 * H;

    /** A load Nairobi to Nakuru, claimed by the driver three hours ago. */
    const aLoad = async () => {
      const { freightId } = (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description: 'Wheat flour, bagged', pickupLocation: { lat: -1.31, lng: 36.84 }, pickupLabel: 'Rift mill', destLabel: 'Nakuru depot', destLocation: { lat: -0.3, lng: 36.08 }, weightKg: 400, packaging: 'bagged', packages: 8 }).expect(201)).body;
      store.set(freightId, { ...store.get(freightId), status: 'claimed', claimedBy: driver.did, claimedAt: iso(claimedAt) });
      const claim = (await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(bearer(driver.token)).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId);
      return { freightId: freightId as string, claim };
    };
    const pickUp = async (l: { freightId: string; claim: { loadChecklist: Array<{ key: string }> } }, observedAt?: number) =>
      (await http().post(`/v1/sbg/dispatch/freight/${l.freightId}/pickup`).set(bearer(driver.token)).send({ confirmed: l.claim.loadChecklist.map((x) => x.key), securementPhotoId: await photo(driver.token, 'securement'), ...(observedAt ? { observedAt: iso(observedAt) } : {}) }).expect(201)).body;
    const deliver = async (l: { freightId: string; claim: { unloadChecklist: Array<{ key: string }> } }, observedAt?: number) =>
      (await http().post(`/v1/sbg/dispatch/freight/${l.freightId}/deliver`).set(bearer(driver.token)).send({ confirmed: l.claim.unloadChecklist.map((x) => x.key), receiverName: 'Otieno at the depot', podPhotoId: await photo(driver.token, 'pod'), ...(observedAt ? { observedAt: iso(observedAt) } : {}) }).expect(201)).body;
    const near = (a: string | undefined, b: number) => expect(Math.abs(Date.parse(a!) - b)).toBeLessThan(5_000);

    // Done two hours ago with no signal, sent now: dated two hours ago, and when it reached us kept beside it.
    const a = await aLoad();
    const pickedA = Date.now() - 2 * H;
    const takenA = await pickUp(a, pickedA);
    expect(takenA.pickedUpAt).toBe(iso(pickedA));
    near(takenA.pickupReceivedAt, Date.now());
    const deliveredA = Date.now() - 30 * 60_000;
    const handedA = await deliver(a, deliveredA);
    expect(handedA.deliveredAt).toBe(iso(deliveredA));
    near(handedA.deliveryReceivedAt, Date.now());
    // The consignment note says so, beside the times it states.
    const note = (await http().get(`/v1/sbg/dispatch/freight/${a.freightId}/consignment-note`).set(bearer(biz)).expect(200)).body;
    expect(note.confirmations.carrier).toMatchObject({ at: iso(pickedA), how: expect.stringContaining("done with no signal on the driver's phone") });
    expect(note.confirmations.consignee.how).toMatch(/done with no signal on the driver's phone, which dated it, and received by SeeBuyGet on \d{4}-\d{2}-\d{2} at \d{2}:\d{2} UTC/);

    // A phone that says it before the claim: held back to the claim. A delivery it says before the pickup: to the pickup.
    const b = await aLoad();
    expect((await pickUp(b, claimedAt - 2 * H)).pickedUpAt).toBe(iso(claimedAt));
    const pickedB = Date.parse(store.get(b.freightId).pickedUpAt as string);
    expect((await deliver(b, pickedB - H)).deliveredAt).toBe(iso(pickedB));

    // A phone clock running ahead: now, never the future — and nothing kept beside it. Said with no time at all: as before.
    const c = await aLoad();
    const ahead = await pickUp(c, Date.now() + 5 * H);
    near(ahead.pickedUpAt, Date.now());
    expect(ahead.pickupReceivedAt).toBeUndefined();
    const plain = await deliver(c);
    near(plain.deliveredAt, Date.now());
    expect(plain.deliveryReceivedAt).toBeUndefined();

    // A contract order handed over two hours before it reached us: read against its day and window at the HANDOVER.
    const managers = app.get(FleetManagerService);
    const n = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
    const fleet = managers.register({ companyName: `Rift Fleet ${n}`, contactPhone: `+2548${n}4`, contactEmail: `off-${tag}-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-OFF-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-OFF-${n}`, transportOperatorLicence: `TOL-OFF-${n}`, taxId: `TAX-OFF-${n}` } });
    const nairobi = (ms: number) => ({ day: new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }), clock: new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }) });
    const d = await aLoad();
    const handedD = Date.now() - 2 * H;
    store.set(d.freightId, { ...store.get(d.freightId), contract: { contractId: `cc_off_${tag}`, fleetDid: fleet.did, fleetName: fleet.companyName, shipperName: 'Rift Millers' }, deliverOn: nairobi(handedD).day });
    await pickUp(d, handedD - 30 * 60_000);
    expect((await deliver(d, handedD)).deliveryTiming).toMatchObject({ timeZone: 'Africa/Nairobi', day: nairobi(handedD).day, at: nairobi(handedD).clock });
  });
});
