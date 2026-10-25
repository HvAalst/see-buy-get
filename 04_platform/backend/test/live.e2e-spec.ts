import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { NotificationService } from '../src/modules/pudo/notification.service';
import { LiveService } from '../src/modules/pudo/live.service';

/**
 * ONE LIVE VIEW, over a real connection (the user, 2026-10-25: "Console and fleet offices"). The unit spec proves who is
 * told what; this proves what it cannot: that the stream is mounted and speaks server-sent events through the booted
 * application's guards and interceptors, that it opens only for the console and fleet offices, that a write reaches the
 * console and its own fleet's office and no other, and that a closed page is forgotten.
 */
describe('the live view, over the wire', () => {
  let app: INestApplication;
  let base = '';
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let operator = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    base = `http://127.0.0.1:${address.port}`;
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aFleet(name: string): Promise<{ did: string; token: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: name, contactPhone: `+2548${n}0`, ownerFullName: 'O O', ownerNationalId: `MGR-LIV-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-LIV-${n}`, transportOperatorLicence: `TOL-LIV-${n}`, taxId: `TAX-LIV-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const token = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: m.did, token };
  }

  async function aDriver(fleetDid: string): Promise<{ did: string; token: string }> {
    const drivers = app.get(DriverService);
    const n = digits();
    const d = drivers.register({ displayName: `Live ${n}`, fullName: `L ${n}`, nationalId: `ID-LIV-${n}`, mobile: `+2547${n}2`, licenceClasses: ['truck'], licenceNumber: `L-LIV-${n}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: fleetDid });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, tenant: fleetDid, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: d.did, token };
  }

  /** Open the stream as a browser would (fetch, with the sign-in in a header), and keep what it says. */
  async function listen(token?: string): Promise<{ status: number; type: string; events: Array<{ type: string; data: { topics?: string[] } }>; heard: (pred: (e: { type: string; data: { topics?: string[] } }) => boolean, ms?: number) => Promise<boolean>; close: () => void }> {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/v1/sbg/live`, { headers: { accept: 'text/event-stream', ...(token ? bearer(token) : {}) }, signal: ctrl.signal });
    const events: Array<{ type: string; data: { topics?: string[] } }> = [];
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            carry += decoder.decode(value, { stream: true });
            const frames = carry.split('\n\n');
            carry = frames.pop() ?? '';
            for (const frame of frames) {
              const type = /^event: (.*)$/m.exec(frame)?.[1];
              const data = /^data: (.*)$/m.exec(frame)?.[1];
              if (type) events.push({ type, data: data ? JSON.parse(data) : {} });
            }
          }
        } catch {
          /* closed */
        }
      })();
    } else {
      await res.body?.cancel();
    }
    const heard = async (pred: (e: { type: string; data: { topics?: string[] } }) => boolean, ms = 3000): Promise<boolean> => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (events.some(pred)) return true;
        await new Promise((r) => setTimeout(r, 20));
      }
      return events.some(pred);
    };
    return { status: res.status, type: res.headers.get('content-type') ?? '', events, heard, close: () => ctrl.abort() };
  }

  it('opens for the console and a fleet office only, as server-sent events', async () => {
    const kilima = await aFleet('Kilima Live');
    const amos = await aDriver(kilima.did);

    const desk = await listen(operator);
    expect(desk.status).toBe(200);
    expect(desk.type).toMatch(/^text\/event-stream/);
    expect(await desk.heard((e) => e.type === 'live')).toBe(true);
    const office = await listen(kilima.token);
    expect(office.status).toBe(200);
    expect(await office.heard((e) => e.type === 'live')).toBe(true);

    // A driver's phone is on push (as a shop's or a business's is: live.spec.ts); somebody not signed in gets nothing.
    expect((await listen(amos.token)).status).toBe(403);
    expect((await listen()).status).toBe(401);
    desk.close();
    office.close();
  });

  it('tells the console and the fleet a driver acts for of the driver’s write, and no other fleet', async () => {
    const kilima = await aFleet('Kilima Writes');
    const pwani = await aFleet('Pwani Writes');
    const amos = await aDriver(kilima.did);
    const day = new Date(Date.parse(`${app.get(FleetManagerService).todayOf(kilima.did)}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

    const desk = await listen(operator);
    const kilimaOffice = await listen(kilima.token);
    const pwaniOffice = await listen(pwani.token);
    for (const s of [desk, kilimaOffice, pwaniOffice]) expect(await s.heard((e) => e.type === 'live')).toBe(true);

    // The Kilima office sets tomorrow's roster: a write in Kilima's name.
    await http().post(`/v1/sbg/fleet/managers/${kilima.did}/roster`).set(bearer(kilima.token)).send({ day, driverDids: [amos.did] }).expect(201);
    expect(await desk.heard((e) => e.type === 'changed' && Boolean(e.data.topics?.includes('changed')))).toBe(true);
    expect(await kilimaOffice.heard((e) => e.type === 'changed' && Boolean(e.data.topics?.includes('changed')))).toBe(true);

    // A notice into Kilima's bell: its office hears "bell".
    await app.get(NotificationService).notify(kilima.did, { kind: 'order_late', title: 'An order running late', body: 'Jenga Ltd, bricks' });
    expect(await kilimaOffice.heard((e) => e.type === 'changed' && Boolean(e.data.topics?.includes('bell')))).toBe(true);

    // Pwani heard none of it.
    expect(pwaniOffice.events.filter((e) => e.type === 'changed')).toEqual([]);

    // A closed page is forgotten.
    const before = app.get(LiveService).count();
    desk.close();
    kilimaOffice.close();
    pwaniOffice.close();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && app.get(LiveService).count().fleets > before.fleets - 2) await new Promise((r) => setTimeout(r, 20));
    expect(app.get(LiveService).count()).toEqual({ console: before.console - 1, fleets: before.fleets - 2 });
  });
});
