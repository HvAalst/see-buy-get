import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * WHO POSTS A LOAD (found 2026-10-27). A person signed in to the Send app could post a load on the board: nobody was billed
 * for it, and the network would have paid its driver at delivery — the free freight the Send app already refuses for a send
 * too big for a parcel ("personal freight booking is coming"). A person is refused, before anything is written; a business
 * still posts its own, settled between it and its carrier.
 */
describe('who posts a load on the board', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const load = { description: 'Sofa, wrapped', pickupLocation: { lat: -1.28, lng: 36.82 }, pickupLabel: 'Gikomba', destLabel: 'Kitengela', destLocation: { lat: -1.47, lng: 36.96 }, weightKg: 80, packaging: 'piece', packages: 1 };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aPerson(): Promise<string> {
    const phone = `+2547${digits()}4`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `load${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    return (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
  }

  it('a person in the Send app is refused — nobody would be billed, and the network would pay the driver', async () => {
    const person = await aPerson();
    const refused = await http().post('/v1/sbg/dispatch/freight').set(bearer(person)).send(load);
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([403, 'FORBIDDEN', 'Booking your own freight in the Send app is coming. Until then, a shop books it at its counter, or a business posts it.']);
  });

  it('a business still posts its own, settled between it and its carrier', async () => {
    const person = await aPerson();
    const made = await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Jenga Bricks ${digits()}`, country: 'KE', registrationNo: `REG-WPL-${digits()}`, activities: ['shipper'], yourName: 'Achieng' }).expect(201);
    const posted = (await http().post('/v1/sbg/dispatch/freight').set(bearer(made.body.token.access_token)).send(load).expect(201)).body;
    expect(posted).toMatchObject({ status: 'available', settlement: 'between_parties' });
  });
});
