import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { FleetService, MIN_REST_HOURS } from '../src/modules/pudo/fleet.service';
import { MonitorService } from '../src/modules/pudo/monitor.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { VehicleCareService } from '../src/modules/pudo/vehicle-care.service';
import { AGREED } from './agreed';

/**
 * A READING AND A SHIFT'S END KEEP THEIR TIME, over the wire (round 24, the user: "Readings keep their time"; a too-warm
 * reading that reached us late — "When it was read, and that it came late"). A cold-chain temperature read with no signal
 * is dated when it was read, and a breach heard of late says so on the control tower's flag and on the consignment note.
 * A shift ended with no signal ends when the driver ended it — never before their phone was last heard from on it — and
 * the rest they owe is counted from then.
 */
describe('a reading and a shift’s end keep their time, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const near = (a: string | undefined, b: number) => expect(Math.abs(Date.parse(a!) - b)).toBeLessThan(5_000);
  const PIN = '48261';

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

  /** A driver signed in to the driver app on their own phone, with a vehicle of their own. */
  async function aDriver(): Promise<{ did: string; token: string; vehicleId: string }> {
    const phone = `+2547${digits()}2`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Achieng', fullName: 'Achieng Reefer', nationalId: `ID-RDG-${digits()}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE' }).expect(201);
    const did = onboarded.body.did as string;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `rdg${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    const bike = app.get(VehicleService).register({ plate: `RDG-${digits()}`, vehicleClass: 'bike', capacityKg: 30, ownerName: 'Achieng Reefer', ownerDriverDid: did } as never);
    return { did, token: session.body.token.access_token as string, vehicleId: bike.vehicleId };
  }

  it('dates a temperature by the phone, never before the taking over or the reading before it — and a late breach says so', async () => {
    const driver = await aDriver();
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `rdg-biz-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Highland Dairy ${digits()}`, country: 'KE', registrationNo: `RDG-${digits()}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
    const { freightId, code } = (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description: 'Fresh milk, chilled', pickupLocation: { lat: -1.31, lng: 36.84 }, pickupLabel: 'Highland dairy', destLabel: 'Nakuru cold store', destLocation: { lat: -0.3, lng: 36.08 }, weightKg: 300, packaging: 'palletised', natureCode: 'FOP' }).expect(201)).body;
    // On the road since three hours ago, with this driver.
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const tookOver = Date.now() - 3 * H;
    store.set(freightId, { ...store.get(freightId), status: 'in_transit', claimedBy: driver.did, claimedAt: iso(tookOver - H), pickedUpAt: iso(tookOver) });
    const read = async (celsius: number, at?: number) =>
      (await http().post(`/v1/sbg/dispatch/freight/${freightId}/temperature`).set(bearer(driver.token)).send({ driverDid: driver.did, celsius, ...(at ? { observedAt: iso(at) } : {}) }).expect(201)).body.tempReadings as Array<{ celsius: number; at: string; receivedAt?: string; breach: boolean }>;

    // A phone that says it read one before the load was taken over: never before the taking over.
    expect((await read(5, Date.now() - 4 * H))[0]).toMatchObject({ celsius: 5, at: iso(tookOver), breach: false });
    // Read two and a half hours ago with no signal, sent now: dated then, and when it reached us kept beside it.
    const second = Date.now() - 150 * 60_000;
    const r2 = (await read(5.5, second))[1];
    expect(r2).toMatchObject({ celsius: 5.5, at: iso(second) });
    near(r2.receivedAt, Date.now());
    // Too warm two hours ago, heard of now.
    const warm = Date.now() - 2 * H;
    const r3 = (await read(12, warm))[2];
    expect(r3).toMatchObject({ celsius: 12, at: iso(warm), breach: true });
    near(r3.receivedAt, Date.now());
    // A reading the phone dates before the one before it: never before it.
    expect((await read(6, Date.now() - 3 * H))[3].at).toBe(iso(warm));
    // A reading sent as it is read keeps no second time.
    const live = (await read(4))[4];
    near(live.at, Date.now());
    expect(live.receivedAt).toBeUndefined();

    // The control tower's flag says when the load was too warm, and that we heard of it later.
    const flag = app.get(MonitorService).flags().find((f) => f.type === 'Temp_Breach' && f.subject === code)!;
    expect(flag.detail).toContain(`12 °C at ${iso(warm).slice(0, 10)} ${iso(warm).slice(11, 16)} UTC — read with no signal; reached us`);
    // So does the consignment note, in its reservations.
    const note = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/consignment-note`).set(bearer(biz)).expect(200)).body;
    expect((note.reservations as string[]).find((r) => r.startsWith('Cold chain breached in transit'))).toMatch(/^Cold chain breached in transit: 12 °C read .+; done with no signal on the driver's phone, which dated it, and received by SeeBuyGet on .+ — see the temperature log$/);
  });

  it('ends a shift when the driver ended it — never before the phone was last heard from — and the rest runs from then', async () => {
    const fleet = app.get(FleetService);
    const end = async (d: { did: string; token: string }, at: number, odometerKm?: number) =>
      (await http().post(`/v1/sbg/fleet/drivers/${d.did}/end-session`).set(bearer(d.token)).send({ observedAt: iso(at), ...(odometerKm !== undefined ? { odometerKm } : {}) }).expect(201)).body;
    const aLongDay = (d: { did: string; vehicleId: string }, heardHoursAgo: number) => {
      fleet.couple(d.did, d.vehicleId);
      const shift = fleet.activeForDriver(d.did)!;
      shift.startedAt = iso(Date.now() - 12 * H);
      shift.lastLocatedAt = iso(Date.now() - heardHoursAgo * H);
    };

    // A twelve-hour day, last heard from three hours ago, ended two hours ago with no signal and sent now.
    const wanjiru = await aDriver();
    aLongDay(wanjiru, 3);
    const endedAt = Date.now() - 2 * H;
    const ended = await end(wanjiru, endedAt, 15_230);
    expect(ended.endedAt).toBe(iso(endedAt));
    near(ended.endReceivedAt, Date.now());
    // The rest owed is counted from the end, not from when we heard of it.
    const hours = (await http().get(`/v1/sbg/fleet/drivers/${wanjiru.did}/session`).set(bearer(wanjiru.token)).expect(200)).body.hours;
    expect(hours.restUntil).toBe(iso(endedAt + MIN_REST_HOURS * H));
    // The odometer read as it ended is dated then too.
    expect(ended.odometer).toMatchObject({ kept: true });
    expect(app.get(VehicleCareService).latestReading(wanjiru.vehicleId)).toMatchObject({ km: 15_230, at: iso(endedAt), source: 'shift_end' });

    // Ended "five hours ago" by a phone heard from three hours ago: not before then — a rest cannot be shortened by a clock.
    const otieno = await aDriver();
    aLongDay(otieno, 3);
    const lastHeard = Date.parse(fleet.activeForDriver(otieno.did)!.lastLocatedAt!);
    expect((await end(otieno, Date.now() - 5 * H)).endedAt).toBe(iso(lastHeard));

    // Staff standing in end it now, whatever time is sent.
    const kamau = await aDriver();
    aLongDay(kamau, 3);
    const byStaff = (await http().post(`/v1/sbg/fleet/drivers/${kamau.did}/end-session`).set(bearer(operator)).send({ observedAt: iso(Date.now() - 2 * H) }).expect(201)).body;
    near(byStaff.endedAt, Date.now());
    expect(byStaff.endReceivedAt).toBeUndefined();
  });
});
